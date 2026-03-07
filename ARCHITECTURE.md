# Architecture Overview

## System Shape

The repository is split into two deployable applications:

- [scores_server/app.py](/home/kuba/dev/scoreboard/scores_server/app.py): backend entrypoint
- [scores_html/web.py](/home/kuba/dev/scoreboard/scores_html/web.py): frontend entrypoint

At runtime, the flow is:

1. The backend polls an upstream live-data endpoint.
2. The backend normalizes the feed into in-memory state and outbound websocket messages.
3. Browser clients subscribe over WebSockets and update their views in real time.
4. The controller can also send operator commands back to the backend.

## Backend Layers

- [scores_server/server/scores_server.py](/home/kuba/dev/scoreboard/scores_server/server/scores_server.py)
  Starts the polling loop, websocket server, and periodic display housekeeping.
- [scores_server/models/game_state.py](/home/kuba/dev/scoreboard/scores_server/models/game_state.py)
  Holds the mutable live state for the active event.
- [scores_server/models/game_server.py](/home/kuba/dev/scoreboard/scores_server/models/game_server.py)
  Coordinates feed loading, state transitions, websocket broadcasts, and stat assembly.
- [scores_server/handlers/websocket_handler.py](/home/kuba/dev/scoreboard/scores_server/handlers/websocket_handler.py)
  Routes inbound websocket messages from controller clients.
- [scores_server/stats.py](/home/kuba/dev/scoreboard/scores_server/stats.py)
  Computes derived metrics from the event timeline.

## Frontend Layers

- [scores_html/templates/scoreboard.html](/home/kuba/dev/scoreboard/scores_html/templates/scoreboard.html)
  Main on-stream display surface.
- [scores_html/templates/controller.html](/home/kuba/dev/scoreboard/scores_html/templates/controller.html)
  Operator control panel for loading events and adjusting display state.
- [scores_html/static/js/scoreboard.js](/home/kuba/dev/scoreboard/scores_html/static/js/scoreboard.js)
  Client-side websocket consumer and display renderer.
- [scores_html/static/js/controller.js](/home/kuba/dev/scoreboard/scores_html/static/js/controller.js)
  Operator-side websocket client.

## What Is Already Generic

- Flask and Gunicorn deployment model
- WebSocket message broadcast pattern
- Poll-transform-broadcast architecture
- Team-based score display
- Roster and schedule rendering
- Manual operator overrides for colors and display state

## What Is Still Domain-Specific

- Upstream payload schema from `scores.frisbee.pl`
- Event code meanings and sequencing rules
- Ultimate-specific metrics:
  - offense/defense points
  - disc possession
  - Callahan handling
- Some client naming and CSS asset names

## Best Generalization Seams

If this project is being adapted rather than rewritten, make changes in this order:

1. Replace the upstream feed contract in [scores_server/models/game_server.py](/home/kuba/dev/scoreboard/scores_server/models/game_server.py) and [scores_html/web.py](/home/kuba/dev/scoreboard/scores_html/web.py).
2. Swap or extend the derived-stat module in [scores_server/stats.py](/home/kuba/dev/scoreboard/scores_server/stats.py).
3. Adjust websocket event naming only if the frontend contract also changes.
4. Rename template and asset identifiers last, because that is mostly cosmetic and carries the highest regression risk for the lowest functional gain.

## Summary

This is best understood as a live-event display platform with one concrete sport adapter already implemented. The transport, state propagation, and browser surfaces are reusable; the feed parser and metric logic are where the remaining specialization lives.
