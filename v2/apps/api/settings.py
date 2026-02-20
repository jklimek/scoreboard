from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv  # pyright: ignore[reportMissingImports]


V2_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(V2_ROOT / ".env")


def _get_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _get_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _get_obs_bg_color() -> str:
    raw = os.getenv("OBS_BG_COLOR", "FF00FF")
    s = (raw or "").strip().lstrip("#")
    if len(s) == 6 and all(c in "0123456789aAbBcCdDeEfF" for c in s):
        return f"#{s.upper()}"
    return "#FF00FF"


def _resolve_ultiscores_url() -> str:
    env = os.getenv("SCOREBOARD_V2_ENV", "development")
    override = os.getenv("ULTISCORES_URL")
    default_public = "https://ultiscores.com/4x/ext/watchlive.php/"
    default_test = "https://scores.frisbee.pl/test3/ext/watchlive.php/"
    default_prod = "https://scores.frisbee.pl/ext/watchlive.php/"

    # Development defaults to test endpoint unless override explicitly points elsewhere.
    if env == "development":
        test_url = os.getenv("ULTISCORES_TEST_URL", default_test)
        if override and override != default_public:
            return override
        return test_url

    # Non-development: explicit override, then prod-specific, then public fallback.
    if override:
        return override
    return os.getenv("ULTISCORES_PROD_URL", default_prod)


@dataclass(frozen=True)
class Settings:
    env: str = os.getenv("SCOREBOARD_V2_ENV", "development")
    host: str = os.getenv("SCOREBOARD_V2_HOST", "0.0.0.0")
    port: int = _get_int("SCOREBOARD_V2_PORT", 8100)

    ultiscores_url: str = _resolve_ultiscores_url()
    print(f"ULTISCORES_URL: {ultiscores_url}")
    ultiscores_timeout_seconds: float = _get_float("ULTISCORES_TIMEOUT_SECONDS", 8.0)

    poll_base_interval_seconds: float = _get_float("POLL_BASE_INTERVAL_SECONDS", 1.0)
    poll_min_interval_seconds: float = _get_float("POLL_MIN_INTERVAL_SECONDS", 0.5)
    poll_max_interval_seconds: float = _get_float("POLL_MAX_INTERVAL_SECONDS", 5.0)
    poll_schedule_interval_seconds: float = _get_float("POLL_SCHEDULE_INTERVAL_SECONDS", 30.0)
    poll_healthy_streak_for_recovery: int = _get_int("POLL_HEALTHY_STREAK_FOR_RECOVERY", 4)
    poll_circuit_breaker_error_threshold: int = _get_int(
        "POLL_CIRCUIT_BREAKER_ERROR_THRESHOLD", 5
    )
    poll_circuit_breaker_cooldown_seconds: float = _get_float(
        "POLL_CIRCUIT_BREAKER_COOLDOWN_SECONDS", 20.0
    )

    websocket_heartbeat_timeout_seconds: float = _get_float(
        "WEBSOCKET_HEARTBEAT_TIMEOUT_SECONDS", 20.0
    )
    match_active_window_before_minutes: int = _get_int("MATCH_ACTIVE_WINDOW_BEFORE_MINUTES", 10)
    match_active_window_after_minutes: int = _get_int("MATCH_ACTIVE_WINDOW_AFTER_MINUTES", 110)

    obs_bg_color: str = _get_obs_bg_color()


settings = Settings()
