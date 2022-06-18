import unicodedata
import json
import os
import time
import requests
import stats
from flask import Flask, abort
from pprint import pprint
from flask_cors import CORS
from threading import Thread
from SimpleWebSocketServer import SimpleWebSocketServer, WebSocket
from teams_abv import teams_abv

# ======== GAME DATA ========
game_number = 0
game_events = []
game_time = 0
stopped_game = False
players = {}
home_score = 0
away_score = 0
home_team_name = ""
away_team_name = ""

home_away = {"A": "h", "B": "a"}

scores_url = os.getenv("SCORES_URL", "https://scores.frisbee.pl/ext/watchlive.php/")
wind_url = os.getenv("WIND_URL", "http://localhost:4000/wind")


# ======== ========= ========


def set_game(data):
    global game_number
    global game_events
    global players
    global stopped_game

    if "game_number" in data:
        if game_number != data["game_number"] and game_number != 0:
            reset_game()
        game_number = data["game_number"]
        stopped_game = False
        get_match_info(data["game_number"])
        print("Players: ")
        pprint(players)


def reset_game():
    global game_events
    global game_time
    global stopped_game
    global players
    global home_score
    global away_score

    game_events = []
    players = {}
    home_score = 0
    away_score = 0
    game_time = 0
    stopped_game = False
    reset_score()
    reset_timer()


def handle_team_setting_message(data):
    global home_away
    data["team"] = home_away[data["team"]]
    if "jersey_color" in data:
        data["type"] = "scoreboard"
        send_message_to_all(data)
        pass
    if "team_name" in data:
        data["type"] = "scoreboard"
        send_message_to_all(data)


def handle_game_setting_message(data):
    print("Game settings: ")
    pprint(data)
    if "game_number" in data:
        set_game(data)
    elif "timer_reset" in data:
        data["type"] = "scoreboard"
        send_message_to_all(data)


def handle_wind_setting_message(data):
    print("Wind settings: ")
    pprint(data)
    if "wind_toggle" in data:
        send_message_to_all(data)


def handle_stats_setting_message(data):
    print("Stats settings: ")
    pprint(data)
    if "roster_toggle" in data:
        send_message_to_all(data)
    elif "leaderboard_toggle" in data:
        send_message_to_all(data)
    elif "stats_toggle" in data:
        send_message_to_all(data)



clients = []


class WebSocketHandler(WebSocket):

    def handleMessage(self):
        data = json.loads(self.data)
        if data["type"] == "team":
            handle_team_setting_message(data)
        elif data["type"] == "game":
            handle_game_setting_message(data)
        elif data["type"] == "wind":
            handle_wind_setting_message(data)
        elif data["type"] == "stats":
            handle_stats_setting_message(data)

    def handleConnected(self):
        print(self.address, 'connected')
        for client in clients:
            msg = {"address": self.address[0] + ':' + str(self.address[1]), "status": "connected"}
            client.sendMessage(json.dumps(msg))
        clients.append(self)

    def handleClose(self):
        clients.remove(self)
        print(self.address, 'closed')
        for client in clients:
            msg = {"address": self.address[0] + ':' + str(self.address[1]), "status": "connected"}
            client.sendMessage(json.dumps(msg))

    @staticmethod
    def send_websocket_message_to_all(message):
        for client in clients:
            client.sendMessage(message)


def wind_update():
    while True:
        try:
            wind_request = requests.get(wind_url, timeout=1)
            result_data = wind_request.json()
            print("Wind request: ", result_data)
            wind_angle = result_data["a"]
            wind_speed = round(float(result_data["s"]), 1)
            set_wind(wind_angle, wind_speed)

        except requests.exceptions:
            print("Connection refused")
            pass

        time.sleep(5)


def scores_update():
    while True:
        if any(players) and int(game_number) >= 1000 and not stopped_game:

            payload = {
                "game": game_number,
                "update": "true"
            }
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.102 Safari/537.36'}

            try:
                r = requests.post(
                    scores_url,
                    data=payload,
                    headers=headers,
                    timeout=10
                )
                result_data = r.json()
                print("Scores request: ")
                pprint(result_data)
                set_timer(result_data["ts"])
                check_and_set_stopped_game_status(result_data["ts"])
                parse_scores_events(result_data["e"])
            except requests.exceptions:
                print("Connection refused")
                pass
        elif int(game_number) >= 1000 and not stopped_game:
            get_match_info(game_number)
        else:
            pass

        time.sleep(4)


