#!/usr/bin/env bash
# Stop V2 dev servers (uvicorn + esbuild watch).
set -euo pipefail

V2_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$V2_DIR/.." && pwd)"
SCRIPT_DIR="$REPO_ROOT/scripts"

# shellcheck source=../../scripts/lib/dev-common.sh
source "$SCRIPT_DIR/lib/dev-common.sh"

PID_FILE="$(dev_pid_dir)/v2.pids"

PORT=8100
if [[ -f "$V2_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$V2_DIR/.env"
  set +a
  PORT="${SCOREBOARD_V2_PORT:-8100}"
fi

echo "Stopping V2 scoreboard dev servers..."

dev_stop_pid_file "$PID_FILE"
dev_kill_port "$PORT"

dev_stop_by_pattern "v2.apps.api.main:app"
dev_stop_by_pattern "uvicorn v2.apps.api.main:app"
dev_stop_by_pattern "scripts/build-web.mjs --watch"
dev_stop_by_pattern "npm run watch:web"

echo "Stopped (port ${PORT} and frontend watch)."
