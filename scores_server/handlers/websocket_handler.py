from SimpleWebSocketServer import WebSocket
import json
import logging
from typing import Dict, Any

class WebSocketHandler(WebSocket):
    """Handler for WebSocket connections."""
    game_server = None  # Will be set during initialization
    logger = logging.getLogger(__name__)

    def handleMessage(self) -> None:
        """Handle incoming WebSocket messages."""
        try:
            data = json.loads(self.data)
            if data["type"] == "team":
                self.game_server.handle_team_setting_message(data)
            elif data["type"] == "game":
                self.game_server.handle_game_setting_message(data)
            elif data["type"] == "wind":
                self.game_server.handle_wind_setting_message(data)
            elif data["type"] == "stats":
                self.game_server.handle_stats_setting_message(data)
            elif data["type"] == "clear_text":
                self.logger.info("Manual text clear requested")
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
        for client in self.game_server.clients:
            msg = {
                "address": f"{self.address[0]}:{self.address[1]}", 
                "status": "connected"
            }
            client.sendMessage(json.dumps(msg))
        self.game_server.clients.append(self)

    def handleClose(self) -> None:
        """Handle WebSocket connection closures."""
        self.game_server.clients.remove(self)
        self.logger.info(f"Client {self.address} closed")
        for client in self.game_server.clients:
            msg = {
                "address": f"{self.address[0]}:{self.address[1]}", 
                "status": "disconnected"
            }
            client.sendMessage(json.dumps(msg)) 