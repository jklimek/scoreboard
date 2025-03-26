/* global $, websocket, teams */

// Global variable to track data loading state
let isDataLoading = false;
let lastGameId = null;
let dataCheckTimer = null;
let matchEnded = false; // Flag to track if the match has ended

// Initialize on document ready
$(document).ready(function() {
    // We now have our own websocket connection defined in the HTML
    
    // Fix syntax error in previous version
    $('.hub-score-separator').text('-');
    
    // Set up websocket message handler for our dedicated connection
    websocket.onmessage = function(evt) {
        try {
            const data = JSON.parse(evt.data);
            console.log("Commentator hub received message:", data);
            handleWebSocketData(data);
        } catch (error) {
            console.error("Error handling WebSocket message in commentator hub:", error);
        }
    };
    
    // Check if we have stored final match data from a previous session
    try {
        const storedFinalData = localStorage.getItem('commentator_final_match_data');
        if (storedFinalData) {
            const finalData = JSON.parse(storedFinalData);
            if (finalData && finalData.ended) {
                console.log("Restoring final match data from previous session");
                
                // Restore the saved match data
                $('#home-roster-container').html(finalData.homeRoster || '');
                $('#away-roster-container').html(finalData.awayRoster || '');
                $('#home-player-stats-container').html(finalData.homeStats || '');
                $('#away-player-stats-container').html(finalData.awayStats || '');
                $('#home-team-stats-container').html(finalData.homeTeamStats || '');
                $('#away-team-stats-container').html(finalData.awayTeamStats || '');
                $('#timeline-container').html(finalData.timeline || '');
                
                // Restore team names and scores if available
                if (finalData.homeTeamName) {
                    $('.hub-home-team .hub-team-name').text(finalData.homeTeamName);
                }
                if (finalData.awayTeamName) {
                    $('.hub-away-team .hub-team-name').text(finalData.awayTeamName);
                }
                if (finalData.homeScore) {
                    $('#hub-home-score').text(finalData.homeScore);
                }
                if (finalData.awayScore) {
                    $('#hub-away-score').text(finalData.awayScore);
                }
                if (finalData.gameTime) {
                    $('#hub-game-time').text(finalData.gameTime);
                }
                if (finalData.half) {
                    $('#hub-half').text(finalData.half);
                }
                
                // Restore players data if available
                if (finalData.players) {
                    players = finalData.players;
                    window.players = finalData.players;
                }
                
                // Set the match ended flag and store the data in window for later use
                matchEnded = true;
                window.finalMatchData = finalData;
                
                // Add a small notification that we're viewing stored data
                const timestamp = new Date(finalData.timestamp || 0).toLocaleString();
                $('.hub-info').html(`Match ended - Data from ${timestamp}`);
                
                return; // Skip initial data request
            }
        }
    } catch (e) {
        console.error("Error restoring final match data:", e);
    }
    
    // If no stored final data, request initial data
    setTimeout(requestInitialData, 1000);
    
    // Set up a permanent data check to ensure data persistence
    dataCheckTimer = setInterval(function() {
        // If match has ended, don't run any refresh logic
        if (matchEnded) {
            console.log("Match has ended - not refreshing data");
            return;
        }
        
        // Don't request if we're currently loading data
        if (isDataLoading) {
            console.log("Data is still loading, skipping check");
            return;
        }
        
        // Check if our critical containers are empty and we should have data
        if (lastGameId && 
            ($('#home-roster-container').is(':empty') || 
             $('#home-player-stats-container').is(':empty') ||
             $('#away-player-stats-container').is(':empty'))) {
            
            console.log("Empty containers detected with active game");
            
            // Check if we have backup data we can use
            if (window.hubBackupData && (Date.now() - window.hubBackupData.timestamp < 30000)) {
                console.log("Restoring from backup data");
                
                // Restore from backup
                if ($('#home-roster-container').is(':empty') && window.hubBackupData.homeRoster) {
                    $('#home-roster-container').html(window.hubBackupData.homeRoster);
                }
                
                if ($('#away-roster-container').is(':empty') && window.hubBackupData.awayRoster) {
                    $('#away-roster-container').html(window.hubBackupData.awayRoster);
                }
                
                if ($('#home-player-stats-container').is(':empty') && window.hubBackupData.homeStats) {
                    $('#home-player-stats-container').html(window.hubBackupData.homeStats);
                }
                
                if ($('#away-player-stats-container').is(':empty') && window.hubBackupData.awayStats) {
                    $('#away-player-stats-container').html(window.hubBackupData.awayStats);
                }
            } else {
                // If no backup or it's too old, request fresh data
                console.log("No valid backup found, requesting fresh data");
                requestInitialData();
            }
        }
    }, 3000);
});

