from __future__ import annotations

import time
import requests
import logging
from typing import Optional
from flask import Flask
from flask_cors import CORS
from threading import Thread, Timer
from SimpleWebSocketServer import SimpleWebSocketServer
from models.game_server import GameServer
from handlers.websocket_handler import WebSocketHandler
from config import config

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
            if (any(self.game_server.state.players) and 
                int(self.game_server.state.game_number) >= 1000 and 
                not self.game_server.state.stopped_game):
                
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
                    self.game_server.set_timer(result_data["ts"])
                    self.game_server.check_and_set_stopped_game_status(result_data["ts"])
                    self.game_server.parse_scores_events(result_data["e"])
                except Exception as e:
                    self.logger.error(f"Connection error: {e}", exc_info=True)

            time.sleep(config.SCORES_UPDATE_INTERVAL)

    def _websocket_server(self) -> None:
        """Background thread for WebSocket server."""
        server = SimpleWebSocketServer('', config.WEBSOCKET_PORT, WebSocketHandler)
        server.serveforever()

    def get_flask_app(self) -> Flask:
        """Get the Flask application instance."""
        return self.app 