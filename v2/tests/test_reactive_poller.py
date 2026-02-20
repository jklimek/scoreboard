import asyncio
from unittest.mock import patch

import pytest

from v2.services.match_orchestrator import MatchOrchestrator, StateStore
from v2.services.reactive_poller.errors import PollerError
from v2.services.reactive_poller.poller import ReactivePoller
from v2.services.stats_engine import StatsEngine
from v2.shared.contracts import MatchContext, MatchIdentity, MatchMode, TimerState


def _empty_payload():
    return {
        "a": 0,
        "h": 0,
        "an": "Away Team",
        "hn": "Home Team",
        "aa": "AWY",
        "ha": "HOM",
        "ts": {"stop": True, "time": "0", "ds": 0},
        "e": [],
        "p": {"a": {}, "h": {}},
    }


class FakeUltiScoresClient:
    def __init__(self) -> None:
        self.live_calls = 0

    async def fetch_schedule(self):
        return []

    async def fetch_match_bootstrap(self, game_id: int):
        return _empty_payload() | {"game_id": game_id}

    async def fetch_live_update(self, game_id: int):
        self.live_calls += 1
        if self.live_calls <= 2:
            raise PollerError("simulated upstream failure")
        return _empty_payload() | {"game_id": game_id}


@pytest.mark.asyncio
async def test_reactive_poller_adapts_after_errors() -> None:
    state_store = StateStore()
    orchestrator = MatchOrchestrator(state_store=state_store)
    await orchestrator.set_mode(MatchMode.MANUAL)
    await orchestrator.set_manual_game(1234)

    poller = ReactivePoller(
        client=FakeUltiScoresClient(),  # type: ignore[arg-type]
        orchestrator=orchestrator,
        state_store=state_store,
        stats_engine=StatsEngine(),
        base_interval=0.05,
        min_interval=0.05,
        max_interval=0.5,
        schedule_interval_seconds=999,
        healthy_streak_for_recovery=1,
        circuit_breaker_error_threshold=10,
    )
    await poller.start()
    await poller.set_enabled(True)

    await asyncio.sleep(0.3)
    snapshot = await state_store.get_snapshot()

    assert snapshot.poller.total_requests >= 2
    assert snapshot.poller.error_count >= 2
    assert snapshot.poller.current_interval_seconds > 0.05

    await poller.stop()


def test_timer_state_uses_persistent_running_anchor() -> None:
    state_store = StateStore()
    orchestrator = MatchOrchestrator(state_store=state_store)
    poller = ReactivePoller(
        client=FakeUltiScoresClient(),  # type: ignore[arg-type]
        orchestrator=orchestrator,
        state_store=state_store,
        stats_engine=StatsEngine(),
    )

    previous = TimerState(running=False, offset_seconds=0.0, base_offset_seconds=0.0)

    with patch("v2.services.reactive_poller.poller.time.time", return_value=1000.0):
        running_timer = poller._timer_from_payload(
            {"stop": False, "ds": 10000}, previous, match_start_iso=None
        )

    assert running_timer.running is True
    assert running_timer.running_started_at_unix_ms == 1_000_000
    assert running_timer.base_offset_seconds == pytest.approx(0.0, abs=0.01)
    assert running_timer.offset_seconds == pytest.approx(0.0, abs=0.01)

    # Even with a noisy upstream payload, elapsed time is based on local running anchor.
    with patch("v2.services.reactive_poller.poller.time.time", return_value=1002.0):
        next_timer = poller._timer_from_payload(
            {"stop": False, "ds": 1}, running_timer, match_start_iso=None
        )

    assert next_timer.running is True
    assert next_timer.running_started_at_unix_ms == running_timer.running_started_at_unix_ms
    assert next_timer.base_offset_seconds == running_timer.base_offset_seconds
    assert next_timer.offset_seconds == pytest.approx(2.0, abs=0.01)

    stopped_timer = poller._timer_from_payload({"stop": True, "time": 123}, next_timer, match_start_iso=None)
    assert stopped_timer.running is False
    assert stopped_timer.offset_seconds == pytest.approx(12.3, abs=0.01)
    assert stopped_timer.base_offset_seconds == pytest.approx(12.3, abs=0.01)
    assert stopped_timer.running_started_at_unix_ms is None


