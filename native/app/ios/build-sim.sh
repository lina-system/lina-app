#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Builds the iOS simulator app bundle (ad-hoc signed) from native/:
#   app/ios/build-sim.sh            -> $CARGO_TARGET_DIR/aarch64-apple-ios-sim/debug/LINA Proto.app
set -eu

target_dir="${CARGO_TARGET_DIR:-target}"
rustup target add aarch64-apple-ios-sim >/dev/null
IPHONEOS_DEPLOYMENT_TARGET=15.0 cargo build --locked -p lina-native-app --bin lina-proto-ios --target aarch64-apple-ios-sim

app="$target_dir/aarch64-apple-ios-sim/debug/LINA Proto.app"
rm -rf "$app"
mkdir -p "$app"
cp "$target_dir/aarch64-apple-ios-sim/debug/lina-proto-ios" "$app/lina-proto-ios"
cp app/ios/Info.plist "$app/Info.plist"
codesign --force --sign - "$app"
echo "ios app: $app"
