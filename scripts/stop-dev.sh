#!/usr/bin/env bash
# Stop v1 dev servers (scores_server + scores_html).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/dev-common.sh
source "$SCRIPT_DIR/lib/dev-common.sh"

ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$(dev_pid_dir)/v1.pids"

echo "Stopping v1 scoreboard dev servers..."

dev_stop_pid_file "$PID_FILE"

for port in 8000 5000 5005; do
  dev_kill_port "$port"
done

# Flask debug reloader / stray children
dev_stop_by_pattern "scores_server/app.py"
dev_stop_by_pattern "scores_html/web.py"

echo "Stopped (ports 8000, 5000, 5005)."
