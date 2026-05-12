#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT/scripts/stop_app.sh"
"$ROOT/scripts/install_app.sh"
"$ROOT/scripts/run_app.sh"

echo "Reinstalled and launched QuotaBar."
