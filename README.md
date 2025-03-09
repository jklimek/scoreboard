# Ultimate Frisbee Scoreboard System

_AI generated README lol_

A comprehensive real-time scores and statistics tracking system designed for Ultimate Frisbee matches, featuring live score updates, player statistics, wind conditions, and team rosters.

## Features

- Real-time score tracking and updates
- Match timer with start/stop functionality
- Player rosters with jersey numbers
- Individual player statistics (goals, assists)
- Team statistics (points, possession time, turnovers)
- Wind direction and speed display
- Beautiful, customizable interface with team colors
- Disc possession indicator

## System Architecture

The application consists of two main components:

1. Backend Server (scores_server)
- Python Flask application for game state management
- WebSocket server for real-time communication
- Statistics calculation engine
- External API integration for match data
2. Frontend Client (scores_html)
- Web-based controller interface
- Scoreboard display
- Statistics and roster views
- Real-time updates via WebSockets

## Installation & Setup

### Docker Installation (Recommended)

1. Clone the repository:
git clone https://github.com/yourusername/scoreboard.git
cd scoreboard
2. Start the application using Docker Compose:
docker-compose up
3. Access the application:
- Scoreboard: http://localhost:8000/scoreboard
- Controller: http://localhost:8000/controller
- Statistics: http://localhost:8000/stats
- Player Stats: http://localhost:8000/pstats

### Manual Installation

1. Clone the repository:
git clone https://github.com/yourusername/scoreboard.git
cd scoreboard
2. Install dependencies:
pip install -r scores_server/requirements.txt
3. Start the backend server:
cd scores_server
gunicorn -b 0.0.0.0:5000 app:app
4. In a separate terminal, start the frontend server:
cd scores_html
gunicorn -b 0.0.0.0:8000 web:app
5. Access the application at http://localhost:8000

## Using the Controller

The controller interface allows you to manage all aspects of the scoreboard system.

### Connecting to the Server

1. Open http://localhost:8000/controller in your web browser
2. Enter the WebSocket URL in the connection field (default: ws://localhost:5005/)
3. Click "Connect" to establish connection

### Setting Up a Match

1. Load Match:
- Enter the match ID in the "Game number" field
- Click "Set the game" to load match information
- The system will automatically fetch team names and rosters
2. Configure Teams:
- Set jersey colors for home and away teams using the color pickers
- Team names are auto-populated but can be manually adjusted
3. Manage Players:
- Player rosters are automatically loaded from the match data
- Player numbers and names can be adjusted if needed

### Controlling the Game

1. Timer Management:
- Start the match timer with the "Start" button
- Reset timer with the "Reset timer" button
- Set specific timer value with "Set timer"
2. Score Management:
- Track scores automatically from API data
- Manually update scores using the score controls
- Record goals with player attribution (scorer and assist)
3. Disc Possession:
- Set which team has possession using the offense buttons
- Record turnovers using the turnover buttons
4. Special Events:
- Record timeouts for either team


## Advanced Usage

### Using External Wind Data

The system can integrate with a weather API to display real-time wind conditions:

1. Connect a compatible weather station
2. Configure the API endpoint in config.py
3. Wind data will automatically update on the scoreboard

### Customizing the Display

Appearance can be customized by modifying:

- Team colors through the controller interface
- Background images and overall theme in the CSS files
- Display layout in the template files

## Development

### Running in Development Mode

1. Start the backend server in debug mode:
cd scores_server
python app.py
2. Start the frontend server in debug mode:
cd scores_html
python web.py

### Testing

Run tests with:
cd scores_server
pytest tests/

Test a specific file:
cd scores_server
pytest tests/test_stats.py -v

### Code Quality

Lint the code with:
cd scores_server
pylint app.py

## Troubleshooting

WebSocket Connection Issues:
- Ensure the WebSocket server port (5005) is not blocked by a firewall
- Check that the WebSocket URL matches your network configuration
- For local development, use ws://localhost:5005/
- For remote access, use ws://your-server-ip:5005/

Missing Player Data:
- Verify that the match ID exists and has player information
- Check the console for any API error messages

Display Not Updating:
- Refresh the browser cache
- Verify the WebSocket connection is active
- Check the browser console for JavaScript errors

## License

This project is licensed under the MIT License - see the LICENSE file for details.

### Acknowledgments

- Created for the Ultimate Frisbee community
- Design inspired by professional sports broadcasting systems

---
For more information, feature requests, or bug reports, please open an issue on our GitHub repository.