// Request initial data from server
function requestInitialData() {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        console.log("Requesting initial data for commentator hub");
        
        // Set loading flag to prevent multiple concurrent requests
        isDataLoading = true;
        
        // Request team data
        websocket.send(JSON.stringify({
            "request_type": "team_data"
        }));
        
        // Request player data
        websocket.send(JSON.stringify({
            "request_type": "player_data"
        }));
        
        // Request stats data
        websocket.send(JSON.stringify({
            "request_type": "stats"
        }));
        
        // Also explicitly request game state for current game ID
        websocket.send(JSON.stringify({
            "type": "request_game_state"
        }));
        
        // Set a timeout to reset the loading flag in case we don't get responses
        setTimeout(function() {
            console.log("Resetting data loading flag after timeout");
            isDataLoading = false;
        }, 10000);
    } else {
        console.warn("WebSocket not open, cannot request initial data");
        isDataLoading = false;
        setTimeout(requestInitialData, 2000); // Try again in 2 seconds
    }
}

// Handle WebSocket data
function handleWebSocketData(data) {
    console.log("Commentator hub received data:", data);
    
    // Track successful data updates to prevent unnecessary re-fetching
    let receivedStats = false;
    
    // Special case for game state messages
    if (data.type === "game") {
        // Listen for game ID changes and refresh all data
        if (data.game_number) {
            console.log("New game ID detected, refreshing data:", data.game_number);
            
            // If we have final match data and we're asked to load a different match,
            // check if the user wants to clear the stored match
            if (matchEnded && window.finalMatchData) {
                const userConfirm = confirm("You are loading a new match, but you have match end data displayed. Would you like to clear the current match data?");
                
                if (userConfirm) {
                    // Clear localStorage and reset flags
                    localStorage.removeItem('commentator_final_match_data');
                    window.finalMatchData = null;
                    matchEnded = false;
                } else {
                    // User chose to keep the current data
                    console.log("User chose to keep current match data");
                    return;
                }
            }
            
            // Only proceed with loading new data if match isn't ended
            if (!matchEnded) {
                lastGameId = data.game_number;
                
                // Clear previous data
                resetAllData();
                
                // Request fresh data after slight delay to allow server processing
                setTimeout(requestInitialData, 1000);
            }
            return;
        }
        
        // Handle score updates from game messages
        if (data.score_set && data.data) {
            updateScores(data.data.a_score, data.data.h_score);
        }
    }
    
    // Handle various data types
    if (data.team_name) {
        updateTeamName(data.team, data.team_name, data.team_name_full);
    } else if (data.jersey_color) {
        updateJerseyColor(data.team, data.jersey_color);
    } else if (data.players_set) {
        updateRosters(data.players);
    } else if (data.stats_update) {
        updateStats(data.stats_data);
        receivedStats = true;
    } else if (data.timer_reset) {
        resetTimer();
    } else if (data.running_timer_set) {
        startTimer(data.timer_offset);
    } else if (data.timer_set) {
        setTimer(data.timer_offset);
    } else if (data.score_set) {
        updateScores(data.data.a_score, data.data.h_score);
    } else if (data.subtype) {
        // Game event (score, turnover, etc.)
        handleGameEvent(data);
        
        // If this was a score event, also update the scores
        if (data.subtype === 'score' && data.data) {
            updateScores(data.data.a_score, data.data.h_score);
        }
    }
    
    // If we received any data, we can consider loading complete
    if (data.team_name || data.players_set || receivedStats || 
        data.jersey_color || data.timer_set || data.score_set) {
        console.log("Received data update, marking loading as complete");
        isDataLoading = false;
    }
}