def test_timer_prefers_ds_over_time_for_running_matches() -> None:
    state_store = StateStore()
    orchestrator = MatchOrchestrator(state_store=state_store)
    poller = ReactivePoller(
        client=FakeUltiScoresClient(),  # type: ignore[arg-type]
        orchestrator=orchestrator,
        state_store=state_store,
        stats_engine=StatsEngine(),
    )

    previous = TimerState(running=False, offset_seconds=0.0, base_offset_seconds=0.0)
    # ds indicates 47 minutes, but time field says 00:51.
    with patch("v2.services.reactive_poller.poller.time.time", return_value=4000.0):
        timer = poller._timer_from_payload(
            {"stop": False, "ds": 16420, "time": 510},
            previous,
            match_start_iso=None,
        )
    assert timer.running is True
    assert timer.base_offset_seconds == pytest.approx(2358.0, abs=0.01)


def test_timer_fallback_uses_last_event_and_match_start_when_ts_missing() -> None:
    state_store = StateStore()
    orchestrator = MatchOrchestrator(state_store=state_store)
    poller = ReactivePoller(
        client=FakeUltiScoresClient(),  # type: ignore[arg-type]
        orchestrator=orchestrator,
        state_store=state_store,
        stats_engine=StatsEngine(),
    )

    # Last known event happened at 28:00 and was seen at t=1100s.
    poller._last_event_offset_seconds = 1680.0
    poller._last_event_seen_unix_ms = 1_100_000
    previous = TimerState(running=False, offset_seconds=0.0, base_offset_seconds=0.0)

    # Upstream ts is running but unusable -> fallback to context estimate.
    with patch("v2.services.reactive_poller.poller.time.time", return_value=1105.0):
        timer = poller._timer_from_payload(
            {"stop": False, "ds": 0},
            previous,
            match_start_iso="2026-01-01T00:00:00+00:00",
        )

    assert timer.running is True
    # Expect last event anchor extrapolation: 1680 + 5 seconds.
    assert timer.base_offset_seconds == pytest.approx(1685.0, abs=0.01)
    assert timer.offset_seconds == pytest.approx(1685.0, abs=0.01)


def test_event_time_parser_supports_legacy_mm_ss() -> None:
    state_store = StateStore()
    orchestrator = MatchOrchestrator(state_store=state_store)
    poller = ReactivePoller(
        client=FakeUltiScoresClient(),  # type: ignore[arg-type]
        orchestrator=orchestrator,
        state_store=state_store,
        stats_engine=StatsEngine(),
    )

    parsed = poller._extract_last_event_offset_seconds([{"t": "28.40"}, {"t": "27:15"}, {"t": 120}])
    assert parsed == pytest.approx(1720.0, abs=0.01)


@pytest.mark.asyncio
async def test_ingest_payload_without_ts_uses_contextual_timer() -> None:
    state_store = StateStore()
    orchestrator = MatchOrchestrator(state_store=state_store)
    poller = ReactivePoller(
        client=FakeUltiScoresClient(),  # type: ignore[arg-type]
        orchestrator=orchestrator,
        state_store=state_store,
        stats_engine=StatsEngine(),
    )

    await state_store.set_match_context(
        MatchContext(
            selected_match=MatchIdentity(
                game_id=123,
                start_time_iso="2026-01-01T00:00:00+00:00",
            )
        )
    )
    poller._last_event_offset_seconds = 1800.0
    poller._last_event_seen_unix_ms = 2_000_000

    payload = _empty_payload()
    payload.pop("ts", None)
    payload["e"] = []

    with patch("v2.services.reactive_poller.poller.time.time", return_value=2005.0):
        await poller._ingest_live_payload(payload)

    snapshot = await state_store.get_snapshot()
    assert snapshot.timer.running is True
    assert snapshot.timer.base_offset_seconds == pytest.approx(1805.0, abs=0.01)
    assert snapshot.timer.offset_seconds == pytest.approx(1805.0, abs=0.01)


@pytest.mark.asyncio
async def test_overlay_projection_skips_backlog_on_first_ingest() -> None:
    state_store = StateStore()
    orchestrator = MatchOrchestrator(state_store=state_store)
    poller = ReactivePoller(
        client=FakeUltiScoresClient(),  # type: ignore[arg-type]
        orchestrator=orchestrator,
        state_store=state_store,
        stats_engine=StatsEngine(),
    )

    payload = _empty_payload()
    payload["p"] = {"a": {"12": "Away Cutter"}, "h": {}}
    payload["e"] = [{"y": "S", "e": "a", "s": 12, "a": -1, "as": 1, "hs": 0, "t": 42}]
    await poller._ingest_live_payload(payload)

    snapshot = await state_store.get_snapshot()
    assert snapshot.stats.overlay_events == []
    assert snapshot.stats.current_possession.team == "h"


