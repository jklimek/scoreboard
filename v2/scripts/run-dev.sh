#!/usr/bin/env bash
# Start Scoreboard V2 API (uvicorn) and frontend watch build.
set -euo pipefail

V2_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$V2_DIR/.." && pwd)"
PID_DIR="$REPO_ROOT/.dev"
PID_FILE="$PID_DIR/v2.pids"

mkdir -p "$PID_DIR"
: >"$PID_FILE"

if [[ ! -x "$V2_DIR/.venv/bin/uvicorn" ]]; then
  echo "Missing v2/.venv. Create it with:"
  echo "  python3 -m venv v2/.venv"
  echo "  v2/.venv/bin/python -m pip install -e 'v2[dev]'"
  exit 1
fi

if [[ ! -d "$V2_DIR/node_modules" ]]; then
  echo "Missing v2/node_modules. Install with: cd v2 && npm install"
  exit 1
fi

# shellcheck source=../../scripts/lib/dev-common.sh
source "$REPO_ROOT/scripts/lib/dev-common.sh"

PORT=8100
if [[ -f "$V2_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$V2_DIR/.env"
  set +a
  PORT="${SCOREBOARD_V2_PORT:-8100}"
fi

export PYTHONPATH="$REPO_ROOT"

API_PID=""
WATCH_PID=""

cleanup() {
  local pids=()
  [[ -n "${API_PID:-}" ]] && pids+=("$API_PID")
  [[ -n "${WATCH_PID:-}" ]] && pids+=("$WATCH_PID")
  if ((${#pids[@]})); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM

echo "Starting V2 API (uvicorn :${PORT})..."
(
  cd "$REPO_ROOT"
  exec "$V2_DIR/.venv/bin/uvicorn" v2.apps.api.main:app \
    --reload \
    --host "${SCOREBOARD_V2_HOST:-0.0.0.0}" \
    --port "$PORT"
) &
API_PID=$!
echo "$API_PID" >>"$PID_FILE"

echo "Starting V2 frontend watch (esbuild)..."
(cd "$V2_DIR" && exec npm run watch:web) &
WATCH_PID=$!
echo "$WATCH_PID" >>"$PID_FILE"

echo ""
echo "  Control panel:   http://localhost:${PORT}/control-panel"
echo "  Commentator hub: http://localhost:${PORT}/commentator-hub"
echo "  OBS scoreboard:  http://localhost:${PORT}/obs/scoreboard"
echo "  Health:          http://localhost:${PORT}/health"
echo ""
echo "Press Ctrl+C to stop, or run: v2/scripts/stop-dev.sh"
echo ""

wait -n "$API_PID" "$WATCH_PID"