// Reset all data when changing games
function resetAllData() {
    console.log("Resetting all data in commentator hub");
    
    // Store the current content before clearing
    const prevHomeRoster = $('#home-roster-container').html();
    const prevAwayRoster = $('#away-roster-container').html();
    const prevHomeStats = $('#home-player-stats-container').html();
    const prevAwayStats = $('#away-player-stats-container').html();
    
    // Only clear data if we're receiving a new game
    // This prevents unnecessary clearing that might cause flickering
    
    // Clear rosters
    $('#home-roster-container').html('');
    $('#away-roster-container').html('');
    
    // Reset player stats
    $('#home-player-stats-container').html('');
    $('#away-player-stats-container').html('');
    
    // Reset team stats
    $('#home-team-stats-container').html('');
    $('#away-team-stats-container').html('');
    
    // Clear timeline
    $('#timeline-container').empty();
    
    // Reset scores and time
    $('#hub-home-score').text('0');
    $('#hub-away-score').text('0');
    $('#hub-game-time').text('00:00');
    $('#hub-half').text('1st Half');
    
    // Reset team names
    $('.hub-home-team .hub-team-name').text('');
    $('.hub-away-team .hub-team-name').text('');
    
    // Store the previous content to restore if needed
    window.hubBackupData = {
        homeRoster: prevHomeRoster,
        awayRoster: prevAwayRoster,
        homeStats: prevHomeStats,
        awayStats: prevAwayStats,
        timestamp: Date.now()
    };
}

// Update team names
function updateTeamName(team, name, fullName) {
    const teamSelector = team === 'h' ? '.hub-home-team .hub-team-name' : '.hub-away-team .hub-team-name';
    $(teamSelector).text(fullName || name);
    
    // Also update the teams object to ensure we have the right names for events
    if (team === 'h') {
        teams.h.name = name || teams.h.name;
        teams.h.full_name = fullName || teams.h.full_name;
    } else if (team === 'a') {
        teams.a.name = name || teams.a.name;
        teams.a.full_name = fullName || teams.a.full_name;
    }
    
    console.log("Updated team names in teams object:", teams);
}

// Update jersey colors
function updateJerseyColor(team, color) {
    const jerseySelector = team === 'h' ? '.hub-home-team .hub-team-jersey' : '.hub-away-team .hub-team-jersey';
    $(jerseySelector).css('background-color', color);
    
    // Store the jersey color in a data attribute for future events
    if (team === 'h') {
        $('body').attr('data-home-jersey-color', color);
    } else {
        $('body').attr('data-away-jersey-color', color);
    }
    
    // Apply colors to all matching timeline events
    applyJerseyColorsToTimeline();
}

// Apply jersey colors to timeline events
function applyJerseyColorsToTimeline() {
    // Get current jersey colors
    const homeJerseyColor = $('body').attr('data-home-jersey-color');
    const awayJerseyColor = $('body').attr('data-away-jersey-color');
    
    console.log("Applying jersey colors to timeline:", homeJerseyColor, awayJerseyColor);
    
    // Apply home team color if available
    if (homeJerseyColor) {
        // Apply to regular events
        // $('.timeline-event.home:not(.score)').css('border-left-color', homeJerseyColor);
        
        // Apply to score events - with !important to override any existing styles
        $('.timeline-event.score.h').css({
            'border-left-color': homeJerseyColor,
            'border-left-width': '8px',
            'border-left-style': 'solid'
        });
    }
    
    // Apply away team color if available
    if (awayJerseyColor) {
        // Apply to regular events
        // $('.timeline-event.away:not(.score)').css('border-left-color', awayJerseyColor);
        
        // Apply to score events - with !important to override any existing styles
        $('.timeline-event.score.a').css({
            'border-left-color': awayJerseyColor,
            'border-left-width': '8px',
            'border-left-style': 'solid'
        });
    }
}

