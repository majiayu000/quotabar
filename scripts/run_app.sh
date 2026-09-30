#!/usr/bin/env bash
set -euo pipefail

APP_PATH="/Applications/QuotaBar.app"
if [[ ! -x "$APP_PATH/Contents/MacOS/quotabar" ]]; then
  echo "QuotaBar is not installed at $APP_PATH. Run ./scripts/install_app.sh first." >&2
  exit 1
fi

open "$APP_PATH"
