from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Dict, List, Optional

from v2.shared.contracts import (
    MatchContext,
    MatchMode,
    PollerMetrics,
    ScoreState,
    StatsPayload,
    SystemSnapshot,
    TeamState,
    TimerState,
    ViewStatus,
)


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


class StateStore:
    def __init__(self) -> None:
        self._snapshot = SystemSnapshot()
        self._lock = asyncio.Lock()
        self._sequence = 0

    async def get_snapshot(self) -> SystemSnapshot:
        async with self._lock:
            return self._snapshot.model_copy(deep=True)

    async def get_sequence(self) -> int:
        async with self._lock:
            return self._sequence

    async def set_mode(self, mode: MatchMode) -> None:
        async with self._lock:
            self._snapshot.mode = mode
            self._touch_locked()

    async def set_selected_field(self, field_id: Optional[str]) -> None:
        async with self._lock:
            self._snapshot.selected_field_id = field_id
            self._touch_locked()

    async def set_selected_game_id(self, game_id: Optional[int]) -> None:
        async with self._lock:
            self._snapshot.selected_game_id = game_id
            self._touch_locked()

    async def set_match_context(self, context: MatchContext) -> None:
        async with self._lock:
            self._snapshot.match_context = context
            self._touch_locked()

    async def set_teams(self, teams: Dict[str, TeamState]) -> None:
        async with self._lock:
            merged: Dict[str, TeamState] = {}
            for side in ("a", "h"):
                existing = self._snapshot.teams.get(side, TeamState())
                incoming = teams.get(side, TeamState())
                team_state = incoming.model_copy(deep=True)
                if team_state.jersey_color is None:
                    team_state.jersey_color = existing.jersey_color
                merged[side] = team_state
            self._snapshot.teams = merged
            self._touch_locked()

    async def set_team_jersey_color(self, team: str, jersey_color: Optional[str]) -> None:
        if team not in {"a", "h"}:
            return
        async with self._lock:
            current = self._snapshot.teams.get(team, TeamState()).model_copy(deep=True)
            current.jersey_color = jersey_color
            self._snapshot.teams[team] = current
            self._touch_locked()

    async def set_players(self, players: Dict[str, Dict[str, str]]) -> None:
        async with self._lock:
            self._snapshot.players = players
            self._touch_locked()

    async def set_score(self, score: ScoreState) -> None:
        async with self._lock:
            self._snapshot.score = score
            self._touch_locked()

    async def set_timer(self, timer: TimerState) -> None:
        async with self._lock:
            self._snapshot.timer = timer
            self._touch_locked()

    async def set_stats(self, stats: StatsPayload) -> None:
        async with self._lock:
            self._snapshot.stats = stats
            self._touch_locked()

    async def set_poller(self, poller: PollerMetrics) -> None:
        async with self._lock:
            self._snapshot.poller = poller
            self._touch_locked()

    async def set_view_status(self, view_status: List[ViewStatus]) -> None:
        async with self._lock:
            self._snapshot.view_status = view_status
            self._touch_locked()

    def _touch_locked(self) -> None:
        self._sequence += 1
        self._snapshot.last_updated_at = _utcnow()