// Update rosters
function updateRosters(playerData) {
    if (!playerData) return;
    
    // Update the global players object
    // Copy to both window.players (for global access) and players (already defined in the HTML template)
    window.players = playerData;
    players = playerData;
    console.log("Players data updated:", players);
    
    // Update home team roster
    let homeRosterHtml = '<table class="hub-roster-table">';
    if (playerData.h) {
        // Sort player numbers numerically
        const homeNumbers = Object.keys(playerData.h).sort((a, b) => parseInt(a) - parseInt(b));
        
        homeNumbers.forEach(number => {
            homeRosterHtml += `
                <tr>
                    <td class="player-number">${number}</td>
                    <td class="player-name">${playerData.h[number]}</td>
                </tr>
            `;
        });
    }
    homeRosterHtml += '</table>';
    $('#home-roster-container').html(homeRosterHtml);
    
    // Update away team roster
    let awayRosterHtml = '<table class="hub-roster-table">';
    if (playerData.a) {
        // Sort player numbers numerically
        const awayNumbers = Object.keys(playerData.a).sort((a, b) => parseInt(a) - parseInt(b));
        
        awayNumbers.forEach(number => {
            awayRosterHtml += `
                <tr>
                    <td class="player-number">${number}</td>
                    <td class="player-name">${playerData.a[number]}</td>
                </tr>
            `;
        });
    }
    awayRosterHtml += '</table>';
    $('#away-roster-container').html(awayRosterHtml);
    
    // After updating rosters, let's check if there are any existing timeline events
    // that could benefit from updated player information
    refreshTimelinePlayerNames();
}

// Update stats
function updateStats(statsData) {
    if (!statsData) return;
    
    console.log("Updating stats with data:", statsData);
    
    // Update player stats
    if (statsData.player_stats) {
        updatePlayerStats(statsData.player_stats);
    }
    
    // Update team stats
    updateTeamStats(statsData);
    
    // Update timeline from game events
    if (statsData.game_events && statsData.game_events.length > 0) {
        console.log("Updating timeline with", statsData.game_events.length, "events");
        updateTimeline(statsData.game_events);
    }
    
    // Update scores too (in case they weren't updated elsewhere)
    if (statsData.points) {
        updateScores(statsData.points.a || 0, statsData.points.h || 0);
    }
}

// Update player stats
function updatePlayerStats(playerStats) {
    if (!playerStats) return;
    
    // Process home team player stats
    let homePlayerStatsHtml = `
        <table class="hub-player-stats-table">
            <thead>
                <tr>
                    <th>Player</th>
                    <th>Goals</th>
                    <th>Assists</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    if (playerStats.h) {
        // Convert to array for sorting
        const homePlayers = Object.entries(playerStats.h).map(([number, stats]) => ({
            number,
            name: stats.name,
            goals: stats.goals || 0,
            assists: stats.assists || 0,
            total: (stats.goals || 0) + (stats.assists || 0)
        }));
        
        // Sort by total points
        homePlayers.sort((a, b) => b.total - a.total);
        
        // Generate table rows
        homePlayers.forEach(player => {
            homePlayerStatsHtml += `
                <tr>
                    <td class="player-name"><small>#${player.number}</small> ${player.name}</td>
                    <td>${player.goals}</td>
                    <td>${player.assists}</td>
                </tr>
            `;
        });
    }
    
    homePlayerStatsHtml += '</tbody></table>';
    $('#home-player-stats-container').html(homePlayerStatsHtml);
    
    // Process away team player stats
    let awayPlayerStatsHtml = `
        <table class="hub-player-stats-table">
            <thead>
                <tr>
                    <th>Player</th>
                    <th>Goals</th>
                    <th>Assists</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    if (playerStats.a) {
        // Convert to array for sorting
        const awayPlayers = Object.entries(playerStats.a).map(([number, stats]) => ({
            number,
            name: stats.name,
            goals: stats.goals || 0,
            assists: stats.assists || 0,
            total: (stats.goals || 0) + (stats.assists || 0)
        }));
        
        // Sort by total points
        awayPlayers.sort((a, b) => b.total - a.total);
        
        // Generate table rows
        awayPlayers.forEach(player => {
            awayPlayerStatsHtml += `
                <tr>
                    <td class="player-name"><small>#${player.number}</small> ${player.name}</td>
                    <td>${player.goals}</td>
                    <td>${player.assists}</td>
                </tr>
            `;
        });
    }
    
    awayPlayerStatsHtml += '</tbody></table>';
    $('#away-player-stats-container').html(awayPlayerStatsHtml);
}

