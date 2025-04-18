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
        """
        Prepare event data for WebSocket transmission.
        """
        prepared_event = {"type": "scoreboard", "subtype": "", "data": {}}
        self.logger.debug(f"Preparing event: {event}")
        if event["y"] == "O":
            prepared_event["side"] = event["e"]
            prepared_event["subtype"] = "offence"
        elif event["y"] == "T":
            prepared_event["side"] = event["e"]
            prepared_event["subtype"] = "turnover"
        elif event["y"] == "TO":
            prepared_event["side"] = event["e"]
            prepared_event["subtype"] = "timeout"
        elif event["y"] == "S":
            prepared_event.update(self._prepare_score_event(event))
        elif event["y"] == "E":
            self.logger.info(f"End event: {event}")
            prepared_event["subtype"] = "end"
            prepared_event["data"]["time"] = event["t"]

        return prepared_event

    def _prepare_score_event(self, event: Dict[str, Any]) -> Dict[str, Any]:
        score_event = {
            "side": event["e"],
            "subtype": "score",
            "data": {
                "assist": "",
                "assist_no": str(event["a"]),
                "scorer": "",
                "scorer_no": str(event["s"]),
                "a_score": str(event["as"]),
                "h_score": str(event["hs"])
            }
        }
        self.logger.info(f"Score event: {score_event}")
        if score_event["data"]["assist_no"] == config.CALLAHAN_MARKER:
            score_event["data"]["assist"] = "CALLAHAN"
        elif score_event["data"]["assist_no"] != config.INVALID_PLAYER_NO:
            score_event["data"]["assist"] = self.state.players[score_event["side"]][score_event["data"]["assist_no"]]
        
        if score_event["data"]["scorer_no"] != config.INVALID_PLAYER_NO:
            score_event["data"]["scorer"] = self.state.players[score_event["side"]][score_event["data"]["scorer_no"]]

        return score_event

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
        """Send a message to all connected WebSocket clients."""
        self.logger.debug(f"Send ws message: {message}")
        for client in self.clients:
            client.sendMessage(json.dumps(message))

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
        """
        Check if the event is valid and should be processed.
        
        Args:
            event: Event data to validate
            
        Returns:
            True if event is valid, False otherwise
        """
        # First check for invalid score event
        if event["y"] == "S" and event["a"] == -1 and event["s"] == -1:
            return False
            
        # Then check for valid event types
        return event["y"] in [
            config.EventType.TURNOVER,
            config.EventType.SCORE,
            config.EventType.OFFENCE,
            config.EventType.END,
            config.EventType.TIMEOUT
        ]

    def count_stats(self, events_data: List[Dict[str, Any]], players_data: Dict[str, Dict[str, str]]) -> None:
        """Calculate and update game statistics."""
        d_o_points = stats.count_d_o_points(events_data)
        disc_possession = stats.count_disc_possession(events_data)
        turnovers = stats.count_turnovers(events_data)
        timeouts = stats.count_timeouts(events_data)
        player_stats = stats.count_points_per_player(events_data, players_data)

        # Make a fresh copy of events data for timeline
        timeline_events = []
        
        # Get valid time-based events and sort them
        valid_events = []
        for event in events_data:
            if event["y"] in ["S", "T", "O", "TO", "H", "E"] and "t" in event:
                try:
                    # Convert time to integer
                    event_copy = event.copy()
                    event_copy["t"] = int(event["t"])
                    valid_events.append(event_copy)
                except (ValueError, TypeError):
                    self.logger.error(f"Invalid time value in event: {event}")
        
        # Sort events by time
        valid_events.sort(key=lambda x: x["t"])
        
        # Check if we have valid events with different timestamps
        has_valid_time_sequence = False
        if len(valid_events) >= 2:
            # Check if time spans are valid (not all the same)
            first_time = valid_events[0]["t"]
            last_time = valid_events[-1]["t"]
            
            # Log time spans to debug
            self.logger.info(f"First event time: {first_time}, Last event time: {last_time}")
            self.logger.info(f"Time span: {last_time - first_time}")
            
            # Look at time differences between events
            time_diffs = []
            for i in range(1, len(valid_events)):
                time_diff = valid_events[i]["t"] - valid_events[i-1]["t"]
                time_diffs.append(time_diff)
            
            self.logger.info(f"Time differences between events: {time_diffs}")
            
            if last_time > first_time:
                has_valid_time_sequence = True
        
        # Add explicit offense event at the beginning to establish initial possession
        # Default to home team possession at the start
        first_team = "h"
        
        # Look for evidence of which team had first possession
        for event in events_data:
            if event["y"] in ["O", "T", "S"]:
                first_team = event["e"]
                break
                
        # # Only add initial offense event if using real timestamps
        # # For artificial timestamps, we'll add it as part of that process
        # if has_valid_time_sequence and valid_events:
        #     # Use the actual first timestamp - 10 to put it slightly earlier
        #     first_time = max(0, valid_events[0]["t"] - 10)
        #     timeline_events.append({
        #         "y": "O",
        #         "e": first_team,
        #         "t": first_time
        #     })
        
        if has_valid_time_sequence:
            # Use actual timestamps
            self.logger.info("Using actual timestamps for timeline")
            timeline_events.extend(valid_events)
            
            # Log resulting timeline events to debug
            time_values = [event.get("t", 0) for event in timeline_events]
            self.logger.info(f"Timeline time values: {time_values}")
            
            # Calculate time differences to verify proportions
            time_diffs = []
            for i in range(1, len(timeline_events)):
                time_diff = timeline_events[i]["t"] - timeline_events[i-1]["t"]
                time_diffs.append(time_diff)
            self.logger.info(f"Timeline time differences: {time_diffs}")
            
        else:
            
            # Calculate exponentially increasing time intervals
            # This will make later events more spread out, creating dynamic width segments
            total_events = sum(1 for event in events_data if event["y"] in ["S", "T", "O", "TO", "H", "E"])
            
            # Create a realistic-looking set of timestamps
            event_index = 1  # Start at 1 because we'll add the first event here
            total_game_time = 5000  # Total artificial game time
            
            
            # Different event types have different typical time spans - simulate this
            for event in events_data:
                # Make sure we copy the event to avoid modifying the original
                event_copy = event.copy()
                # Include only relevant events for timeline
                if event["y"] in ["S", "T", "O", "TO", "H", "E"]:
                    # Real games have varied time intervals - create this with a progressive approach
                    # Each event's time depends on its position in game sequence
                    
                    # Get base time from event's position in sequence (non-linear)
                    progression_factor = event_index / total_events  # 0-1 range
                    
                    # Base time from event position - this creates naturally varying segment widths
                    time_value = int(progression_factor * total_game_time)
                    
                    # Ensure events don't have identical times by adding minimum differences
                    if timeline_events:
                        # Get the last event's time
                        last_time = timeline_events[-1]["t"]
                        # Ensure this event is at least a minimum distance away
                        min_diff = 100 + (event_index * 20)  # Increasing minimum gaps
                        time_value = max(time_value, last_time + min_diff)
                    
                    # Set the final time
                    event_copy["t"] = time_value
                    event_index += 1
                    
                    # Add to timeline events
                    timeline_events.append(event_copy)
            
            # Sort the events by time to ensure proper ordering
            timeline_events.sort(key=lambda x: x.get("t", 0))
            
            # Log resulting timeline events to debug
            time_values = [event.get("t", 0) for event in timeline_events]
            
            # Calculate time differences to verify proportions
            time_diffs = []
            for i in range(1, len(timeline_events)):
                time_diff = timeline_events[i]["t"] - timeline_events[i-1]["t"]
                time_diffs.append(time_diff)

        stats_data = {
            "points": {
                "a": self.state.away_score,
                "h": self.state.home_score,
                "ap": stats.get_rounded_percentage(self.state.away_score, self.state.home_score),
                "hp": stats.get_rounded_percentage(self.state.home_score, self.state.away_score)
            },
            "o_points": {
                "a": d_o_points["a"]["offence_points"],
                "h": d_o_points["h"]["offence_points"],
                "ap": stats.get_rounded_percentage(d_o_points["a"]["offence_points"], d_o_points["h"]["offence_points"]),
                "hp": stats.get_rounded_percentage(d_o_points["h"]["offence_points"], d_o_points["a"]["offence_points"])
            },
            "d_points": {
                "a": d_o_points["a"]["defence_points"],
                "h": d_o_points["h"]["defence_points"],
                "ap": stats.get_rounded_percentage(d_o_points["a"]["defence_points"], d_o_points["h"]["defence_points"]),
                "hp": stats.get_rounded_percentage(d_o_points["h"]["defence_points"], d_o_points["a"]["defence_points"])
            },
            "o_time": {
                "a": f"{disc_possession['a']}%",
                "h": f"{disc_possession['h']}%",
                "ap": round(disc_possession["a"]),
                "hp": round(disc_possession["h"])
            },
            "turnovers": {
                "a": turnovers["a"],
                "h": turnovers["h"],
                "ap": stats.get_rounded_percentage(turnovers["a"], turnovers["h"]),
                "hp": stats.get_rounded_percentage(turnovers["h"], turnovers["a"])
            },
            "timeouts": {
                "a": timeouts["a"],
                "h": timeouts["h"],
                "ap": stats.get_rounded_percentage(timeouts["a"], timeouts["h"]),
                "hp": stats.get_rounded_percentage(timeouts["h"], timeouts["a"])
            },
            "player_stats": player_stats,
            "game_events": timeline_events  # Pass processed timeline events
        }

        self.send_message_to_all({
            "type": "stats",
            "stats_update": 1,
            "stats_data": stats_data
        })

    def set_timer(self, time_data: Dict[str, Any], match_info: bool = False) -> None:
        """
        Set and update game timer.
        
        Args:
            time_data: Timer data containing 'ds' (timestamp), 'stop' and 'time' fields
            match_info: Whether this is initial match info
        """
        self.logger.debug(f"Setting timer with data: {time_data}, current game_time: {self.state.game_time}. Match info: {match_info}")
        timer_offset = self.calculate_timer_offset(time_data["ds"])

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

    @staticmethod
    def calculate_timer_offset(timestamp: int) -> float:
        """
        Calculate timer offset from timestamp.
        
        Args:
            timestamp: Server timestamp in deciseconds
            
        Returns:
            Offset in seconds
        """
        current_time = int(round(time.time() * 1000))  # Current time in milliseconds
        server_time = int(timestamp) * 100  # Convert deciseconds to milliseconds
        return round((current_time - server_time) / 1000)

    def detect_start(self, time_data: Dict[str, Any]) -> bool:
        """
        Detect if a game is starting.
        
        Args:
            time_data: Timer data containing 'ds' (timestamp) and 'stop' fields
            
        Returns:
            True if game is starting, False otherwise
        """
        timer_offset = self.calculate_timer_offset(time_data["ds"])
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
        home_name = self._normalize_team_name(home_name)
        away_name = self._normalize_team_name(away_name)
        
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
        """
        Normalize team name by removing special characters and extra spaces.
        
        Args:
            team_name: Raw team name or None
            
        Returns:
            Normalized team name or empty string if None
        """
        if team_name is None:
            return ""
            
        # Remove special characters and normalize unicode
        normalized = unicodedata.normalize('NFKD', team_name)
        normalized = ''.join(c for c in normalized if not unicodedata.combining(c))
        
        # Remove extra spaces and strip
        normalized = ' '.join(normalized.split())
        
        return normalized

    def get_team_side(self, team_id: str) -> Optional[str]:
        """
        Get team side (home/away) from team ID.
        
        Args:
            team_id: Team identifier
            
        Returns:
            Team side or None if not found
        """
        return config.TEAM_SIDE_MAPPING.get(team_id)

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