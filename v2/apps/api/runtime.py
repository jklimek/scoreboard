from __future__ import annotations

import asyncio
import re
import time
from typing import Any, Dict, Optional

from v2.services.connection_registry import ConnectionRegistry
from v2.services.match_orchestrator import MatchOrchestrator, StateStore
from v2.services.reactive_poller import ReactivePoller, UltiScoresClient
from v2.services.stats_engine import StatsEngine
from v2.shared.contracts import (
    ClientRole,
    EmitCustomOverlayRequest,
    MatchMode,
    OverlayEvent,
    OverlayEventKind,
    SetFieldRequest,
    SetManualGameRequest,
    SetModeRequest,
    SetTeamColorRequest,
    WsLogEvent,
    WsMatchUpdateEvent,
    WsPollerStatusEvent,
    WsSnapshotEvent,
    WsStatsUpdateEvent,
    WsViewStatusEvent,
)

from .settings import settings


class RuntimeServices:
    def __init__(self) -> None:
        self.registry = ConnectionRegistry()
        self.state_store = StateStore()
        self.stats_engine = StatsEngine()
        self.orchestrator = MatchOrchestrator(
            state_store=self.state_store,
            active_window_before_minutes=settings.match_active_window_before_minutes,
            active_window_after_minutes=settings.match_active_window_after_minutes,
        )
        self.poller = ReactivePoller(
            client=UltiScoresClient(
                base_url=settings.ultiscores_url,
                timeout_seconds=settings.ultiscores_timeout_seconds,
            ),
            orchestrator=self.orchestrator,
            state_store=self.state_store,
            stats_engine=self.stats_engine,
            base_interval=settings.poll_base_interval_seconds,
            min_interval=settings.poll_min_interval_seconds,
            max_interval=settings.poll_max_interval_seconds,
            schedule_interval_seconds=settings.poll_schedule_interval_seconds,
            healthy_streak_for_recovery=settings.poll_healthy_streak_for_recovery,
            circuit_breaker_error_threshold=settings.poll_circuit_breaker_error_threshold,
            circuit_breaker_cooldown_seconds=settings.poll_circuit_breaker_cooldown_seconds,
            on_state_change=self.publish_snapshot,
        )
        self._heartbeat_task: Optional[asyncio.Task[None]] = None

    async def start(self) -> None:
        await self.poller.start()
        self._heartbeat_task = asyncio.create_task(self._heartbeat_watchdog())
        await self.publish_snapshot()

    async def stop(self) -> None:
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        await self.poller.stop()

    async def _heartbeat_watchdog(self) -> None:
        while True:
            await asyncio.sleep(5)
            stale_ids = await self.registry.prune_stale(settings.websocket_heartbeat_timeout_seconds)
            if stale_ids:
                await self.refresh_view_status()

    async def refresh_view_status(self) -> None:
        status = await self.registry.view_status()
        await self.state_store.set_view_status(status)
        event = WsViewStatusEvent(items=status)
        await self.registry.broadcast_json(event.model_dump(mode="json"))
        await self.publish_snapshot()

    async def publish_snapshot(self) -> None:
        snapshot = await self.state_store.get_snapshot()
        await self.registry.broadcast_json(WsSnapshotEvent(snapshot=snapshot).model_dump(mode="json"))
        await self.registry.broadcast_json(
            WsPollerStatusEvent(poller=snapshot.poller).model_dump(mode="json")
        )
        await self.registry.broadcast_json(
            WsMatchUpdateEvent(
                context=snapshot.match_context,
                selected_game_id=snapshot.selected_game_id,
                selected_field_id=snapshot.selected_field_id,
                mode=snapshot.mode,
            ).model_dump(mode="json")
        )
        await self.registry.broadcast_json(
            WsStatsUpdateEvent(
                stats=snapshot.stats,
                score=snapshot.score,
                timer=snapshot.timer,
                teams=snapshot.teams,
            ).model_dump(mode="json")
        )

    async def handle_command(self, command: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if command == "start_loop":
            await self.poller.set_enabled(True)
            await self._log("info", "Scores polling loop started by control command.")
            return {"ok": True, "message": "Loop started"}
        if command == "stop_loop":
            await self.poller.set_enabled(False)
            await self._log("info", "Scores polling loop stopped by control command.")
            return {"ok": True, "message": "Loop stopped"}
        if command == "set_mode":
            request = SetModeRequest.model_validate(payload)
            await self.orchestrator.set_mode(request.mode)
            await self._log("info", f"Mode set to {request.mode.value}")
            await self.publish_snapshot()
            return {"ok": True, "message": "Mode updated"}
        if command == "set_field":
            request = SetFieldRequest.model_validate(payload)
            await self.orchestrator.set_field(request.field_id)
            await self._log("info", f"Field set to {request.field_id}")
            await self.publish_snapshot()
            return {"ok": True, "message": "Field updated"}
        if command == "set_manual_match":
            request = SetManualGameRequest.model_validate(payload)
            await self.orchestrator.set_mode(MatchMode.MANUAL)
            await self.orchestrator.set_manual_game(request.game_id)
            await self._log("info", f"Manual match set to {request.game_id}")
            await self.publish_snapshot()
            return {"ok": True, "message": "Manual match updated"}
        if command == "set_team_color":
            request = SetTeamColorRequest.model_validate(payload)
            normalized_color = self._normalize_hex_color(request.jersey_color)
            if request.jersey_color is not None and normalized_color is None:
                return {
                    "ok": False,
                    "message": "Invalid jersey color, expected #RRGGBB or RRGGBB.",
                }
            await self.state_store.set_team_jersey_color(request.team, normalized_color)
            await self._log(
                "info",
                f"Team {request.team} jersey color set to {normalized_color or 'none'}",
            )
            await self.publish_snapshot()
            return {"ok": True, "message": "Team color updated"}
        if command == "request_refresh":
            await self.publish_snapshot()
            return {"ok": True, "message": "Snapshot broadcast"}
        if command == "emit_custom_overlay":
            request = EmitCustomOverlayRequest.model_validate(payload)
            if not request.enabled:
                await self.poller.clear_manual_overlay()
                await self._log("info", "Custom overlay disabled.")
                return {"ok": True, "message": "Custom overlay disabled"}
            event = await self._build_custom_overlay_event(request)
            await self.poller.emit_manual_overlay_event(event)
            await self._log("info", "Custom overlay emitted.")
            return {"ok": True, "message": "Custom overlay emitted"}
        if command == "clear_custom_overlay":
            await self.poller.clear_manual_overlay()
            await self._log("info", "Custom overlay cleared.")
            return {"ok": True, "message": "Custom overlay cleared"}
        return {"ok": False, "message": f"Unsupported command: {command}"}

    async def _log(self, level: str, message: str) -> None:
        await self.registry.broadcast_json(WsLogEvent(level=level, message=message).model_dump(mode="json"))

    @staticmethod
    def _normalize_hex_color(raw: Optional[str]) -> Optional[str]:
        if raw is None:
            return None
        candidate = raw.strip()
        if not candidate:
            return None
        if re.fullmatch(r"#?[0-9a-fA-F]{6}", candidate) is None:
            return None
        return f"#{candidate.lstrip('#').upper()}"

    async def _build_custom_overlay_event(self, request: EmitCustomOverlayRequest) -> OverlayEvent:
        snapshot = await self.state_store.get_snapshot()
        display_ms = max(1500, min(int(request.display_ms), 30000))
        event_id = f"manual:{int(round(time.time() * 1000))}"

        if request.player_team in {"a", "h"} and request.player_number:
            team = request.player_team
            number = request.player_number
            player_stats = snapshot.stats.player_stats.get(team, {}).get(number)
            player_name = ""
            goals = 0
            assists = 0
            if player_stats is not None:
                player_name = player_stats.name
                goals = int(player_stats.goals)
                assists = int(player_stats.assists)
            if not player_name:
                player_name = snapshot.players.get(team, {}).get(number, "")

            title = (request.title or "").strip()
            primary_text = request.primary_text.strip() or player_name or f"#{number}"
            secondary_fallback = f"#{number} · GOALS {goals} · ASSISTS {assists}"
            secondary_text = request.secondary_text.strip() or secondary_fallback
            return OverlayEvent(
                id=event_id,
                kind=OverlayEventKind.GENERIC,
                team=team,
                display_ms=display_ms,
                title=title,
                primary_text=primary_text,
                secondary_text=secondary_text,
                meta={
                    "custom_info_only": True,
                    "player": {
                        "team": team,
                        "number": number,
                        "name": player_name or primary_text,
                    },
                },
            )

        title = (request.title or "").strip()
        primary_text = request.primary_text.strip() or ""
        secondary_text = request.secondary_text.strip()
        return OverlayEvent(
            id=event_id,
            kind=OverlayEventKind.GENERIC,
            team=request.player_team,
            display_ms=display_ms,
            title=title,
            primary_text=primary_text,
            secondary_text=secondary_text,
            meta={},
        )


runtime_services = RuntimeServices()
