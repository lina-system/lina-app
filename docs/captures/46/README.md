<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native emoji capture

[Skin tone and pin controls](skin-tone.png) is an actual AppKit view rendered by
`EmojiTests.testCaptureNativeEmojiSearchAndPreferences` in an unordered fixture
window. It uses synthetic local preferences and no external application, typing
injection, clipboard writes, login changes or session unlock.

Source head: `6d271f9a71bc3b67f8191225293b5bcd9416eeb7`.
[macOS CI run 40099818621](https://github.com/lina-system/lina-app/actions/runs/40099818621),
job `native-macos` (120889478996), artifact `launcher-evidence` (12562368474).
All 36 native tests passed, including five emoji tests. This committed image
shows the unchanged skin-tone layout. The capture exposed an unrelated initial
ranking problem for heart-name queries; the later candidate ranks ❤️ first and
adds assertions for both names and immediate empty-search recent ordering.

Each macOS CI run uploads fresh Korean, English, skin-tone and empty-search
captures under `46/` in `launcher-evidence`. These are automated rendering
checks, not physical IME, key handling, VoiceOver or fullscreen acceptance.
Physical checks are recorded in [#116](https://github.com/lina-system/lina-app/issues/116#issuecomment-6384981739).
