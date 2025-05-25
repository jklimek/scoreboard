from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Dict, Any, ClassVar
import logging

# Logger for this module, configured by setup_logging() in app.py
logger = logging.getLogger(__name__)

@dataclass
class Config:
    # API URLs
    WIND_URL: str = os.getenv("WIND_URL", "http://192.168.10.13/") # Default for local dev/testing if not set
    SCORES_URL: str = "https://scores.frisbee.pl/ext/watchlive.php/" # Default for Production/Development
    WEBSOCKET_URL: str = "ws://klimek.jakub.tech:5005/" # Default for Production/Development
    
    # Server settings
    FLASK_HOST: str = "0.0.0.0"
    FLASK_PORT: int = 5000
    
    WEBSOCKET_PORT: int = 5005
    
    # Update intervals (seconds)
    SCORES_UPDATE_INTERVAL: int = 4
    WIND_UPDATE_INTERVAL: int = 1
    
    # Request settings
    REQUEST_TIMEOUT: int = 20
    USER_AGENT: str = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.102 Safari/537.36'
    
    # Team mappings
    TEAM_SIDE_MAPPING: ClassVar[Dict[str, str]] = {
        "A": "h",
        "B": "a"
    }
    
    # Event types
    class EventType:
        TURNOVER: str = "T"
        SCORE: str = "S"
        OFFENCE: str = "O"
        END: str = "E"
        HALFTIME: str = "H"
        TIMEOUT: str = "TO"
    
    # Default values
    DEFAULT_TEAM_NAME_LENGTH: int = 3
    CALLAHAN_MARKER: str = "XX"
    INVALID_PLAYER_NO: str = "-1"

    @classmethod
    def get_request_headers(cls) -> Dict[str, str]:
        return {
            'User-Agent': cls.USER_AGENT
        }

class ProductionConfig(Config):
    FLASK_DEBUG = False
    # SCORES_URL and WEBSOCKET_URL are inherited from Config (Prod/Dev default)
    # Add any production-specific overrides here if they differ from Config defaults

class DevConfig(Config):
    FLASK_DEBUG = True
    # SCORES_URL and WEBSOCKET_URL are inherited from Config (Prod/Dev default)
    # Add any dev-specific overrides here if they differ from Config defaults

class TestingConfig(Config):
    FLASK_DEBUG = True
    # Add testing-specific settings
    SCORES_URL: str = "https://scores.frisbee.pl/test3/ext/watchlive.php/"
    WEBSOCKET_URL: str = "ws://localhost:5005/"

# Select config based on environment
env = os.getenv("RUN_ENV", "testing")

if env not in ("production", "testing"):
    logger.error(f"Invalid FLASK_ENV value: {env}, defaulting to testing")

config_map = {
    "production": ProductionConfig(),
    "testing": TestingConfig(),
    "dev": DevConfig(),
}

logger.info(f"Using {env} environment configuration")
config = config_map[env]
