from flask import Flask, abort
from flask import request
import requests
import json
from pprint import pprint
from flask_cors import CORS
from time import sleep
from threading import Thread
import logging

# logging.basicConfig(level=logging.DEBUG, format='[%(levelname)s] (%(threadName)-10s) %(message)s')

application = Flask(__name__)
CORS(application)


# ======== GAME DATA ========
game_number = 5439
game_events = []
players = {}
home_score = 0
away_score = 0
# ======== ========= ========


def scores_update():
    while True:
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
            parse_scores_events(result_data["e"])
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
                send_event(event)
    # else Correct event


def webapp():
    pass
    # while True:
    #     print(".")
    #     sleep(1)


def send_event(event):
    pprint(event)


def proper_event(event):
    if event["y"] == "S" and event["a"] == -1 and event["s"] == -1:
        return False
    elif event["y"] in ["T", "S", "O", "E", "TO"]:
        return True
    else:
        return False


@application.route('/set_game', methods=['POST'])
def set_game():
    if not request.data:
        abort(400)
    pprint(request.data)
    response = application.make_response(json.dumps({"status": "ok"}))
    response.headers['Content-Type'] = "application/json"
    return response


if __name__ == '__main__':
    scores_thread = Thread(target=scores_update)
    scores_thread.start()
    application.run(host='0.0.0.0', debug=True, port=5000, use_reloader=False)



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

