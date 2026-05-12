#!/usr/bin/env bash
set -euo pipefail

APP_PATH="/Applications/QuotaBar.app"
if [[ -d "$APP_PATH" ]]; then
  open "$APP_PATH"
else
  echo "Not installed in /Applications, launching local binary..."
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  "$ROOT/src-tauri/target/release/quotabar"
fi
