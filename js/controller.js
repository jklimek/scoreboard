function init() {
    document.myform.url.value = "ws://localhost:5001/";
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
}

function onError(evt) {
    writeToScreen('error: ' + evt.error + '\n');
    websocket.close();
    document.myform.connectButton.disabled = false;
    document.myform.disconnectButton.disabled = true;
}

function doSend(message) {
    if (typeof websocket !== 'undefined') {
        writeToScreen("sent: " + message.toString() + '\n');
        websocket.send(message);
    } else {
        writeToScreen("Connect to Websocket server first" + '\n');
    }
}

function writeToScreen(message) {
    document.myform.wslog.value += message;
    document.myform.wslog.scrollTop = document.myform.wslog.scrollHeight;
}

window.addEventListener("load", init, false);

function clearText() {
    document.myform.wslog.value = "";
}

function doDisconnect() {
    websocket.close();
}

function setGame() {
    var gameNumber = $("#gameNumber").val();
    var message = JSON.stringify({
        "type": "game",
        "game_number": gameNumber
    });

    doSend(message);
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