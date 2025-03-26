/* global $, Chart, websocket, parseEvent, teams */

// Initialize chart variables
let timeSeriesChart = null;

// Team colors
const homeTeamColor = getComputedStyle(document.documentElement).getPropertyValue('--box-font-color').trim();
const awayTeamColor = getComputedStyle(document.documentElement).getPropertyValue('--box-point-accent-color').trim();

// Data arrays for charts
const timeLabels = [];
const homeScoreData = [];
const awayScoreData = [];

// Chart configuration
const timeSeriesConfig = {
    type: 'line',
    data: {
        labels: timeLabels,
        datasets: [
            {
                label: 'Home Team',
                data: homeScoreData,
                borderColor: homeTeamColor,
                backgroundColor: homeTeamColor + '33', // Add transparency
                borderWidth: 3,
                pointRadius: 6,
                pointBackgroundColor: homeTeamColor,
                tension: 0.1,
                fill: false
            },
            {
                label: 'Away Team',
                data: awayScoreData,
                borderColor: awayTeamColor,
                backgroundColor: awayTeamColor + '33', // Add transparency
                borderWidth: 3,
                pointRadius: 6,
                pointBackgroundColor: awayTeamColor,
                tension: 0.1,
                fill: false
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                title: {
                    display: true,
                    text: 'Game Time',
                    font: {
                        size: 16,
                        weight: 'bold'
                    }
                },
                grid: {
                    color: 'rgba(0, 0, 0, 0.1)'
                }
            },
            y: {
                title: {
                    display: true,
                    text: 'Score',
                    font: {
                        size: 16,
                        weight: 'bold'
                    }
                },
                min: 0,
                ticks: {
                    stepSize: 1,
                    font: {
                        size: 14
                    }
                },
                grid: {
                    color: 'rgba(0, 0, 0, 0.1)'
                }
            }
        },
        plugins: {
            legend: {
                position: 'top',
                labels: {
                    font: {
                        size: 16,
                        weight: 'bold'
                    },
                    boxWidth: 20,
                    padding: 20
                }
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleFont: {
                    size: 16
                },
                bodyFont: {
                    size: 14
                },
                padding: 12,
                cornerRadius: 6
            }
        }
    }
};


// Initialize the charts when the document is ready
$(document).ready(function() {
    try {
        // Initialize chart with default values
        console.log("Initializing chart...");
        initializeCharts();
        
        // Setup WebSocket message handler to avoid overriding the global handler
        const originalOnMessage = websocket.onmessage;
        websocket.onmessage = function(evt) {
            try {
                // Call original handler first
                if (originalOnMessage) {
                    originalOnMessage(evt);
                } else {
                    // Fall back to standard parsing if no original handler
                    if (!JSON.parse(evt.data).hasOwnProperty("wind_update")) {
                        console.log("event: " + evt.data + '\n');
                    }
                    parseEvent(JSON.parse(evt.data));
                }
                
                // Then update our charts
                const data = JSON.parse(evt.data);
                handleWebSocketData(data);
            } catch (error) {
                console.error("Error handling WebSocket message:", error);
            }
        };
        
        // Request initial match data
        console.log("Requesting stats data...");
        setTimeout(function() {
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                console.log("Sending stats request...");
                websocket.send(JSON.stringify({
                    "request_type": "stats"
                }));
            } else {
                console.warn("WebSocket not open, cannot request stats");
                // Try reconnecting
                websocketConnection();
            }
        }, 1000);
    } catch (error) {
        console.error("Error in chart initialization:", error);
    }
});

// Initialize charts
function initializeCharts() {
    const timeSeriesCtx = document.getElementById('timeSeriesChart').getContext('2d');
    timeSeriesChart = new Chart(timeSeriesCtx, timeSeriesConfig);
}

// Handle WebSocket data
function handleWebSocketData(data) {
    if (data.hasOwnProperty('stats_data')) {
        updateTeamNames(data.stats_data);
        updateScores(data.stats_data);
        processTimelineEvents(data.stats_data.game_events);
        
        // For debugging
        console.log("Received stats data with", 
            data.stats_data.game_events ? data.stats_data.game_events.length : 0, 
            "game events");
    }
}