// Update team stats
function updateTeamStats(statsData) {
    // Create team stats HTML for home team
    let homeTeamStatsHtml = `
        <table class="hub-team-stats-table">
            <thead>
                <tr>
                    <th>Stat</th>
                    <th>Value</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Points</td>
                    <td>${statsData.points?.h || 0}</td>
                </tr>
                <tr>
                    <td>O-Points</td>
                    <td>${statsData.o_points?.h || 0}</td>
                </tr>
                <tr>
                    <td>D-Points</td>
                    <td>${statsData.d_points?.h || 0}</td>
                </tr>
                <tr>
                    <td>Time in Offence</td>
                    <td>${statsData.o_time?.h || 0}</td>
                </tr>
                <tr>
                    <td>Turnovers</td>
                    <td>${statsData.turnovers?.h || 0}</td>
                </tr>
                <tr>
                    <td>Timeouts</td>
                    <td>${statsData.timeouts?.h || 0}</td>
                </tr>
            </tbody>
        </table>
    `;
    $('#home-team-stats-container').html(homeTeamStatsHtml);
    
    // Create team stats HTML for away team
    let awayTeamStatsHtml = `
        <table class="hub-team-stats-table">
            <thead>
                <tr>
                    <th>Stat</th>
                    <th>Value</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Points</td>
                    <td>${statsData.points?.a || 0}</td>
                </tr>
                <tr>
                    <td>O-Points</td>
                    <td>${statsData.o_points?.a || 0}</td>
                </tr>
                <tr>
                    <td>D-Points</td>
                    <td>${statsData.d_points?.a || 0}</td>
                </tr>
                <tr>
                    <td>Time in Offence</td>
                    <td>${statsData.o_time?.a || 0}</td>
                </tr>
                <tr>
                    <td>Turnovers</td>
                    <td>${statsData.turnovers?.a || 0}</td>
                </tr>
                <tr>
                    <td>Timeouts</td>
                    <td>${statsData.timeouts?.a || 0}</td>
                </tr>
            </tbody>
        </table>
    `;
    $('#away-team-stats-container').html(awayTeamStatsHtml);
}