@pytest.mark.asyncio
async def test_overlay_projection_generates_score_and_timeout_events() -> None:
    state_store = StateStore()
    orchestrator = MatchOrchestrator(state_store=state_store)
    poller = ReactivePoller(
        client=FakeUltiScoresClient(),  # type: ignore[arg-type]
        orchestrator=orchestrator,
        state_store=state_store,
        stats_engine=StatsEngine(),
    )

    bootstrap_payload = _empty_payload()
    bootstrap_payload["p"] = {"a": {"12": "Away Scorer", "5": "Away Assist"}, "h": {}}
    bootstrap_payload["e"] = [{"y": "O", "e": "a", "t": 10}]
    await poller._ingest_live_payload(bootstrap_payload)

    live_payload = _empty_payload()
    live_payload["p"] = {"a": {"12": "Away Scorer", "5": "Away Assist"}, "h": {}}
    live_payload["e"] = [
        {"y": "O", "e": "a", "t": 10},
        {"y": "S", "e": "a", "s": 12, "a": 5, "as": 1, "hs": 0, "t": 25},
        {"y": "TO", "e": "h", "t": 28},
    ]
    await poller._ingest_live_payload(live_payload)

    snapshot = await state_store.get_snapshot()
    overlay_events = snapshot.stats.overlay_events
    assert len(overlay_events) >= 3

    score_event = next(event for event in overlay_events if event.kind == "score")
    timeout_event = next(event for event in overlay_events if event.kind == "timeout_start")
    possession_event = next(event for event in overlay_events if event.kind == "possession_change")

    assert score_event.primary_text == "Away Scorer"
    assert score_event.secondary_text == "Away Assist"
    assert timeout_event.team == "h"
    assert timeout_event.display_ms == 50000
    assert possession_event.team == "h"
    assert snapshot.stats.current_possession.team == "h"


@pytest.mark.asyncio
async def test_score_overlay_waits_for_complete_scorer_and_assist_data() -> None:
    state_store = StateStore()
    orchestrator = MatchOrchestrator(state_store=state_store)
    poller = ReactivePoller(
        client=FakeUltiScoresClient(),  # type: ignore[arg-type]
        orchestrator=orchestrator,
        state_store=state_store,
        stats_engine=StatsEngine(),
    )

    bootstrap_payload = _empty_payload()
    bootstrap_payload["p"] = {"a": {"12": "Away Scorer", "5": "Away Assist"}, "h": {}}
    bootstrap_payload["e"] = [{"y": "O", "e": "a", "t": 10}]
    await poller._ingest_live_payload(bootstrap_payload)

    # Score appears immediately, but assist is still pending in event payload.
    pending_payload = _empty_payload()
    pending_payload["a"] = 1
    pending_payload["h"] = 0
    pending_payload["p"] = {"a": {"12": "Away Scorer", "5": "Away Assist"}, "h": {}}
    pending_payload["e"] = [
        {"y": "O", "e": "a", "t": 10},
        {"y": "S", "e": "a", "s": 12, "a": -1, "as": 1, "hs": 0, "t": 25},
    ]
    await poller._ingest_live_payload(pending_payload)
    snapshot_pending = await state_store.get_snapshot()
    assert snapshot_pending.score.away == 1
    assert all(event.kind != "score" for event in snapshot_pending.stats.overlay_events)

    # Same score event gets updated with assist later (same index, same list length).
    resolved_payload = _empty_payload()
    resolved_payload["a"] = 1
    resolved_payload["h"] = 0
    resolved_payload["p"] = {"a": {"12": "Away Scorer", "5": "Away Assist"}, "h": {}}
    resolved_payload["e"] = [
        {"y": "O", "e": "a", "t": 10},
        {"y": "S", "e": "a", "s": 12, "a": 5, "as": 1, "hs": 0, "t": 25},
    ]
    await poller._ingest_live_payload(resolved_payload)
    snapshot_resolved = await state_store.get_snapshot()
    score_event = next(event for event in snapshot_resolved.stats.overlay_events if event.kind == "score")
    assert score_event.primary_text == "Away Scorer"
    assert score_event.secondary_text == "Away Assist"
