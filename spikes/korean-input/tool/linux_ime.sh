#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
cd "$(dirname "$0")/.."
# Run this wrapper with dv heavy on shared development hosts.
# Build first: flutter build linux --debug --dart-define=IME_TRACE=true
for command in dbus-run-session xvfb-run xdotool fcitx5 fcitx5-remote import convert python3; do
  command -v "$command" >/dev/null
done
binary="$PWD/build/linux/x64/debug/bundle/korean_input"
test -x "$binary"
output="${1:?usage: tool/linux_ime.sh OUTPUT_DIRECTORY}"
mkdir -p "$output"
output="$(realpath "$output")"
exec dbus-run-session -- xvfb-run -a -s '-screen 0 1280x800x24' \
  python3 tool/linux_ime.py "$binary" "$output"
