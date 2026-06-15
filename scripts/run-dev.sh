#!/usr/bin/env bash
# Start scores_server (API + WebSocket) and scores_html (views) for local testing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT/.dev"
PID_FILE="$PID_DIR/v1.pids"

mkdir -p "$PID_DIR"
: >"$PID_FILE"

pick_python() {
  for candidate in "$@"; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done
  command -v python3
}

PYTHON_SCORES="$(pick_python \
  "$ROOT/scores_server/.venv/bin/python" \
  "$ROOT/.venv/bin/python")"
PYTHON_VIEWS="$(pick_python \
  "$ROOT/.venv/bin/python" \
  "$ROOT/scores_server/.venv/bin/python")"

export RUN_ENV=testing

SCORES_PID=""
VIEWS_PID=""

cleanup() {
  local pids=()
  [[ -n "${SCORES_PID:-}" ]] && pids+=("$SCORES_PID")
  [[ -n "${VIEWS_PID:-}" ]] && pids+=("$VIEWS_PID")
  if ((${#pids[@]})); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM

echo "Using scores Python: $PYTHON_SCORES"
echo "Using views Python:  $PYTHON_VIEWS"
echo ""
echo "Starting scores server (Flask :5000, WebSocket :5005)..."
(cd "$ROOT/scores_server" && exec "$PYTHON_SCORES" app.py) &
SCORES_PID=$!
echo "$SCORES_PID" >>"$PID_FILE"

echo "Starting views server (Flask :8000)..."
(cd "$ROOT/scores_html" && exec "$PYTHON_VIEWS" web.py) &
VIEWS_PID=$!
echo "$VIEWS_PID" >>"$PID_FILE"

echo ""
echo "  Controller:  http://localhost:8000/controller"
echo "  Scoreboard:  http://localhost:8000/scoreboard"
echo "  Stats:       http://localhost:8000/stats"
echo "  WebSocket:   ws://localhost:5005/"
echo ""
echo "Press Ctrl+C to stop, or run: scripts/stop-dev.sh"
echo ""

# Exit (and cleanup the other process) when either server stops.
wait -n "$SCORES_PID" "$VIEWS_PID"
