<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native emoji captures

- [Korean heart search](korean.png)
- [English heart search](english.png)
- [Skin tone and pin controls](skin-tone.png)
- [Empty search with recents and pins](recents.png)

These actual AppKit views were rendered by
`EmojiTests.testCaptureNativeEmojiSearchAndPreferences` in an unordered fixture
window. They use synthetic local preferences and no external application, typing
injection, clipboard writes, login changes or session unlock.

Source head: `694cfbcd543a1d2613c79d4c9923bea5d9f21683`.
[macOS CI run 40100489665](https://github.com/lina-system/lina-app/actions/runs/40100489665),
job `native-macos` (120891463615), artifact `launcher-evidence` (12563125875).
The capture test and both heart-ranking assertions passed. That run's overall
suite failed on non-keyboard current-event handling and a release resource test
path. The subsequent candidate fixes both; see [PR #133](https://github.com/lina-system/lina-app/pull/133)
for final validation. The release artifact inventory confirms the catalog was
packaged in `LINA.app/Contents/Resources/emoji.json`.

Each macOS CI run uploads fresh Korean, English, skin-tone and empty-search
captures under `46/` in `launcher-evidence`. These are automated rendering
checks, not physical IME, key handling, VoiceOver or fullscreen acceptance.
Physical checks are recorded in [#116](https://github.com/lina-system/lina-app/issues/116#issuecomment-6384981739).
