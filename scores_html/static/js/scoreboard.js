/* global $ */

// Performance optimization: Cache all DOM selectors on page load
var DOMCache = {};

$(document).ready(function() {
    // Cache all DOM elements once
    DOMCache.timer = $("#timer");
    DOMCache.timerMinutes = $("#timer-minutes");
    DOMCache.timerSeconds = $("#timer-seconds");
    DOMCache.windBox = $("#wind");
    DOMCache.windArrow = $("#wind-direction-arrow");
    DOMCache.windSpeed = $("#wind-speed");
    DOMCache.windTemp = $("#wind-temp");
    DOMCache.windHum = $("#wind-hum");
    DOMCache.scorer = $("#scorer");
    DOMCache.assist = $("#assist");
    DOMCache.roster = $("#roster");
    DOMCache.stats = $("#stats");
    DOMCache.taScore = $("#ta-score");
    DOMCache.thScore = $("#th-score");
    DOMCache.ta = $("#ta");
    DOMCache.th = $("#th");
    DOMCache.taScoreBox = $("#ta-score-box");
    DOMCache.thScoreBox = $("#th-score-box");
});

var websocket;
var reconnectInterval = 5000; // 5 seconds
var maxReconnectAttempts = 10;
var reconnectAttempts = 0;

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

// Backward compatibility references (deprecated - use DOMCache instead)
var timerHandle, windBoxHandle, windArrowHandle, windSpeedHandle, windTempHandle, windHumHandle;
var scorerHandle, assistHandle, rosterHandle, statsHandle;

var awayTeam = "AWA";
var homeTeam = "HOM";

// Initialize teams object - DOM elements will be cached in $(document).ready
var teams = {
    a: {
        full_name: "",
        name: awayTeam.toString().split("-")[0],
        jerseys: awayTeam
    },
    h: {
        full_name: "",
        name: homeTeam.toString().split("-")[0],
        jerseys: homeTeam
    }
};

// Cache team-related DOM elements after page load
$(document).ready(function() {
    teams.a.handle = $("#ta");
    teams.a.stats_handle = $("#stats__ta-stats");
    teams.a.stats_name_handle = $("#stats__ta-name");
    teams.a.roster_name_handle = $("#roster__ta-name");
    teams.a.roster_players_handle = $("#roster__ta-roster");
    teams.a.player_stats_handle = $("#player-stats__ta-stats");
    teams.a.player_stats_name_handle = $("#player-stats__ta-name");
    teams.a.score_handle = $("#ta-score-box");
    
    teams.h.handle = $("#th");
    teams.h.stats_handle = $("#stats__th-stats");
    teams.h.stats_name_handle = $("#stats__th-name");
    teams.h.roster_name_handle = $("#roster__th-name");
    teams.h.roster_players_handle = $("#roster__th-roster");
    teams.h.player_stats_handle = $("#player-stats__th-stats");
    teams.h.player_stats_name_handle = $("#player-stats__th-name");
    teams.h.score_handle = $("#th-score-box");
    
    // Set backward compatibility references
    timerHandle = DOMCache.timer;
    windBoxHandle = DOMCache.windBox;
    windArrowHandle = DOMCache.windArrow;
    windSpeedHandle = DOMCache.windSpeed;
    windTempHandle = DOMCache.windTemp;
    windHumHandle = DOMCache.windHum;
    scorerHandle = DOMCache.scorer;
    assistHandle = DOMCache.assist;
    rosterHandle = DOMCache.roster;
    statsHandle = DOMCache.stats;
});

