from __future__ import annotations

import os
import logging
import time
import requests
import json # Added for WebSocketHandler
from typing import Optional, Dict, Any # Added Dict, Any for WebSocketHandler type hints
from flask import Flask
from flask_cors import CORS
from threading import Thread, Timer
from SimpleWebSocketServer import WebSocket, SimpleWebSocketServer # Modified import
from scores_server.game_logic import GameServer # Updated import for GameServer
from config import config

class WebSocketHandler(WebSocket):
    """Handler for WebSocket connections."""
    # game_server will be set as a class attribute by ScoresServer.__init__
    game_server = None 
    logger = logging.getLogger(__name__) # Use the same logger configuration

    def handleMessage(self) -> None:
        """Handle incoming WebSocket messages."""
        try:
            data = json.loads(self.data)
            if data["type"] in ["team", "jersey_color"]:
                self.game_server.handle_team_setting_message(data)
            elif data["type"] == "game":
                self.game_server.handle_game_setting_message(data)
            elif data["type"] == "wind":
                self.game_server.handle_wind_setting_message(data)
            elif data["type"] == "stats":
                self.game_server.handle_stats_setting_message(data)
            elif data["type"] == "request_game_state":
                self.logger.info("Game state request received")
                if self.game_server and self.game_server.state.game_number:
                    self.game_server.send_game_state_to_client(self)
                else:
                    self.logger.info("No active game or game_server not set to send state for")
            elif data["type"] == "clear_text":
                self.logger.info("Manual text clear requested")
                if self.game_server:
                    self.game_server.send_message_to_all({
                        "type": "clear_text",
                        "clear": True
                    })
        except json.JSONDecodeError as e:
            self.logger.error(f"Error decoding message: {e}", exc_info=True)
        except Exception as e:
            self.logger.error(f"Error handling message: {e}", exc_info=True)

    def handleConnected(self) -> None:
        """Handle new WebSocket connections."""
        self.logger.info(f"Client {self.address} connected")
        if not self.game_server:
            self.logger.error("game_server not initialized for WebSocketHandler")
            return

        for client in self.game_server.clients:
            msg = {
                "address": f"{self.address[0]}:{self.address[1]}", 
                "status": "connected"
            }
            # It's possible client.sendMessage can fail if a client is closing
            try:
                client.sendMessage(json.dumps(msg))
            except Exception as e:
                self.logger.warning(f"Failed to send connection status to client {client.address}: {e}")
        self.game_server.clients.append(self)

    def handleClose(self) -> None:
        """Handle WebSocket connection closures."""
        if not self.game_server:
            self.logger.error("game_server not initialized for WebSocketHandler during close")
            # Cannot remove client if game_server or its clients list is not available
            return
        
        if self in self.game_server.clients:
            self.game_server.clients.remove(self)
            self.logger.info(f"Client {self.address} closed")
            for client in self.game_server.clients:
                msg = {
                    "address": f"{self.address[0]}:{self.address[1]}", 
                    "status": "disconnected"
                }
                # It's possible client.sendMessage can fail
                try:
                    client.sendMessage(json.dumps(msg))
                except Exception as e:
                    self.logger.warning(f"Failed to send disconnection status to client {client.address}: {e}")
        else:
            self.logger.warning(f"Client {self.address} not found in active clients list during close.")

class ScoresServer:
    def __init__(self) -> None:
        self.app = Flask(__name__)
        CORS(self.app)
        self.game_server = GameServer()
        self.logger = logging.getLogger(__name__)
        WebSocketHandler.game_server = self.game_server
        self.clear_text_timer: Optional[Timer] = None

    def start(self) -> None:
        """Start background threads for scores updates and websocket server."""
        scores_thread = Thread(target=self._scores_update)
        scores_thread.daemon = True
        scores_thread.start()
        
        websocket_thread = Thread(target=self._websocket_server)
        websocket_thread.daemon = True
        websocket_thread.start()

        # Start periodic text clearing
        self._schedule_clear_text()

    def _schedule_clear_text(self) -> None:
        """Schedule the next text clear operation."""
        CLEAR_INTERVAL = 300  # 5 minutes in seconds
        
        # Cancel any existing timer
        if self.clear_text_timer:
            self.clear_text_timer.cancel()
        
        # Send clear text message
        self.game_server.send_message_to_all({
            "type": "clear_text",
            "clear": True
        })
        
        self.logger.info("Cleared text display")
        
        # Schedule next clear
        self.clear_text_timer = Timer(CLEAR_INTERVAL, self._schedule_clear_text)
        self.clear_text_timer.daemon = True
        self.clear_text_timer.start()

    def _scores_update(self) -> None:
        """Background thread for updating scores from the API."""
        while True:
            self.logger.debug("Checking for score updates...")
            if (any(self.game_server.state.players) and 
                int(self.game_server.state.game_number) >= 1000 and 
                not self.game_server.state.stopped_game):
                
                self.logger.debug(f"Current game time: {self.game_server.state.game_time}")
                self.game_server.state.scores_requests_count += 1
                payload = {
                    "game": self.game_server.state.game_number,
                    "update": "true"
                }
                try:
                    r = requests.post(
                        config.SCORES_URL,
                        data=payload,
                        headers=config.get_request_headers(),
                        timeout=config.REQUEST_TIMEOUT
                    )
                    result_data = r.json()
                    if self.game_server.state.scores_requests_count % 2 == 0:
                        self.logger.info(f"Scores request: {result_data}")
                    
                    # Only update timer if it's running
                    if not result_data["ts"]["stop"]:
                        self.game_server.set_timer(result_data["ts"])
                    self.game_server.check_and_set_stopped_game_status(result_data["ts"])
                    self.game_server.parse_scores_events(result_data["e"])
                    
                    self.logger.debug(f"Updated game time: {self.game_server.state.game_time}")
                except Exception as e:
                    self.logger.error(f"Connection error: {e}", exc_info=True)
            else:
                self.logger.debug(f"Update conditions not met: players={bool(any(self.game_server.state.players))}, "
                                f"game_number={self.game_server.state.game_number}, "
                                f"stopped_game={self.game_server.state.stopped_game}")

            time.sleep(config.SCORES_UPDATE_INTERVAL)

    def _websocket_server(self) -> None:
        """Background thread for WebSocket server."""
        server = SimpleWebSocketServer('', config.WEBSOCKET_PORT, WebSocketHandler)
        server.serveforever()

    def get_flask_app(self) -> Flask:
        """Get the Flask application instance."""
        return self.app 

# Set up logging
def setup_logging() -> None:
    """Configure logging for the application."""
    log_dir = "logs"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)

    log_file = os.path.join(log_dir, "scores_server.log")
    
    handlers = [logging.FileHandler(log_file)]
    
    if config.FLASK_DEBUG:
        handlers.append(logging.StreamHandler())  # Print to console only in debug mode
        
    logging.basicConfig(
        level=logging.DEBUG,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=handlers
    )

# Initialize logging
setup_logging()
logger = logging.getLogger(__name__)

def generate_app():
    """
    Generate Flask app with all necessary background threads.
    Used by WSGI daemon (gunicorn).
    
    Returns:
        Flask: Configured Flask application
    """
    server = ScoresServer()
    server.start()
    return server.get_flask_app()

# Create the Flask app
app = generate_app()

if __name__ == '__main__':
    app.run(
        host=config.FLASK_HOST,
        port=config.FLASK_PORT,
        debug=config.FLASK_DEBUG,
        use_reloader=False
    )
