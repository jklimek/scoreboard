function init() {
    document.myform.url.value = "ws://scores.jakub.tech:5005/";
    // document.myform.url.value = "ws://localhost:5005/";
    document.myform.disconnectButton.disabled = true;
}

function doConnect() {
    websocket = new WebSocket(document.myform.url.value);
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
    writeToScreen("Websocket connected\n");
    document.myform.connectButton.disabled = true;
    document.myform.disconnectButton.disabled = false;
}

function onClose(evt) {
    writeToScreen("Websocket disconnected\n");
    document.myform.connectButton.disabled = false;
    document.myform.disconnectButton.disabled = true;
}

function onMessage(evt) {
    writeToScreen("event: " + evt.data + '\n');
    var eventData = {};
    eventData = JSON.parse(evt.data);
    if (eventData["type"] === "team") {
        if (eventData["team"] === "h") {
            $("#teamHomeName").html(eventData["team_name_full"] + "(" + eventData["team_name"] + ")")
        }
        if (eventData["team"] === "a") {
            $("#teamAwayName").html(eventData["team_name_full"] + "(" + eventData["team_name"] + ")")
        }
    }

}

function onError(evt) {
    writeToScreen('error: ' + evt.error + '\n');
    websocket.close();
    document.myform.connectButton.disabled = false;
    document.myform.disconnectButton.disabled = true;
}

function doSend(message) {
    if (typeof websocket !== 'undefined') {
        websocket.send(message);
        writeToScreen("sent: " + message.toString() + '\n');
    } else {
        writeToScreen("Connect to Websocket server first" + '\n');
    }
}

function writeToScreen(message) {
    document.myform.wslog.value += message;
    document.myform.wslog.scrollTop = document.myform.wslog.scrollHeight;
}

window.addEventListener("load", init, false);

$(document).keypress(
    function (event) {
        if (event.which == '13') {
            event.preventDefault();
        }
    });


function clearText() {
    document.myform.wslog.value = "";
}

function doDisconnect() {
    websocket.close();
}

function setGame() {
    var gameNumber = $("#gameNumber").val();
    if (gameNumber) {
        var message = JSON.stringify({
            "type": "game",
            "game_number": gameNumber
        });

        doSend(message);
    } else {
        writeToScreen("Provide proper game number\n");
    }

}

function jerseysColor(color, team) {
    var message = JSON.stringify({
        "type": "team",
        "team": team,
        "jersey_color": "#" + color.toString()
    });
    doSend(message);

}

function setTeamName(team) {
    var teamName = $("#teamNameSelect" + team).val();
    var message = JSON.stringify({
        "type": "team",
        "team": team,
        "team_name": teamName
    });
    doSend(message);
}

function setOffenceTeam() {
    var team = $("#teamOffenceSelect").val();
    var message = JSON.stringify({
        "type": "game",
        "offence_team": team
    });
    doSend(message);
}

function resetTimer() {
    if (confirm("Are you sure? You are resetting stream timer!")) {
        var message = JSON.stringify({
            "type": "game",
            "timer_reset": 1
        });
        doSend(message);
    }
}

function toggleWind(toggle) {
    var message = JSON.stringify({
        "type": "wind",
        "wind_toggle": toggle
    });
    doSend(message);
}

function toggleRoster(toggle) {
    var message = JSON.stringify({
        "type": "stats",
        "roster_toggle": toggle
    });
    doSend(message);
}

function toggleLeaderboard(toggle) {
    var message = JSON.stringify({
        "type": "stats",
        "leaderboard_toggle": toggle
    });
    doSend(message);
}

function toggleStats(toggle) {
    var message = JSON.stringify({
        "type": "stats",
        "stats_toggle": toggle
    });
    doSend(message);
}
