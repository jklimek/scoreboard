/* global $ */


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

var awayTeam = getAllUrlParams().a.toUpperCase();
var homeTeam = getAllUrlParams().h.toUpperCase();

if (getAllUrlParams().time) {
    time = getAllUrlParams().time;
}

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

var game = getAllUrlParams().game;
setTeams();
getPlayers();

function setTeams() {
    teams.h.handle.text(teams.h.name);
    teams.h.handle.addClass(teams.h.jerseys);
    teams.a.handle.text(teams.a.name);
    teams.a.handle.addClass(teams.a.jerseys);
}

function getPlayers() {
    $.ajax({
        url: 'http://test.ultiscores.com/ext/watchlive.php',
        data: {
            game: game,
            update: "true",
            players: "true"
        },
        dataType: 'json',
        type: 'POST',
        error: function (request, status, error) {
            console.log(request);
            console.log(status);
            console.log(error);
        },
        success: function (data) {
            console.log(data);
            players = data.p;
        },
        complete: function () {
            scoresAjax();
        }
    });
}


/*
a - away score
h - home score
e - events
    t - time
    e - team side
        a - away
        h - home
    y - event
        T - turn
        S - score
        O - offence start
        E - end of a match
        TO - timeout
    a - assist
    s - scorer
ts - time

 */

function parseScoresLiveData(data) {
    awayScore = data.a;
    homeScore = data.h;
    console.log(data);


    // Set events and check for diff
    if (events.length < data.e.length) {
        var newEventsIndex = events.length;
        for (newEventsIndex; newEventsIndex <= data.e.length - 1; newEventsIndex++) {
            var event = data.e[newEventsIndex];
            if (eventsSwitch(event)) {
                events.push(event);
            }
        }
    }

    setScores(awayScore, homeScore);

}

function eventsSwitch(event) {
    console.log(event);
    switch (event.y) {

        // START OF THE MATCH
        case "O":
        {
            //if (time == 0) {
            // Update the count down every 1 second
            timerIntervalId = setInterval(setTimer, 1000);
            console.log(teams[event.e]["name"] + " ZACZYNA W ATAKU");

            setAssistAndScorerTexts("", "START");
            $("#scorer").addClass("active");
            timerHandle.addClass("team-score-animation");
            setTimeout(function () {
                timerHandle.removeClass("team-score-animation");
            }, 8000);
            setTimeout(function () {
                $("#scorer").removeClass("active");
            }, 4000);
            //}
            return true;
        }

        // TURNOVER
        case "T":
        {
            console.log(teams[event.e]["name"] + " STRATA");
            return true;
        }

        // TIMEOUT
        case "TO":
        {
            console.log(teams[event.e]["name"] + " TIMEOUT");
            setAssistAndScorerTexts("", "TIMEOUT");
            animateScorerIn(teams[event.e]["handle"], score);
            setTimeout(function () {
                animateScorerOut(teams[event.e]["handle"])
            }, 30000);
            return true;
        }

        // SCORE
        case "S":
        {
            if (event.a != -1) {
                //var assist = players[event.e][event.a].escapeDiacritics().toUpperCase();
                var assist = "ASYSTENT";
            } else {
                assist = "";
            }

            if (event.s != -1) {
                //var scorer = players[event.e][event.s].escapeDiacritics().toUpperCase();
                var scorer = "PUNKTARZ";
            } else {
                scorer = "";
            }
            if (event.a == -1 && event.s == -1) {
                console.log(teams[event.e]["name"] + " PUNKT");
                return false;
            } else {
                console.log(teams[event.e]["name"] + " PUNKT a:" + assist + " s:" + scorer);
                score(teams[event.e]["handle"], assist, scorer);
                return true;
            }
        }

        // END OF THE MATCH
        case "E":
        {
            console.log("KONIEC MECZU");
            clearInterval(timerIntervalId);
            clearTimeout(scoresTimeoutId);

            time = event.t;
            setTimer();

            setAssistAndScorerTexts("", "END OF THE MATCH");
            timerHandle.addClass("team-score");
            scorerHandle.addClass("active");
            setTimeout(function () {
                scorerHandle.removeClass("active");
            }, 10000);
            return true;
        }

    }
}

function setScores(a, h) {
    $("#ta-score").text(a.toString());
    $("#th-score").text(h.toString());
}


function scoresAjax() {
    $.ajax({
        //url: 'http://0.0.0.0:8000/api/match.json',
        url: 'http://test.ultiscores.com/ext/watchlive.php',
        data: {
            game: game,
            update: "true"
        },
        dataType: 'json',
        type: 'POST',
        error: function (request, status, error) {
            console.log(request);
            console.log(status);
            console.log(error);
        },
        success: function (data) {
            parseScoresLiveData(data);
        },
        complete: function () {
            scoresTimeoutId = setTimeout(scoresAjax, ajaxInterval);
        },
        timeout: 4000 // sets timeout to 3 seconds
    });

}


function getAllUrlParams(url) {

    // get query string from url (optional) or window
    var queryString = url ? url.split('?')[1] : window.location.search.slice(1);

    var obj = {};

    if (queryString) {

        // stuff after # is not part of query string, so get rid of it
        queryString = queryString.split('#')[0];

        var arr = queryString.split('&');

        for (var i = 0; i < arr.length; i++) {
            var a = arr[i].split('=');

            // in case params look like: list[]=thing1&list[]=thing2
            var paramNum = undefined;
            var paramName = a[0].replace(/\[\d*\]/, function (v) {
                paramNum = v.slice(1, -1);
                return '';
            });

            // set parameter value (use 'true' if empty)
            var paramValue = typeof(a[1]) === 'undefined' ? true : a[1];

            paramName = paramName.toLowerCase();
            paramValue = paramValue.toLowerCase();

            // if parameter name already exists
            if (obj[paramName]) {
                if (typeof obj[paramName] === 'string') {
                    obj[paramName] = [obj[paramName]];
                }
                if (typeof paramNum === 'undefined') {
                    // put the value on the end of the array
                    obj[paramName].push(paramValue);
                }
                else {
                    obj[paramName][paramNum] = paramValue;
                }
            }
            // if param name doesn't exist yet, set it
            else {
                obj[paramName] = paramValue;
            }
        }
    }

    return obj;
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
    assistHandle.html(assist.toString());
    scorerHandle.html(scorer.toString());
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


function setTimer() {


    time++;
    var minutes = Math.floor(time / 60);
    var seconds = time - minutes * 60;

    if (minutes.toString().length < 2) {
        minutes = "0" + minutes
    }
    if (seconds.toString().length < 2) {
        seconds = "0" + seconds
    }

    $("#timer").text(minutes + ":" + seconds + "");

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


