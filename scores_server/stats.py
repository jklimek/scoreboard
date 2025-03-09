from __future__ import annotations
from typing import List, Dict, Any, Union

# json_data = {"a": 15,
#              "an": "Ultimatum",
#              "e": [
#                  # {"e": "h", "t": 0, "y": "O"},
#                  {"e": "h", "t": 169, "y": "T"},
#                  {"e": "a", "t": 184, "y": "T"},
#                  {"e": "h", "t": 234, "y": "T"},
#                  {"e": "a", "t": 253, "y": "T"},
#                  {"e": "h", "t": 288, "y": "T"},
#                  {"a": 24, "as": "1", "e": "a", "hs": "0", "s": 9, "t": 330, "y": "S"},
#                  {"a": 97, "as": "1", "e": "h", "hs": "1", "s": 10, "t": 483, "y": "S"},
#                  {"a": 21, "as": "2", "e": "a", "hs": "1", "s": 11, "t": 621, "y": "S"},
#                  {"e": "h", "t": 734, "y": "T"},
#                  {"a": 21, "as": "3", "e": "a", "hs": "1", "s": 49, "t": 741, "y": "S"},
#                  {"a": 11, "as": "3", "e": "h", "hs": "2", "s": 9, "t": 843, "y": "S"},
#                  {"a": 21, "as": "4", "e": "a", "hs": "2", "s": 69, "t": 929, "y": "S"},
#                  {"e": "h", "t": 1060, "y": "T"},
#                  {"a": 9, "as": "5", "e": "a", "hs": "2", "s": 19, "t": 1075, "y": "S"},
#                  {"e": "h", "t": 1151, "y": "T"},
#                  {"e": "a", "t": 1157, "y": "T"},
#                  {"e": "h", "t": 1194, "y": "T"},
#                  {"e": "a", "t": 1211, "y": "T"},
#                  {"a": 20, "as": "5", "e": "h", "hs": "3", "s": 97, "t": 1229, "y": "S"},
#                  {"a": 21, "as": "6", "e": "a", "hs": "3", "s": 11, "t": 1428, "y": "S"},
#                  {"e": "h", "t": 1553, "y": "T"},
#                  {"e": "a", "t": 1593, "y": "T"},
#                  {"e": "h", "t": 1677, "y": "T"},
#                  {"a": 26, "as": "7", "e": "a", "hs": "3", "s": 22, "t": 1704, "y": "S"},
#                  {"e": "h", "t": 1804, "y": "T"},
#                  {"e": "a", "t": 1811, "y": "T"},
#                  {"e": "h", "t": 1872, "y": "T"},
#                  {"e": "a", "t": 2015, "y": "T"},
#                  {"e": "h", "t": 2068, "y": "T"},
#                  {"e": "a", "t": 2074, "y": "T"},
#                  {"a": 20, "as": "7", "e": "h", "hs": "4", "s": 97, "t": 2080, "y": "S"},
#                  {"e": "a", "t": 2206, "y": "T"},
#                  {"e": "h", "t": 2222, "y": "T"},
#                  {"e": "a", "t": 2238, "y": "T"},
#                  {"e": "h", "t": 2307, "y": "T"},
#                  {"e": "a", "t": 2460, "y": "T"},
#                  {"e": "h", "t": 2495, "y": "T"},
#                  {"e": "a", "t": 2541, "y": "T"},
#                  {"e": "h", "t": 2584, "y": "T"},
#                  {"e": "a", "t": 2601, "y": "T"},
#                  {"e": "h", "t": 2615, "y": "T"},
#                  {"e": "a", "t": 2645, "y": "T"},
#                  {"a": 11, "as": "7", "e": "h", "hs": "5", "s": 22, "t": 2656, "y": "S"},
#                  {"a": 21, "as": "8", "e": "a", "hs": "5", "s": 18, "t": 2836, "y": "S"},
#                  {"t": 2837, "y": "H"},
#                  {"e": "a", "t": 2953, "y": "T"},
#                  {"e": "h", "t": 2972, "y": "T"},
#                  {"e": "a", "t": 2975, "y": "T"},
#                  {"e": "h", "t": 3031, "y": "T"},
#                  {"a": 21, "as": "9", "e": "a", "hs": "5", "s": 9, "t": 3044, "y": "S"},
#                  {"e": "h", "t": 3159, "y": "T"},
#                  {"e": "a", "t": 3185, "y": "T"},
#                  {"e": "h", "t": 3207, "y": "T"},
#                  {"e": "a", "t": 3231, "y": "T"},
#                  {"e": "h", "t": 3445, "y": "T"},
#                  {"e": "a", "t": 3453, "y": "T"},
#                  {"e": "h", "t": 3470, "y": "T"},
#                  {"e": "a", "t": 3518, "y": "T"},
#                  {"a": 33, "as": "9", "e": "h", "hs": "6", "s": 11, "t": 3530, "y": "S"},
#                  {"e": "a", "t": 3620, "y": "T"},
#                  {"e": "h", "t": 3667, "y": "T"},
#                  {"a": 28, "as": "10", "e": "a", "hs": "6", "s": 49, "t": 3677, "y": "S"},
#                  {"e": "h", "t": 3826, "y": "T"},
#                  {"a": 27, "as": "11", "e": "a", "hs": "6", "s": 9, "t": 3827, "y": "S"},
#                  {"e": "h", "t": 3924, "y": "T"},
#                  {"a": 26, "as": "12", "e": "a", "hs": "6", "s": 11, "t": 3949, "y": "S"},
#                  {"e": "h", "t": 4086, "y": "T"},
#                  {"e": "a", "t": 4114, "y": "T"},
#                  {"e": "h", "t": 4154, "y": "T"},
#                  {"e": "a", "t": 4165, "y": "T"},
#                  {"e": "h", "t": 4261, "y": "T"},
#                  {"e": "a", "t": 4398, "y": "T"},
#                  {"e": "h", "t": 4442, "y": "T"},
#                  {"a": 24, "as": "13", "e": "a", "hs": "6", "s": 44, "t": 4479, "y": "S"},
#                  {"e": "h", "t": 4596, "y": "T"},
#                  {"a": 5, "as": "14", "e": "a", "hs": "6", "s": 22, "t": 4608, "y": "S"},
#                  {"a": 11, "as": "14", "e": "h", "hs": "7", "s": 20, "t": 4735, "y": "S"},
#                  {"e": "a", "t": 4843, "y": "T"},
#                  {"a": 11, "as": "14", "e": "h", "hs": "8", "s": 8, "t": 4854, "y": "S"},
#                  {"e": "a", "t": 4929, "y": "T"},
#                  {"a": 20, "as": "14", "e": "h", "hs": "9", "s": 97, "t": 5016, "y": "S"},
#                  {"a": 69, "as": "15", "e": "a", "hs": "9", "s": 27, "t": 5111, "y": "S"},
#                  {"t": 5112, "y": "E"}],
#              "h": 9,
#              "hn": "Ohana",
#              "o": "e",
#              "p": {"a": {"0": "Kamil Kiljan",
#                          "11": "Jakub Klimek",
#                          "15": "Cezary Przybyła",
#                          "16": "Agata Żuk",
#                          "18": "Milena Rusiecka",
#                          "19": "Oliwia Deorocka",
#                          "2": "Joanna Zawitowska",
#                          "21": "Piotr Wrzaszcz",
#                          "22": "Tomasz Bartniczak",
#                          "23": "Marek Dubrawa",
#                          "24": "Michał Gorzkowski",
#                          "26": "Julia Hardy",
#                          "27": "Honorata Ząbek",
#                          "28": "Bartłomiej Smolarek",
#                          "31": "Adam Broda",
#                          "44": "Adam Mossakowski",
#                          "49": "Oskar Żuchliński",
#                          "5": "Maciej Fickowski",
#                          "69": "Kamil Merch=elski",
#                          "7": "Mikołaj Folaron-Pamuła",
#                          "77": "Martyna Lis",
#                          "8": "Sandra Lisiewska",
#                          "9": "Bartłomiej Skopiński",
#                          "99": "Anna Łukasik"},
#                    "h": {"1": "Jakub Tumkielski",
#                          "10": "Kamila Bąk",
#                          "11": "Tomasz Gorczyca",
#                          "14": "Piotr Sobecki",
#                          "16": "Małgorzata Dalidonis",
#                          "17": "Maja Świgońska",
#                          "2": "Jan Zwolan",
#                          "20": "Jakub Węglarz",
#                          "22": "Andżelika Mianecka",
#                          "23": "Karolina Skrobiszewska",
#                          "24": "Łukasz Skierski",
#                          "33": "Hubert Klimkowski",
#                          "4": "Agata Przedpełska",
#                          "5": "Magdalena Dudzińska",
#                          "6": "Maria Filipska",
#                          "60": "Krzysztof Krysa",
#                          "8": "Matylda Lisiak",
#                          "9": "Jakub Raczyński",
#                          "97": "Marcin Głowacki"}},
#              "ts": {"ds": 0, "stop": True, "time": "51110"}}
#
# game_events = json_data["e"]
# players = json_data["p"]
#


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
    Count defensive and offensive points for each team.
    
    In Ultimate Frisbee:
    - Offense points occur when the team that started with the disc scores
    - Defense points occur when the team that didn't start with the disc forces a turnover and scores
    
    Note: In Ultimate Frisbee, the "O" event appears only once at the start of the game to 
    indicate who starts with possession. After that, possession alternates after each point,
    and flips at halftime if the first half ended with an odd number of points.
    """
    # Initialize points structure
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
    
    # Filter only events we need
    relevant_events = list(filter(lambda ev: ev["y"] in ["S", "O", "H", "T"], game_events))
    
    if not relevant_events:
        return d_o_points
    
    # First find all halftimes and scores to divide the game into parts
    halftime_indices = []
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
    Calculate disc possession time for each team as a percentage.
    
    Args:
        game_events: List of game events including turnovers, scores, etc.
        
    Returns:
        Dictionary with possession percentages and total time
    """
    possession_game_events = list(filter(lambda ev: ev["y"] in ["T", "S", "O", "H"], game_events))
    
    # Handle empty events case
    if not possession_game_events:
        return {
            "a": 0,
            "h": 0,
            "total": 0
        }
    
    disc_possession = {
        "a": 0,
        "h": 0,
        "total": possession_game_events[-1]["t"]
    }
    
    # Find first offense setting event
    first_offense_event = None
    for event in possession_game_events:
        if event["y"] == "O":
            first_offense_event = event
            break
    
    # If no explicit offense event found, use first event
    if first_offense_event is None:
        first_offense_event = possession_game_events[0]
    
    # Initialize tracking variables
    current_side = first_offense_event["e"]  # Current possession side
    prev_time = 0  # Previous event timestamp
    
    for e in possession_game_events:
        current_time = e["t"]
        elapsed_time = current_time - prev_time
        
        # Handle different event types
        if e["y"] == "O":
            # Time is attributed to the team that had possession BEFORE this event
            disc_possession[current_side] += elapsed_time
            # Now switch to the new offense team
            current_side = e["e"]
        
        elif e["y"] == "T":
            # Time is attributed to the team that had possession BEFORE this event
            # (which is the same team that committed the turnover)
            disc_possession[current_side] += elapsed_time
            # Switch possession to the other team for the next time period
            current_side = "h" if current_side == "a" else "a"
        
        elif e["y"] == "S":
            # Time is attributed to the team that had possession BEFORE this event
            # (which is also the scoring team)
            disc_possession[current_side] += elapsed_time
            # After score, possession switches to the other team
            current_side = "h" if e["e"] == "a" else "a"
        
        elif e["y"] == "H":
            # Time is attributed to the team that had possession BEFORE this event
            disc_possession[current_side] += elapsed_time
            # At halftime, possession typically switches
            current_side = "h" if current_side == "a" else "a"
        
        # Update previous time for next iteration
        prev_time = current_time
    
    # Calculate percentages
    if disc_possession["total"] == 0:
        disc_possession["a"] = 0
        disc_possession["h"] = 0
    else:
        disc_possession["a"] = round(disc_possession["a"] / disc_possession["total"] * 100, 1)
        disc_possession["h"] = round(disc_possession["h"] / disc_possession["total"] * 100, 1)
        
    return disc_possession


