import json

def send_message_to_all(clients, message, logger=None):
    if logger:
        logger.debug(f"Send ws message: {message}")
    for client in clients:
        client.sendMessage(json.dumps(message))