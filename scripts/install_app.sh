#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_SRC="$ROOT/src-tauri/target/release/bundle/macos/QuotaBar.app"
APP_DST="/Applications/QuotaBar.app"

if [[ ! -d "$APP_SRC" ]]; then
  echo "App bundle not found. Build it first: npm run tauri build -- --bundles app" >&2
  exit 1
fi

ditto "$APP_SRC" "$APP_DST"
echo "Installed: $APP_DST"
