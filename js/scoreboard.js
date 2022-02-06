/* global $ */

websocketConnection();
var timer = new Timer();
var time = 0;

var timerIntervalId = 0;
var ajaxInterval = 1000;
var scoresTimeoutId = 0;

var awayScore = 0;
var homeScore = 0;
var players = {};
var events = [];

var timerHandle = $("#timer");
var scorerHandle = $("#scorer");
var assistHandle = $("#assist");

var awayTeam = "AWA";
var homeTeam = "HOM";

var teams = {
    a: {
        name: awayTeam.toString().split("-")[0],
        jerseys: awayTeam,
        handle: $("#ta")
    },
    h: {
        name: homeTeam.toString().split("-")[0],
        jerseys: homeTeam,
        handle: $("#th")
    }
};

function websocketConnection() {
    websocket = new WebSocket("ws://localhost:5005/");
    websocket.onopen = function (evt) {
        onOpen(evt)
    };
    websocket.onclose = function (evt) {
        onClose(evt)
    };
    websocket.onmessage = function (evt) {
        onMessage(evt)
    };
    websocket.onerror = function (evt) {
        onError(evt)
    };
}


function onOpen(evt) {
    console.log("Websocket connected\n");
}

function onClose(evt) {
    console.log("Websocket disconnected\n");
}

function onMessage(evt) {
    console.log("event: " + evt.data + '\n');
    parseEvent(JSON.parse(evt.data));
}

function onError(evt) {
    console.log('error: ' + evt.error + '\n');
    websocket.close();
}

function parseEvent(data) {
    console.log(data);
    if (data.hasOwnProperty("jersey_color")) {
        setTeamJerseyColor(data["team"], data["jersey_color"])
    } else if (data.hasOwnProperty("team_name")) {
        setTeamName(data["team"], data["team_name"])
    } else if (data.hasOwnProperty("timer_reset")) {
        resetTimer();
    } else if (data.hasOwnProperty("running_timer_set")) {
        startTimer(data["timer_offset"]);
    } else if (data.hasOwnProperty("timer_set")) {
        setTimer(data["timer_offset"]);
    } else if (data.hasOwnProperty("score_reset")) {
        setScores(0, 0);
    } else if (data.hasOwnProperty("score_set")) {
        setScores(data["data"]["a_score"], data["data"]["h_score"]);
    } else if (data.hasOwnProperty("subtype")) {
        if (data["subtype"] === "score") {
            score(teams[data["side"]]["handle"], data["data"]["assist"], data["data"]["scorer"]);
            setScores(data["data"]["a_score"], data["data"]["h_score"]);
        } else if (data["subtype"] === "offence") {
            startOffence();
        } else if (data["subtype"] === "timeout") {
            timeout(data["side"]);
        } else if (data["subtype"] === "start") {
            startMatch(data["timer_offset"]);
        } else if (data["subtype"] === "end") {
            end();
        }
    }
}

function setTeamName(team, name) {
    teams[team]["handle"].text(name);
}

function setTeamJerseyColor(team, color) {
    console.log(team, color);
    teams[team]["handle"].css("border-color", color);
}

function setScores(a, h) {
    $("#ta-score").text(a.toString());
    $("#th-score").text(h.toString());
}

function startOffence() {

}

function startMatch(offset) {
    startTimer(offset);
    setAssistAndScorerTexts("", "START");
    $("#scorer").addClass("active");
    timerHandle.addClass("team-score-animation");
    setTimeout(function () {
        timerHandle.removeClass("team-score-animation");
    }, 8000);
    setTimeout(function () {
        $("#scorer").removeClass("active");
    }, 4000);
}

function end() {
    stopTimer();
    setAssistAndScorerTexts("", "KONIEC MECZU");
    timerHandle.addClass("team-score-animation");
    setTimeout(function () {
        timerHandle.removeClass("team-score-animation");
    }, 8000);
    scorerHandle.addClass("active");
    setTimeout(function () {
        scorerHandle.removeClass("active");
    }, 10000);
}


function timeout(team) {
    setAssistAndScorerTexts("", "TIMEOUT");
    animateScorerIn(teams[team]["handle"], score);
    setTimeout(function () {
        animateScorerOut(teams[team]["handle"])
    }, 50000);
}

function score(team, assist, scorer) {
    setAssistAndScorerTexts(assist, scorer);
    animateScorerIn(team, score);
    setTimeout(animateAssistIn, 1000);
    setTimeout(animateAssistOut, 8000);
    setTimeout(function () {
        animateScorerOut(team)
    }, 9000);
}

function setAssistAndScorerTexts(assist, scorer) {
    assistHandle.html(assist.toString().toUpperCase());
    scorerHandle.html(scorer.toString().toUpperCase());
}

function animateScorerIn(team) {
    team.addClass("team-score");
    scorerHandle.addClass("active");
}

function animateAssistIn() {
    assistHandle.addClass("active");
}

function animateAssistOut() {
    assistHandle.removeClass("active");
}

function animateScorerOut(team) {
    scorerHandle.removeClass("active");
    team.addClass("team-score-animation");
    team.removeClass("team-score");
    setTimeout(function () {
        team.removeClass("team-score-animation");
    }, 8000);
}


function startTimer(offset = 0) {
    stopTimer();
    timer.start({startValues: {seconds: offset}});
    timer.addEventListener('secondsUpdated', function (e) {
        var timeString = timer.getTimeValues().toString();
        var secondsString = addPrefixZeroToTime(timer.getTimeValues().seconds);
        var minutesString = addPrefixZeroToTime(timer.getTotalTimeValues().minutes);
        $("#timer-minutes").text(minutesString);
        $("#timer-seconds").text(secondsString);
    });
}

// lazy shit, should've divide and set just strings
function setTimer(offset = 0) {
    stopTimer();
    var secondsString = addPrefixZeroToTime(offset % 60);
    var minutesString = addPrefixZeroToTime(Math.floor(offset / 60));
    $("#timer-minutes").text(minutesString);
    $("#timer-seconds").text(secondsString);
}

function addPrefixZeroToTime(time) {
    if (time < 10) {
        return "0" + time.toString();
    }
    return time.toString();
}

function stopTimer() {
    timer.stop();
}

function resetTimer() {
    timer.stop();
    $("#timer-minutes").text("00");
    $("#timer-seconds").text("00");
}


String.prototype.escapeDiacritics = function () {
    return this.replace(/ą/g, 'a').replace(/Ą/g, 'A')
        .replace(/ć/g, 'c').replace(/Ć/g, 'C')
        .replace(/ę/g, 'e').replace(/Ę/g, 'E')
        .replace(/ł/g, 'l').replace(/Ł/g, 'L')
        .replace(/ń/g, 'n').replace(/Ń/g, 'N')
        .replace(/ó/g, 'o').replace(/Ó/g, 'O')
        .replace(/ś/g, 's').replace(/Ś/g, 'S')
        .replace(/ż/g, 'z').replace(/Ż/g, 'Z')
        .replace(/ź/g, 'z').replace(/Ź/g, 'Z');
};


