#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Builds the GPUI web prototype into native/web/dist (run from native/web/).
# Needs wasm-bindgen-cli of the same version as the wasm-bindgen crate in Cargo.lock.
# Font: LINA_WEB_FONT (a .ttf/.otf path) and LINA_WEB_FONT_FAMILY (its family name).
# Without them it uses Pretendard from the repository if that file is present;
# no font is downloaded. Hangul missing from the font falls back to Canvas text.
set -eu

default_font="../../docs/research/90-accent/fonts/Pretendard-Regular.otf"
if [ -z "${LINA_WEB_FONT:-}" ] && [ -f "$default_font" ]; then
  LINA_WEB_FONT="$(cd "$(dirname "$default_font")" && pwd)/$(basename "$default_font")"
  LINA_WEB_FONT_FAMILY="Pretendard"
fi
: "${LINA_WEB_FONT:?set LINA_WEB_FONT to a font file (no Pretendard in this checkout)}"
: "${LINA_WEB_FONT_FAMILY:?set LINA_WEB_FONT_FAMILY to that font's family name}"
export LINA_WEB_FONT LINA_WEB_FONT_FAMILY

target_dir="${CARGO_TARGET_DIR:-target}"
cargo build --locked --release --target wasm32-unknown-unknown
rm -rf dist
mkdir -p dist
wasm-bindgen --target web --no-typescript --out-dir dist --out-name lina_web \
  "$target_dir/wasm32-unknown-unknown/release/lina-web.wasm"
cp index.html dist/index.html
ls -l dist
