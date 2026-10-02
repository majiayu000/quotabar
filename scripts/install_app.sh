#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_SRC="$ROOT/src-tauri/target/release/bundle/macos/QuotaBar.app"
APP_DST="/Applications/QuotaBar.app"

if [[ ! -x "$APP_SRC/Contents/MacOS/quotabar" ]]; then
  echo "App bundle not found. Build it first: npm run tauri build -- --bundles app" >&2
  exit 1
fi

# Stage on the destination filesystem before stopping the current app.
STAGE="$(mktemp -d /Applications/.quotabar-install.XXXXXX)"
cleanup() {
  if [[ -e "$STAGE/previous.app" ]]; then
    echo "Previous app retained at $STAGE/previous.app" >&2
  else
    rm -rf "$STAGE"
  fi
}
trap cleanup EXIT

ditto "$APP_SRC" "$STAGE/QuotaBar.app"
"$ROOT/scripts/stop_app.sh"

if [[ -e "$APP_DST" ]]; then
  mv "$APP_DST" "$STAGE/previous.app"
fi
if mv "$STAGE/QuotaBar.app" "$APP_DST"; then
  rm -rf "$STAGE/previous.app"
else
  status=$?
  if [[ -e "$STAGE/previous.app" ]]; then
    mv "$STAGE/previous.app" "$APP_DST" || echo "Failed to restore the previous app; see retained path below." >&2
  fi
  exit "$status"
fi
echo "Installed: $APP_DST"
