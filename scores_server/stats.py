from __future__ import annotations
import logging  # Added
from typing import List, Dict, Any, Union

# Large commented-out JSON block removed.

logger = logging.getLogger(__name__)  # Added

def get_rounded_percentage(a: Union[int, str], b: Union[int, str]) -> int:
    """
    Calculate rounded percentage of a/(a+b).
    
    Args:
        a: First number (can be int or str)
        b: Second number (can be int or str)
        
    Returns:
        Rounded percentage or 0 if sum is 0
    """
    # Convert to integers if strings
    a_int = int(a) if isinstance(a, str) else a
    b_int = int(b) if isinstance(b, str) else b
    
    return round((a_int / (a_int + b_int)) * 100) if (a_int + b_int) != 0 else 0


def count_d_o_points(game_events: List[Dict[str, Any]]) -> Dict[str, Dict[str, int]]:
    """
    Count defensive and offensive points for each team based on game events.

    In Ultimate Frisbee, the determination of an offensive vs. defensive point
    depends on which team had possession at the start of that particular point:
    - An "offense point" is scored by the team that had possession at the start of the point.
    - A "defense point" is scored by the team that gained possession (usually after a turnover)
      during the point and then scored.

    Key events influencing possession for D/O point calculation:
    - 'O' (Offense): Indicates initial possession at the very start of the game.
    - 'S' (Score): After a score, the team that was scored upon receives possession for the next point.
    - 'H' (Halftime): Possession typically flips. If Team A had possession for the point leading into
      halftime, Team B gets possession for the point starting after halftime.
    - 'T' (Turnover): Indicates a change of possession within a point. This is crucial for a
      defensive score but doesn't change who *started* the point on offense.
    """
    # Initialize points structure to store counts for home ('h') and away ('a') teams
    d_o_points = {
        "a": {
            "offence_points": 0,
            "defence_points": 0
        },
        "h": {
            "offence_points": 0,
            "defence_points": 0
        }
    }
    
    # Filter for events relevant to determining D/O points: Scores, initial Offense, Halftime, and Turnovers.
    # Turnovers help confirm if a point involved a possession change, characteristic of many defensive scores.
    relevant_events = [event for event in game_events if event["y"] in ["S", "O", "H", "T"]]
    
    if not relevant_events:
        return d_o_points  # No relevant events, so no points.
    
    # Identify indices of halftime and score events to segment the game.
    # These are critical junctures where possession rules for the next point are applied.
    halftime_event_indices = []
    score_indices = []
    
    for i, event in enumerate(relevant_events):
        if event["y"] == "H":
            halftime_indices.append(i)
        elif event["y"] == "S":
            score_indices.append(i)
    
    if not score_indices:
        return d_o_points
    
    # Find the initial offense event
    starting_offense = None
    for event in relevant_events:
        if event["y"] == "O":
            starting_offense = event["e"]
            break
    
    if starting_offense is None and relevant_events:
        # If no explicit offense event, use the first event's team
        starting_offense = relevant_events[0]["e"]
    elif starting_offense is None:
        # No events at all
        return d_o_points
    
    # Process the game with precise tracking of who starts each point with possession
    current_offense_team = starting_offense
    
    logger.debug(
        f"count_d_o_points: Initial offense: {current_offense_team}, "
        f"{len(score_indices)} scores to process among {len(relevant_events)} relevant events."
    )
    
    # Track if we've passed halftime
    passed_halftime = False
    
    # Process each point
    point_boundaries = [0] + [i+1 for i in score_indices] + [len(relevant_events)]
    
    for i in range(len(point_boundaries) - 1):
        # Skip the last pseudo-point
        if i >= len(score_indices):
            break
            
        # Get score event for this point
        score_idx = score_indices[i]
        score_event = relevant_events[score_idx]
        
        # Get all events in this point
        point_start = point_boundaries[i]
        point_end = point_boundaries[i+1]
        point_events = relevant_events[point_start:point_end]
        
        # Check if this point contains halftime
        for event in point_events:
            if event["y"] == "H" and not passed_halftime:
                passed_halftime = True
                # At halftime, possession switches to opposite team
                current_offense_team = "h" if current_offense_team == "a" else "a"
        
        # Check if point had turnovers
        had_turnover = any(event["y"] == "T" for event in point_events)
        
        # Determine who scored and if it was offense or defense
        scoring_team = score_event["e"]
        is_offense_point = scoring_team == current_offense_team
        
        if is_offense_point:
            # Offense point
            d_o_points[scoring_team]["offence_points"] += 1
        else:
            # Defense point
            d_o_points[scoring_team]["defence_points"] += 1
        
        # After a score, possession switches
        current_offense_team = "a" if scoring_team == "h" else "h"
    
    return d_o_points


