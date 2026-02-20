from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Tuple, Union

from v2.shared.contracts import AdvancedStats, LegacyStatValue, PlayerStatLine, StatsPayload


def get_rounded_percentage(a: Union[int, str], b: Union[int, str]) -> int:
    a_int = int(a) if isinstance(a, str) else a
    b_int = int(b) if isinstance(b, str) else b
    total = a_int + b_int
    return round((a_int / total) * 100) if total else 0


def count_d_o_points(game_events: List[Dict[str, Any]]) -> Dict[str, Dict[str, int]]:
    points = {
        "a": {"offence_points": 0, "defence_points": 0},
        "h": {"offence_points": 0, "defence_points": 0},
    }
    relevant = [ev for ev in game_events if ev.get("y") in {"S", "O", "H", "T"}]
    if not relevant:
        return points

    starting_offense = next((ev.get("e") for ev in relevant if ev.get("y") == "O"), "a")
    current_offense_team = starting_offense
    passed_halftime = False

    score_indices = [idx for idx, event in enumerate(relevant) if event.get("y") == "S"]
    boundaries = [0] + [idx + 1 for idx in score_indices] + [len(relevant)]

    for idx in range(len(score_indices)):
        score_event = relevant[score_indices[idx]]
        point_start = boundaries[idx]
        point_end = boundaries[idx + 1]
        point_events = relevant[point_start:point_end]

        for event in point_events:
            if event.get("y") == "H" and not passed_halftime:
                passed_halftime = True
                current_offense_team = "h" if current_offense_team == "a" else "a"

        scoring_team = score_event.get("e")
        if not scoring_team:
            continue
        if scoring_team == current_offense_team:
            points[scoring_team]["offence_points"] += 1
        else:
            points[scoring_team]["defence_points"] += 1
        current_offense_team = "a" if scoring_team == "h" else "h"
    return points


def count_disc_possession(game_events: List[Dict[str, Any]]) -> Dict[str, Any]:
    events = [ev for ev in game_events if ev.get("y") in {"T", "S", "O", "H"}]
    if not events:
        return {"a": 0, "h": 0, "total": 0}

    possession = {"a": 0, "h": 0, "total": int(events[-1].get("t", 0))}
    first_offense = next((ev for ev in events if ev.get("y") == "O"), events[0])
    current_side = first_offense.get("e", "a")
    prev_time = 0

    for event in events:
        current_time = int(event.get("t", 0))
        elapsed = current_time - prev_time
        possession[current_side] += max(0, elapsed)
        event_type = event.get("y")
        if event_type in {"T", "S", "H"}:
            current_side = "h" if current_side == "a" else "a"
        elif event_type == "O":
            current_side = event.get("e", current_side)
        prev_time = current_time

    if possession["total"] <= 0:
        possession["a"] = 0
        possession["h"] = 0
    else:
        possession["a"] = round((possession["a"] / possession["total"]) * 100, 1)
        possession["h"] = round((possession["h"] / possession["total"]) * 100, 1)
    return possession


def count_turnovers(game_events: List[Dict[str, Any]]) -> Dict[str, int]:
    return {
        "a": len([ev for ev in game_events if ev.get("y") == "T" and ev.get("e") == "a"]),
        "h": len([ev for ev in game_events if ev.get("y") == "T" and ev.get("e") == "h"]),
    }


def count_timeouts(game_events: List[Dict[str, Any]]) -> Dict[str, int]:
    return {
        "a": len([ev for ev in game_events if ev.get("y") == "TO" and ev.get("e") == "a"]),
        "h": len([ev for ev in game_events if ev.get("y") == "TO" and ev.get("e") == "h"]),
    }


def count_points_per_player(
    game_events: List[Dict[str, Any]],
    players: Dict[str, Dict[str, str]],
) -> Dict[str, Dict[str, PlayerStatLine]]:
    player_stats: Dict[str, Dict[str, PlayerStatLine]] = {"a": {}, "h": {}}

    for event in game_events:
        if event.get("y") != "S":
            continue

        team = event.get("e")
        if team not in {"a", "h"}:
            continue
        scorer_no = str(event.get("s"))
        assist_no = str(event.get("a"))
        if scorer_no == "-1":
            continue
        if scorer_no not in players.get(team, {}):
            continue

        scorer = player_stats[team].setdefault(
            scorer_no,
            PlayerStatLine(name=players[team][scorer_no], goals=0, assists=0, total=0),
        )
        scorer.goals += 1
        scorer.total += 1

        if assist_no not in {"-1", "XX"} and assist_no in players.get(team, {}):
            assister = player_stats[team].setdefault(
                assist_no,
                PlayerStatLine(name=players[team][assist_no], goals=0, assists=0, total=0),
            )
            assister.assists += 1
            assister.total += 1

    for team in ("a", "h"):
        sorted_items = sorted(
            player_stats[team].items(),
            key=lambda item: (-item[1].total, -item[1].goals, -item[1].assists, item[1].name),
        )
        player_stats[team] = dict(sorted_items)
    return player_stats