function websocketConnection() {
    // Auto-detect WebSocket URL based on window location
    var wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsHost = window.location.hostname || 'localhost';
    var wsUrl = wsProtocol + '//' + wsHost + ':5005/';
    
    console.log('Connecting to WebSocket: ' + wsUrl);
    
    try {
        websocket = new WebSocket(wsUrl);
        
        websocket.onopen = function (evt) {
            onOpen(evt);
        };
        
        websocket.onclose = function (evt) {
            onClose(evt);
        };
        
        websocket.onmessage = function (evt) {
            onMessage(evt);
        };
        
        websocket.onerror = function (evt) {
            onError(evt);
        };
    } catch (e) {
        console.error('WebSocket connection failed:', e);
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        console.log('Reconnecting in ' + (reconnectInterval / 1000) + ' seconds... (Attempt ' + reconnectAttempts + '/' + maxReconnectAttempts + ')');
        setTimeout(function() {
            websocketConnection();
        }, reconnectInterval);
    } else {
        console.error('Max reconnection attempts reached. Please refresh the page.');
    }
}


function onOpen(evt) {
    console.log("Websocket connected\n");
    reconnectAttempts = 0; // Reset reconnection counter on successful connection
}

function onClose(evt) {
    console.log("Websocket disconnected\n");
    scheduleReconnect();
}

function onMessage(evt) {
    if (!JSON.parse(evt.data).hasOwnProperty("wind_update")) {
        console.log("event: " + evt.data + '\n');
    }
    parseEvent(JSON.parse(evt.data));
}

function onError(evt) {
    console.log('WebSocket error: ' + (evt.error || 'Unknown error') + '\n');
    // Don't close here - let onClose handle reconnection
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
        windUpdate(data["data"]["wind_angle"], data["data"]["wind_speed"], data["data"]["wind_temp"], data["data"]["wind_hum"]);
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
    // Save the full name in the teams object
    teams[team]["name"] = name;
    teams[team]["full_name"] = name_full;
    
    // Update UI elements
    teams[team]["handle"].text(name);
    teams[team]["roster_name_handle"].text(name_full.toUpperCase());
    teams[team]["stats_name_handle"].text(name_full.toUpperCase());
    
    // Player stats view
    if (teams[team]["player_stats_name_handle"] && teams[team]["player_stats_name_handle"].length) {
        teams[team]["player_stats_name_handle"].text(name_full.toUpperCase());
    }
}

function setTeamJerseyColor(team, color) {
    console.log(team, color);
    teams[team]["handle"].css("border-color", color);
    teams[team]["roster_name_handle"].css("border-color", color);
    teams[team]["stats_name_handle"].css("border-color", color);
    
    // Player stats view
    if (teams[team]["player_stats_name_handle"] && teams[team]["player_stats_name_handle"].length) {
        teams[team]["player_stats_name_handle"].css("border-color", color);
    }
}

