#!/usr/bin/env bash
# Download YOLO26-X weights if missing (used by minimap_service.py).
set -euo pipefail
cd "$(dirname "$0")"
MODEL="yolo26x.pt"
URL="https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26x.pt"
if [[ -f "$MODEL" ]]; then
  echo "$MODEL already present ($(du -h "$MODEL" | cut -f1))"
  exit 0
fi
echo "Downloading $MODEL ..."
curl -fL --progress-bar -o "$MODEL" "$URL"
echo "Done: $(du -h "$MODEL" | cut -f1)"
