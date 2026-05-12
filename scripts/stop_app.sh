#!/usr/bin/env bash
set -euo pipefail

pkill -f "/Applications/QuotaBar.app/Contents/MacOS/quotabar" || true
pkill -f "/src-tauri/target/release/quotabar" || true

echo "Stopped QuotaBar (if running)."