function setScores(a, h) {
    // Use cached DOM elements for better performance
    if (DOMCache.taScore && DOMCache.thScore) {
        DOMCache.taScore.text(a.toString());
        DOMCache.thScore.text(h.toString());
    } else {
        // Fallback for initialization
        $("#ta-score").text(a.toString());
        $("#th-score").text(h.toString());
    }
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

function windTempUpdate(windTempTarget) {
    windTempHandle.text(windTempTarget)
    windTemp = windTempTarget
}

function windHumUpdate(windHumTarget) {
    windHumHandle.text(windHumTarget)
    windHum = windHumTarget
}
function statsUpdate(stats_data) {
    let away_stats_html_list = "<ul>"
    let home_stats_html_list = "<ul>"
    let stats_list = ["points", "o_points", "d_points", "o_time", "turnovers", "timeouts"]

    for (let stat in stats_list) {
        console.log(stat);
        away_percent = stats_data[stats_list[stat]]["ap"]
        home_percent = stats_data[stats_list[stat]]["hp"]

        function set_stat_widths(percent) {
            if (percent > 80) {
                percent = percent - 3
            } else if (percent < 5) {
                percent = 5.5
            }
            return percent
        }

        away_stats_html_list += `<li style="width:${set_stat_widths(away_percent)}%">${stats_data[stats_list[stat]]["a"]}</li>`;
        home_stats_html_list += `<li style="width:${set_stat_widths(home_percent)}%">${stats_data[stats_list[stat]]["h"]}</li>`;
    }
    away_stats_html_list += `</ul>`;
    home_stats_html_list += `</ul>`;

    teams["a"]["stats_handle"].html(away_stats_html_list)
    teams["h"]["stats_handle"].html(home_stats_html_list)
    
    // Update player stats if available
    if (stats_data.hasOwnProperty("player_stats")) {
        updatePlayerStats(stats_data["player_stats"]);
    }
}

function updatePlayerStats(player_stats) {
    // Process player stats for both teams and show top 5 players
    let away_player_stats = processTopPlayers(player_stats["a"], 5);
    let home_player_stats = processTopPlayers(player_stats["h"], 5);
    
    // Update team names in the player stats view
    if (teams["a"]["full_name"]) {
        teams["a"]["player_stats_name_handle"].text(teams["a"]["full_name"].toUpperCase());
    }
    
    if (teams["h"]["full_name"]) {
        teams["h"]["player_stats_name_handle"].text(teams["h"]["full_name"].toUpperCase());
    }
    
    // Generate HTML for player stats
    let away_player_stats_html = generatePlayerStatsHtml(away_player_stats);
    let home_player_stats_html = generatePlayerStatsHtml(home_player_stats);
    
    // Update the HTML
    teams["a"]["player_stats_handle"].html(away_player_stats_html);
    teams["h"]["player_stats_handle"].html(home_player_stats_html);
}

function processTopPlayers(team_stats, limit) {
    // Convert object to array for easier sorting
    let playersArray = Object.entries(team_stats).map(([playerNumber, stats]) => {
        return {
            number: playerNumber,
            name: stats.name,
            goals: stats.goals,
            assists: stats.assists,
            total: stats.total
        };
    });
    
    // Sort players by total points, then goals, then assists
    playersArray.sort((a, b) => {
        if (a.total !== b.total) return b.total - a.total;
        if (a.goals !== b.goals) return b.goals - a.goals;
        return b.assists - a.assists;
    });
    
    // Return the top players (limited to the specified count)
    return playersArray.slice(0, limit);
}

function generatePlayerStatsHtml(playersArray) {
    if (playersArray.length === 0) {
        return "<div class='no-data'>Brak danych</div>";
    }
    
    let html = `
    <table class="player-stats-table">
        <thead>
            <tr>
                <th>IMIĘ I NAZWISKO</th>
                <th>PUNKTY</th>
                <th>ASYSTY</th>
            </tr>
        </thead>
        <tbody>
    `;
    
    playersArray.forEach(player => {
        html += `
            <tr>
                <td class="player-name">
                    <span class="player-number">#${player.number}</span>
                    ${player.name}
                </td>
                <td>${player.goals}</td>
                <td>${player.assists}</td>
            </tr>
        `;
    });
    
    html += `
        </tbody>
    </table>
    `;
    
    return html;
}

function setPlayers(players_data) {
    players = players_data;
    
    // Create away team roster table - with two columns of players
    let away_roster_html = `
    <table class="roster-table">
        <tbody>
    `;
    
    // Sort player numbers numerically
    let away_numbers = Object.keys(players["a"]).sort((a, b) => parseInt(a) - parseInt(b));
    
    // Split the players into two columns
    const halfLength = Math.ceil(away_numbers.length / 2);
    const leftColumn = away_numbers.slice(0, halfLength);
    const rightColumn = away_numbers.slice(halfLength);
    
    // Generate rows with two players per row
    for (let i = 0; i < halfLength; i++) {
        if (i % 2 === 0) {
            away_roster_html += `<tr class="roster__even-row">`;
        } else {
            away_roster_html += `<tr>`;
        }
        // Left column player
        away_roster_html += `
            <td class="player-number">#${leftColumn[i]}</td>
            <td class="player-name">${players["a"][leftColumn[i]]}</td>
        `;
        
        // Right column player (if exists)
        if (i < rightColumn.length) {
            away_roster_html += `
                <td class="player-number second-column">#${rightColumn[i]}</td>
                <td class="player-name">${players["a"][rightColumn[i]]}</td>
            `;
        } else {
            // Empty cells for alignment
            away_roster_html += `
                <td class="player-number second-column"></td>
                <td class="player-name"></td>
            `;
        }
        
        away_roster_html += `</tr>`;
    }
    
    away_roster_html += `
        </tbody>
    </table>
    `;

    // Create home team roster table - with two columns of players
    let home_roster_html = `
    <table class="roster-table">
        <tbody>
    `;
    
    // Sort player numbers numerically
    let home_numbers = Object.keys(players["h"]).sort((a, b) => parseInt(a) - parseInt(b));
    
    // Split the players into two columns
    const homeHalfLength = Math.ceil(home_numbers.length / 2);
    const homeLeftColumn = home_numbers.slice(0, homeHalfLength);
    const homeRightColumn = home_numbers.slice(homeHalfLength);
    
    // Generate rows with two players per row
    for (let i = 0; i < homeHalfLength; i++) {
        if (i % 2 === 0) {
            home_roster_html += `<tr class="roster__even-row">`;
        } else {
            home_roster_html += `<tr>`;
        }
        
        // Left column player
        home_roster_html += `
            <td class="player-number">#${homeLeftColumn[i]}</td>
            <td class="player-name">${players["h"][homeLeftColumn[i]]}</td>
        `;
        
        // Right column player (if exists)
        if (i < homeRightColumn.length) {
            home_roster_html += `
                <td class="player-number second-column">#${homeRightColumn[i]}</td>
                <td class="player-name">${players["h"][homeRightColumn[i]]}</td>
            `;
        } else {
            // Empty cells for alignment
            home_roster_html += `
                <td class="player-number second-column"></td>
                <td class="player-name"></td>
            `;
        }
        
        home_roster_html += `</tr>`;
    }
    
    home_roster_html += `
        </tbody>
    </table>
    `;

    // Update the DOM
    teams["a"]["roster_players_handle"].html(away_roster_html);
    teams["h"]["roster_players_handle"].html(home_roster_html);
}

function windUpdate(windAngle, windSpeed, windTemp, windHum) {
    windAngleUpdate(windAngle);
    windSpeedUpdate(windSpeed);
    windTempUpdate(windTemp);
    windHumUpdate(windHum);
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
    console.log("Toggle roster: ", toggle);
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
    animateScorerIn(teams[team]["handle"]);
    setTimeout(function () {
        animateScorerOut(teams[team]["handle"])
    }, 50000);
}

function score(team, assist, scorer) {
    setAssistAndScorerTexts(assist, scorer);
    animateScorerIn(team);
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
        // Use cached DOM elements
        if (DOMCache.timerMinutes && DOMCache.timerSeconds) {
            DOMCache.timerMinutes.text(minutesString);
            DOMCache.timerSeconds.text(secondsString);
        } else {
            $("#timer-minutes").text(minutesString);
            $("#timer-seconds").text(secondsString);
        }
    });
}

function setTimer(offset = 0) {
    stopTimer();
    var secondsString = addPrefixZeroToTime(offset % 60);
    var minutesString = addPrefixZeroToTime(Math.floor(offset / 60));
    // Use cached DOM elements
    if (DOMCache.timerMinutes && DOMCache.timerSeconds) {
        DOMCache.timerMinutes.text(minutesString);
        DOMCache.timerSeconds.text(secondsString);
    } else {
        $("#timer-minutes").text(minutesString);
        $("#timer-seconds").text(secondsString);
    }
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
    // Use cached DOM elements
    if (DOMCache.timerMinutes && DOMCache.timerSeconds) {
        DOMCache.timerMinutes.text("00");
        DOMCache.timerSeconds.text("00");
    } else {
        $("#timer-minutes").text("00");
        $("#timer-seconds").text("00");
    }
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


