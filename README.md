# Live Event Scoreboard Platform

Real-time event display platform for scoreboards, controller panels, rosters, and derived statistics.

The current implementation is wired to an Ultimate Frisbee live feed, but the project structure is broader than that:

- `scores_server/` provides the polling loop, in-memory state, websocket fan-out, and stat packaging.
- `scores_html/` provides browser views for the display, controller, schedules, rosters, and stats.
- Sport-specific behavior is mostly isolated to the upstream feed format and a small set of derived metrics such as offense/defense points and disc possession.

## Overview

The application has two runtime services:

1. Backend server
   - Polls an upstream event feed
   - Tracks current match state
   - Broadcasts updates to connected clients over WebSockets
   - Computes derived statistics from the event stream
2. Frontend server
   - Serves scoreboard and operator views
   - Renders live state pushed over WebSockets
   - Exposes dedicated pages for controller, schedule, roster, and analytics views

## Reusable Core

These parts are already generic enough to reuse for other sports or event formats:

- Flask app bootstrapping and deployment packaging
- Background polling thread and websocket server
- Shared `GameState` model for live state
- Browser-based operator and display surfaces
- Team color overrides and manual display control
- Schedule and roster pages backed by a JSON feed

## Current Sport-Specific Areas

These parts still assume the current Ultimate feed and event semantics:

- Default upstream endpoint points to `scores.frisbee.pl`
- Event codes such as `O`, `T`, `S`, `H`, `TO`, `E`
- Derived metrics for offense/defense points and disc possession
- Callahan-specific assist handling
- Some CSS and JS naming still refer to `scoreboard`

If you want to adapt this to another sport, the cleanest seam is the feed adapter plus the derived-stat functions in [scores_server/stats.py](/home/kuba/dev/scoreboard/scores_server/stats.py) and event preparation in [scores_server/models/game_server.py](/home/kuba/dev/scoreboard/scores_server/models/game_server.py).

## Architecture

High-level architecture and generalization notes live in [ARCHITECTURE.md](/home/kuba/dev/scoreboard/ARCHITECTURE.md).

## Run With Docker

```bash
docker-compose up --build
```

Default endpoints:

- Display: `http://localhost:8000/scoreboard`
- Controller: `http://localhost:8000/controller`
- Schedule: `http://localhost:8000/matches`
- Team stats: `http://localhost:8000/stats`
- Player stats: `http://localhost:8000/player_stats`
- Roster: `http://localhost:8000/roster`

## Run Manually

Install backend dependencies:

```bash
pip install -r scores_server/requirements.txt
```

Start the backend:

```bash
cd scores_server
gunicorn -b 0.0.0.0:5000 app:app
```

Start the frontend:

```bash
cd scores_html
gunicorn -b 0.0.0.0:8000 web:app
```

## Configuration

Useful environment variables:

- `RUN_ENV`: `production`, `dev`, or `testing`
- `SCORES_URL`: upstream schedule/live-data endpoint
- `WEBSOCKET_URL`: websocket endpoint advertised to clients
- `WIND_URL`: optional wind data source

The defaults still target the current Ultimate deployment, but those endpoints are now intended to be overridden per environment.

## Development

Run the backend in development:

```bash
cd scores_server
python app.py
```

Run the frontend in development:

```bash
cd scores_html
python web.py
```

Run tests:

```bash
cd scores_server
pytest tests/
```