def _compute_scoring_runs(game_events: List[Dict[str, Any]]) -> Dict[str, int]:
    max_run = {"a": 0, "h": 0}
    streak_team: str | None = None
    streak_len = 0
    for event in game_events:
        if event.get("y") != "S":
            continue
        team = event.get("e")
        if team not in {"a", "h"}:
            continue
        if streak_team == team:
            streak_len += 1
        else:
            streak_team = team
            streak_len = 1
        max_run[team] = max(max_run[team], streak_len)
    return max_run


def _compute_avg_point_duration(game_events: List[Dict[str, Any]]) -> float:
    score_times = [int(event.get("t", 0)) for event in game_events if event.get("y") == "S"]
    if len(score_times) < 2:
        return float(score_times[0]) if score_times else 0.0
    durations = [max(0, score_times[idx] - score_times[idx - 1]) for idx in range(1, len(score_times))]
    return round(sum(durations) / len(durations), 2) if durations else 0.0


def _top_contributors(
    player_stats: Dict[str, Dict[str, PlayerStatLine]],
    limit: int = 3,
) -> Dict[str, List[Dict[str, Any]]]:
    contributors: Dict[str, List[Dict[str, Any]]] = {"a": [], "h": []}
    for team in ("a", "h"):
        for number, line in list(player_stats.get(team, {}).items())[:limit]:
            contributors[team].append(
                {
                    "number": number,
                    "name": line.name,
                    "total": line.total,
                    "goals": line.goals,
                    "assists": line.assists,
                }
            )
    return contributors


def _to_legacy_stat(a_value: Union[int, str], h_value: Union[int, str]) -> LegacyStatValue:
    return LegacyStatValue(
        a=a_value,
        h=h_value,
        ap=get_rounded_percentage(a_value, h_value),
        hp=get_rounded_percentage(h_value, a_value),
    )


class StatsEngine:
    def compute(
        self,
        game_events: List[Dict[str, Any]],
        players: Dict[str, Dict[str, str]],
        away_score: int,
        home_score: int,
    ) -> StatsPayload:
        d_o_points = count_d_o_points(game_events)
        disc_possession = count_disc_possession(game_events)
        turnovers = count_turnovers(game_events)
        timeouts = count_timeouts(game_events)
        player_stats = count_points_per_player(game_events, players)

        total_points = max(away_score + home_score, 1)
        hold_rate = {
            "a": round((d_o_points["a"]["offence_points"] / max(away_score, 1)) * 100, 1)
            if away_score
            else 0.0,
            "h": round((d_o_points["h"]["offence_points"] / max(home_score, 1)) * 100, 1)
            if home_score
            else 0.0,
        }
        break_rate = {
            "a": round((d_o_points["a"]["defence_points"] / total_points) * 100, 1),
            "h": round((d_o_points["h"]["defence_points"] / total_points) * 100, 1),
        }
        avg_point_duration = _compute_avg_point_duration(game_events)
        turnovers_per_point = round((turnovers["a"] + turnovers["h"]) / total_points, 2)
        scoring_runs = _compute_scoring_runs(game_events)

        advanced_stats = AdvancedStats(
            hold_rate=hold_rate,
            break_rate=break_rate,
            avg_point_duration=avg_point_duration,
            turnovers_per_point=turnovers_per_point,
            scoring_runs=scoring_runs,
            top_contributors=_top_contributors(player_stats),
        )

        return StatsPayload(
            points=_to_legacy_stat(away_score, home_score),
            o_points=_to_legacy_stat(
                d_o_points["a"]["offence_points"],
                d_o_points["h"]["offence_points"],
            ),
            d_points=_to_legacy_stat(
                d_o_points["a"]["defence_points"],
                d_o_points["h"]["defence_points"],
            ),
            o_time=LegacyStatValue(
                a=f"{disc_possession['a']}%",
                h=f"{disc_possession['h']}%",
                ap=round(disc_possession["a"]),
                hp=round(disc_possession["h"]),
            ),
            turnovers=_to_legacy_stat(turnovers["a"], turnovers["h"]),
            timeouts=_to_legacy_stat(timeouts["a"], timeouts["h"]),
            player_stats=player_stats,
            game_events=game_events,
            advanced_stats=advanced_stats,
        )
