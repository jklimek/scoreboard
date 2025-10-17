/* global $ */

// Field Scoreboard JavaScript - Simplified version for field display
// Reuses WebSocket and timer logic from main scoreboard

// Global time limit for countdown (15 minutes = 900 seconds)
var TIME_LIMIT = 900;

var timer = new Timer();
var time = 0;
var updateInterval = null; // For smooth hundredths updates

var awayScore = 0;
var homeScore = 0;

// DOM element handles for field scoreboard
var homeScoreHandle = $("#home-score");
var awayScoreHandle = $("#away-score");
var timerMinutesHandle = $("#timer-minutes");
var timerSecondsHandle = $("#timer-seconds");
var timerHundredthsHandle = $("#timer-hundredths");
var homeTeamNameHandle = $("#home-team-name");
var awayTeamNameHandle = $("#away-team-name");

// Initialize WebSocket connection
websocketConnection();

function websocketConnection() {
    // Use the same WebSocket URL as the main scoreboard
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
    console.log("Field scoreboard: WebSocket connected");
}

function onClose(evt) {
    console.log("Field scoreboard: WebSocket disconnected");
    // Attempt to reconnect after 3 seconds
    setTimeout(websocketConnection, 3000);
}

function onMessage(evt) {
    if (!JSON.parse(evt.data).hasOwnProperty("wind_update")) {
        console.log("Field scoreboard event: " + evt.data);
    }
    parseEvent(JSON.parse(evt.data));
}

function onError(evt) {
    console.log('Field scoreboard error: ' + evt.error);
    websocket.close();
}

function parseEvent(data) {
    console.log("Field scoreboard parsing event:", data);

    // Handle score updates
    if (data.hasOwnProperty("score_reset")) {
        setScores(0, 0);
    } else if (data.hasOwnProperty("score_set")) {
        setScores(data["data"]["a_score"], data["data"]["h_score"]);
    } else if (data.hasOwnProperty("subtype")) {
        if (data["subtype"] === "score") {
            setScores(data["data"]["a_score"], data["data"]["h_score"]);
        }
    }

    if (data.hasOwnProperty("team_name")) {
        setTeamName(data["team"], data["team_name"], data["team_name_full"]);
    }

    // Handle timer events
    if (data.hasOwnProperty("timer_reset")) {
        resetTimer();
    } else if (data.hasOwnProperty("running_timer_set")) {
        startTimer(data["timer_offset"]);
    } else if (data.hasOwnProperty("timer_set")) {
        setTimer(data["timer_offset"]);
    } else if (data.hasOwnProperty("subtype")) {
        if (data["subtype"] === "start") {
            startTimer(data["timer_offset"]);
        } else if (data["subtype"] === "end") {
            stopTimer();
        }
    }
}

function setScores(a, h) {
    awayScore = a;
    homeScore = h;
    awayScoreHandle.text(a.toString());
    homeScoreHandle.text(h.toString());
}

function setTeamName(team, name, fullName) {
    var displayName = fullName && fullName.length ? fullName : name;
    if (!displayName || !displayName.length) {
        return;
    }

    if (team === "h") {
        homeTeamNameHandle.text(displayName.toUpperCase());
    } else if (team === "a") {
        awayTeamNameHandle.text(displayName.toUpperCase());
    }
}

function startTimer(offset = 0) {
    stopTimer();
    // For countdown, we'll use a custom implementation
    // Store the start time for calculating remaining time
    timer.startTime = Date.now();
    timer.initialOffset = offset;
    timer.isCountdown = true;

    // Start the timer counting up from 0
    timer.start({startValues: {seconds: 0}});

    // Start fast updates for smooth hundredths display (1fps = 10ms interval)
    updateInterval = setInterval(updateCountdownDisplay, 10);

    // timer.addEventListener('secondsUpdated', function (e) {
    //     // Still listen for seconds updates for debugging
    //     console.log("Seconds updated:", timer.getTimeValues().seconds);
    // });
    timer.addEventListener('targetAchieved', function (e) {
        console.log("Timer reached zero (countdown complete)");
        stopTimer(); // Stop the fast updates when timer reaches zero
    });
}

