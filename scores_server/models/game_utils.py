# Utility functions (team name normalization, timer offset, etc)
import unicodedata
import time
from typing import Optional

def normalize_team_name(team_name: Optional[str]) -> str:
    """
    Normalize team name by removing special characters and extra spaces.
    """
    if team_name is None:
        return ""
    normalized = unicodedata.normalize('NFKD', team_name)
    normalized = ''.join(c for c in normalized if not unicodedata.combining(c))
    normalized = ' '.join(normalized.split())
    return normalized

def calculate_timer_offset(timestamp: int) -> float:
    """
    Calculate timer offset from timestamp.
    """
    current_time = int(round(time.time() * 1000))  # ms
    server_time = int(timestamp) * 100  # deciseconds to ms
    return round((current_time - server_time) / 1000)

def get_team_side(team_id: str, team_side_mapping: dict) -> Optional[str]:
    """
    Get team side (home/away) from team ID.
    """
    return team_side_mapping.get(team_id)