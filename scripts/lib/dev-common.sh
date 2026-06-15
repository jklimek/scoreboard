# Shared helpers for local dev run/stop scripts.
# shellcheck shell=bash

dev_repo_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)"
  if [[ "$script_dir" == */scripts/lib ]]; then
    cd "$script_dir/../.." && pwd
  elif [[ "$script_dir" == */v2/scripts ]]; then
    cd "$script_dir/../.." && pwd
  elif [[ "$script_dir" == */scripts ]]; then
    cd "$script_dir/.." && pwd
  else
    pwd
  fi
}

dev_pid_dir() {
  echo "$(dev_repo_root)/.dev"
}

dev_kill_port() {
  local port="$1"
  local pids=""

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti ":${port}" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
    return 0
  fi

  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.2
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

dev_stop_pid_file() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return 0
  fi

  local pid
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    kill "$pid" 2>/dev/null || true
  done <"$pid_file"
  rm -f "$pid_file"
}

dev_stop_by_pattern() {
  local pattern="$1"
  pkill -f "$pattern" 2>/dev/null || true
}
