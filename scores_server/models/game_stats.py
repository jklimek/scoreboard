# Handles all statistics calculation and timeline logic
import stats

def count_stats(events_data, players_data, state, logger):
    d_o_points = stats.count_d_o_points(events_data)
    disc_possession = stats.count_disc_possession(events_data)
    turnovers = stats.count_turnovers(events_data)
    timeouts = stats.count_timeouts(events_data)
    player_stats = stats.count_points_per_player(events_data, players_data)
    timeline_stats = stats.count_timeline_stats(events_data)

    # ... Timeline event logic can be moved here if desired ...
    # For now, just return the stats_data dict as in the original code
    stats_data = {
        "points": {
            "a": state.away_score,
            "h": state.home_score,
            "ap": stats.get_rounded_percentage(state.away_score, state.home_score),
            "hp": stats.get_rounded_percentage(state.home_score, state.away_score)
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
        "game_events": timeline_stats
    }
    return stats_data