// Update team names
function updateTeamNames(statsData) {
    // Update display names
    const homeName = statsData.home_name || teams.h.name;
    const awayName = statsData.away_name || teams.a.name;
    
    $('#graph-stats__th-name').text(homeName);
    $('#graph-stats__ta-name').text(awayName);
    
    // Also update chart labels
    if (timeSeriesChart) {
        timeSeriesChart.data.datasets[0].label = homeName;
        timeSeriesChart.data.datasets[1].label = awayName;
    }
}

// Update scores
function updateScores(statsData) {
    $('#graph-stats__th-score').text(statsData.home_score || statsData.points?.h || 0);
    $('#graph-stats__ta-score').text(statsData.away_score || statsData.points?.a || 0);
}

// Process timeline events and update charts
function processTimelineEvents(gameEvents) {
    if (!gameEvents || gameEvents.length === 0) {
        console.log("No game events received");
        return;
    }
    
    console.log("Processing", gameEvents.length, "game events");
    
    // Clear existing data
    timeLabels.length = 0;
    homeScoreData.length = 0;
    awayScoreData.length = 0;
    
    let homeScore = 0;
    let awayScore = 0;
    
    // Process events chronologically
    // Game events can have either 't' or 'timestamp' property
    gameEvents.sort((a, b) => (a.t || a.timestamp || 0) - (b.t || b.timestamp || 0));
    
    gameEvents.forEach(event => {
        // Get event timestamp (could be 't' or 'timestamp')
        const timestamp = event.t || event.timestamp || 0;
        
        // Format timestamp as minutes:seconds (timestamps are typically in deciseconds - divide by 10)
        const totalSeconds = Math.floor(timestamp);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const timeLabel = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        

        // Check if it's a score event - can be either 'y' === 'S' or 'subtype' === 'score'
        const isScoreEvent = 
            (event.y === 'S') ||
            (event.subtype === 'score') || 
            (event.type === 'score');
            
        if (isScoreEvent) {
            // Team can be in 'e' or 'side' or 'team' field
            const team = event.e || event.side || event.team;
            
            // For score events, can either use:
            // 1. hs/as fields directly if available
            // 2. Increment based on which team scored
            
            if (event.hs !== undefined && event.as !== undefined) {
                // Use provided scores if available
                homeScore = event.hs;
                awayScore = event.as;
            } else {
                // Update scores based on which team scored
                if (team === 'h') {
                    homeScore++;
                } else if (team === 'a') {
                    awayScore++;
                }
            }
            
            // Add data point
            timeLabels.push(timeLabel);
            homeScoreData.push(homeScore);
            awayScoreData.push(awayScore);
            
            console.log(`Score at ${timeLabel}: Home ${homeScore} - Away ${awayScore}`);
        } else if (event.y === 'O') {
            timeLabels.push("Start");
            homeScoreData.push(homeScore);
            awayScoreData.push(awayScore);
        }
    });
    
    // Add a final data point with the most recent scores if we have any events
    if (homeScoreData.length > 0 && awayScoreData.length > 0) {
        // Get the current scores
        const finalHomeScore = homeScoreData[homeScoreData.length - 1];
        const finalAwayScore = awayScoreData[awayScoreData.length - 1];
        
        // Add "Final" or "Current" label based on whether we have an end event
        const hasEndEvent = gameEvents.some(event => 
            event.y === 'E' || 
            event.subtype === 'end' || 
            event.type === 'end');
            
        // Add a label 
        if (hasEndEvent) {
            timeLabels.push("Final");
        } else {
            timeLabels.push("Current");
        }
        
        // Add the current score data
        homeScoreData.push(finalHomeScore);
        awayScoreData.push(finalAwayScore);
    }
    
    // Check if we have data to display
    if (timeLabels.length === 0) {
        // If no data, add a "No Data" point
        timeLabels.push("No Data");
        homeScoreData.push(0);
        awayScoreData.push(0);
        
        console.log("No score events found in game data");
    } else {
        console.log(`Chart updated with ${timeLabels.length} data points`);
    }
    
    // Update chart
    timeSeriesChart.update();
}