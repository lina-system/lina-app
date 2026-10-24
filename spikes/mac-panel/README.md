# macOS panel spike

Research for [#89](https://github.com/lina-system/lina-app/issues/89) and the
owner's framework decision [#2](https://github.com/lina-system/lina-app/issues/2).
Use the repository's exact Flutter 3.47.8 pin. Requires macOS 13+ and Xcode.
This is an isolated study, not the production launcher or a distributable alpha.

From the repository root, on a shared host:

```sh
dv heavy -- node scripts/mac-panel.mjs flutter
node scripts/mac-panel.mjs smoke-flutter
node scripts/mac-panel.mjs measure-flutter
```

The build is release mode and ad-hoc signed. `smoke-flutter` checks the hidden
first-frame/platform-channel handshake and quits without showing a window.
`measure-flutter` refuses a locked or unknown screen state, shows only this
synthetic panel ten times over eight seconds, records ordering time and RSS,
and quits. It never types, enables clipboard history, or changes another app's
windows. Its timer-to-window-ordering time is **not** shortcut-to-visible latency.
The script kills its child on timeout. It does not change Xcode selection,
accept a license, request permissions, or change lock/sleep settings.

For manual tests, launch `spikes/mac-panel/build/macos/Build/Products/Release/mac_panel.app`.
The app starts hidden. Control+Option+Space toggles the panel. Its menu bar item
can open the panel and quit the study. Choose Command+Shift+Space in the panel
to test reconfiguration; registration conflicts keep the working shortcut.
Only the shortcut preference is saved. Clipboard history is off on every launch,
is text-only, and lives in memory until disabled, locked, or quit. Do not enable
history or collect recordings around personal content; use a synthetic fixture.
Submission increments a local counter and clears committed input; it sends
nothing to Core or the network.

Tests:

```sh
swift test --package-path spikes/mac-panel -j 2 --filter MacPanelPlatformTests
cd spikes/mac-panel
flutter pub get --enforce-lockfile
flutter analyze --no-pub
flutter test --no-pub test/composer_test.dart test/capture_test.dart
# Local rendered evidence; macOS system font is read, never bundled:
MAC_PANEL_CAPTURE=1 flutter test --no-pub test/capture_test.dart
```

Use `dv heavy -- node scripts/foundation.mjs` for the full repository gate.
CI runs Dart checks, native tests, the release build, signing verification, and
the hidden-engine handshake. CI does not establish physical Korean IME or Spaces
behavior. The detailed evidence and remaining manual protocol are in
[mac-panel.md](../../docs/research/mac-panel.md).

If full Xcode is unavailable, the same platform sources build with Command Line
Tools, without Flutter:

```sh
dv heavy -- node scripts/mac-panel.mjs native
node scripts/mac-panel.mjs measure
```

This builds an ad-hoc signed, synthetic native harness and runs its clipboard
smoke test against a private pasteboard. Full XCTest still needs Xcode. Do not
compare the native harness's RSS with a Flutter app as if their features match.
