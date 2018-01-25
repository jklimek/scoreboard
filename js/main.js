/* global $ */



var awayScore = 0;
var homeScore = 0;
var players = {};
var events = [];

var awayTeam = getAllUrlParams().a.toUpperCase();
var ta = $("#ta");

var homeTeam = getAllUrlParams().h.toUpperCase();
var th = $("#th");

var game = getAllUrlParams().game;
setTeams();
getPlayers();

function setTeams() {
    th.text(homeTeam.toString().split("-")[0]);
    th.addClass(homeTeam);
    ta.text(awayTeam.toString().split("-")[0]);
    ta.addClass(awayTeam);
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
    if (events.length != 0 && events.length != data.e.length) {
        var newEventsIndex = events.length - 1;
        var newEventsCount = data.e.length - events.length;
        console.log(newEventsCount, newEventsIndex);
    } else {
        events = data.e;
        for (var i = 0, len = events.length; i < len; i++) {
            //switch()
            console.log(events[i]);

            switch(events[i].y) {
                case "O": {

                }
            }
        }
    }

    setScores(awayScore, homeScore);
    score(ta, "JAKUB KLIMEK", "PIOTR WRZASZCZ");
}

function setScores(a,h) {
    $("#ta-score").text(a.toString());
    $("#th-score").text(h.toString());
}

var ajaxInterval = 2000;

function scoresAjax() {
    $.ajax({
        //url: 'http://0.0.0.0:8888/api/match.php',
        url: 'http://scores.frisbee.pl/ext/watchlive.php',
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
            console.log(data);
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
}

// Set the date we're counting down to
var time = 0;

// Update the count down every 1 second
setInterval(function () {

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

}, 1000);

//var p = 1;
//setInterval(function () {
//    score("ta", p++, "JAKUB KLIMEK", "PIOTR WRZASZCZ");
//}, 20000);





