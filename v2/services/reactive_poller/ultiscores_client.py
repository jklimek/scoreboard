from __future__ import annotations

from datetime import date
from typing import Any, Dict, Optional

import httpx

from .errors import PollerError, PollerThrottleError


class UltiScoresClient:
    def __init__(self, base_url: str, timeout_seconds: float = 8.0) -> None:
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds
        self._headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/50.0.2661.102 Safari/537.36"
            )
        }

    async def fetch_schedule(self, schedule_date: Optional[date] = None) -> list:
        payload = {
            "schedule": 1,
            "date": (schedule_date or date.today()).isoformat(),
        }
        raw = await self._post(payload)
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            for key in ("schedule", "matches", "games", "items"):
                val = raw.get(key)
                if isinstance(val, list):
                    return val
        return []

    async def fetch_match_bootstrap(self, game_id: int) -> Dict[str, Any]:
        payload = {
            "game": game_id,
            "players": "true",
            "teams": "true",
            "update": "true",
        }
        return await self._post(payload)

    async def fetch_live_update(self, game_id: int) -> Dict[str, Any]:
        payload = {
            "game": game_id,
            "update": "true",
        }
        return await self._post(payload)

    async def _post(self, payload: Dict[str, Any]) -> Any:
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(self.base_url, data=payload, headers=self._headers)
        except Exception as exc:
            raise PollerError(f"Network error while calling UltiScores: {exc}") from exc

        if response.status_code in (429, 503):
            raise PollerThrottleError(f"UltiScores throttled requests: {response.status_code}")
        if response.status_code >= 400:
            raise PollerError(f"UltiScores HTTP error: {response.status_code}")

        try:
            return response.json()
        except Exception as exc:
            raise PollerError("UltiScores returned non-JSON response") from exc
