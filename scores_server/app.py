from __future__ import annotations

import os
import logging
from flask_cors import CORS
from server.scores_server import ScoresServer
from config import config

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
CORS(app)

if __name__ == '__main__':
    app.run(
        host=config.FLASK_HOST,
        port=config.FLASK_PORT,
        debug=config.FLASK_DEBUG,
        use_reloader=False
    )

# a - away score
# h - home score
# e - events
#     t - time
#     e - team side
#         a - away
#         h - home
#     y - event
#         T - turn
#         S - score
#         O - offence set
#         E - end of a match
#         H - halftime
#         TO - timeout
#     a - assist
#     s - scorer
# ts - time