# Check if game clock is moving and api calls are still necessary
def check_and_set_stopped_game_status(ts):
    global stopped_game
    if ts['stop'] and not stopped_game and int(ts['time']) > 0:
        stopped_game = True


def get_match_info(passed_game_number):
    global players
    # while not any(players):
    payload = {
        "game": passed_game_number,
        "players": "true",
        "update": "true",
        "teams": "true"
    }
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.102 Safari/537.36'}

    try:
        r = requests.post(
            scores_url,
            data=payload,
            headers=headers,
            timeout=10
        )
        result_data = r.json()
        print("Match info request:")
        pprint(result_data)
        set_team_names(result_data["hn"], result_data["ha"], result_data["an"], result_data["aa"])
        set_timer(result_data["ts"], True)
        set_score(result_data["a"], result_data["h"])
        if any(result_data["p"]["a"]) and any(result_data["p"]["h"]):
            players = result_data["p"]
            set_players(players)

    except requests.exceptions.ConnectionError:
        print("Connection refused")
        pass
        # time.sleep(5)


def parse_scores_events(events_array):
    print("Events difference: ")
    print(len(events_array) - len(game_events))
    if len(game_events) < len(events_array):
        for i in range(len(game_events), len(events_array)):
            event = events_array[i]
            # as = away score, doesn't matter which, all two are included for score events
            if "as" in event:
                set_score(event["as"], event["hs"])
            if proper_event(event):
                game_events.append(event)
                # Recount stats only on new proper events
                count_stats(game_events, players)
                send_message_to_all(prepare_event(event))
    # else Correct event


def strip_accents(s):
    s = s.replace("ł", "l")
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn')


def count_stats(events_data, players_data):
    # {'a': {'offence_points': 7, 'defence_points': 8}, 'h': {'offence_points': 6, 'defence_points': 3}}
    d_o_points = stats.count_d_o_points(events_data)

    # {'a': 37.4, 'h': 62.6, 'total': 5111}
    disc_possession = stats.count_disc_possession(events_data)

    # {'a': 26, 'h': 31}
    turnovers = stats.count_turnovers(events_data)

    # {'a': 0, 'h': 0}
    timeouts_used = stats.count_timeouts(events_data)

    # {'a': {   'total': [{'scores': 0, 'assists': 6, 'name': 'Piotr Wrzaszcz', 'no': '21'},
    #           'assists': [{'scores': 0, 'assists': 6, 'name': 'Piotr Wrzaszcz', 'no': '21'},
    #           'points': [{'scores': 3, 'assists': 1, 'name': 'Bartłomiej Skopiński', 'no': '9'},
    points_per_player = stats.count_points_per_player(events_data, players_data)


    # HERE SEND WEBSOCKET MSG TO SCOREBOARD


def prepare_event(event):
    prepared_event = {"type": "scoreboard", "subtype": "", "data": {}}

    # START
    # ?

    # OFFENCE
    if event["y"] == "O":
        prepared_event["side"] = event["e"]
        prepared_event["subtype"] = "offence"

    # TURNOVER
    elif event["y"] == "T":
        prepared_event["side"] = event["e"]
        prepared_event["subtype"] = "turnover"

    # TIMEOUT
    elif event["y"] == "TO":
        prepared_event["side"] = event["e"]
        prepared_event["subtype"] = "timeout"

    # SCORE
    elif event["y"] == "S":
        prepared_event["side"] = event["e"]
        prepared_event["subtype"] = "score"
        prepared_event["data"]["assist"] = ""
        prepared_event["data"]["assist_no"] = str(event["a"])
        prepared_event["data"]["scorer"] = ""
        prepared_event["data"]["scorer_no"] = str(event["s"])

        prepared_event["data"]["a_score"] = str(event["as"])
        prepared_event["data"]["h_score"] = str(event["hs"])

        if prepared_event["data"]["assist_no"] == "XX":
            prepared_event["data"]["assist"] = "CALLAHAN"
        elif prepared_event["data"]["assist_no"] != "-1":
            assist_str = players[prepared_event["side"]][prepared_event["data"]["assist_no"]]
            # prepared_event["data"]["assist"] = strip_accents(assist_str)
            prepared_event["data"]["assist"] = assist_str
        if prepared_event["data"]["scorer_no"] != "-1":
            scorer_str = players[prepared_event["side"]][prepared_event["data"]["scorer_no"]]
            # prepared_event["data"]["scorer"] = strip_accents(scorer_str)
            prepared_event["data"]["scorer"] = scorer_str

    # END
    elif event["y"] == "E":
        prepared_event["subtype"] = "end"
        prepared_event["data"]["time"] = event["t"]

    return prepared_event