// Update timeline
function updateTimeline(events) {
    if (!events || events.length === 0) {
        console.log("No events to update timeline with");
        return;
    }
    
    console.log("Timeline updating with events:", events);
    
    // Clear current timeline
    const container = $('#timeline-container');
    container.empty();
    
    // Get proper team names from global teams object
    const homeName = teams.h.name || "HOME";
    const homeFullName = teams.h.full_name || "HOME";
    const awayName = teams.a.name || "AWAY";
    const awayFullName = teams.a.full_name || "AWAY";
    var homeScoreTotal = '';
    var awayScoreTotal = '';
    
    // Sort events by timestamp in REVERSE chronological order (newest first)
    const sortedEvents = events.sort((a, b) => {
        const timeA = a.t || 0;
        const timeB = b.t || 0;
        return timeB - timeA; // Notice the reverse order here
    });
    
    // Process events in reverse chronological order (newest first)
    sortedEvents.forEach(event => {
        let eventHtml = '';
        const eventTime = event.t || 0;
        const formattedTime = formatGameTime(eventTime);
        const team = event.e || event.side || '';
        const teamName = team === 'h' ? homeName : team === 'a' ? awayName : '';
        
        // Log the event for debugging
        console.log("Processing timeline event:", event, "team:", team, "teamName:", teamName);
        
        // Score event
        if (event.y === 'S' || event.subtype === 'score') {
            // Get scorer details - try to include number and full name
            const scorerNumber = event.s || (event.data ? event.data.scorer_no : '');
            const scorerName = event.data?.scorer || '';
            
            // Get scorer's name from the global players object
            let scorerNameToUse = '';
            if (scorerNumber && team && players && players[team] && players[team][scorerNumber]) {
                scorerNameToUse = players[team][scorerNumber];
            } else if (scorerName) {
                scorerNameToUse = scorerName;
            }
            
            // Enhanced scorer display with better formatting
            let scorerDisplay;
            if (scorerNameToUse) {
                scorerDisplay = `<strong>#${scorerNumber}</strong> <span class="player-fullname">${scorerNameToUse}</span>`;
            } else if (scorerNumber) {
                scorerDisplay = `<strong>#${scorerNumber}</strong>`;
            } else {
                scorerDisplay = 'Goal';
            }
            
            // Get assist details if available
            const assistNumber = event.a || (event.data ? event.data.assist_no : '');
            const assistName = event.data?.assist || '';
            
            // Get assist's name from the global players object
            let assistNameToUse = '';
            if (assistNumber && team && players && players[team] && players[team][assistNumber]) {
                assistNameToUse = players[team][assistNumber];
            } else if (assistName) {
                assistNameToUse = assistName;
            }
            
            // Enhanced assist display with better formatting
            let assistDisplay;
            if (assistNameToUse) {
                assistDisplay = `<strong>#${assistNumber}</strong> <span class="player-fullname">${assistNameToUse}</span>`;
            } else if (assistNumber) {
                assistDisplay = `<strong>#${assistNumber}</strong>`;
            } else {
                assistDisplay = '';
            }
            
            // Get current score information if available
            const homeScoreNow = event.data?.h_score || event.hs || '';
            const awayScoreNow = event.data?.a_score || event.as || '';
            // Check if the score has changed
            homeScoreTotal = homeScoreNow;
            awayScoreTotal = awayScoreNow;
            
            // Get jersey color from data attribute if available
            const jerseyColor = team === 'h' 
                ? $('body').attr('data-home-jersey-color') 
                : $('body').attr('data-away-jersey-color');
                
            // Set a data attribute on the event element to identify its team
            const teamDataAttr = team === 'h' ? 'data-home-team="true"' : 'data-away-team="true"';
            
            eventHtml = `
                <div class="timeline-event score ${team}" ${teamDataAttr} style="border-left-color:${jerseyColor || '#fff'};">
                    <div class="timeline-time">${formattedTime}</div>
                    <div class="timeline-team">${teamName}</div>
                    <div class="timeline-action">
                        <div class="player-action">${scorerDisplay}</div>
                        ${assistDisplay ? `<div class="player-assist">${assistDisplay}</div>` : ''}
                    </div>
                </div>
            `;
        }
        // Turnover event
        else if (event.y === 'T' || event.subtype === 'turnover') {
            // Get jersey color from data attribute
            const jerseyColor = team === 'h' 
                ? $('body').attr('data-home-jersey-color') 
                : $('body').attr('data-away-jersey-color');
                
            // Set a data attribute on the event element
            const teamDataAttr = team === 'h' ? 'data-home-team="true"' : 'data-away-team="true"';
            
            eventHtml = `
                <div class="timeline-event ${team}" ${teamDataAttr} style="border-left-color:${jerseyColor || '#fff'};">
                    <div class="timeline-time">${formattedTime}</div>
                    <div class="timeline-team">${teamName}</div>
                    <div class="timeline-action">Turnover</div>
                </div>
            `;
        }
        // Timeout event
        else if (event.y === 'TO' || event.subtype === 'timeout') {
            // Get jersey color from data attribute
            const jerseyColor = team === 'h' 
                ? $('body').attr('data-home-jersey-color') 
                : $('body').attr('data-away-jersey-color');
                
            // Set a data attribute on the event element
            const teamDataAttr = team === 'h' ? 'data-home-team="true"' : 'data-away-team="true"';
            
            eventHtml = `
                <div class="timeline-event timeout ${team}" ${teamDataAttr} style="border-left-color:#f8d84f;">
                    <div class="timeline-time">${formattedTime}</div>
                    <div class="timeline-team">${teamName}</div>
                    <div class="timeline-action">Timeout</div>
                </div>
            `;
        }
        // Offense event
        else if (event.y === 'O' || event.subtype === 'offence') {
            // Get jersey color from data attribute
            const jerseyColor = team === 'h' 
                ? $('body').attr('data-home-jersey-color') 
                : $('body').attr('data-away-jersey-color');
                
            // Set a data attribute on the event element
            const teamDataAttr = team === 'h' ? 'data-home-team="true"' : 'data-away-team="true"';
            
            eventHtml = `
                <div class="timeline-event ${team}" ${teamDataAttr} style="border-left-color:${jerseyColor || '#fff'};">
                    <div class="timeline-time">${formattedTime}</div>
                    <div class="timeline-team">${teamName}</div>
                    <div class="timeline-action">Starting on Offense</div>
                </div>
            `;
        }
        // Halftime event
        else if (event.y === 'H' || event.subtype === 'halftime') {
            eventHtml = `
                <div class="timeline-event halftime">
                    <div class="timeline-time">${formattedTime}</div>
                    <div class="timeline-team">-</div>
                    <div class="timeline-action">HALFTIME</div>
                </div>
            `;
            // Update half indicator
            $('#hub-half').text('2nd Half');
        }
        // End event
        else if (event.y === 'E' || event.subtype === 'end') {
            eventHtml = `
                <div class="timeline-event end">
                    <div class="timeline-time">${formattedTime}</div>
                    <div class="timeline-team"></div>
                    <div class="timeline-action">END OF GAME</div>
                </div>
            `;
        }
        
        // Add to timeline if we created HTML for this event
        if (eventHtml) {
            container.append(eventHtml);
        }
    });
    
    // After adding all events, apply jersey colors to team events
    applyJerseyColorsToTimeline();
}

