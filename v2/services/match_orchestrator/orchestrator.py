from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from v2.shared.contracts import MatchContext, MatchIdentity, MatchMode

from .state_store import StateStore


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_match_datetime(date_value: Optional[str], time_value: Optional[str]) -> Optional[datetime]:
    if not date_value or not time_value:
        return None
    known_formats = ("%d.%m.%Y %H:%M", "%Y-%m-%d %H:%M")
    for fmt in known_formats:
        try:
            naive = datetime.strptime(f"{date_value} {time_value}", fmt)
            return naive.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


@dataclass
class OrchestratorState:
    mode: MatchMode = MatchMode.AUTO
    selected_field_id: Optional[str] = None
    manual_game_id: Optional[int] = None
    selected_game_id: Optional[int] = None
    polling_enabled: bool = False


class MatchOrchestrator:
    def __init__(
        self,
        state_store: StateStore,
        active_window_before_minutes: int = 10,
        active_window_after_minutes: int = 110,
    ) -> None:
        self.state_store = state_store
        self._state = OrchestratorState()
        self._schedule_matches: List[Dict[str, Any]] = []
        self._active_before = timedelta(minutes=active_window_before_minutes)
        self._active_after = timedelta(minutes=active_window_after_minutes)

    async def set_mode(self, mode: MatchMode) -> None:
        self._state.mode = mode
        await self.state_store.set_mode(mode)
        await self._recalculate_context()

    async def set_field(self, field_id: Optional[str]) -> None:
        self._state.selected_field_id = field_id
        await self.state_store.set_selected_field(field_id)
        await self._recalculate_context()

    async def set_manual_game(self, game_id: Optional[int]) -> None:
        self._state.manual_game_id = game_id
        if self._state.mode == MatchMode.MANUAL:
            self._state.selected_game_id = game_id
            await self.state_store.set_selected_game_id(game_id)
        await self._recalculate_context()

    async def set_polling_enabled(self, enabled: bool) -> None:
        self._state.polling_enabled = enabled

    async def ingest_schedule(self, schedule_matches: List[Dict[str, Any]]) -> None:
        self._schedule_matches = schedule_matches
        await self._recalculate_context()

    def get_selected_game_id(self) -> Optional[int]:
        return self._state.selected_game_id

    def is_polling_enabled(self) -> bool:
        return self._state.polling_enabled

    async def _recalculate_context(self) -> None:
        now = _utcnow()
        matches = self._normalize_schedule(self._schedule_matches)

        if self._state.selected_field_id:
            matches = [m for m in matches if m.field_id == self._state.selected_field_id]

        matches.sort(key=lambda m: m.start_time_iso or "")

        current_match = None
        next_match = None
        last_match = None

        for item in matches:
            start_dt = (
                datetime.fromisoformat(item.start_time_iso)
                if item.start_time_iso
                else None
            )
            if start_dt is None:
                continue
            if start_dt - self._active_before <= now <= start_dt + self._active_after:
                current_match = item
            elif start_dt > now and next_match is None:
                next_match = item
            elif start_dt < now:
                last_match = item

        selected_match = None
        if self._state.mode == MatchMode.MANUAL and self._state.manual_game_id is not None:
            selected_match = next(
                (m for m in matches if m.game_id == self._state.manual_game_id),
                MatchIdentity(game_id=self._state.manual_game_id),
            )
            self._state.selected_game_id = self._state.manual_game_id
        else:
            selected_match = current_match or next_match or last_match
            self._state.selected_game_id = selected_match.game_id if selected_match else None

        context = MatchContext(
            last_match=last_match,
            current_match=current_match,
            next_match=next_match,
            selected_match=selected_match,
        )
        await self.state_store.set_selected_game_id(self._state.selected_game_id)
        await self.state_store.set_match_context(context)

    def _normalize_schedule(self, schedule_matches: List[Dict[str, Any]]) -> List[MatchIdentity]:
        normalized: List[MatchIdentity] = []
        for row in schedule_matches:
            game_id_raw = row.get("i") or row.get("game_id") or row.get("id")
            try:
                game_id: Optional[int] = int(game_id_raw) if game_id_raw is not None else None
            except (TypeError, ValueError):
                game_id = None

            field_raw = row.get("f") or row.get("field")
            field_id = str(field_raw) if field_raw is not None else None
            home_name = row.get("hn") or row.get("home_name")
            away_name = row.get("an") or row.get("away_name")
            date_value = row.get("d") or row.get("date")
            time_value = row.get("t") or row.get("time")
            start_dt = _parse_match_datetime(date_value, time_value)

            normalized.append(
                MatchIdentity(
                    game_id=game_id,
                    field_id=field_id,
                    start_time_iso=start_dt.isoformat() if start_dt else None,
                    home_name=home_name,
                    away_name=away_name,
                )
            )
        return normalized
