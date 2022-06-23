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
var windAngle = 0;
var windSpeed = "-";

var timerHandle = $("#timer");
var windBoxHandle = $("#wind");
var windArrowHandle = $("#wind-direction-arrow");
var windSpeedHandle = $("#wind-speed");
var scorerHandle = $("#scorer");
var assistHandle = $("#assist");
var rosterHandle = $("#roster");
var statsHandle = $("#stats");

var awayTeam = "AWA";
var homeTeam = "HOM";

var teams = {
    a: {
        full_name: "",
        name: awayTeam.toString().split("-")[0],
        jerseys: awayTeam,
        handle: $("#ta"),
        stats_handle: $("#stats__ta-stats"),
        stats_name_handle: $("#stats__ta-name"),
        roster_name_handle: $("#roster__ta-name"),
        roster_players_handle: $("#roster__ta-roster"),
        score_handle: $("#ta-score-box")
    },
    h: {
        full_name: "",
        name: homeTeam.toString().split("-")[0],
        jerseys: homeTeam,
        handle: $("#th"),
        stats_handle: $("#stats__th-stats"),
        stats_name_handle: $("#stats__th-name"),
        roster_name_handle: $("#roster__th-name"),
        roster_players_handle: $("#roster__th-roster"),
        score_handle: $("#th-score-box")
    }
};

function websocketConnection() {
    // websocket = new WebSocket("ws://klimek.jakub.tech:5005/");
    websocket = new WebSocket("ws://172.30.37.11:5005/");
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
        setTeamNames(data["team"], data["team_name"], data["team_name_full"])
    } else if (data.hasOwnProperty("timer_reset")) {
        resetTimer();
    } else if (data.hasOwnProperty("running_timer_set")) {
        startTimer(data["timer_offset"]);
    } else if (data.hasOwnProperty("timer_set")) {
        setTimer(data["timer_offset"]);
    } else if (data.hasOwnProperty("players_set")) {
        setPlayers(data["players"]);
    } else if (data.hasOwnProperty("wind_toggle")) {
        toggleWind(data["wind_toggle"]);
    } else if (data.hasOwnProperty("roster_toggle")) {
        toggleRoster(data["roster_toggle"]);
    } else if (data.hasOwnProperty("stats_toggle")) {
        toggleStats(data["stats_toggle"]);
    } else if (data.hasOwnProperty("leaderboard_toggle")) {
        toggleLeaderboard(data["leaderboard_toggle"]);
    } else if (data.hasOwnProperty("wind_update")) {
        windUpdate(data["data"]["wind_angle"], data["data"]["wind_speed"]);
    } else if (data.hasOwnProperty("stats_update")) {
        statsUpdate(data["stats_data"]);
    } else if (data.hasOwnProperty("score_reset")) {
        setScores(0, 0);
    } else if (data.hasOwnProperty("score_set")) {
        setScores(data["data"]["a_score"], data["data"]["h_score"]);
    } else if (data.hasOwnProperty("subtype")) {
        if (data["subtype"] === "score") {
            score(teams[data["side"]]["handle"], data["data"]["assist"], data["data"]["scorer"]);
            setScores(data["data"]["a_score"], data["data"]["h_score"]);
            discPossessionChange(data["side"]);
        } else if (data["subtype"] === "offence") {
            discPossessionChange(data["side"], true);
        } else if (data["subtype"] === "turnover") {
            discPossessionChange(data["side"]);
        } else if (data["subtype"] === "timeout") {
            timeout(data["side"]);
        } else if (data["subtype"] === "start") {
            startMatch(data["timer_offset"]);
        } else if (data["subtype"] === "end") {
            end();
        }
    }
}

