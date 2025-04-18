from __future__ import annotations

import json
import time
import requests
import logging
import unicodedata
from typing import List, Dict, Any, Optional
from SimpleWebSocketServer import WebSocket
from models.game_state import GameState
from config import config
import stats
from models.game_events import prepare_event, proper_event
from models.game_stats import count_stats
from models.game_broadcast import send_message_to_all
from models.game_utils import normalize_team_name, calculate_timer_offset, get_team_side

class GameServer:
    def __init__(self) -> None:
        self.state = GameState()
        self.clients: List[WebSocket] = []
        self.logger = logging.getLogger(__name__)

    def set_game(self, data: Dict[str, Any]) -> None:
        if "game_number" in data:
            if self.state.game_number != data["game_number"] and self.state.game_number != 0:
                self.reset_game()
            self.state.game_number = data["game_number"]
            self.state.stopped_game = False
            self.get_match_info(data["game_number"])
            self.logger.info(f"Players: {self.state.players}")

    def reset_game(self) -> None:
        self.state.reset()
        self.reset_score()
        self.reset_timer()

    def get_match_info(self, game_number: int) -> None:
        """Get initial match information from the server."""
        payload = {
            "game": game_number,
            "players": "true",
            "update": "true",
            "teams": "true"
        }

        try:
            r = requests.post(
                config.SCORES_URL,
                data=payload,
                headers=config.get_request_headers(),
                timeout=config.REQUEST_TIMEOUT
            )
            result_data = r.json()
            self.logger.info(f"Match info request: {result_data}")
            
            self.set_team_names(
                result_data["hn"], 
                result_data["ha"], 
                result_data["an"], 
                result_data["aa"]
            )
            
            # Save initial game time
            if not result_data["ts"]["stop"]:
                self.state.game_time = result_data["ts"]["ds"]
            
            self.set_timer(result_data["ts"], True)
            self.set_score(result_data["a"], result_data["h"])
            
            if result_data["p"]["a"] and result_data["p"]["h"]:
                self.state.players = result_data["p"]
                self.set_players(self.state.players)
        
        except Exception as e:
            self.logger.error(f"Connection error: {e}", exc_info=True)

    def prepare_event(self, event: Dict[str, Any]) -> Dict[str, Any]:
        return prepare_event(event, self.state, self.logger, config)

    def handle_game_setting_message(self, data: Dict[str, Any]) -> None:
        """
        Handle game setting messages from WebSocket clients.
        
        Args:
            data: Game setting message data
        """
        if "game_number" in data:
            # Broadcast the game change to all clients first so they can reset their state
            self.send_message_to_all({
                "type": "game",
                "game_number": data["game_number"]
            })
            # Then set the game data
            self.set_game(data)
        elif "timer_reset" in data:
            self.reset_timer()
        elif "score_reset" in data:
            self.reset_score()

    def handle_team_setting_message(self, data: Dict[str, Any]) -> None:
        """
        Handle team setting messages from WebSocket clients.
        
        Args:
            data: Team setting message data
        """
        
        if "jersey_color" in data:
            self.logger.info(f"Jersey color: {data}")
            if data["team"] == "h":
                self.state.home_jersey_color = data["jersey_color"]
            else:
                self.state.away_jersey_color = data["jersey_color"]
            self.send_message_to_all({
                "type": "jersey_color",
                "team": data["team"],
                "jersey_color": data["jersey_color"]
            })
            pass
        if "team_name" in data:
            if data["team"] == "h":
                self.set_team_names(
                    data["team_name"],
                    "",  # home_abv
                    self.state.away_team_name,
                    ""   # away_abv
                )
            else:
                self.set_team_names(
                    self.state.home_team_name,
                    "",  # home_abv
                    data["team_name"],
                    ""   # away_abv
                )
        

    def handle_wind_setting_message(self, data: Dict[str, Any]) -> None:
        """
        Handle wind setting messages from WebSocket clients.
        
        Args:
            data: Wind setting message data
        """
        if "wind_data" in data:
            self.set_wind(data["wind_data"])

    def handle_stats_setting_message(self, data: Dict[str, Any]) -> None:
        """
        Handle statistics setting messages from WebSocket clients.
        
        Args:
            data: Statistics setting message data
        """
        if "stats_reset" in data:
            self.state.game_events = []
            self.count_stats(self.state.game_events, self.state.players)

    def set_score(self, away_score: int, home_score: int) -> None:
        """Update and broadcast score."""
        self.send_message_to_all({
            "type": "game",
            "score_set": 1,
            "data": {
                "a_score": away_score,
                "h_score": home_score
            }
        })

    def set_players(self, players: Dict[str, Dict[str, str]]) -> None:
        """Update and broadcast players."""
        self.send_message_to_all({
            "type": "players",
            "players_set": 1,
            "players": players
        })

    def reset_timer(self) -> None:
        """Reset and broadcast timer."""
        self.send_message_to_all({
            "type": "game",
            "timer_reset": 1
        })

    def reset_score(self) -> None:
        """Reset and broadcast score."""
        self.send_message_to_all({
            "type": "game",
            "score_reset": 1
        })

    def check_and_set_stopped_game_status(self, ts: Dict[str, Any]) -> None:
        """Check and update the game's stopped status."""
        if ts['stop'] and not self.state.stopped_game and int(ts['time']) > 0:
            self.state.stopped_game = True

    def send_message_to_all(self, message: Dict[str, Any]) -> None:
        send_message_to_all(self.clients, message, self.logger)

    def parse_scores_events(self, events_array: List[Dict[str, Any]]) -> None:
        """Parse and process score events."""
        if len(self.state.game_events) < len(events_array):
            for i in range(len(self.state.game_events), len(events_array)):
                event = events_array[i]
                if "as" in event:
                    self.set_score(event["as"], event["hs"])
                    self.state.away_score = event["as"]
                    self.state.home_score = event["hs"]

                if self.proper_event(event):
                    self.state.game_events.append(event)
                    self.count_stats(self.state.game_events, self.state.players)
                    self.send_message_to_all(self.prepare_event(event))

    def proper_event(self, event: Dict[str, Any]) -> bool:
        return proper_event(event, config)
        
    def count_stats(self, events_data: List[Dict[str, Any]], players_data: Dict[str, Dict[str, str]]):
        stats_data = count_stats(events_data, players_data, self.state, self.logger)
        self.set_stats(stats_data)
        return stats_data

    def set_timer(self, time_data: Dict[str, Any], match_info: bool = False) -> None:
        """
        Set and update game timer.
        
        Args:
            time_data: Timer data containing 'ds' (timestamp), 'stop' and 'time' fields
            match_info: Whether this is initial match info
        """
        self.logger.debug(f"Setting timer with data: {time_data}, current game_time: {self.state.game_time}. Match info: {match_info}")
        timer_offset = calculate_timer_offset(time_data["ds"])

        # Only update game_time if timer is running
        if not time_data["stop"]:
            if self.detect_start(time_data):
                self.logger.debug(f"Start detected")
                self.state.game_time = time_data["ds"]
                self.start_match_event(timer_offset)
            else:
                # For running timer, update game_time and send running timer event
                self.state.game_time = time_data["ds"]
                self.set_running_timer_event(timer_offset)
        else:
            # For stopped timer, use the time value directly
            self.set_timer_event(int(time_data["time"]) / 10)
            
        self.logger.debug(f"Timer set complete, game_time: {self.state.game_time}")

    def start_match_event(self, timer_offset: float) -> None:
        """
        Send match start event to all clients.
        
        Args:
            timer_offset: Current timer offset
        """
        self.send_message_to_all({
            "type": "game",
            "start": 1,
            "data": {
                "timer_offset": timer_offset
            }
        })

    def set_running_timer_event(self, timer_offset: float) -> None:
        """
        Send running timer event to all clients.
        
        Args:
            timer_offset: Current timer offset
        """
        self.send_message_to_all({
            "type": "game",
            "running_timer_set": 1,
            "timer_offset": timer_offset
        })

    def set_timer_event(self, time_value: float) -> None:
        """
        Send timer set event to all clients.
        
        Args:
            time_value: Time value to set
        """
        self.send_message_to_all({
            "type": "game",
            "timer_set": 1,
            "timer_offset": time_value
        })

    def detect_start(self, time_data: Dict[str, Any]) -> bool:
        """
        Detect if a game is starting.
        
        Args:
            time_data: Timer data containing 'ds' (timestamp) and 'stop' fields
            
        Returns:
            True if game is starting, False otherwise
        """
        timer_offset = calculate_timer_offset(time_data["ds"])
        self.logger.debug(f"Start detection - Timer offset: {timer_offset}, Game time: {self.state.game_time}")
        return (
            self.state.game_time == 0 and 
            not time_data["stop"] and 
            timer_offset < 60
        )

    def set_team_names(self, home_name: str, home_abv: str, away_name: str, away_abv: str) -> None:
        """
        Set and broadcast team names.
        
        Args:
            home_name: Full name of home team
            home_abv: Abbreviation of home team
            away_name: Full name of away team
            away_abv: Abbreviation of away team
        """
        home_name = normalize_team_name(home_name)
        away_name = normalize_team_name(away_name)
        
        self.state.home_team_name = home_name
        self.state.away_team_name = away_name

        home_team_name_abv = home_abv or home_name[:config.DEFAULT_TEAM_NAME_LENGTH]
        away_team_name_abv = away_abv or away_name[:config.DEFAULT_TEAM_NAME_LENGTH]

        self.send_message_to_all({
            "type": "team",
            "team": "h",
            "team_name": home_team_name_abv,
            "team_name_full": home_name
        })

        self.send_message_to_all({
            "type": "team",
            "team": "a",
            "team_name": away_team_name_abv,
            "team_name_full": away_name
        })

    @staticmethod
    def _normalize_team_name(team_name: Optional[str]) -> str:
        # Deprecated: use normalize_team_name from game_utils
        return normalize_team_name(team_name)

    def get_team_side(self, team_id: str) -> Optional[str]:
        return get_team_side(team_id, config.TEAM_SIDE_MAPPING)

    @staticmethod
    def calculate_timer_offset(timestamp: int) -> float:
        # Deprecated: use calculate_timer_offset from game_utils
        return calculate_timer_offset(timestamp)

    def set_wind(self, wind_data: Dict[str, Any]) -> None:
        """
        Set and broadcast wind data.
        
        Args:
            wind_data: Wind information to broadcast
        """
        self.send_message_to_all({
            "type": "wind",
            "wind_update": 1,
            "wind_data": wind_data
        })

    def set_stats(self, stats_data: Dict[str, Any]) -> None:
        """
        Set and broadcast statistics data.
        
        Args:
            stats_data: Statistics to broadcast
        """
        self.send_message_to_all({
            "type": "stats",
            "stats_update": 1,
            "stats_data": stats_data
        })
        
    def send_game_state_to_client(self, client) -> None:
        """
        Send complete game state to a specific client.
        Used when a client explicitly requests current game state.
        
        Args:
            client: The WebSocket client to send state to
        """
        self.logger.info(f"Sending game state to client {client.address}")
        
        # Send game ID
        if self.state.game_number:
            client.sendMessage(json.dumps({
                "type": "game",
                "game_number": self.state.game_number
            }))
        
        # Send team names
        if self.state.home_team_name:
            client.sendMessage(json.dumps({
                "team": "h",
                "team_name": self.state.home_team_name.split(" ")[0] if self.state.home_team_name else "",
                "team_name_full": self.state.home_team_name
            }))
        
        if self.state.away_team_name:
            client.sendMessage(json.dumps({
                "team": "a",
                "team_name": self.state.away_team_name.split(" ")[0] if self.state.away_team_name else "",
                "team_name_full": self.state.away_team_name
            }))
        
        # Send jersey colors
        if self.state.home_jersey_color:
            client.sendMessage(json.dumps({
                "type": "jersey_color",
                "team": "h",
                "jersey_color": self.state.home_jersey_color
            }))
        
        if self.state.away_jersey_color:
            client.sendMessage(json.dumps({
                "type": "jersey_color",
                "team": "a",
                "jersey_color": self.state.away_jersey_color
            }))
        
        # Send player data
        if self.state.players:
            client.sendMessage(json.dumps({
                "players_set": True,
                "players": self.state.players
            }))
        
        # Send current score
        if self.state.away_score is not None and self.state.home_score is not None:
            client.sendMessage(json.dumps({
                "type": "game",
                "score_set": 1,
                "data": {
                    "a_score": self.state.away_score,
                    "h_score": self.state.home_score
                }
            }))
        
        # Send current timer state
        if self.state.game_time is not None:
            client.sendMessage(json.dumps({
                "timer_set": True,
                "timer_offset": self.state.game_time
            }))
            
        # Send stats data if available
        if self.state.game_events:
            stats_data = self.count_stats(self.state.game_events, self.state.players)
            client.sendMessage(json.dumps({
                "type": "stats",
                "stats_update": 1,
                "stats_data": stats_data
            }))

    def handle_wind_request(self) -> None:
        """Handle wind data request from the wind sensor."""
        try:
            r = requests.get(
                config.WIND_URL,
                timeout=config.REQUEST_TIMEOUT
            )
            wind_data = r.json()
            self.set_wind(wind_data)
        except Exception as e:
            self.logger.error(f"Wind request error: {e}", exc_info=True)