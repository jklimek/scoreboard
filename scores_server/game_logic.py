from __future__ import annotations

import json
import time
import requests
import logging
import unicodedata
from typing import List, Dict, Any, Optional
from SimpleWebSocketServer import WebSocket
from scores_server.models import GameState # Updated import for GameState
from scores_server.config import config
from scores_server import stats # Adjusted import for stats

class GameServer:
    def __init__(self) -> None:
        self.state = GameState()
        self.clients: List[WebSocket] = []
        self.logger = logging.getLogger(__name__)

    def set_game(self, data: Dict[str, Any]) -> None:
        """
        Sets the current game number and fetches initial match information.
        If the game number changes from a previously set game, it resets the game state.
        """
        if "game_number" in data:
            new_game_number = data["game_number"]
            if self.state.game_number != 0 and self.state.game_number != new_game_number:
                self.logger.info(f"Game number changed from {self.state.game_number} to {new_game_number}. Resetting game state.")
                self.reset_game()
            self.state.game_number = new_game_number
            self.state.stopped_game = False
            self.get_match_info(data["game_number"])
            self.logger.info(f"Players: {self.state.players}")

    def reset_game(self) -> None:
        """Resets the game state, including scores and timer, and notifies clients."""
        self.state.reset() # Resets GameState dataclass to defaults
        self.reset_score() # Broadcasts score reset
        self.reset_timer() # Broadcasts timer reset

    def get_match_info(self, game_number: int) -> None:
        """
        Fetches initial match information (teams, players, initial timer, initial score)
        from the configured scores API for the given game number.
        Updates the internal game state with this information and broadcasts relevant parts to clients.
        """
        self.logger.info(f"Fetching match info for game number: {game_number}")
        payload = {
            "game": game_number,  # The ID of the game to fetch
            "players": "true",    # Include player rosters in the response
            "update": "true",     # Unclear what this flag does, but it's part of the existing API call
            "teams": "true"       # Include team names in the response
        }

        try:
            # Make a POST request to the scores API
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
        Transforms a raw game event (from the external source) into a structured format
        suitable for broadcasting to WebSocket clients for scoreboard updates.

        The 'y' field in the raw event determines the 'subtype' of the scoreboard message.
        'e' field usually indicates the team associated with the event.
        't' field indicates the time of the event.
        """
        prepared_event: Dict[str, Any] = {"type": "scoreboard", "subtype": "", "data": {}}
        event_type = event.get("y")
        event_team = event.get("e")
        event_time = event.get("t")

        self.logger.debug(f"Preparing event for WebSocket: {event}")

        if event_type == "O": # Offense possession call
            prepared_event["subtype"] = "offence"
            if event_team: prepared_event["side"] = event_team
        elif event_type == "T": # Turnover
            prepared_event["subtype"] = "turnover"
            if event_team: prepared_event["side"] = event_team
        elif event_type == "TO": # Timeout
            prepared_event["subtype"] = "timeout"
            if event_team: prepared_event["side"] = event_team
        elif event_type == "S": # Score
            # Score events are more complex and have their own preparation method.
            # _prepare_score_event returns a dict that should merge with/update prepared_event.
            prepared_event.update(self._prepare_score_event(event))
        elif event_type == "E": # End of game/period
            self.logger.info(f"End event detected: {event}")
            prepared_event["subtype"] = "end"
            if event_time is not None: prepared_event["data"]["time"] = event_time
        else:
            self.logger.warning(f"Unknown event type '{event_type}' received in prepare_event: {event}")
            return {} # Return empty dict for unknown event types to avoid sending malformed messages

        return prepared_event

    def _prepare_score_event(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """
        Prepares the detailed structure for a 'score' event, including scorer and assist info.
        """
        # Raw event structure for score:
        # {"e": team, "a": assist_player_no, "s": scorer_player_no, "as": away_score, "hs": home_score, ...}
        team_scored = event["e"]
        assist_player_no = str(event.get("a", config.INVALID_PLAYER_NO)) # Ensure string
        scorer_player_no = str(event.get("s", config.INVALID_PLAYER_NO)) # Ensure string

        # Base structure for the score event to be broadcast
        score_event_payload = {
            "side": team_scored, # 'h' or 'a'
            "subtype": "score",
            "data": {
                "assist": "", # Player name for assist
                "assist_no": assist_player_no,
                "scorer": "", # Player name for scorer
                "scorer_no": scorer_player_no,
                "a_score": str(event.get("as", self.state.away_score)), # Current away score
                "h_score": str(event.get("hs", self.state.home_score))  # Current home score
            }
        }
        
        self.logger.info(f"Preparing score event details: {score_event_payload}")

        # Populate assist player name
        if assist_player_no == config.CALLAHAN_MARKER:
            score_event_payload["data"]["assist"] = "CALLAHAN"
        elif assist_player_no != config.INVALID_PLAYER_NO:
            try:
                score_event_payload["data"]["assist"] = self.state.players[team_scored][assist_player_no]
            except KeyError:
                self.logger.error(
                    f"Assist player number {assist_player_no} not found in team {team_scored} roster for event: {event}"
                )
        
        # Populate scorer player name
        if scorer_player_no != config.INVALID_PLAYER_NO:
            try:
                score_event_payload["data"]["scorer"] = self.state.players[team_scored][scorer_player_no]
            except KeyError:
                self.logger.error(
                    f"Scorer player number {scorer_player_no} not found in team {team_scored} roster for event: {event}"
                )
        
        return score_event_payload

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
            data: Statistics setting message data. Expects "stats_reset": true to clear events.
        """
        if data.get("stats_reset"):
            self.logger.info("Resetting game events and recalculating stats due to stats_reset request.")
            self.state.game_events = []
            # Recalculate stats with empty events (should result in zeroed stats)
            # and broadcast them.
            self.count_stats(self.state.game_events, self.state.players)

    def set_score(self, away_score: int, home_score: int) -> None:
        """Updates and broadcasts the current game score to all clients."""
        self.logger.debug(f"Broadcasting score update: Away {away_score}, Home {home_score}")
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
        """
        Sends a JSON-serialized message to all connected WebSocket clients.
        Includes error handling for individual client send failures.
        """
        self.logger.debug(f"Sending WebSocket message to all clients: {message}")
        message_json = json.dumps(message) # Serialize once
        for client in self.clients:
            try:
                client.sendMessage(message_json)
            except Exception as e:
                # Log error if sending message to a specific client fails, but continue for others
                self.logger.error(f"Failed to send message to client {client.address}: {e}", exc_info=True)

    def parse_scores_events(self, events_array: List[Dict[str, Any]]) -> None:
        """
        Parses and processes new score-related events received from an external source.

        This method is designed to handle an array of events, `events_array`,
        and compare it against the events already processed and stored in `self.state.game_events`.
        It processes only the new events that appear in `events_array` beyond those
        already in `self.state.game_events`.

        For each new event:
        1. If the event contains score information ("as" - away score, "hs" - home score),
           it updates the game score using `self.set_score()` (which broadcasts)
           and updates the internal `self.state.away_score` and `self.state.home_score`.
        2. If the event is considered "proper" (valid for stats and timeline processing,
           as determined by `self.proper_event()`), it is:
           a. Appended to `self.state.game_events` (the internal log of significant events).
           b. Triggers a recalculation and broadcast of all game statistics via `self.count_stats()`.
           c. Prepared for a specific WebSocket transmission (e.g., scoreboard update for that event)
              using `self.prepare_event()` and then sent to all clients.
        
        Args:
            events_array: A list of event dictionaries from the external source.
        """
        num_existing_events = len(self.state.game_events)
        num_received_events = len(events_array)

        if num_received_events > num_existing_events:
            self.logger.info(
                f"Processing {num_received_events - num_existing_events} new events "
                f"(existing: {num_existing_events}, received: {num_received_events})."
            )
            # Iterate only over the new events, from the end of the existing list to the end of the new one.
            for i in range(num_existing_events, num_received_events):
                event = events_array[i]
                self.logger.debug(f"Processing new event raw data: {event}")

                # If the event contains 'as' (away score) and 'hs' (home score),
                # it's treated as a direct score-update event.
                if "as" in event and "hs" in event:
                    self.logger.info(f"Direct score update in event: Away {event['as']}, Home {event['hs']}")
                    # self.set_score updates clients and internal state via GameState object if it were passed,
                    # but here it only broadcasts. We also update internal state directly.
                    self.set_score(event["as"], event["hs"]) 
                    self.state.away_score = event["as"]
                    self.state.home_score = event["hs"]

                # Check if the event is a "proper" event type (e.g., Turnover, Score, Offence set, End, Timeout)
                # that should be recorded for detailed stats, timeline, and specific scoreboard updates.
                if self.proper_event(event):
                    self.logger.debug(f"Proper event detected: Type '{event.get('y', 'N/A')}'. Adding to game events.")
                    self.state.game_events.append(event) # Add to internal list of processed significant events
                    
                    # Recalculate and broadcast all game statistics based on the updated event list.
                    # self.state.players provides the player roster needed for some stats.
                    self.count_stats(self.state.game_events, self.state.players) 
                    
                    # Prepare this specific event for a discrete scoreboard update (e.g., turnover icon)
                    # and send it to all clients.
                    prepared_event_for_broadcast = self.prepare_event(event)
                    self.send_message_to_all(prepared_event_for_broadcast)
        elif num_received_events < num_existing_events:
            # This case might indicate a reset from the source or an issue.
            self.logger.warning(
                f"Received event array is shorter ({num_received_events}) than existing "
                f"game events ({num_existing_events}). This might indicate an event stream reset "
                "or an issue with the source. Current game events are not altered."
            )
            # Depending on expected behavior, one might want to reset self.state.game_events here,
            # but the current logic only processes when the new event array is longer.

    def proper_event(self, event: Dict[str, Any]) -> bool:
        """
        Check if the event is valid and should be processed.
        
        Args:
            event: An event dictionary, expected to have a 'y' key for event type.
                   May also have 'a' (assist) and 's' (scorer) keys for score events.
            
        Returns:
            True if the event is considered proper for processing, False otherwise.
        """
        event_type = event.get("y")

        # Rule 1: An 'S' (Score) event is improper if both assist and scorer are -1.
        # This typically indicates a data entry error or a placeholder.
        if event_type == "S" and str(event.get("a")) == config.INVALID_PLAYER_NO and str(event.get("s")) == config.INVALID_PLAYER_NO:
            self.logger.warning(f"Improper score event (both assist and scorer are -1): {event}")
            return False
            
        # Rule 2: Event type must be one of the known significant types.
        # These are types that typically affect game flow, stats, or scoreboard display.
        is_known_type = event_type in [
            config.EventType.TURNOVER,
            config.EventType.SCORE,
            config.EventType.OFFENCE, # E.g. initial possession, or after timeout/pull
            config.EventType.END,     # E.g. end of period, end of game
            config.EventType.TIMEOUT,
            config.EventType.HALFTIME # 'H' was missing, adding it as it's processed elsewhere
        ]
        if not is_known_type:
            self.logger.debug(f"Event type '{event_type}' is not considered a 'proper' event for main processing: {event}")
        
        return is_known_type

    @staticmethod
    def _prepare_timeline_events(events_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Prepares a list of events suitable for timeline visualization.
        It processes raw events to either use their actual timestamps or generate
        artificial timestamps if the actual ones are not suitable (e.g., all zero or too close).
        """
        timeline_events: List[Dict[str, Any]] = []
        
        # Filter for valid time-based events and attempt to convert time to integer
        valid_events: List[Dict[str, Any]] = []
        for event in events_data:
            if event.get("y") in ["S", "T", "O", "TO", "H", "E"] and "t" in event:
                try:
                    event_copy = event.copy()
                    event_copy["t"] = int(event["t"]) # Ensure time is integer
                    valid_events.append(event_copy)
                except (ValueError, TypeError):
                    self.logger.error(f"Invalid time value in event, skipping for timeline: {event}")
        
        valid_events.sort(key=lambda x: x["t"]) # Sort events by time
        
        has_valid_time_sequence = False
        if len(valid_events) >= 2:
            first_time = valid_events[0]["t"]
            last_time = valid_events[-1]["t"]
            if last_time > first_time: # Check if there's an actual time progression
                has_valid_time_sequence = True

        if has_valid_time_sequence:
            self.logger.info("Using actual timestamps for timeline events.")
            timeline_events.extend(valid_events)
        else:
            self.logger.info("Generating artificial timestamps for timeline events.")
            # Fallback to artificial timestamp generation if actual timestamps are not sequential
            num_relevant_events = len(valid_events) # Use count of events that *could* have time
            if num_relevant_events == 0: # No events to process for artificial timeline
                return []

            total_game_time_artificial = 5000 # Arbitrary total time for artificial timeline
            
            for i, event_copy in enumerate(valid_events): # Iterate over already copied and time-validated events
                # Distribute events over the artificial total game time
                # A simpler linear approach for this refactor:
                time_value = int(((i + 1) / num_relevant_events) * total_game_time_artificial)
                
                event_with_artificial_time = event_copy.copy() # Ensure we don't modify original valid_events items
                event_with_artificial_time["t"] = time_value
                timeline_events.append(event_with_artificial_time)
            
            # Ensure sorted by new artificial time, though linear generation should maintain order.
            timeline_events.sort(key=lambda x: x.get("t", 0))
            
        return timeline_events

    def _build_stats_payload(
        self,
        d_o_points: Dict[str, Dict[str, int]],
        disc_possession: Dict[str, Any],
        turnovers: Dict[str, int],
        timeouts: Dict[str, int],
        player_stats_data: Dict[str, Dict[str, Any]],
        timeline_events: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Constructs the statistics payload dictionary for WebSocket transmission."""
        return {
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
            "o_time": { # Possession time percentages
                "a": f"{disc_possession.get('a', 0)}%", # Use .get for safety
                "h": f"{disc_possession.get('h', 0)}%",
                "ap": round(disc_possession.get('a', 0)),
            "hp": round(disc_possession.get('h', 0)) # Raw percentage for home
            },
            "turnovers": {
                "a": turnovers.get("a",0), # Use .get for safety
                "h": turnovers.get("h",0),
                "ap": stats.get_rounded_percentage(turnovers["a"], turnovers["h"]),
                "hp": stats.get_rounded_percentage(turnovers["h"], turnovers["a"])
            },
            "timeouts": {
                "a": timeouts.get("a",0), # Use .get for safety
                "h": timeouts.get("h",0),
                "ap": stats.get_rounded_percentage(timeouts["a"], timeouts["h"]),
                "hp": stats.get_rounded_percentage(timeouts["h"], timeouts["a"])
            },
            "player_stats": player_stats_data,
            "game_events": timeline_events
        }

    def count_stats(self, events_data: List[Dict[str, Any]], players_data: Dict[str, Dict[str, str]]) -> None:
        """
        Calculates comprehensive game statistics and sends them to all clients.
        This method aggregates data from various stat calculation functions,
        prepares timeline events, and then broadcasts the compiled stats.
        """
        if not events_data: # Avoid processing if there are no events
            self.logger.info("No events data to count stats for.")
            # Optionally send empty/default stats if required by clients
            # For now, just return to avoid errors with empty events_data
            return

        # Calculate individual statistical components
        d_o_points = stats.count_d_o_points(events_data)
        disc_possession = stats.count_disc_possession(events_data) # Returns dict with 'a', 'h' percentages
        turnovers = stats.count_turnovers(events_data)
        timeouts = stats.count_timeouts(events_data)
        player_stats_data = stats.count_points_per_player(events_data, players_data)

        # Prepare events for timeline visualization
        timeline_events = self._prepare_timeline_events(events_data)

        # Build the final statistics payload
        stats_payload = self._build_stats_payload(
            d_o_points,
            disc_possession,
            turnovers,
            timeouts,
            player_stats_data,
            timeline_events
        )

        # Broadcast the updated statistics to all connected clients
        self.send_message_to_all({
            "type": "stats",
            "stats_update": 1,
            "stats_data": stats_payload
        })

    def set_timer(self, time_data: Dict[str, Any], match_info: bool = False) -> None:
        """
        Sets and updates the game timer based on data received from an external source.

        The method handles different scenarios:
        - If the timer from the source is running (`time_data["stop"]` is False):
            - If it's detected as the start of the match (`detect_start` returns True),
              it initializes `self.state.game_time` and sends a 'start' event.
            - Otherwise, it updates `self.state.game_time` and sends a 'running_timer_set' event.
        - If the timer from the source is stopped (`time_data["stop"]` is True):
            - It sends a 'timer_set' event with the explicit time value provided.
        
        Args:
            time_data: A dictionary containing timer information from the source.
                       Expected keys:
                       - "ds": Timestamp from the source (in deciseconds). Used for calculating offset
                               if the timer is running.
                       - "stop": Boolean indicating if the timer is stopped.
                       - "time": The explicit time value (in deciseconds) if the timer is stopped.
            match_info: Boolean flag, if True, indicates this timer setting is part of
                        the initial match information fetch. (Currently mainly used for logging).
        """
        self.logger.debug(
            f"Setting timer. Input time_data: {time_data}, "
            f"current self.state.game_time: {self.state.game_time}, match_info: {match_info}"
        )

        # Calculate the offset between local time and the source's timestamp.
        # This is used if the source timer is running to synchronize.
        # `time_data["ds"]` is expected to be a deciseconds timestamp.
        timer_offset = self.calculate_timer_offset(time_data["ds"])

        if not time_data["stop"]:
            # Source timer is RUNNING.
            # We need to determine if this is the very start of the game or just an update.
            if self.detect_start(time_data):
                # This is considered the start of the match.
                self.logger.info(f"Match start detected. Timer offset: {timer_offset}s.")
                self.state.game_time = time_data["ds"] # Store the source's timestamp.
                self.start_match_event(timer_offset)
            else:
                # Timer is running, but it's not the initial start (e.g., game resumed).
                self.logger.debug(f"Running timer update. Offset: {timer_offset}s.")
                self.state.game_time = time_data["ds"] # Update game_time with the new source timestamp.
                self.set_running_timer_event(timer_offset)
        else:
            # Source timer is STOPPED.
            # Use the explicit 'time' value provided by the source.
            # The 'time' field from source is in deciseconds, convert to seconds.
            stopped_time_value_seconds = int(time_data["time"]) / 10.0
            self.logger.info(f"Timer is stopped. Setting to explicit time: {stopped_time_value_seconds}s.")
            # Note: self.state.game_time is not updated here as per original logic,
            # because the game_time usually stores the 'ds' timestamp when running.
            # For a stopped timer, the explicit value is sent, but 'game_time' might hold
            # the last running 'ds' value or remain unchanged. This behavior should be confirmed
            # if it causes issues with game state representation.
            self.set_timer_event(stopped_time_value_seconds)
            
        self.logger.debug(f"Timer set process complete. Current self.state.game_time: {self.state.game_time}")

    def start_match_event(self, timer_offset: float) -> None:
        """
        Send match start event to all clients.
        
        Args:
            timer_offset: The calculated offset (in seconds) between the server's time
                          and the client's reported 'ds' timestamp. This helps clients
                          synchronize their countdown/countup timers.
            timer_offset: Similar to `start_match_event`, this offset allows clients
                          to synchronize with a running timer.
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
            timer_offset: The calculated offset (in seconds) between the server's time
                          and the client's reported 'ds' timestamp. This helps clients
                          synchronize their countdown/countup timers.
        """
        self.send_message_to_all({
            "type": "game",
            "running_timer_set": 1, # Indicates the timer is currently running
            "timer_offset": timer_offset
        })

    def set_timer_event(self, time_value: float) -> None:
        """
        Send timer set event to all clients.
        
        Args:
            time_value: The explicit time value (in seconds) to which clients
                        should set their timers. Used when the game clock is stopped.
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
            timestamp: The timestamp (in deciseconds) received from the external source,
                       representing the source's current game time when the timer is running.
            
        Returns:
            The calculated offset in seconds. A positive offset typically means the
            local server time is ahead of the source's time snapshot.
        """
        current_time_ms = int(round(time.time() * 1000))  # Current system time in milliseconds
        source_time_ms = int(timestamp) * 100  # Convert source's deciseconds to milliseconds
        
        offset_seconds = round((current_time_ms - source_time_ms) / 1000.0, 2) # Keep some precision
        self.logger.debug(f"Calculated timer offset: {offset_seconds}s (current_ms: {current_time_ms}, source_ds: {timestamp})")
        return offset_seconds

    def detect_start(self, time_data: Dict[str, Any]) -> bool:
        """
        Detects if the current timer data signifies the start of a new game.
        
        A game start is typically characterized by:
        1. The internal game state `self.state.game_time` being at its initial value (e.g., 0).
        2. The timer data from the source indicating the timer is running (`not time_data["stop"]`).
        3. The calculated `timer_offset` being relatively small (e.g., < 60 seconds),
           suggesting the source timer has just recently started relative to the server's clock.
           This helps differentiate a true start from a late join where `self.state.game_time` might still be 0.

        Args:
            time_data: Timer data from the source, including "ds" (timestamp) and "stop" status.
            
        Returns:
            True if conditions indicate a game start, False otherwise.
        """
        # Calculate offset first, as it's a condition for start detection.
        # `time_data["ds"]` is expected to be a deciseconds timestamp.
        timer_offset = self.calculate_timer_offset(time_data["ds"])

        is_starting = (
            self.state.game_time == 0 and  # Internal game time hasn't been set yet from a running source.
            not time_data["stop"] and      # Source timer is currently running.
            timer_offset < 60              # Offset is small, implying source timer just started.
        )
        
        self.logger.debug(
            f"Start detection: is_starting={is_starting} (self.state.game_time: {self.state.game_time}, "
            f"source_is_stopped: {time_data['stop']}, calculated_offset: {timer_offset}s)"
        )
        return is_starting

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
            normalized = ''.join(c for c in normalized if not unicodedata.combining(c) and c.isprintable()) # Keep printable
        
        # Remove extra spaces and strip leading/trailing whitespace
        normalized = ' '.join(normalized.split()).strip()
        
        return normalized

    @staticmethod
    def get_team_side(team_id: str) -> Optional[str]:
        """
        Get team side (home 'h' or away 'a') from a team ID string.
        Relies on `config.TEAM_SIDE_MAPPING`.
        
        Args:
            team_id: Team identifier (e.g., "1" for home, "2" for away as per some configs).
            
        Returns:
            Team side ('h' or 'a') or None if the team_id is not recognized.
        """
        return config.TEAM_SIDE_MAPPING.get(str(team_id)) # Ensure team_id is string for lookup

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
            stats_data: A pre-compiled dictionary of statistics to be broadcast.
                        This allows for sending stats that might be generated externally
                        or by a different process.
        """
        self.logger.info(f"Broadcasting provided stats_data: {stats_data}")
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
            client: The WebSocket client instance (which has a `sendMessage` method)
                    to send the game state to.
        """
        self.logger.info(f"Sending full game state to client {client.address}")

        def _send_to_client(data_to_send: Dict[str, Any]):
            """Helper to send a JSON message to the specified client."""
            try:
                client.sendMessage(json.dumps(data_to_send))
            except Exception as e:
                self.logger.error(f"Error sending state to client {client.address}: {e}", exc_info=True)

        # Sequence of messages to reconstruct the game state on the client side.
        if self.state.game_number:
            _send_to_client({"type": "game", "game_number": self.state.game_number})
        
        if self.state.home_team_name:
            _send_to_client({
                "type": "team", "team": "h",
                "team_name": self.state.home_team_name.split(" ")[0] if self.state.home_team_name else "",
                "team_name_full": self.state.home_team_name
            })
        if self.state.away_team_name:
            _send_to_client({
                "type": "team", "team": "a",
                "team_name": self.state.away_team_name.split(" ")[0] if self.state.away_team_name else "",
                "team_name_full": self.state.away_team_name
            })
        
        if self.state.home_jersey_color:
            _send_to_client({"type": "jersey_color", "team": "h", "jersey_color": self.state.home_jersey_color})
        if self.state.away_jersey_color:
            _send_to_client({"type": "jersey_color", "team": "a", "jersey_color": self.state.away_jersey_color})
        
        if self.state.players:
            _send_to_client({"type": "players", "players_set": 1, "players": self.state.players})
        
        # Ensure scores are not None before sending. GameState initializes them to 0.
        _send_to_client({
            "type": "game", "score_set": 1,
            "data": {"a_score": self.state.away_score, "h_score": self.state.home_score}
        })
        
        # Regarding timer: self.state.game_time stores the 'ds' timestamp when the timer is running.
        # If the timer is stopped, this 'ds' might be stale. The client needs to know
        # if the timer is currently running or stopped, and its current value.
        # This requires more state than just 'game_time' (e.g. is_stopped, current_display_time).
        # For now, sending game_time as timer_offset if it's non-zero.
        # A more robust solution would involve sending the full timer state (running/stopped, value).
        if self.state.game_time is not None: # game_time is initialized to 0
             _send_to_client({
                "type": "game",
                # "timer_set" was used for stopped timer, "running_timer_set" or "start" for running.
                # This is ambiguous. Let's send a generic timer state if possible,
                # or clarify client-side expectations.
                # For now, using "timer_set" as a general "this is the time" message.
                "timer_set": 1, # This implies a specific time value, not necessarily that it's stopped.
                "timer_offset": self.state.game_time # Or current displayed time if stopped
            })
            
        if self.state.game_events:
            # As noted before, count_stats sends to all. It doesn't return the payload.
            # To send stats only to this client, we would need to refactor count_stats
            # to return the payload, or duplicate its _build_stats_payload logic here.
            self.logger.warning(
                "Full stats data sending in send_game_state_to_client is currently limited "
                "as count_stats broadcasts directly. Consider refactoring count_stats to return payload."
            )
            # Current behavior: no specific stats payload sent directly to this client here.

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
