#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Wraps the release binary into an app bundle and signs it with a Developer ID
# from the login keychain. The identity is passed in, never stored in the repo:
#   LINA_SIGN_IDENTITY=<sha1 or name> app/macos/bundle.sh   (run from native/)
set -eu

: "${LINA_SIGN_IDENTITY:?set LINA_SIGN_IDENTITY to a Developer ID Application identity}"
target_dir="${CARGO_TARGET_DIR:-target}"
app="$target_dir/release/LINA Proto.app"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp app/macos/Info.plist "$app/Contents/Info.plist"
cp "$target_dir/release/lina-proto" "$app/Contents/MacOS/lina-proto"

codesign --force --options runtime --timestamp=none --sign "$LINA_SIGN_IDENTITY" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
echo "bundle: $app"
