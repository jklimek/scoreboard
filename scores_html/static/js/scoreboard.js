/* global $ */

websocketConnection();
var timer = new Timer();
var time = 0;

var timerIntervalId = 0;
var ajaxInterval = 1000;
var scoresTimeoutId = 0;
var topPlayersStatsLimit = 6;

var awayScore = 0;
var homeScore = 0;
var players = {};
var events = [];
var gameEvents = [];
var windAngle = 0;
var windSpeed = "-";
var maxGameTime = 0;

var timerHandle = $("#timer");
var windBoxHandle = $("#wind");
var windArrowHandle = $("#wind-direction-arrow");
var windSpeedHandle = $("#wind-speed");
var windTempHandle = $("#wind-temp");
var windHumHandle = $("#wind-hum");
var scorerHandle = $("#scorer");
var assistHandle = $("#assist");
var rosterHandle = $("#roster");
var statsHandle = $("#stats");
// Number of consecutive scoring events (per team) to trigger Hot Hand indicator
var hotStreakLength = 3;

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
        player_stats_handle: $("#player-stats__ta-stats"),
        player_stats_name_handle: $("#player-stats__ta-name"),
        timeline_handle: $(".timeline-event-away"),
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
        player_stats_handle: $("#player-stats__th-stats"),
        player_stats_name_handle: $("#player-stats__th-name"),
        timeline_handle: $(".timeline-event-home"),
        score_handle: $("#th-score-box")
    }
};

function websocketConnection() {
    // websocket = new WebSocket("ws://scores.jakub.tech:5005/");
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
    if (!JSON.parse(evt.data).hasOwnProperty("wind_update")) {
        console.log("event: " + evt.data + '\n');
    }
    parseEvent(JSON.parse(evt.data));
}

function onError(evt) {
    console.log('error: ' + evt.error + '\n');
    websocket.close();
}