function setTeamNames(team, name, name_full) {
    teams[team]["handle"].text(name);
    teams[team]["roster_name_handle"].text(name_full.toUpperCase())
    teams[team]["stats_name_handle"].text(name_full.toUpperCase())
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
    scorerHandle.addClass("active");
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
    teams["a"]["score_handle"].removeClass("disc-possession");
    teams["h"]["score_handle"].removeClass("disc-possession");
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

function discPossessionChange(team, offence = false) {
    if (offence) {
        teams[team]["score_handle"].addClass("disc-possession");
    } else {
        if (team === 'a') {
            teams[team]["score_handle"].removeClass("disc-possession");
            teams["h"]["score_handle"].addClass("disc-possession");
        }
        if (team === 'h') {
            teams[team]["score_handle"].removeClass("disc-possession");
            teams["a"]["score_handle"].addClass("disc-possession");
        }
    }
}


function windAngleUpdate(windAngleTarget) {

    $({rotation: windAngle}).animate({rotation: windAngleTarget}, {
        duration: 300,
        easing: 'swing',
        step: function (now, fx) {
            windArrowHandle.css({transform: 'rotate(' + (this.rotation - 45) % 360 + 'deg)'});
        }
    });
    windAngle = windAngleTarget
}

function windSpeedUpdate(windSpeedTarget) {
    windSpeedHandle.text(windSpeedTarget)
    windSpeed = windSpeedTarget
}

function statsUpdate(stats_data) {
    let away_stats_html_list = "<ul>"
    let home_stats_html_list = "<ul>"
    let stats_list = ["points", "o_points", "d_points", "o_time", "turnovers", "timeouts"]

    for (let stat in stats_list) {
        console.log(stat);
        away_stats_html_list += `<li style="background: linear-gradient(to right, var(--box-font-color) ${stats_data[stats_list[stat]]["ap"]}%, rgb(255 255 255 / 0%) ${stats_data[stats_list[stat]]["ap"]}%);">${stats_data[stats_list[stat]]["a"]}</li>`;
        home_stats_html_list += `<li style="background: linear-gradient(to left, var(--box-font-color) ${stats_data[stats_list[stat]]["hp"]}%, rgb(255 255 255 / 0%) ${stats_data[stats_list[stat]]["hp"]}%);">${stats_data[stats_list[stat]]["h"]}</li>`;
    }
    away_stats_html_list += `</ul>`;
    home_stats_html_list += `</ul>`;

    teams["a"]["stats_handle"].html(away_stats_html_list)
    teams["h"]["stats_handle"].html(home_stats_html_list)
}

function setPlayers(players_data) {
    players = players_data;
    let away_roster_html_list = "<ul class=\"roster__th-roster-list\">"
    for (let number in players["a"]) {
        away_roster_html_list += `<li class="roster__ta-roster-item roster__roster-item">
                    <span class="roster__roster-item__number">#${number}</span>
                    ${players["a"][number]}
                </li>`;
    }
    away_roster_html_list += `</ul>`;

    let home_roster_html_list = "<ul class=\"roster__th-roster-list\">"
    for (let number in players["h"]) {
        home_roster_html_list += `<li class="roster__ta-roster-item roster__roster-item">
                    <span class="roster__roster-item__number">#${number}</span>
                    ${players["h"][number]}
                </li>`;
    }
    home_roster_html_list += `</ul>`;

    teams["a"]["roster_players_handle"].html(away_roster_html_list)
    teams["h"]["roster_players_handle"].html(home_roster_html_list)


}

function windUpdate(windAngle, windSpeed) {
    windAngleUpdate(windAngle);
    windSpeedUpdate(windSpeed);
}


function toggleWind(toggle) {
    console.log("Toggle wind: ", toggle);
    if (toggle) {
        windBoxHandle.addClass("active");
    } else {
        windBoxHandle.removeClass("active");
    }
}

function toggleRoster(toggle) {
    console.log("Toggle wind: ", toggle);
    if (toggle) {
        rosterHandle.addClass("active");
    } else {
        rosterHandle.removeClass("active");
    }
}

function toggleStats(toggle) {
    console.log("Toggle stats: ", toggle);
    if (toggle) {
        statsHandle.addClass("active");
    } else {
        statsHandle.removeClass("active");
    }
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