def count_turnovers(game_events):
    turnover_stats = {
        "a": len(list(filter(lambda ev: ev["y"] == "T" and ev["e"] == "a", game_events))),
        "h": len(list(filter(lambda ev: ev["y"] == "T" and ev["e"] == "h", game_events)))
    }
    return turnover_stats


def count_timeouts(game_events):
    timeout_stats = {
        "a": len(list(filter(lambda ev: ev["y"] == "TO" and ev["e"] == "a", game_events))),
        "h": len(list(filter(lambda ev: ev["y"] == "TO" and ev["e"] == "h", game_events)))
    }
    return timeout_stats


def count_points_per_player(game_events: List[Dict[str, Any]], players: Dict[str, Dict[str, str]]) -> Dict[str, Dict[str, Any]]:
    """
    Count points per player statistics.
    
    Args:
        game_events: List of game events
        players: Dictionary of players by team and number
        
    Returns:
        Dictionary of player statistics, sorted by total points
    """
    player_stats = {
        "a": {},
        "h": {}
    }

    for e in game_events:
        if e["y"] == "S":
            # Convert to strings to handle both string and integer inputs
            scorer_no = str(e["s"])
            assist_no = str(e["a"])
            team = e["e"]
            
            # Skip events with invalid player numbers
            if scorer_no == "-1" or assist_no == "-1":
                continue
                
            # Process scorer
            try:
                # Initialize player stats if needed
                if scorer_no not in player_stats[team]:
                    player_stats[team][scorer_no] = {
                        "name": players[team][scorer_no],
                        "goals": 0,
                        "assists": 0,
                        "total": 0
                    }
                
                # Count scorer stats
                player_stats[team][scorer_no]["goals"] += 1
                player_stats[team][scorer_no]["total"] += 1
            except KeyError:
                # Handle error when player number doesn't exist in roster
                # Re-raise to ensure callers know there's a problem
                raise KeyError(f"Player {scorer_no} not found in team {team} roster")
            
            # Handle assist stats (skip for Callahan)
            if assist_no != "XX":
                try:
                    # Initialize player stats if needed
                    if assist_no not in player_stats[team]:
                        player_stats[team][assist_no] = {
                            "name": players[team][assist_no],
                            "goals": 0,
                            "assists": 0,
                            "total": 0
                        }
                    
                    # Count assist stats
                    player_stats[team][assist_no]["assists"] += 1
                    player_stats[team][assist_no]["total"] += 1
                except KeyError:
                    # Handle error when player number doesn't exist in roster
                    raise KeyError(f"Player {assist_no} not found in team {team} roster")

    # Sort player stats by total points, goals, assists, then name
    sorted_stats = {}
    
    for team in ["a", "h"]:
        # Sort by:
        # 1. Total points (descending)
        # 2. Goals (descending)
        # 3. Assists (descending)
        # 4. Player name (ascending)
        sorted_stats[team] = dict(sorted(
            player_stats[team].items(),
            key=lambda x: (
                -x[1]["total"],        # Sort by total points (descending)
                -x[1]["goals"],        # Then by goals (descending)
                -x[1]["assists"],      # Then by assists (descending)
                x[1]["name"]           # Then by name (ascending)
            )
        ))

    return sorted_stats
