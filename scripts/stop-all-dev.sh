#!/usr/bin/env bash
# Stop all local scoreboard dev servers (v1 and v2).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/stop-dev.sh"
"$SCRIPT_DIR/../v2/scripts/stop-dev.sh"

echo "All dev servers stopped."
