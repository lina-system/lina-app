#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Boots one simulator, installs and launches the app, takes screenshots, then
# shuts the simulator down. Run from native/ after build-sim.sh:
#   app/ios/run-sim.sh <out-dir> [device name, default "iPhone 17"] [app arguments...]
# SHOT_PREFIX (default "ios") names the screenshots and the app log.
set -eu

out="$1"
device_name="${2:-iPhone 17}"
shift; [ $# -gt 0 ] && shift
prefix="${SHOT_PREFIX:-ios}"
target_dir="${CARGO_TARGET_DIR:-target}"
app="$target_dir/aarch64-apple-ios-sim/debug/LINA Proto.app"
mkdir -p "$out"

udid=$(xcrun simctl list devices available | grep -F "    $device_name (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[ -n "$udid" ] || { echo "no simulator named $device_name"; exit 1; }
echo "device: $device_name $udid"

shutdown() { xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true; echo "simulator shut down"; }
trap shutdown EXIT

xcrun simctl boot "$udid" 2>/dev/null || true
xcrun simctl bootstatus "$udid" -b
xcrun simctl install "$udid" "$app"
xcrun simctl launch --console-pty --terminate-running-process "$udid" system.lina.proto.ios "$@" > "$out/$prefix-app.log" 2>&1 &
launcher=$!
sleep 6
xcrun simctl io "$udid" screenshot "$out/$prefix-01-start.png"
sleep 6
xcrun simctl io "$udid" screenshot "$out/$prefix-02-after-6s.png"
xcrun simctl terminate "$udid" system.lina.proto.ios || true
wait "$launcher" 2>/dev/null || true
for image in "$out"/"$prefix"-*.png; do
  echo "$image $(sips -g pixelWidth -g pixelHeight "$image" | awk '/pixel/ {printf "%s=%s ", $1, $2}')"
done
