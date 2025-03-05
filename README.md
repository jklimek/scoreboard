# Scoreboard

A real-time scoreboard application for streaming Ultimate Frisbee games with live stats, rosters, and dynamic controls.

## Overview

The Scoreboard application provides a complete solution for streaming Ultimate Frisbee games with:
- Live score updates
- Player statistics
- Team rosters
- Wind information
- Customizable jersey colors
- Controller interface

## Getting Started

### Running with Docker

The easiest way to run the Scoreboard application is using Docker:

```bash
docker-compose up
```

This will start all required services and make the application available on:
- Web frontend: http://localhost:8000
- API: http://localhost:5000
- WebSocket: ws://localhost:5005

### Manual Setup

1. Install requirements:
```bash
pip install -r scores_server/requirements.txt
```

2. Run the backend server:
```bash
cd scores_server
gunicorn -b 0.0.0.0:5000 app:app
```

3. Run the frontend server:
```bash
cd scores_html
gunicorn -b 0.0.0.0:8000 web:app
```

## Using the Scoreboard

### Controller Interface

Access the controller at: http://localhost:8000/controller

The controller is the central hub for managing what appears on the scoreboard:

1. **Set Game Number**: Enter the game ID from scores.frisbee.pl to load match data
2. **Set Jersey Colors**: Use the color pickers to match team jersey colors
3. **Control Displays**: Toggle wind information, team rosters, and statistics
4. **Timer Controls**: Start, stop, and reset the game timer

All changes made in the controller are instantly reflected on the other views through WebSocket connections.

### Main Scoreboard

Access the main scoreboard at: http://localhost:8000/scoreboard

This is the primary view showing:
- Team names and scores
- Game timer
- Recent points (scorer and assist)
- Team colors matching jerseys

To use in OBS:
1. Add a "Browser" source
2. Set the URL to http://localhost:8000/scoreboard
3. Set width to 1920 and height to 1080 (for full HD)

### Statistics View

Access the statistics at: http://localhost:8000/stats

Show this view during timeouts or after the game to display:
- Points by each team
- Offensive/defensive points
- Time in attack
- Turnovers
- Timeouts remaining

Toggle this view on/off from the controller interface.

### Team Rosters

Access the rosters at: http://localhost:8000/roster

Display team rosters showing:
- Player names
- Jersey numbers
- Team colors

Toggle this view on/off from the controller interface.

## WebSocket Connection

The application uses WebSockets for real-time updates across all views.

### Connection Details

The WebSocket server runs on port 5005 by default:
```
ws://localhost:5005/
```

For production environments, update the WebSocket URL in the JavaScript files:
- scores_html/static/js/scoreboard.js
- scores_html/static/js/controller.js

### Message Types

The WebSocket handles different message types:
- `team`: Updates team information (colors, names)
- `game`: Updates game state (score, timer)
- `wind`: Controls wind display
- `stats`: Controls statistics display

## Customization

To customize the application for different leagues or tournaments:
1. Update the API URL in scores_server/app.py (`SCORES_URL` variable)
2. Modify CSS in scores_html/static/css/ for visual changes
3. Update templates in scores_html/templates/ for layout changes

## Troubleshooting

### Common Issues

1. **No data appears**: Ensure the game ID is correct and the external API is accessible
2. **WebSocket disconnection**: Check network connectivity and firewall settings
3. **Color changes not applying**: Refresh the scoreboard page after changing colors

For technical support, check the application logs in the Docker console or server output.