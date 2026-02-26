from dataclasses import dataclass, field
from typing import List, Dict, Any

@dataclass
class GameState:
    """Class to encapsulate all game state."""
    game_number: int = 0
    game_events: List[Dict[str, Any]] = field(default_factory=list)
    game_time: int = 0
    stopped_game: bool = False
    players: Dict[str, Dict[str, str]] = field(default_factory=dict)
    home_score: int = 0
    away_score: int = 0
    home_team_name: str = ""
    away_team_name: str = ""
    home_jersey_color: str = ""
    away_jersey_color: str = ""
    scores_requests_count: int = 0

    def reset(self) -> None:
        """Reset all game state to initial values."""
        self.__init__() 