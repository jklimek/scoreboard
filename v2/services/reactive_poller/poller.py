from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

from v2.services.match_orchestrator import MatchOrchestrator, StateStore
from v2.services.stats_engine import StatsEngine
from v2.shared.contracts import (
    OverlayEvent,
    OverlayEventKind,
    PollerLifecycleState,
    PollerMetrics,
    PossessionState,
    ScoreState,
    TeamState,
    TimerState,
)

from .errors import PollerError, PollerThrottleError
from .rate_controller import AdaptiveRateController
from .ultiscores_client import UltiScoresClient


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


class ReactivePoller:
    SCORE_EVENT_DISPLAY_MS = 9000
    TIMEOUT_EVENT_DISPLAY_MS = 50000
    POSSESSION_EVENT_DISPLAY_MS = 1500

    def __init__(
        self,
        client: UltiScoresClient,
        orchestrator: MatchOrchestrator,
        state_store: StateStore,
        stats_engine: StatsEngine,
        *,
        base_interval: float = 1.0,
        min_interval: float = 0.5,
        max_interval: float = 5.0,
        schedule_interval_seconds: float = 30.0,
        healthy_streak_for_recovery: int = 4,
        circuit_breaker_error_threshold: int = 5,
        circuit_breaker_cooldown_seconds: float = 20.0,
        on_state_change: Optional[Callable[[], Awaitable[None]]] = None,
    ) -> None:
        self.client = client
        self.orchestrator = orchestrator
        self.state_store = state_store
        self.stats_engine = stats_engine
        self.schedule_interval_seconds = schedule_interval_seconds
        self.on_state_change = on_state_change
        self.circuit_breaker_error_threshold = circuit_breaker_error_threshold
        self.circuit_breaker_cooldown_seconds = circuit_breaker_cooldown_seconds

        self.rate = AdaptiveRateController(
            base_interval=base_interval,
            min_interval=min_interval,
            max_interval=max_interval,
            healthy_streak_for_recovery=healthy_streak_for_recovery,
        )
        self.metrics = PollerMetrics(
            state=PollerLifecycleState.STOPPED,
            enabled=False,
            current_interval_seconds=base_interval,
        )
        self._task: Optional[asyncio.Task[None]] = None
        self._stop_event = asyncio.Event()
        self._last_schedule_fetch = 0.0

        self._last_game_id: Optional[int] = None
        self._players: Dict[str, Dict[str, str]] = {"a": {}, "h": {}}
        self._events: List[Dict[str, Any]] = []
        self._breaker_until_monotonic: float = 0.0
        self._last_event_offset_seconds: Optional[float] = None
        self._last_event_seen_unix_ms: Optional[int] = None
        self._processed_event_count: int = 0
        self._events_initialized: bool = False
        self._overlay_events: List[OverlayEvent] = []
        self._manual_overlay_events: List[OverlayEvent] = []
        self._current_possession: PossessionState = PossessionState()
        self._team_short_names: Dict[str, str] = {"a": "AWY", "h": "HOM"}

    async def emit_manual_overlay_event(self, event: OverlayEvent) -> None:
        self._manual_overlay_events.append(event)
        if len(self._manual_overlay_events) > 20:
            self._manual_overlay_events = self._manual_overlay_events[-20:]
        await self._publish_overlay_events_to_state_store()

    async def clear_manual_overlay(self) -> None:
        self._manual_overlay_events = []
        clear_event = OverlayEvent(
            id=f"manual-clear:{int(round(time.time() * 1000))}",
            kind=OverlayEventKind.CLEAR_OVERLAY,
            display_ms=1200,
            title="",
            primary_text="",
            secondary_text="",
            meta={},
        )
        await self._publish_overlay_events_to_state_store(extra_event=clear_event)

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event.clear()
        self.metrics.state = PollerLifecycleState.STARTING
        await self._publish_metrics()
        self._task = asyncio.create_task(self._run(), name="v2-reactive-poller")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self.metrics.state = PollerLifecycleState.STOPPED
        self.metrics.enabled = False
        await self._publish_metrics()

    async def set_enabled(self, enabled: bool) -> None:
        if enabled and (self._task is None or self._task.done()):
            await self.start()
        self.metrics.enabled = enabled
        await self.orchestrator.set_polling_enabled(enabled)
        if not enabled:
            self.metrics.state = PollerLifecycleState.IDLE
        elif self.metrics.state in {PollerLifecycleState.STOPPED, PollerLifecycleState.IDLE}:
            self.metrics.state = PollerLifecycleState.RUNNING
        await self._publish_metrics()

    async def _run(self) -> None:
        self.metrics.state = PollerLifecycleState.IDLE
        await self._publish_metrics()

        try:
            while not self._stop_event.is_set():
                now = time.monotonic()
                if now - self._last_schedule_fetch >= self.schedule_interval_seconds:
                    await self._poll_schedule()
                    self._last_schedule_fetch = now

                if not self.metrics.enabled:
                    await asyncio.sleep(1.0)
                    continue

                game_id = self.orchestrator.get_selected_game_id()
                if not game_id:
                    await asyncio.sleep(1.0)
                    continue

                now = time.monotonic()
                if self._breaker_until_monotonic > now:
                    self.metrics.state = PollerLifecycleState.ERROR
                    await self._publish_metrics()
                    await asyncio.sleep(min(1.5, self._breaker_until_monotonic - now))
                    continue

                await self._poll_live_match(game_id)
                await asyncio.sleep(self.rate.with_jitter())
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.metrics.error_count += 1
            self.metrics.last_error_at = _utcnow()
            self.metrics.last_error_message = f"Poller task crashed: {exc}"
            self.metrics.state = PollerLifecycleState.ERROR
            await self._publish_metrics()

    async def _poll_schedule(self) -> None:
        try:
            schedule = await self.client.fetch_schedule()
            if isinstance(schedule, list):
                await self.orchestrator.ingest_schedule(schedule)
                await self._notify_state_change()
        except Exception:
            # Schedule refresh failure should not interrupt live polling.
            return

    async def _poll_live_match(self, game_id: int) -> None:
        if self._last_game_id != game_id:
            # Reset timer anchor when switching games.
            await self.state_store.set_timer(TimerState())
            self._last_event_offset_seconds = None
            self._last_event_seen_unix_ms = None
            self._processed_event_count = 0
            self._events_initialized = False
            self._overlay_events = []
            self._current_possession = PossessionState()
            self._events = []
            await self._bootstrap_game(game_id)
            self._last_game_id = game_id

        self.metrics.total_requests += 1
        try:
            payload = await self.client.fetch_live_update(game_id)
        except PollerThrottleError as exc:
            self.metrics.error_count += 1
            self.metrics.consecutive_errors += 1
            self.metrics.last_error_at = _utcnow()
            self.metrics.last_error_message = str(exc)
            self.metrics.state = PollerLifecycleState.DEGRADED
            self.rate.on_throttled()
            self.metrics.current_interval_seconds = self.rate.current_interval
            self._trip_breaker_if_needed()
            await self._publish_metrics()
            return
        except PollerError as exc:
            self.metrics.error_count += 1
            self.metrics.consecutive_errors += 1
            self.metrics.last_error_at = _utcnow()
            self.metrics.last_error_message = str(exc)
            self.metrics.state = PollerLifecycleState.DEGRADED
            self.rate.on_error()
            self.metrics.current_interval_seconds = self.rate.current_interval
            self._trip_breaker_if_needed()
            await self._publish_metrics()
            return
        except Exception as exc:
            self.metrics.error_count += 1
            self.metrics.consecutive_errors += 1
            self.metrics.last_error_at = _utcnow()
            self.metrics.last_error_message = str(exc)
            self.metrics.state = PollerLifecycleState.ERROR
            self.rate.on_error()
            self.metrics.current_interval_seconds = self.rate.current_interval
            self._trip_breaker_if_needed()
            await self._publish_metrics()
            return

        self.metrics.state = PollerLifecycleState.RUNNING
        self.metrics.consecutive_errors = 0
        self.metrics.last_success_at = _utcnow()
        self.metrics.last_error_message = None
        self.rate.on_success()
        self.metrics.current_interval_seconds = self.rate.current_interval
        try:
            await self._ingest_live_payload(payload)
        except Exception as exc:
            self.metrics.error_count += 1
            self.metrics.consecutive_errors += 1
            self.metrics.last_error_at = _utcnow()
            self.metrics.last_error_message = f"Live payload ingest failed: {exc}"
            self.metrics.state = PollerLifecycleState.ERROR
            self.rate.on_error()
            self.metrics.current_interval_seconds = self.rate.current_interval
            self._trip_breaker_if_needed()
            await self._publish_metrics()
            return
        await self._publish_metrics()

    async def _bootstrap_game(self, game_id: int) -> None:
        try:
            payload = await self.client.fetch_match_bootstrap(game_id)
        except Exception as exc:
            self.metrics.error_count += 1
            self.metrics.last_error_at = _utcnow()
            self.metrics.last_error_message = f"Bootstrap failed: {exc}"
            self.metrics.state = PollerLifecycleState.DEGRADED
            await self._publish_metrics()
            return
        try:
            await self._ingest_live_payload(payload)
        except Exception as exc:
            self.metrics.error_count += 1
            self.metrics.consecutive_errors += 1
            self.metrics.last_error_at = _utcnow()
            self.metrics.last_error_message = f"Bootstrap ingest failed: {exc}"
            self.metrics.state = PollerLifecycleState.ERROR
            self.rate.on_error()
            self.metrics.current_interval_seconds = self.rate.current_interval
            self._trip_breaker_if_needed()
            await self._publish_metrics()
            return

    async def _ingest_live_payload(self, payload: Dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise PollerError(
                f"Expected dict payload from scores API, got {type(payload).__name__}"
            )
        snapshot = await self.state_store.get_snapshot()

        away_name = payload.get("an") or snapshot.teams["a"].full_name
        home_name = payload.get("hn") or snapshot.teams["h"].full_name
        away_short = (
            payload.get("aa")
            or snapshot.teams["a"].short_name
            or (away_name[:3] if away_name else "AWY")
        )
        home_short = (
            payload.get("ha")
            or snapshot.teams["h"].short_name
            or (home_name[:3] if home_name else "HOM")
        )

        teams = {
            "a": TeamState(
                full_name=away_name,
                short_name=away_short,
                jersey_color=snapshot.teams["a"].jersey_color,
            ),
            "h": TeamState(
                full_name=home_name,
                short_name=home_short,
                jersey_color=snapshot.teams["h"].jersey_color,
            ),
        }
        self._team_short_names["a"] = away_short or self._team_short_names["a"]
        self._team_short_names["h"] = home_short or self._team_short_names["h"]
        await self.state_store.set_teams(teams)

        away_score_raw = payload.get("a", snapshot.score.away)
        home_score_raw = payload.get("h", snapshot.score.home)
        score = ScoreState(away=int(away_score_raw or 0), home=int(home_score_raw or 0))
        await self.state_store.set_score(score)

        incoming_players = payload.get("p")
        if isinstance(incoming_players, dict):
            players_a = incoming_players.get("a")
            players_h = incoming_players.get("h")
            if isinstance(players_a, dict):
                self._players["a"] = players_a
            if isinstance(players_h, dict):
                self._players["h"] = players_h
        await self.state_store.set_players(self._players)

        incoming_events = payload.get("e")
        if isinstance(incoming_events, list):
            self._events = incoming_events
        self._project_overlay_events_and_possession(self._events)
        self._capture_last_event_offset(self._events)

        ts = payload.get("ts", {}) or {}
        match_start_iso = self._resolve_match_start_iso(snapshot)
        if ts:
            timer = self._timer_from_payload(
                ts=ts,
                previous_timer=snapshot.timer,
                match_start_iso=match_start_iso,
            )
        else:
            contextual_offset = self._estimate_offset_from_match_context(match_start_iso)
            if contextual_offset is not None:
                now_ms = int(round(time.time() * 1000))
                timer = TimerState(
                    running=True,
                    offset_seconds=max(contextual_offset, 0.0),
                    raw_deciseconds=snapshot.timer.raw_deciseconds,
                    base_offset_seconds=max(contextual_offset, 0.0),
                    running_started_at_unix_ms=now_ms,
                )
            else:
                timer = snapshot.timer
        await self.state_store.set_timer(timer)

        stats_payload = self.stats_engine.compute(
            game_events=self._events,
            players=self._players,
            away_score=score.away,
            home_score=score.home,
        )
        stats_payload.overlay_events = list(self._overlay_events) + list(self._manual_overlay_events)
        stats_payload.current_possession = self._current_possession
        await self.state_store.set_stats(stats_payload)
        await self._notify_state_change()

    async def _publish_overlay_events_to_state_store(self, extra_event: Optional[OverlayEvent] = None) -> None:
        snapshot = await self.state_store.get_snapshot()
        stats_payload = snapshot.stats.model_copy(deep=True)
        events = list(self._overlay_events) + list(self._manual_overlay_events)
        if extra_event is not None:
            events.append(extra_event)
        if len(events) > 40:
            events = events[-40:]
        stats_payload.overlay_events = events
        await self.state_store.set_stats(stats_payload)
        await self._notify_state_change()

    def _project_overlay_events_and_possession(self, events: List[Dict[str, Any]]) -> None:
        if not self._events_initialized:
            self._current_possession = self._derive_possession_from_history(events)
            self._processed_event_count = len(events)
            self._events_initialized = True
            self._emit_ready_score_events(events)
            return

        if len(events) < self._processed_event_count:
            # Upstream event stream was reset. Re-sync without replaying all historical overlays.
            self._overlay_events = []
            self._current_possession = self._derive_possession_from_history(events)
            self._processed_event_count = len(events)
            return

        for index in range(self._processed_event_count, len(events)):
            event = events[index]
            projected = self._build_overlay_event(event, index)
            if projected is not None:
                self._overlay_events.append(projected)
            self._apply_possession_from_event(event, index)

        self._processed_event_count = len(events)
        self._emit_ready_score_events(events)
        if len(self._overlay_events) > 30:
            self._overlay_events = self._overlay_events[-30:]

    def _derive_possession_from_history(self, events: List[Dict[str, Any]]) -> PossessionState:
        possession = PossessionState()
        for index, event in enumerate(events):
            next_state = self._resolve_next_possession(possession, event, index)
            if next_state is not None:
                possession = next_state
        return possession

    def _apply_possession_from_event(self, event: Dict[str, Any], index: int) -> None:
        previous_team = self._current_possession.team
        next_state = self._resolve_next_possession(self._current_possession, event, index)
        if next_state is None:
            return
        self._current_possession = next_state
        if next_state.team and next_state.team != previous_team:
            self._overlay_events.append(
                OverlayEvent(
                    id=self._make_overlay_event_id("possession", index, event),
                    kind=OverlayEventKind.POSSESSION_CHANGE,
                    team=next_state.team,
                    clock_seconds=next_state.changed_at_seconds,
                    display_ms=self.POSSESSION_EVENT_DISPLAY_MS,
                    title="POSSESSION",
                    primary_text=self._team_short_names.get(next_state.team, next_state.team.upper()),
                    meta={"event_type": event.get("y")},
                )
            )

    def _resolve_next_possession(
        self,
        current_state: PossessionState,
        event: Dict[str, Any],
        index: int,
    ) -> Optional[PossessionState]:
        event_type = str(event.get("y", "")).upper()
        event_team = self._normalize_team_key(event.get("e"))

        next_team: Optional[str] = None
        if event_type == "O":
            next_team = event_team
        elif event_type in {"T", "S", "H"}:
            if current_state.team in {"a", "h"}:
                next_team = self._flip_team(current_state.team)
            elif event_team in {"a", "h"}:
                next_team = self._flip_team(event_team)

        if next_team is None:
            return None

        return PossessionState(
            team=next_team,
            changed_at_seconds=self._parse_event_time_to_seconds(event.get("t")),
            source_event_id=self._make_overlay_event_id("possession", index, event),
        )

    def _build_overlay_event(self, event: Dict[str, Any], index: int) -> Optional[OverlayEvent]:
        event_type = str(event.get("y", "")).upper()
        event_team = self._normalize_team_key(event.get("e"))
        clock_seconds = self._parse_event_time_to_seconds(event.get("t"))

        if event_type == "S":
            # Score overlays are emitted only when scorer+assist data is complete.
            return None

        if event_type == "TO" and event_team is not None:
            team_label = self._team_short_names.get(event_team, event_team.upper())
            return OverlayEvent(
                id=self._make_overlay_event_id("timeout", index, event),
                kind=OverlayEventKind.TIMEOUT_START,
                team=event_team,
                clock_seconds=clock_seconds,
                display_ms=self.TIMEOUT_EVENT_DISPLAY_MS,
                title="TIMEOUT",
                primary_text=f"{team_label} TIMEOUT",
                secondary_text="",
                meta={},
            )

        if event_type == "E":
            return OverlayEvent(
                id=self._make_overlay_event_id("end", index, event),
                kind=OverlayEventKind.GENERIC,
                team=event_team,
                clock_seconds=clock_seconds,
                display_ms=8000,
                title="MATCH",
                primary_text="END OF GAME",
                secondary_text="",
                meta={"event_type": "E"},
            )

        return None

    def _emit_ready_score_events(self, events: List[Dict[str, Any]]) -> None:
        existing_score_ids = {
            event.id for event in self._overlay_events if event.kind == OverlayEventKind.SCORE
        }
        for index, event in enumerate(events):
            if str(event.get("y", "")).upper() != "S":
                continue
            event_id = self._make_overlay_event_id("score", index, event)
            if event_id in existing_score_ids:
                continue
            projected = self._build_score_overlay_if_ready(event, index)
            if projected is None:
                continue
            self._overlay_events.append(projected)
            existing_score_ids.add(projected.id)

    def _build_score_overlay_if_ready(self, event: Dict[str, Any], index: int) -> Optional[OverlayEvent]:
        event_team = self._normalize_team_key(event.get("e"))
        if event_team is None:
            return None

        scorer_no = str(event.get("s"))
        assist_no = str(event.get("a"))
        scorer_name = self._resolve_player_name(event_team, scorer_no)
        assist_name = self._resolve_player_name(event_team, assist_no)

        if scorer_no in {"", "None", "-1"} or not scorer_name:
            return None

        if assist_no == "XX":
            assist_name = "CALLAHAN"
        else:
            if assist_no in {"", "None", "-1"}:
                return None
            if not assist_name:
                return None

        return OverlayEvent(
            id=self._make_overlay_event_id("score", index, event),
            kind=OverlayEventKind.SCORE,
            team=event_team,
            clock_seconds=self._parse_event_time_to_seconds(event.get("t")),
            display_ms=self.SCORE_EVENT_DISPLAY_MS,
            title="GOAL",
            primary_text=scorer_name,
            secondary_text=assist_name,
            meta={
                "scorer_no": scorer_no,
                "assist_no": assist_no,
                "away_score": event.get("as"),
                "home_score": event.get("hs"),
            },
        )

    def _resolve_player_name(self, team: str, number: str) -> str:
        if number in {"", "None", "-1"}:
            return ""
        team_players = self._players.get(team, {})
        return str(team_players.get(number, "")).strip()

    @staticmethod
    def _normalize_team_key(team_raw: Any) -> Optional[str]:
        if team_raw in {"a", "h"}:
            return str(team_raw)
        return None

    @staticmethod
    def _flip_team(team: str) -> str:
        return "h" if team == "a" else "a"

    def _make_overlay_event_id(self, kind: str, index: int, event: Dict[str, Any]) -> str:
        game_id = self._last_game_id or 0
        event_time = event.get("t", index)
        return f"{game_id}:{index}:{kind}:{event_time}"

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _estimate_running_offset_seconds(self, ts: Dict[str, Any]) -> Optional[float]:
        ds = self._safe_int(ts.get("ds"), default=-1)
        if ds > 0:
            current_ms = int(round(time.time() * 1000))
            server_ms = ds * 100
            estimated = (current_ms - server_ms) / 1000.0
            if 0 <= estimated <= 6 * 60 * 60:
                return estimated

        # Fallback only when ds is unavailable/invalid.
        raw_time = ts.get("time")
        if raw_time is not None:
            try:
                from_time = float(raw_time) / 10.0
            except (TypeError, ValueError):
                return None
            if 0 <= from_time <= 6 * 60 * 60:
                return from_time

        return None

    @staticmethod
    def _parse_event_time_to_seconds(raw: Any) -> Optional[float]:
        if isinstance(raw, (int, float)):
            value = float(raw)
            return value if value >= 0 else None
        if isinstance(raw, str):
            normalized = raw.strip()
            if not normalized:
                return None
            if ":" in normalized:
                parts = normalized.split(":")
                if len(parts) == 2:
                    try:
                        mins = int(parts[0])
                        secs = float(parts[1])
                    except (TypeError, ValueError):
                        return None
                    value = mins * 60 + secs
                    return value if value >= 0 else None
            if "." in normalized:
                # Support legacy "mm.ss" formatting (e.g. "28.40" => 1720s).
                whole, frac = normalized.split(".", 1)
                if whole.isdigit() and frac.isdigit():
                    mins = int(whole)
                    secs = int(frac)
                    if 0 <= secs < 60:
                        return float(mins * 60 + secs)
            try:
                value = float(normalized)
            except (TypeError, ValueError):
                return None
            return value if value >= 0 else None
        return None

    def _extract_last_event_offset_seconds(self, events: List[Dict[str, Any]]) -> Optional[float]:
        max_offset: Optional[float] = None
        for event in events:
            value = self._parse_event_time_to_seconds(event.get("t"))
            if value is None:
                continue
            if max_offset is None or value > max_offset:
                max_offset = value
        return max_offset

    def _capture_last_event_offset(self, events: List[Dict[str, Any]]) -> None:
        last_event_offset = self._extract_last_event_offset_seconds(events)
        if last_event_offset is None:
            return
        self._last_event_offset_seconds = last_event_offset
        self._last_event_seen_unix_ms = int(round(time.time() * 1000))

    @staticmethod
    def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed

    def _resolve_match_start_iso(self, snapshot: Any) -> Optional[str]:
        context = snapshot.match_context
        selected = context.selected_match
        current = context.current_match
        if selected and selected.start_time_iso:
            return selected.start_time_iso
        if current and current.start_time_iso:
            return current.start_time_iso
        return None

    def _estimate_offset_from_match_context(self, match_start_iso: Optional[str]) -> Optional[float]:
        now_unix_seconds = time.time()
        now_ms = int(round(now_unix_seconds * 1000))
        now_dt = datetime.fromtimestamp(now_unix_seconds, tz=timezone.utc)

        event_estimate: Optional[float] = None
        start_estimate: Optional[float] = None

        if self._last_event_offset_seconds is not None:
            event_estimate = self._last_event_offset_seconds
            if self._last_event_seen_unix_ms is not None:
                event_estimate += max((now_ms - self._last_event_seen_unix_ms) / 1000.0, 0.0)

        match_start_dt = self._parse_iso_datetime(match_start_iso)
        if match_start_dt is not None:
            elapsed_since_start = (now_dt - match_start_dt).total_seconds()
            if elapsed_since_start >= 0:
                start_estimate = elapsed_since_start

        if event_estimate is not None and start_estimate is not None:
            # Scheduled start can be stale; if it drifts too far from observed event time, trust events.
            if start_estimate - event_estimate > 15 * 60:
                return event_estimate
            return max(event_estimate, start_estimate)

        if event_estimate is not None:
            return event_estimate

        return start_estimate

    def _timer_from_payload(
        self,
        ts: Dict[str, Any],
        previous_timer: TimerState,
        match_start_iso: Optional[str],
    ) -> TimerState:
        stop_flag = bool(ts.get("stop", True))
        if stop_flag:
            raw_deciseconds = self._safe_int(ts.get("time"), default=0)
            seconds = max(raw_deciseconds / 10.0, 0.0)
            return TimerState(
                running=False,
                offset_seconds=seconds,
                raw_deciseconds=raw_deciseconds,
                base_offset_seconds=seconds,
                running_started_at_unix_ms=None,
            )

        now_ms = int(round(time.time() * 1000))
        raw_deciseconds = self._safe_int(ts.get("ds"), default=previous_timer.raw_deciseconds)
        running_started_at_unix_ms: Optional[int]
        base_offset_seconds: float

        if previous_timer.running and previous_timer.running_started_at_unix_ms is not None:
            running_started_at_unix_ms = previous_timer.running_started_at_unix_ms
            base_offset_seconds = previous_timer.base_offset_seconds
        else:
            running_started_at_unix_ms = now_ms
            estimated_offset = self._estimate_running_offset_seconds(ts)
            contextual_offset = self._estimate_offset_from_match_context(match_start_iso)
            base_offset_seconds = max(previous_timer.offset_seconds, 0.0)
            if estimated_offset is not None:
                # On refresh/restart there may be no prior baseline; otherwise avoid large jumps.
                if base_offset_seconds <= 0.0 or abs(estimated_offset - base_offset_seconds) <= 5.0:
                    base_offset_seconds = estimated_offset
            elif contextual_offset is not None:
                # Fallback when upstream timer metadata is unavailable.
                if base_offset_seconds <= 0.0 or abs(contextual_offset - base_offset_seconds) <= 15.0:
                    base_offset_seconds = contextual_offset
                else:
                    # Prefer not to move backwards when local baseline already advanced.
                    base_offset_seconds = max(base_offset_seconds, contextual_offset)

        elapsed_running_seconds = max((now_ms - running_started_at_unix_ms) / 1000.0, 0.0)
        offset = base_offset_seconds + elapsed_running_seconds

        return TimerState(
            running=True,
            offset_seconds=max(offset, 0.0),
            raw_deciseconds=raw_deciseconds,
            base_offset_seconds=base_offset_seconds,
            running_started_at_unix_ms=running_started_at_unix_ms,
        )

    async def _publish_metrics(self) -> None:
        await self.state_store.set_poller(self.metrics)
        await self._notify_state_change()

    async def _notify_state_change(self) -> None:
        if self.on_state_change is not None:
            await self.on_state_change()

    def _trip_breaker_if_needed(self) -> None:
        if self.metrics.consecutive_errors < self.circuit_breaker_error_threshold:
            return
        self.metrics.state = PollerLifecycleState.ERROR
        self._breaker_until_monotonic = time.monotonic() + self.circuit_breaker_cooldown_seconds
