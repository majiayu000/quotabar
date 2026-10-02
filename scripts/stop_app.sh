#!/usr/bin/env bash
set -euo pipefail

# Only stop the installed app, never another checkout's development process.
PATTERN='^/Applications/QuotaBar[.]app/Contents/MacOS/quotabar([[:space:]].*)?$'
if pkill -TERM -f "$PATTERN"; then
  :
else
  status=$?
  if [[ "$status" -eq 1 ]]; then
    echo "Installed QuotaBar is not running."
    exit 0
  fi
  echo "Failed to signal installed QuotaBar (pkill exit $status)." >&2
  exit "$status"
fi

for ((attempt = 0; attempt < 50; attempt++)); do
  if pgrep -f "$PATTERN" >/dev/null; then
    sleep 0.1
  else
    status=$?
    if [[ "$status" -eq 1 ]]; then
      echo "Stopped installed QuotaBar."
      exit 0
    fi
    echo "Failed to check installed QuotaBar (pgrep exit $status)." >&2
    exit "$status"
  fi
done

echo "Timed out waiting for installed QuotaBar to exit; installation must not continue." >&2
exit 1
