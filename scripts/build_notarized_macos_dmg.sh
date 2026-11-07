#!/usr/bin/env bash
# Builds a notarized macOS DMG and staples its app if Tauri could not.
#
# Tauri runs `xcrun stapler staple` without checking its exit status or keeping
# its output, so a transient CloudKit error still produces a DMG with an
# unstapled app. Bundling again notarizes again and has failed the same way, so
# keep the notarized app and retry only the staple on a writable copy of the DMG.
set -euo pipefail

readonly DMG_DIR="src-tauri/target/release/bundle/dmg"
readonly MAX_STAPLE_ATTEMPTS=10
readonly STAPLE_RETRY_SECONDS=30
readonly RW_FREE_SPACE_MB=64

mount_point=""
work_dir="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/quotabar-dmg.XXXXXX")"

cleanup() {
  if [ -n "$mount_point" ]; then
    hdiutil detach "$mount_point" >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

fail() {
  echo "$1" >&2
  exit 1
}

mount_dmg() {
  mount_point="$work_dir/mount"
  mkdir -p "$mount_point"
  hdiutil attach -nobrowse "$@" -mountpoint "$mount_point" >/dev/null
  app_path="$(find "$mount_point" -maxdepth 1 -name '*.app' -print -quit)"
  [ -n "$app_path" ] || fail "Signed macOS app bundle is missing from the DMG"
}

unmount_dmg() {
  hdiutil detach "$mount_point" >/dev/null
  mount_point=""
}

staple_with_retries() {
  local attempt
  for attempt in $(seq 1 "$MAX_STAPLE_ATTEMPTS"); do
    echo "Stapling the app, attempt $attempt of $MAX_STAPLE_ATTEMPTS"
    if xcrun stapler staple -v "$app_path" 2>&1; then
      return 0
    fi
    if [ "$attempt" -lt "$MAX_STAPLE_ATTEMPTS" ]; then
      sleep "$STAPLE_RETRY_SECONDS"
    fi
  done
  fail "App notarization ticket could not be stapled after $MAX_STAPLE_ATTEMPTS attempts"
}

npm run tauri build -- --bundles dmg

dmg_path="$(find "$DMG_DIR" -maxdepth 1 -name '*.dmg' -print -quit 2>/dev/null || true)"
[ -n "$dmg_path" ] || fail "Signed macOS DMG was not produced"

mount_dmg -readonly "$dmg_path"
if xcrun stapler validate "$app_path"; then
  unmount_dmg
  echo "Tauri stapled the app notarization ticket"
  exit 0
fi
app_size_mb="$(du -sm "$app_path" | cut -f1)"
unmount_dmg

echo "::warning::Tauri left the app without a notarization ticket; stapling it inside the DMG"
writable_dmg="$work_dir/writable.dmg"
hdiutil convert "$dmg_path" -format UDRW -o "$writable_dmg" >/dev/null
hdiutil resize -size "$((app_size_mb + RW_FREE_SPACE_MB))m" "$writable_dmg" >/dev/null

mount_dmg -readwrite "$writable_dmg"
staple_with_retries
unmount_dmg

# Converting drops the DMG signature. The workflow's next step verifies this
# signature, then notarizes and staples the DMG itself.
compressed_dmg="$work_dir/compressed.dmg"
hdiutil convert "$writable_dmg" -format UDZO -imagekey zlib-level=9 -o "$compressed_dmg" >/dev/null
mv -f "$compressed_dmg" "$dmg_path"
codesign --force --timestamp \
  --keychain "$QUOTABAR_SIGNING_KEYCHAIN" \
  --sign "$APPLE_SIGNING_IDENTITY" \
  "$dmg_path"
echo "Stapled the app and re-signed $dmg_path"