function parseEvent(data) {
    console.log(data);
    if (data.jersey_color) {
        setTeamJerseyColor(data.team, data.jersey_color);
    } else if (data.team_name) {
        setTeamNames(data.team, data.team_name, data.team_name_full);
    } else if (data.timer_reset) {
        resetTimer();
    } else if (data.running_timer_set) {
        startTimer(data.timer_offset);
    } else if (data.timer_set) {
        setTimer(data.timer_offset);
    } else if (data.players_set) {
        setPlayers(data.players);
    } else if (data.wind_toggle) {
        toggleWind(data.wind_toggle);
    } else if (data.roster_toggle) {
        toggleRoster(data.roster_toggle);
    } else if (data.stats_toggle) {
        toggleStats(data.stats_toggle);
    } else if (data.leaderboard_toggle) {
        toggleLeaderboard(data.leaderboard_toggle);
    } else if (data.wind_update) {
        windUpdate(data.data.wind_angle, data.data.wind_speed, data.data.wind_temp, data.data.wind_hum);
    } else if (data.stats_update) {
        statsUpdate(data.stats_data);
    } else if (data.score_reset) {
        setScores(0, 0);
        clearTimeline();
    } else if (data.score_set) {
        setScores(data.data.a_score, data.data.h_score);
    } else if (data.subtype) {
        if (data.t) {
            maxGameTime = Math.max(maxGameTime, data.t);
        }
        gameEvents.push(data);
        switch (data.subtype) {
            case "score":
                score(teams[data.side].handle, data.data.assist, data.data.scorer);
                setScores(data.data.a_score, data.data.h_score);
                discPossessionChange(data.side);
                // Highlight live scorer/assist if on hot streak
                highlightHotHandLive(data);
                break;
            case "offence":
                discPossessionChange(data.side, true);
                break;
            case "turnover":
                discPossessionChange(data.side);
                break;
            case "timeout":
                timeout(data.side);
                break;
            case "start":
                startMatch(data.timer_offset);
                clearTimeline();
                break;
            case "end":
                end();
                break;
        }
        updateTimeline();
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
    teams[team]["player_stats_name_handle"].css("border-color", color);
    
    let timeline_elements = (team === "a") ? $(".timeline-event-away") : $(".timeline-event-home");
    // Timeline event handles
    if (timeline_elements && timeline_elements.length) {
        for (let timeline_el of timeline_elements) {
            $(timeline_el).css("background-color", color);
        }
    }

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
    // Process player stats for both teams and show top Limit players
    let away_player_stats = processTopPlayers(player_stats["a"], topPlayersStatsLimit);
    let home_player_stats = processTopPlayers(player_stats["h"], topPlayersStatsLimit);
    
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


// String.prototype.escapeDiacritics = function () {
//     return this.replace(/ą/g, 'a').replace(/Ą/g, 'A')
//         .replace(/ć/g, 'c').replace(/Ć/g, 'C')
//         .replace(/ę/g, 'e').replace(/Ę/g, 'E')
//         .replace(/ł/g, 'l').replace(/Ł/g, 'L')
//         .replace(/ń/g, 'n').replace(/Ń/g, 'N')
//         .replace(/ó/g, 'o').replace(/Ó/g, 'O')
//         .replace(/ś/g, 's').replace(/Ś/g, 'S')
//         .replace(/ż/g, 'z').replace(/Ż/g, 'Z')
//         .replace(/ź/g, 'z').replace(/Ź/g, 'Z');
// };

// Live Hot Hand indicator helper functions
// Returns true if the given player number has been involved (scorer or assist) in the last hotStreakLength scores for that team
function isHotHand(team, playerNo) {
    var scores = gameEvents.filter(function(ev) {
        return ev.subtype === "score" && ev.side === team;
    });
    var lastScores = scores.slice(-hotStreakLength-1,-1);
    if (lastScores.length < hotStreakLength) {
        console.log("lastScores.length < hotStreakLength")
        return false;
    }
    return lastScores.every(function(ev) {
        return ev.data.scorer === playerNo || ev.data.assist === playerNo;
    });
}

// Highlight the live scorer/assist display if the player is on a hot streak
function highlightHotHandLive(eventData) {
    // Remove any existing flame icons
    scorerHandle.find(".flame-icon").remove();
    assistHandle.find(".flame-icon").remove();
    var team = eventData.side;
    var scorerNo = parseInt(eventData.data.scorer_no);
    var assistNo = parseInt(eventData.data.assist_no);
    console.log("scorer, assist nos, team", scorerNo, assistNo, team)
    if (scorerNo && isHotHand(team, scorerNo)) {
        console.log(team, scorerNo, "HOT HAND")
        scorerHandle.append(' <i class="fas fa-fire flame-icon"></i>');
    }
    if (assistNo && assistNo !== "-1" && assistNo !== "" && isHotHand(team, assistNo)) {
        console.log(team, assistNo, "HOT HAND")
        assistHandle.append(' <i class="fas fa-fire flame-icon"></i>');
    }
}

// Timeline functions
function clearTimeline() {
    // Clear all timeline elements
    $(".stats__timeline-container").empty();
    gameEvents = [];
    maxGameTime = 0;
}

function updateTimeline() {
    // Debug info
    console.log("Updating timeline, events:", gameEvents.length);
    
    // If no events or not showing stats, don't update
    if (gameEvents.length === 0 || !statsHandle.hasClass("active")) {
        return;
    }
    
    // Get timeline container and clear it
    const container = $(".stats__timeline-container");
    container.empty();
    
    // Get team colors from the border-top of stats name elements
    const homeColor = teams["h"]["stats_name_handle"].css("border-top-color") || "#5866E1";
    const awayColor = teams["a"]["stats_name_handle"].css("border-top-color") || "#bc4920";
    console.log("Team colors - Home:", homeColor, "Away:", awayColor);
    
    // Width of the container
    const containerWidth = container.width();
    console.log("Container width:", containerWidth);
    
    // Ensure we have valid time values
    const validTimeEvents = gameEvents.filter(event => typeof event.t === 'number' && event.t >= 0);
    console.log("Events with valid times:", validTimeEvents.length);
    
    // If no valid time events, add artificial times
    if (validTimeEvents.length === 0 && gameEvents.length > 0) {
        gameEvents.forEach((event, index) => {
            event.t = index * 100; // Space events 100 units apart
        });
        maxGameTime = (gameEvents.length - 1) * 100;
        console.log("Created artificial timestamps in updateTimeline, new max time:", maxGameTime);
    }
    
    // Set maxGameTime to latest event time
    maxGameTime = 0;
    gameEvents.forEach(event => {
        if (typeof event.t === 'number') {
            maxGameTime = Math.max(maxGameTime, event.t);
        }
    });
    
    // If still no maxGameTime, use a default
    if (maxGameTime === 0) {
        maxGameTime = 3600; // Default to 1 hour (3600 deciseconds)
    }
    
    console.log("Max game time:", maxGameTime);
    
    // Sort events by time
    const sortedEvents = [...gameEvents].sort((a, b) => {
        const timeA = typeof a.t === 'number' ? a.t : 0;
        const timeB = typeof b.t === 'number' ? b.t : 0;
        return timeA - timeB;
    });
    
    console.log("Sorted events:", sortedEvents);
    
    // Default to home team as first team
    let currentTeam = "h"; 
    let lastPosition = 0;
    
    // First event should determine initial possession
    if (sortedEvents.length > 0 && sortedEvents[0].subtype === "offence") {
        currentTeam = sortedEvents[0].side;
        console.log("Found starting offense:", currentTeam);
    }
    
    // Process each event
    sortedEvents.forEach((event, index) => {
        // Skip events without time
        if (!event.t && event.t !== 0) return;
        
        console.log("Processing event:", event);
        
        // Calculate position based on time (percentage of total time)
        // For artificial timestamps, we can simply use the index to space events evenly
        // This ensures a clean visual regardless of the actual time values
        const eventTime = typeof event.t === 'number' ? event.t : 0;
        const safeMaxTime = maxGameTime > 0 ? maxGameTime : 1;
        const position = (eventTime / safeMaxTime) * containerWidth;
        const timeout_width = 40;
        const homeTimelineEventClass = "timeline-event-home";
        const awayTimelineEventClass = "timeline-event-away";
        console.log("Event position:", position, "Time:", eventTime, "Max time:", safeMaxTime);
        
        // Handle different event types
        if (event.subtype === "turnover") {
            // Create segment for the period before turnover
            const segmentWidth = position - lastPosition;
            
            if (segmentWidth > 0) {
                const segment = $("<div>")
                    .addClass("timeline-event")
                    .addClass(currentTeam === "h" ? homeTimelineEventClass : awayTimelineEventClass)
                    .css({
                        left: lastPosition + "px",
                        width: segmentWidth + "px",
                        backgroundColor: currentTeam === "h" ? homeColor : awayColor
                    });
                
                container.append(segment);
                console.log("Added turnover segment:", currentTeam, lastPosition, segmentWidth);
            }
            
            // Switch possession after turnover
            currentTeam = currentTeam === "h" ? "a" : "h";
            lastPosition = position;
        } 
        else if (event.subtype === "score") {
            // Create segment for the period before score
            const segmentWidth = position - lastPosition;
            
            if (segmentWidth > 0) {
                const segment = $("<div>")
                    .addClass("timeline-event")
                    .addClass(currentTeam === "h" ? homeTimelineEventClass : awayTimelineEventClass)
                    .css({
                        left: lastPosition + "px",
                        width: segmentWidth + "px", 
                        backgroundColor: currentTeam === "h" ? homeColor : awayColor
                    });
                
                container.append(segment);
                console.log("Added score segment:", currentTeam, lastPosition, segmentWidth);
            }
            
            // Add point marker
            const pointMarker = $("<div>")
                .addClass("timeline-event-point")
                .css({
                    left: position + "px",
                    // backgroundColor: currentTeam === "h" ? homeColor : awayColor
                });
            
            container.append(pointMarker);
            console.log("Added point marker at:", position);
            
            // Switch possession after score
            currentTeam = currentTeam === "h" ? "a" : "h";
            lastPosition = position;
        }
        else if (event.subtype === "offence") {
            // Only create segment if this isn't the first event
            if (index > 0) {
                // Create segment for the period before offense
                const segmentWidth = position - lastPosition;
                
                if (segmentWidth > 0) {
                    const segment = $("<div>")
                        .addClass("timeline-event")
                        .addClass(currentTeam === "h" ? homeTimelineEventClass : awayTimelineEventClass)
                        .css({
                            left: lastPosition + "px",
                            width: segmentWidth + "px",
                            backgroundColor: currentTeam === "h" ? homeColor : awayColor
                        });
                    
                    container.append(segment);
                    console.log("Added offense segment:", currentTeam, lastPosition, segmentWidth);
                }
            }
            
            // Set team with offense
            currentTeam = event.side;
            lastPosition = position;
        }
        else if (event.subtype === "timeout") {
            // Add timeout marker
            const timeoutMarker = $("<div>")
                .addClass("timeline-event-timeout")
                .css({
                    left: position + timeout_width + "px"
                });
            timeoutMarker.append("<p class=\"timeline-event-timeout-sign\">TO</p>");
            container.append(timeoutMarker);
            console.log("Added timeout marker at:", position);
        }
        else if (event.subtype === "halftime") {  // Halftime event
            // Create segment before halftime
            const segmentWidth = position - lastPosition;
            
            if (segmentWidth > 0) {
                const segment = $("<div>")
                    .addClass("timeline-event")
                    .css({
                        left: lastPosition + "px",
                        width: segmentWidth + "px",
                        backgroundColor: currentTeam === "h" ? homeColor : awayColor
                    });
                
                container.append(segment);
                console.log("Added pre-halftime segment:", currentTeam, lastPosition, segmentWidth);
            }
            
            // Add halftime marker
            const halftimeMarker = $("<div>")
                .addClass("timeline-event-halftime")
                .css({
                    left: position + "px"
                });
            
            container.append(halftimeMarker);
            console.log("Added halftime marker at:", position);
            
            // After halftime, possession switches
            currentTeam = currentTeam === "h" ? "a" : "h";
            lastPosition = position;
        }
    });
    
    // Add final segment if needed
    if (lastPosition < containerWidth) {
        const segmentWidth = containerWidth - lastPosition;
        if (segmentWidth > 0) {
            const finalSegment = $("<div>")
                .addClass("timeline-event")
                .css({
                    left: lastPosition + "px",
                    width: segmentWidth + "px",
                    backgroundColor: currentTeam === "h" ? homeColor : awayColor
                });
            
            container.append(finalSegment);
            console.log("Added final segment:", currentTeam, lastPosition, segmentWidth);
        }
    }
}

// Add stats update handler to also update timeline
const originalStatsUpdate = statsUpdate;
statsUpdate = function(stats_data) {
    originalStatsUpdate(stats_data);
    
    // Check for raw events in the game_events field (sent from backend)
    if (stats_data.hasOwnProperty("game_events") && stats_data.game_events && stats_data.game_events.length > 0) {
        // Reset game events from stats
        gameEvents = [];
        maxGameTime = 0;
        
        console.log("Raw game events from backend:", stats_data.game_events.length);
        
        // Use timestamps directly from server - backend now ensures they're valid
        stats_data.game_events.forEach((event, index) => {
            const eventTime = typeof event.t === 'number' ? event.t : parseInt(event.t || 0, 10);
            
            console.log("Processing event from backend:", event, "Parsed time:", eventTime);
            
            if (event.y === "S") { // Score event
                gameEvents.push({
                    subtype: "score",
                    side: event.e,
                    t: eventTime,
                    data: {
                        assist: event.a,
                        scorer: event.s,
                        a_score: event.as, 
                        h_score: event.hs
                    }
                });
                
                // Update max time
                maxGameTime = Math.max(maxGameTime, eventTime);
            } 
            else if (event.y === "T") { // Turnover event
                gameEvents.push({
                    subtype: "turnover",
                    side: event.e,
                    t: eventTime
                });
                
                // Update max time
                maxGameTime = Math.max(maxGameTime, eventTime);
            }
            else if (event.y === "O") { // Offense event
                gameEvents.push({
                    subtype: "offence",
                    side: event.e,
                    t: eventTime
                });
                
                // Update max time
                maxGameTime = Math.max(maxGameTime, eventTime);
            }
            else if (event.y === "TO") { // Timeout event
                gameEvents.push({
                    subtype: "timeout",
                    side: event.e,
                    t: eventTime
                });
                
                // Update max time
                maxGameTime = Math.max(maxGameTime, eventTime);
            }
            else if (event.y === "H") { // Halftime event
                gameEvents.push({
                    y: "H",
                    t: eventTime
                });
                
                // Update max time
                maxGameTime = Math.max(maxGameTime, eventTime);
            }
            else if (event.y === "E") { // End event
                gameEvents.push({
                    subtype: "end",
                    t: eventTime
                });
                
                // Update max time
                maxGameTime = Math.max(maxGameTime, eventTime);
            }
        });
        
        console.log("Processed events with artificial times:", gameEvents.length, "Max time:", maxGameTime);
    }
    
    // After updating stats, update the timeline
    updateTimeline();
};