// Note: updateGameTime function removed - we now use the timer functions in the HTML template

// Update scores
function updateScores(awayScore, homeScore) {
    $('#hub-away-score').text(awayScore);
    $('#hub-home-score').text(homeScore);
    
    // Remove the dash initially present in HTML
    $('.hub-score-separator').text('-');
}

// Handle individual game events
function handleGameEvent(event) {
    // Start timer on first non-halftime event if it hasn't been started yet
    if (!matchTimerStarted && !matchEnded && event.t && event.subtype !== 'halftime' && event.subtype !== 'end') {
        console.log("Auto-starting timer from first event");
        startTimer(event.t);
    }
    
    // For score events, update scores in header
    if (event.subtype === 'score' && event.data) {
        updateScores(event.data.a_score, event.data.h_score);
    }
    
    // For start event, reset half indicator and timer
    if (event.subtype === 'start') {
        $('#hub-half').text('1st Half');
        // Reset the match ended flag when starting a new match
        matchEnded = false;
        // Start timer with the provided offset
        if (event.timer_offset !== undefined) {
            startTimer(event.timer_offset);
        } else {
            resetTimer();
        }
    }
    
    // For end event, set the match ended flag to prevent further data refreshes
    if (event.subtype === 'end') {
        // Stop the timer when the match ends
        stopTimer();
        console.log("End of match detected - freezing data");
        matchEnded = true;
        
        // Wait a short moment to ensure all other data has been processed
        setTimeout(function() {
            // Create a permanent backup of the final match state
            const finalHomeRoster = $('#home-roster-container').html();
            const finalAwayRoster = $('#away-roster-container').html();
            const finalHomeStats = $('#home-player-stats-container').html();
            const finalAwayStats = $('#away-player-stats-container').html();
            const finalHomeTeamStats = $('#home-team-stats-container').html();
            const finalAwayTeamStats = $('#away-team-stats-container').html();
            const finalTimeline = $('#timeline-container').html();
            
            // Also save team names, scores, and game time
            const homeTeamName = $('.hub-home-team .hub-team-name').text();
            const awayTeamName = $('.hub-away-team .hub-team-name').text();
            const homeScore = $('#hub-home-score').text();
            const awayScore = $('#hub-away-score').text();
            const gameTime = $('#hub-game-time').text();
            const half = $('#hub-half').text();
            
            // Store this as the permanent match end state
            window.finalMatchData = {
                homeRoster: finalHomeRoster,
                awayRoster: finalAwayRoster,
                homeStats: finalHomeStats,
                awayStats: finalAwayStats,
                homeTeamStats: finalHomeTeamStats,
                awayTeamStats: finalAwayTeamStats,
                timeline: finalTimeline,
                homeTeamName: homeTeamName,
                awayTeamName: awayTeamName,
                homeScore: homeScore,
                awayScore: awayScore,
                gameTime: gameTime,
                half: half,
                ended: true,
                timestamp: Date.now()
            };
            
            // Also save a copy of the players object for reference
            if (players) {
                window.finalMatchData.players = JSON.parse(JSON.stringify(players));
            }
            
            // Store in localStorage to persist across page reloads
            try {
                localStorage.setItem('commentator_final_match_data', JSON.stringify(window.finalMatchData));
                console.log("Final match data saved successfully to localStorage");
            } catch (e) {
                console.error("Failed to save final match data to localStorage:", e);
            }
        }, 2000); // Wait 2 seconds to ensure all updates have completed
    }
}

