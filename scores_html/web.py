import os
import requests
import datetime
from flask import Flask, render_template
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

scores_url = os.getenv("SCORES_URL", "https://scores.frisbee.pl/ext/watchlive.php/")


@app.route('/controller')
def controller():
    return render_template('controller.html')


@app.route('/matches/<field>')
def matches_field(field):
    matches_list_raw = get_matches_list_for_date()
    matches_list = render_matches(matches_list_raw)
    filtered_matches_list = filter_matches(matches_list, field)
    return render_template('matches.html', matches_list=filtered_matches_list)


@app.route('/matches_date/<date>')
def matches_date(date):
    def validate(date_text):
        try:
            return datetime.date.fromisoformat(date_text)
        except ValueError:
            raise ValueError("Incorrect data format, should be YYYY-MM-DD")

    matches_list_raw = get_matches_list_for_date(validate(date))
    matches_list = render_matches(matches_list_raw)
    matches_list_1 = filter_matches(matches_list, "1")
    matches_list_2 = filter_matches(matches_list, "2")
    matches_list_3 = filter_matches(matches_list, "3")
    return render_template('matches_all.html', matches_list_1=matches_list_1, matches_list_2=matches_list_2,
                           matches_list_3=matches_list_3)


@app.route('/matches')
def matches():
    matches_list_raw = get_matches_list_for_date()
    matches_list = render_matches(matches_list_raw)
    matches_list_1 = filter_matches(matches_list, "1")
    matches_list_2 = filter_matches(matches_list, "2")
    matches_list_3 = filter_matches(matches_list, "3")
    return render_template('matches_all.html', matches_list_1=matches_list_1, matches_list_2=matches_list_2,
                           matches_list_3=matches_list_3)


@app.route('/scoreboard')
def scoreboard():
    return render_template('scoreboard.html')


@app.route('/stats')
def stats():
    return render_template('stats.html')



@app.route('/wind')
def wind():
    return render_template('wind.html')


@app.route('/roster')
def roster():
    return render_template('roster.html')


@app.route('/pstats')
def pstats():
    return render_template('pstats.html')


def filter_matches(matches_list, field):
    return [m for m in matches_list if m['field'] == field]


def render_matches(matches_list):
    updated_list = []
    for match in matches_list:
        status = ""
        if match["e"]:
            status = "past"
        else:
            now_datetime = datetime.datetime.now()
            match_datetime = datetime.datetime.strptime(match["d"] + " " + match["t"], '%d.%m.%Y %H:%M')
            delta = abs(match_datetime - now_datetime)

            if match_datetime >= now_datetime and delta < datetime.timedelta(minutes=10):
                status = "active"
            if match_datetime < now_datetime and delta <= datetime.timedelta(minutes=30):
                status = "active"
            if match_datetime < now_datetime and delta > datetime.timedelta(minutes=30):
                status = "past"
            if match_datetime > now_datetime and datetime.timedelta(
                    minutes=30) >= delta >= datetime.timedelta(minutes=10):
                status = "next"

        if not match["h"]:
            home_points, away_points = "-", "-"
        else:
            home_points, away_points = match["h"], match["a"]

        updated_list.append({
            "game_id": match["i"],
            "home_name": match["hn"],
            "away_name": match["an"],
            "field": match["f"],
            "date": match["d"],
            "time": match["t"],
            "home_points": home_points,
            "away_points": away_points,
            "status": status,
        })
    return updated_list


def get_matches_list_for_date(date=datetime.date.today()):
    payload = {
        "schedule": 1,
        "date": date
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.102 Safari/537.36"
    }
    try:
        r = requests.post(
            scores_url,
            data=payload,
            headers=headers,
            timeout=20
        )
        result_data = r.json()
        return result_data
    except requests.exceptions.RequestException as e:
        print("Matches list connection error: ", e)
        pass


if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=8000, use_reloader=True)
