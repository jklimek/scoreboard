from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Dict, Any, ClassVar
import logging

# Get logger from app.py
logger = logging.getLogger(__name__)

@dataclass
class Config:
    # API URLs
    SCORES_URL: str = os.getenv("SCORES_URL", "https://scores.frisbee.pl/ext/watchlive.php/")
    WIND_URL: str = os.getenv("WIND_URL", "http://192.168.10.13/")
    
    # Server settings
    FLASK_HOST: str = "0.0.0.0"
    FLASK_PORT: int = 5000
    FLASK_DEBUG: bool = False
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

class DevelopmentConfig(Config):
    FLASK_DEBUG = True
    # Add development-specific settings

class ProductionConfig(Config):
    FLASK_DEBUG = False
    # Add production-specific settings

class TestingConfig(Config):
    FLASK_DEBUG = True
    SCORES_URL: str = os.getenv("SCORES_URL", "https://scores.frisbee.pl/test3/watchlive.php")
    # Add testing-specific settings

# Select config based on environment
env = os.getenv("FLASK_ENV", "testing")
env = "testing"

if env not in ("development", "production", "testing"):
    logger.error(f"Invalid FLASK_ENV value: {env}, defaulting to testing")
    env = "testing"

config_map = {
    "development": DevelopmentConfig(),
    "production": ProductionConfig(),
    "testing": TestingConfig(),
}

logger.info(f"Using {env} environment configuration")
config = config_map[env]

# Create a global config instance
config: Config = Config() 