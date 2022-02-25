from flask import Flask, render_template, request
from flask_cors import CORS
import requests

from pprint import pprint

app = Flask(__name__)
CORS(app)


# @app.route('/board')
# def board():
#     return render_template('board.html')



@app.route('/matches')
def matches():
    date = request.args.get('date')
    payload = {
        "schedule": True,
        "date": date,
    }
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.102 Safari/537.36'}

    try:
        r = requests.post(
            "https://scores.frisbee.pl/ext/watchlive.php/",
            data=payload,
            headers=headers,
            timeout=10
        )
        result_data = r.json()
        print("Matches request: ")
        pprint(result_data)
    except requests.exceptions:
        print("Connection refused")
        pass



@app.route('/controller')
def controller():
    return render_template('controller.html')


@app.route('/scoreboard')
def scoreboard():
    return render_template('scoreboard.html')


if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=8000, use_reloader=True)
