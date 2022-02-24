from flask import Flask, render_template
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


# @app.route('/board')
# def board():
#     return render_template('board.html')


@app.route('/controller')
def controller():
    return render_template('controller.html')


@app.route('/scoreboard')
def scoreboard():
    return render_template('scoreboard.html')


if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=8000, use_reloader=True)
