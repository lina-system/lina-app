#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Build LINA Probe, the single executable that holds the Accessibility and
# Screen Recording grants for the launcher baseline (#91), sign it with sign.sh
# and install it.
#
# The signing identity comes from LINA_PROBE_SIGN, else the first line of
# ~/Library/Application Support/LINA Probe/sign-identity, else "local".
# See sign.sh for the accepted values. The grants survive rebuilds while the
# identity stays the same; ad-hoc signing (CI) ties TCC to the cdhash instead.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
app=${LINA_PROBE_APP:-/Applications/LINA Probe.app}
support="$HOME/Library/Application Support/LINA Probe"
sign=${LINA_PROBE_SIGN:-}
[ -n "$sign" ] || [ ! -s "$support/sign-identity" ] || sign=$(head -n 1 "$support/sign-identity")
sign=${sign:-local}
bundle_id=dev.lina.probe

fail() { printf 'build.sh: %s\n' "$*" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] || fail 'macOS only'

# Provenance for the evidence manifest is written to "$support/build.json".
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
staged="$work/LINA Probe.app"
mkdir -p "$staged/Contents/MacOS"
cp "$here/Info.plist" "$staged/Contents/Info.plist"
xcrun swiftc -O -o "$staged/Contents/MacOS/LINA Probe" "$here"/*.swift
"$here/sign.sh" "$staged" "$sign" >/dev/null

mkdir -p "$(dirname "$app")"
rm -rf "$app.previous"
[ ! -e "$app" ] || mv "$app" "$app.previous"
mv "$staged" "$app"
rm -rf "$app.previous"

mkdir -p "$support"
executable="$app/Contents/MacOS/LINA Probe"
requirement=$(codesign -d -r- "$app" 2>&1 | sed -n 's/^designated => //p')
cdhash=$(codesign -dvvv "$app" 2>&1 | sed -n 's/^CDHash=//p')
revision=$(git -C "$here" rev-parse HEAD 2>/dev/null || echo unknown)
dirty=$(git -C "$here" status --porcelain -- . 2>/dev/null | grep -q . && echo true || echo false)
jq -n --arg app "$app" --arg bundle_id "$bundle_id" --arg sign "$sign" \
  --arg requirement "$requirement" --arg cdhash "$cdhash" \
  --arg sha256 "$(shasum -a 256 "$executable" | cut -d' ' -f1)" \
  --arg revision "$revision" --argjson dirty "$dirty" \
  --arg swift "$(xcrun swiftc --version 2>&1 | head -1)" --arg sdk "$(xcrun --show-sdk-version)" \
  --arg built_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{app:$app,bundle_id:$bundle_id,signing:$sign,designated_requirement:$requirement,cdhash:$cdhash,
    executable_sha256:$sha256,source_revision:$revision,source_dirty:$dirty,swift:$swift,sdk:$sdk,
    codesign_verify_strict:"passed",built_at:$built_at}' | tee "$support/build.json"
