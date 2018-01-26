/* global $ */


var time = 0;
var awayScore = 0;
var homeScore = 0;
var players = {};
var events = [];

var awayTeam = getAllUrlParams().a.toUpperCase();

var homeTeam = getAllUrlParams().h.toUpperCase();


var teams = {
    a: {
        name: awayTeam.toString().split("-")[0],
        jerseys: awayTeam,
        handle: $("#ta"),
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
        url: 'http://scores.frisbee.pl/ext/watchlive.php',
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
            players = data.p
        },
        complete: function() {
            scoresAjax();
        }
    });
}


$('.score').click(function (event) {
    event.preventDefault();
    scoresAjax();
});


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

    // Set events and check for diff
    if (events.length < data.e.length) {
        var newEventsIndex = events.length;

        for (newEventsIndex; newEventsIndex <= data.e.length - 1; newEventsIndex++) {
            var event = data.e[newEventsIndex];
            eventsSwitch(event);
        }
        events = data.e;

    }

    setScores(awayScore, homeScore);

}

function eventsSwitch(event) {
    switch (event.y) {

        // START OF THE MATCH
        case "O": {
            if (time == 0) {
                // Update the count down every 1 second
                setInterval(setTimer, 1000);
                console.log(teams[event.e]["name"] + " ZACZYNA W ATAKU");
            }
            break;
        }

        // TURNOVER
        case "T": {
            console.log(teams[event.e]["name"] + " STRATA");
            break;
        }

        // TIMEOUT
        case "TO": {
            console.log(teams[event.e]["name"] + " TIMEOUT");
            setAssistAndScorerTexts("", "TIMEOUT");
            animateScorerIn(teams[event.e]["handle"], score);
            setTimeout(function () {
                animateScorerOut(teams[event.e]["handle"])
            }, 30000);
            break;
        }

        // SCORE
        case "S": {
            if (event.a != -1) {
                var assist = players[event.e][event.a].escapeDiacritics().toUpperCase();
            } else {
                assist = "";
            }
            if (event.s != -1) {
                var scorer = players[event.e][event.s].escapeDiacritics().toUpperCase();
            } else {
                scorer = "";
            }
            console.log(teams[event.e]["name"] + " PUNKT a:" + assist + " s:" + scorer);
            score(teams[event.e]["handle"], assist, scorer);
            break;
        }

        // END OF THE MATCH
        case "E": {
            console.log("KONIEC MECZU");
        }

    }
}

function setScores(a,h) {
    $("#ta-score").text(a.toString());
    $("#th-score").text(h.toString());
}

var ajaxInterval = 2000;

function scoresAjax() {
    $.ajax({
        url: 'http://0.0.0.0:8888/api/match.json',
        //url: 'http://scores.frisbee.pl/ext/watchlive.php',
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
            //setTimeout(scoresAjax, ajaxInterval);
        }
    });

}

// score("ta", p++, "JAKUB KLIMEK", "KATARZYNA KOMOROWSKA");

function getAllUrlParams(url) {

    // get query string from url (optional) or window
    var queryString = url ? url.split('?')[1] : window.location.search.slice(1);

    // we'll store the parameters here
    var obj = {};

    // if query string exists
    if (queryString) {

        // stuff after # is not part of query string, so get rid of it
        queryString = queryString.split('#')[0];

        // split our query string into its component parts
        var arr = queryString.split('&');

        for (var i = 0; i < arr.length; i++) {
            // separate the keys and the values
            var a = arr[i].split('=');

            // in case params look like: list[]=thing1&list[]=thing2
            var paramNum = undefined;
            var paramName = a[0].replace(/\[\d*\]/, function (v) {
                paramNum = v.slice(1, -1);
                return '';
            });

            // set parameter value (use 'true' if empty)
            var paramValue = typeof(a[1]) === 'undefined' ? true : a[1];

            // (optional) keep case consistent
            paramName = paramName.toLowerCase();
            paramValue = paramValue.toLowerCase();

            // if parameter name already exists
            if (obj[paramName]) {
                // convert value to array (if still string)
                if (typeof obj[paramName] === 'string') {
                    obj[paramName] = [obj[paramName]];
                }
                // if no array index number specified...
                if (typeof paramNum === 'undefined') {
                    // put the value on the end of the array
                    obj[paramName].push(paramValue);
                }
                // if array index number specified...
                else {
                    // put the value at that index number
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
    $("#assist").html(assist.toString());
    $("#scorer").html(scorer.toString());
}

function animateScorerIn(team) {
    team.addClass("team-score");
    $("#scorer").addClass("active");
}

function animateAssistIn() {
    $("#assist").addClass("active");
}

function animateAssistOut() {
    $("#assist").removeClass("active");
}

function animateScorerOut(team) {
    $("#scorer").removeClass("active");
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

//var p = 1;
//setInterval(function () {
//    score("ta", p++, "JAKUB KLIMEK", "PIOTR WRZASZCZ");
//}, 20000);


String.prototype.escapeDiacritics = function()
{
    return this.replace(/ą/g, 'a').replace(/Ą/g, 'A')
        .replace(/ć/g, 'c').replace(/Ć/g, 'C')
        .replace(/ę/g, 'e').replace(/Ę/g, 'E')
        .replace(/ł/g, 'l').replace(/Ł/g, 'L')
        .replace(/ń/g, 'n').replace(/Ń/g, 'N')
        .replace(/ó/g, 'o').replace(/Ó/g, 'O')
        .replace(/ś/g, 's').replace(/Ś/g, 'S')
        .replace(/ż/g, 'z').replace(/Ż/g, 'Z')
        .replace(/ź/g, 'z').replace(/Ź/g, 'Z');
}