def websocket_server():
    server = SimpleWebSocketServer('', 5005, WebSocketHandler)
    server.serveforever()


def send_message_to_all(message):
    print("Send ws message: ")
    pprint(message)
    WebSocketHandler.send_websocket_message_to_all(json.dumps(message))


def proper_event(event):
    if event["y"] == "S" and event["a"] == -1 and event["s"] == -1:
        return False
    elif event["y"] in ["T", "S", "O", "E", "TO"]:
        return True
    else:
        return False


def detect_start(time_data):
    global game_time
    print("Timer offset: " + str(calculate_timer_offset(time_data["ds"])))
    if game_time == 0 and time_data["stop"] is False and calculate_timer_offset(time_data["ds"]) < 60:
        return True
    else:
        return False


def calculate_timer_offset(timestamp):
    return round((int(round(time.time() * 1000)) - int(timestamp) * 100) / 1000)


def set_timer(time_data, match_info=False):
    global game_time
    timer_offset = calculate_timer_offset(time_data["ds"])

    if detect_start(time_data):
        game_time = time_data["ds"]
        start_match_event(timer_offset)
    if match_info and time_data["stop"] is False:
        set_running_timer_event(timer_offset)
    elif match_info and time_data["stop"] is True:
        set_timer_event(int(time_data["time"]) / 10)


def start_match_event(offset):
    send_message_to_all({
        "type": "game",
        "subtype": "start",
        "timer_offset": offset
    })


def set_running_timer_event(offset):
    send_message_to_all({
        "type": "game",
        "running_timer_set": 1,
        "timer_offset": offset
    })


def set_timer_event(offset):
    send_message_to_all({
        "type": "game",
        "timer_set": 1,
        "timer_offset": offset
    })


def set_players(players):
    send_message_to_all({
        "type": "players",
        "players_set": 1,
        "players": players
    })


def reset_timer():
    send_message_to_all({
        "type": "game",
        "timer_reset": 1
    })


def reset_score():
    send_message_to_all({
        "type": "game",
        "score_reset": 1
    })


def set_score(a_score, h_score):
    send_message_to_all({
        "type": "game",
        "score_set": 1,
        "data": {
            "a_score": a_score,
            "h_score": h_score
        }
    })


def set_wind(wind_angle, wind_speed):
    send_message_to_all({
        "type": "wind",
        "wind_update": 1,
        "data": {
            "wind_angle": wind_angle,
            "wind_speed": wind_speed
        }
    })


def set_team_names(home_name, home_abv, away_name, away_abv):
    global home_team_name
    global away_team_name

    home_team_name = home_name
    away_team_name = away_name

    if home_abv:
        home_team_name_abv = home_abv
    else:
        home_team_name_abv = home_team_name[0:3]

    if away_abv:
        away_team_name_abv = away_abv
    else:
        away_team_name_abv = away_team_name[0:3]

    # home team scoreboard
    send_message_to_all({
        "type": "team",
        "team": "h",
        "team_name": home_team_name_abv,
        "team_name_full": home_team_name
    })

    # away team scoreboard
    send_message_to_all({
        "type": "team",
        "team": "a",
        "team_name": away_team_name_abv,
        "team_name_full": away_team_name
    })


# App generator for WSGI daemon (gunicorn)
def generate_app():
    tmp_app = Flask(__name__)
    wind_thread = Thread(target=wind_update)
    wind_thread.start()
    scores_thread = Thread(target=scores_update)
    scores_thread.start()
    websocket_thread = Thread(target=websocket_server)
    websocket_thread.start()

    return tmp_app


app = generate_app()
CORS(app)

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=False, port=5000, use_reloader=False)

# a - away score
# h - home score
# e - events
#     t - time
#     e - team side
#         a - away
#         h - home
#     y - event
#         T - turn
#         S - score
#         O - offence set
#         E - end of a match
#         H - halftime
#         TO - timeout
#     a - assist
#     s - scorer
# ts - time