// Helper function to format time in seconds (for o_time and game time)
function formatTimeInSeconds(deciseconds) {
    const totalSeconds = Math.floor(deciseconds);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Alias for formatTimeInSeconds to maintain code clarity
const formatGameTime = formatTimeInSeconds;

// Refresh timeline events with updated player information
function refreshTimelinePlayerNames() {
    // Only proceed if we have players data
    if (!players || (!players.h && !players.a)) {
        console.log("No player data available for timeline refresh");
        return;
    }
    
    console.log("Refreshing timeline player names with updated roster data");
    
    // Find all score events in the timeline
    $('.timeline-event.score').each(function() {
        const $event = $(this);
        const isHomeTeam = $event.hasClass('home');
        const team = isHomeTeam ? 'h' : 'a';
        
        // Look for player numbers in the event
        const $playerAction = $event.find('.player-action');
        const $playerAssist = $event.find('.player-assist');
        
        // Extract player number from HTML
        const scorerNumberMatch = $playerAction.html()?.match(/#(\d+)/);
        if (scorerNumberMatch && scorerNumberMatch[1]) {
            const number = scorerNumberMatch[1];
            
            // Check if we have this player in our roster
            if (players[team] && players[team][number]) {
                const playerName = players[team][number];
                
                // Update the player action with proper name
                const updatedContent = $playerAction.html().replace(
                    /#(\d+)(<\/strong>)\s*(<span class="player-fullname">).*?(<\/span>|$)/,
                    `#$1$2 <span class="player-fullname">${playerName}</span>`
                );
                $playerAction.html(updatedContent);
            }
        }
        
        // Do the same for assist
        const assistNumberMatch = $playerAssist.html()?.match(/#(\d+)/);
        if (assistNumberMatch && assistNumberMatch[1]) {
            const number = assistNumberMatch[1];
            
            // Check if we have this player in our roster
            if (players[team] && players[team][number]) {
                const playerName = players[team][number];
                
                // Update the player assist with proper name
                const updatedContent = $playerAssist.html().replace(
                    /#(\d+)(<\/strong>)\s*(<span class="player-fullname">).*?(<\/span>|$)/,
                    `#$1$2 <span class="player-fullname">${playerName}</span>`
                );
                $playerAssist.html(updatedContent);
            }
        }
    });
}