function setTimer(offset = 0) {
    // For setTimer, we don't start the timer, just display the remaining time directly
    var remainingTime = Math.max(0, TIME_LIMIT - offset);
    var totalSeconds = Math.floor(remainingTime);
    var hundredths = Math.floor((remainingTime - totalSeconds) * 100);

    var secondsString = addPrefixZeroToTime(totalSeconds % 60);
    var minutesString = addPrefixZeroToTime(Math.floor(totalSeconds / 60));
    var hundredthsString = addPrefixZeroToTime(hundredths, 2);

    timerMinutesHandle.text(minutesString);
    timerSecondsHandle.text(secondsString);
    timerHundredthsHandle.text(hundredthsString);
}

function updateTimerDisplay() {
    var timeValues = timer.getTimeValues();
    var minutesString = addPrefixZeroToTime(timeValues.minutes);
    var secondsString = addPrefixZeroToTime(timeValues.seconds);
    var hundredthsString = addPrefixZeroToTime(timeValues.secondTenths * 10, 2);

    timerMinutesHandle.text(minutesString);
    timerSecondsHandle.text(secondsString);
    timerHundredthsHandle.text(hundredthsString);
}

function updateCountdownDisplay() {
    if (!timer.isCountdown || !timer.startTime) {
        return; // Not in countdown mode or not started
    }

    // Calculate elapsed time since timer started
    var elapsedMs = Date.now() - timer.startTime;
    var elapsedSeconds = elapsedMs / 1000;

    // Calculate remaining time: TIME_LIMIT - initial_offset - elapsed
    var remainingTime = Math.max(0, TIME_LIMIT - timer.initialOffset - elapsedSeconds);

    // If time is up, stop the updates
    if (remainingTime <= 0) {
        timerMinutesHandle.text("00");
        timerSecondsHandle.text("00");
        timerHundredthsHandle.text("00");
        stopTimer();
        return;
    }

    // Convert to minutes, seconds, hundredths
    var minutes = Math.floor(remainingTime / 60);
    var seconds = Math.floor(remainingTime % 60);
    var hundredths = Math.floor((remainingTime - Math.floor(remainingTime)) * 100);

    var minutesString = addPrefixZeroToTime(minutes);
    var secondsString = addPrefixZeroToTime(seconds);
    var hundredthsString = addPrefixZeroToTime(hundredths, 2);

    timerMinutesHandle.text(minutesString);
    timerSecondsHandle.text(secondsString);
    timerHundredthsHandle.text(hundredthsString);
}

function addPrefixZeroToTime(time, digits = 2) {
    var timeString = time.toString();
    while (timeString.length < digits) {
        timeString = "0" + timeString;
    }
    return timeString;
}

function stopTimer() {
    timer.stop();
    // Clear the fast update interval
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    // Clear countdown-specific properties
    if (timer.isCountdown) {
        timer.isCountdown = false;
        timer.startTime = null;
        timer.initialOffset = null;
    }
}

function resetTimer() {
    timer.stop();
    // Clear the fast update interval
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    // Clear countdown-specific properties
    timer.isCountdown = false;
    timer.startTime = null;
    timer.initialOffset = null;

    // Show full time limit initially (15:00.00 for countdown)
    var minutesString = addPrefixZeroToTime(Math.floor(TIME_LIMIT / 60));
    var secondsString = addPrefixZeroToTime(TIME_LIMIT % 60);
    timerMinutesHandle.text(minutesString);
    timerSecondsHandle.text(secondsString);
    timerHundredthsHandle.text("00");
}

// Handle page visibility changes to pause/resume timer if needed
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        console.log("Field scoreboard page hidden");
    } else {
        console.log("Field scoreboard page visible");
    }
});

// Initialize with zeros and show 15-minute countdown
setScores(0, 0);
resetTimer();