def count_disc_possession(game_events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Calculate disc possession time for each team as a percentage of the total game duration
    covered by the provided events.

    Args:
        game_events: A list of game event dictionaries. Each event is expected
                     to have a 'y' key for the event type and a 't' key for the
                     timestamp of the event. Relevant event types are 'O' (Offense set),
                     'T' (Turnover), 'S' (Score), and 'H' (Halftime).

    Returns:
        A dictionary containing:
        - 'a': Percentage of time the away team had possession.
        - 'h': Percentage of time the home team had possession.
        - 'total': The total duration of the game segment covered by the events (timestamp of the last event).
                   Returns 0 for all if no relevant events are found.
    """
    # Filter for events that signify a potential change in possession or define game segments.
    possession_game_events = [event for event in game_events if event["y"] in ["T", "S", "O", "H"]]
    
    if not possession_game_events:
        logger.debug("count_disc_possession: No relevant events for possession calculation.")
        return {"a": 0, "h": 0, "total": 0}
    
    # Initialize possession time counters for away ('a') and home ('h') teams.
    disc_possession_time = {
        "a": 0,  # Time in original units for away team
        "h": 0,  # Time in original units for home team
        "total": possession_game_events[-1]["t"] # Timestamp of the last event
    }
    
    # Determine the initial team on offense.
    initial_event_for_possession = possession_game_events[0] 
    for event in possession_game_events:
        if event["y"] == "O": 
            initial_event_for_possession = event
            break
    
    current_possessing_team = initial_event_for_possession["e"] 
    previous_event_time = 0 
    logger.debug(
        f"count_disc_possession: Initial possessing team: {current_possessing_team}, "
        f"Total event time span: {disc_possession_time['total']} from {len(possession_game_events)} events."
    )

    # Iterate through each relevant event to calculate time segments and attribute possession.
    for event in possession_game_events:
        current_event_time = event["t"]
        time_segment_duration = current_event_time - previous_event_time

        # Attribute the time segment to the team that had possession *before* this event occurred.
        if current_possessing_team in disc_possession_time: # Ensure team is 'a' or 'h'
            disc_possession_time[current_possessing_team] += time_segment_duration
        
        # Update who has possession *after* this event, for the *next* segment.
        event_type = event["y"]
        event_team = event.get("e") # Team associated with the event (e.g., who turned over, who scored)

        if event_type == "O":
            # Offense event sets the possession to the specified team.
            current_possessing_team = event_team
        elif event_type == "T":
            # Turnover: possession switches to the other team.
            current_possessing_team = "h" if event_team == "a" else "a"
        elif event_type == "S":
            # Score: possession switches to the team that was scored upon.
            current_possessing_team = "h" if event_team == "a" else "a" # If 'a' scored, 'h' gets disc.
        elif event_type == "H":
            # Halftime: possession typically flips from who had it leading into halftime.
            # (Assuming current_possessing_team correctly reflects who had it before 'H' was processed)
            current_possessing_team = "h" if current_possessing_team == "a" else "a"
        
        previous_event_time = current_event_time # Update previous_event_time for the next iteration.
    
    # Calculate possession percentages based on the total duration.
    total_duration = disc_possession_time["total"]
    if total_duration == 0:
        # Avoid division by zero if total duration is zero.
        disc_possession_time["a_percentage"] = 0.0
        disc_possession_time["h_percentage"] = 0.0
    else:
        disc_possession_time["a_percentage"] = round(disc_possession_time["a"] / total_duration * 100, 1)
        disc_possession_time["h_percentage"] = round(disc_possession_time["h"] / total_duration * 100, 1)
        
    # For backward compatibility or if raw times are preferred by caller,
    # the original structure returned percentages directly in "a" and "h" keys.
    # Let's return a more descriptive structure but also consider original if needed.
    # The original function returned: {"a": percentage, "h": percentage, "total": total_time}
    return {
        "a": disc_possession_time["a_percentage"],
        "h": disc_possession_time["h_percentage"],
        "total": total_duration # Total time of events considered
    }


def count_turnovers(game_events: List[Dict[str, Any]]) -> Dict[str, int]:
    """Counts turnovers for each team."""
    logger.debug(f"count_turnovers: Processing {len(game_events)} events.")
    turnover_stats = {
        "a": 0, # Away team turnovers
        "h": 0  # Home team turnovers
    }
    for event in game_events:
        if event.get("y") == "T": # "T" signifies a turnover event
            team_committed_turnover = event.get("e") # "e" indicates the team
            if team_committed_turnover == "a":
                turnover_stats["a"] += 1
            elif team_committed_turnover == "h":
                turnover_stats["h"] += 1
    logger.debug(f"Turnover counts: Away {turnover_stats['a']}, Home {turnover_stats['h']}.")
    return turnover_stats


def count_timeouts(game_events: List[Dict[str, Any]]) -> Dict[str, int]:
    """Counts timeouts called by each team."""
    logger.debug(f"count_timeouts: Processing {len(game_events)} events.")
    timeout_stats = {
        "a": 0, # Away team timeouts
        "h": 0  # Home team timeouts
    }
    for event in game_events:
        if event.get("y") == "TO": # "TO" signifies a timeout event
            team_called_timeout = event.get("e") # "e" indicates the team
            if team_called_timeout == "a":
                timeout_stats["a"] += 1
            elif team_called_timeout == "h":
                timeout_stats["h"] += 1
    logger.debug(f"Timeout counts: Away {timeout_stats['a']}, Home {timeout_stats['h']}.")
    return timeout_stats


def count_points_per_player(game_events: List[Dict[str, Any]], players: Dict[str, Dict[str, str]]) -> Dict[str, Dict[str, Any]]:
    logger.debug(f"count_points_per_player: Processing {len(game_events)} events for player stats.")
    """
    Calculates and aggregates points (goals and assists) for each player.

    Args:
        game_events: A list of game event dictionaries. Score events ('S') are
                     processed, expecting 's' (scorer ID), 'a' (assist ID),
                     and 'e' (team).
        players: A dictionary mapping team ('a' or 'h') to another dictionary,
                 which maps player jersey numbers (as strings) to player names.
                 Example: {"a": {"10": "Player A"}, "h": {"5": "Player B"}}

    Returns:
        A dictionary where keys are team identifiers ('a', 'h'). Each team's value
        is another dictionary where keys are player jersey numbers (strings).
        Each player's value is a dictionary with "name", "goals", "assists",
        and "total" points. The players within each team are sorted by total points
        (descending), then goals, then assists, then by name (ascending).
    """
    # Initialize structure for player statistics for both away ('a') and home ('h') teams.
    player_stats_agg: Dict[str, Dict[str, Dict[str, Any]]] = { # Renamed to avoid conflict with module name
        "a": {},
        "h": {}
    }

    # Iterate through game events to find score events ('S').
    for event in game_events:
        if event.get("y") == "S": # Process only score events.
            scorer_no = str(event.get("s")) # Scorer's jersey number.
            assist_no = str(event.get("a")) # Assist's jersey number.
            team = event.get("e")           # Team that scored ('a' or 'h').

            if team not in player_stats_agg:
                logger.warning(f"Score event has unknown team '{team}': {event}")
                continue # Skip if team is not 'a' or 'h'.

            # --- Process Scorer ---
            # Ensure scorer number is valid (not the placeholder for invalid/unknown, e.g., "-1").
            # Assuming config.INVALID_PLAYER_NO = "-1"
            if scorer_no != "-1": 
                try:
                    # Initialize player in stats if not already present.
                    if scorer_no not in player_stats_agg[team]:
                        # Attempt to get player name; use a placeholder if not found.
                        player_name = players.get(team, {}).get(scorer_no, f"Unknown Player {scorer_no}")
                        player_stats_agg[team][scorer_no] = {"name": player_name, "goals": 0, "assists": 0, "total": 0}
                    
                    player_stats_agg[team][scorer_no]["goals"] += 1
                    player_stats_agg[team][scorer_no]["total"] += 1
                except KeyError as e_key: # Should be caught by .get for players[team] if team is invalid
                    logger.error(f"KeyError processing scorer: Player number '{scorer_no}' in team '{team}'. Event: {event}. Error: {e_key}")
                    # This path should ideally not be hit if players.get(team, {}) is used.
                    # If it means players[team] itself is missing, that's a different issue.
                    # For now, this matches original logic of potentially raising KeyError if players[team][scorer_no] fails.
                    # To keep existing behavior of raising error:
                    # raise KeyError(f"Player {scorer_no} not found in team {team} roster. Event: {event}") from e_key
                    # If we want to be more resilient and log then continue:
                    if scorer_no not in player_stats_agg[team]: # ensure it exists if error happened before init
                         player_stats_agg[team][scorer_no] = {"name": f"Error Player {scorer_no}", "goals": 1, "assists": 0, "total": 1}
                    else: # if error happened during increment
                         player_stats_agg[team][scorer_no]["goals"] += 1 # try to salvage
                         player_stats_agg[team][scorer_no]["total"] += 1


            # --- Process Assist ---
            # Ensure assist number is valid and not Callahan (e.g., "XX").
            # Assuming config.INVALID_PLAYER_NO = "-1" and config.CALLAHAN_MARKER = "XX"
            if assist_no != "-1" and assist_no != "XX":
                try:
                    # Initialize player in stats if not already present.
                    if assist_no not in player_stats_agg[team]:
                        player_name = players.get(team, {}).get(assist_no, f"Unknown Player {assist_no}")
                        player_stats_agg[team][assist_no] = {"name": player_name, "goals": 0, "assists": 0, "total": 0}
                    
                    player_stats_agg[team][assist_no]["assists"] += 1
                    player_stats_agg[team][assist_no]["total"] += 1
                except KeyError as e_key:
                    logger.error(f"KeyError processing assist: Player number '{assist_no}' in team '{team}'. Event: {event}. Error: {e_key}")
                    # Similar to scorer, decide on error handling.
                    # raise KeyError(f"Player {assist_no} not found in team {team} roster. Event: {event}") from e_key
                    if assist_no not in player_stats_agg[team]:
                         player_stats_agg[team][assist_no] = {"name": f"Error Player {assist_no}", "goals": 0, "assists": 1, "total": 1}
                    else:
                         player_stats_agg[team][assist_no]["assists"] += 1
                         player_stats_agg[team][assist_no]["total"] += 1
    
    # Sort player statistics for each team.
    sorted_player_stats: Dict[str, Dict[str, Any]] = {}
    
    for team_key in ["a", "h"]: # Use team_key to avoid conflict if 'team' variable is used inside loop
        # Sort by:
        # 1. Total points (descending)
        # 2. Goals (descending)
        # 3. Assists (descending)
        # 4. Player name (ascending)
        sorted_player_stats[team_key] = dict(sorted(
            player_stats_agg[team_key].items(), # Use player_stats_agg here
            key=lambda item: (
                -item[1]["total"],        # Sort by total points (descending)
                -item[1]["goals"],        # Then by goals (descending)
                -item[1]["assists"],      # Then by assists (descending)
                item[1]["name"]           # Then by name (ascending)
            )
        ))

    return sorted_player_stats
