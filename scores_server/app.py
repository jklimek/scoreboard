from flask import Flask, abort
from flask import request
import requests
import json
import unicodedata
from pprint import pprint
from flask_cors import CORS
from time import sleep
from threading import Thread
from SimpleWebSocketServer import SimpleWebSocketServer, WebSocket
import logging

# logging.basicConfig(level=logging.DEBUG, format='[%(levelname)s] (%(threadName)-10s) %(message)s')

application = Flask(__name__)
CORS(application)


# ======== GAME DATA ========
game_number = 0
game_events = []
players = {}
home_score = 0
away_score = 0
home_team_name = ""
away_team_name = ""

# ======== ========= ========


def set_game(data):
    global game_number

    if "game_number" in data:
        game_number = data["game_number"]
        get_players_list(data["game_number"])
        # pprint(players)


def handle_team_setting_message(data):
    pprint(data)
    team_side = data["team"]
    # if "team_name" in data:


def handle_game_setting_message(data):
    pprint(data)
    if "game_number" in data:
        set_game(data)


class WebSocketHandler(WebSocket):

    def handleMessage(self):
        data = json.loads(self.data)
        if data["type"] == "team":
            handle_team_setting_message(data)
        elif data["type"] == "game":
            handle_game_setting_message(data)

    def handleConnected(self):
        print(self.address, 'ws connected')

    def handleClose(self):
        print(self.address, 'ws closed')


def scores_update():
    while True:

        if any(players):

            payload = {
                "game": game_number,
                "update": "true"
            }
            headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.102 Safari/537.36'}

            try:
                r = requests.post(
                    'http://test.ultiscores.com/ext/watchlive.php',
                    data=payload,
                    headers=headers,
                    timeout=10
                )
                print("request")
                result_data = r.json()
                # pprint(result_data)
                parse_scores_events(result_data["e"])
            except requests.exceptions.ConnectionError:
                print("Connection refused")
                pass

        sleep(4)


def get_players_list(passed_game_number):
    global players
    while not any(players):
        payload = {
            "game": passed_game_number,
            "players": "true",
            "update": "true"
        }
        headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.102 Safari/537.36'}

        try:
            r = requests.post(
                'http://test.ultiscores.com/ext/watchlive.php',
                data=payload,
                headers=headers,
                timeout=10
            )
            print("request")
            result_data = r.json()
            # pprint(result_data)
            players = result_data["p"]
        except requests.exceptions.ConnectionError:
            print("Connection refused")
            pass
        sleep(4)


def parse_scores_events(events_array):
    if len(game_events) < len(events_array):
        for i in range(len(game_events), len(events_array)):
            event = events_array[i]
            if proper_event(event):
                game_events.append(event)
                send_event(prepare_event(event))
    # else Correct event


def strip_accents(s):
    s = s.replace("ł", "l")
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn')


def prepare_event(event):
    prepared_event = {"type": "", "side": event["e"], "data": {}}

    # OFFENCE START
    if event["y"] == "O":
        prepared_event["type"] = "start"

    # TURNOVER
    elif event["y"] == "T":
        prepared_event["type"] = "turnover"

    # TIMEOUT
    elif event["y"] == "TO":
        prepared_event["type"] = "timeout"

    # SCORE
    elif event["y"] == "S":
        prepared_event["type"] = "score"
        prepared_event["data"]["assist"] = ""
        prepared_event["data"]["assist_no"] = str(event["a"])
        prepared_event["data"]["scorer"] = ""
        prepared_event["data"]["scorer_no"] = str(event["s"])
        
        if prepared_event["data"]["assist_no"] != -1:
            assist_str = players[prepared_event["side"]][prepared_event["data"]["assist_no"]]
            prepared_event["data"]["assist"] = strip_accents(assist_str)
        if prepared_event["data"]["scorer_no"] != -1:
            scorer_str = players[prepared_event["side"]][prepared_event["data"]["scorer_no"]]
            prepared_event["data"]["scorer"] = strip_accents(scorer_str)

    # END OF THE MATCH
    elif event["y"] == "E":
        prepared_event["type"] = "end"
        prepared_event["data"]["time"] = event["t"]

    return prepared_event


def websocket_thread():
    server = SimpleWebSocketServer('', 5001, WebSocketHandler)
    server.serveforever()


def send_event(event):
    pprint(event)


def proper_event(event):
    if event["y"] == "S" and event["a"] == -1 and event["s"] == -1:
        return False
    elif event["y"] in ["T", "S", "O", "E", "TO"]:
        return True
    else:
        return False





if __name__ == '__main__':
    scores_thread = Thread(target=scores_update)
    scores_thread.start()
    websocket_thread = Thread(target=websocket_thread)
    websocket_thread.start()
    # application.run(host='0.0.0.0', debug=True, port=5000, use_reloader=False)



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
#         O - offence start
#         E - end of a match
#         TO - timeout
#     a - assist
#     s - scorer
# ts - time

