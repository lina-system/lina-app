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
node scripts/mac-panel.mjs permissions # read-only; never requests a grant
node scripts/mac-panel.mjs measure
```

This builds an ad-hoc signed, synthetic native harness and runs its clipboard
smoke test against a private pasteboard. Full XCTest still needs Xcode. Do not
compare the native harness's RSS with a Flutter app as if their features match.

## Shortcut-to-visible frame collection

The primary committed run uses the registered Carbon global-hotkey route on the actual Mac:

```sh
dv heavy -- node scripts/mac-panel.mjs flutter
node scripts/mac-panel.mjs measure-visible
scripts/benchmarks/probe/run.sh panel-shortcut
# On each LINA_VISIBLE_READY: click Send panel shortcut in the probe.
# Its existing Accessibility grant supplies one fixed global HID key chord.
node scripts/mac-panel-evidence.mjs
node --test spikes/mac-panel/visible-evidence.test.mjs
```

The same configured shortcut has two native routes: AppKit keyDown while the
app is active and Carbon RegisterEventHotKey in the background. Every sample
records its route. The primary result requires the Carbon route and an external foreground app.
The separately preserved foreground run does not claim global-key delivery.
To collect the separate background condition, start `node scripts/mac-panel.mjs
fixture` and `node scripts/mac-panel.mjs measure-visible`, then use physical
Control+Option+Space presses while the external fixture is frontmost. CUA's
app-bound key driver bypasses macOS global-hotkey routing and cannot test that
condition. Neither collector synthesizes a key or calls its handler directly. The stable
probe is the separate, already-authorized stimulus driver; rebuild it with
`dv heavy -- scripts/benchmarks/probe/build.sh` and retain its signing identity.
The alternate `measure-visible-local` mode uses a same-process synthetic
foreground fixture and AppKit keyDown events; its samples are labeled separately.

On macOS 14.4+, the recorder captures only its own panel via
`SCShareableContent.currentProcess`, which does not need a global TCC grant.
No other app/display is captured. Both entry points refuse a locked/unknown
session; a lock notification cancels collection. Never unlock or change sleep,
login-session or permission settings as part of a test.

After `LINA_VISIBLE_READY`, send one chord per ready event, ten times. The
panel hides between trials; after ten samples the app and its internal fixture
quit. The external fixture has a three-minute deadline and should be quit when
no longer needed. Timeouts write no passing measurement.

The benchmark uses an opaque synthetic panel with a read-only field and
clipboard disabled. A four-color Flutter marker alternates per invocation.
Only a complete frame with the expected marker, a visible/on-screen window and
a post-shortcut `SCStreamFrameInfo.displayTime` can finish a trial. That
WindowServer timestamp is the displayed-frame endpoint, not `orderFront`
completion. The native event's timestamp is the start. Callback receipt is also
recorded as an observation upper bound. One warm-up frame is excluded.

The helper saves `visible-latency.json`, ten accepted PNGs/hashes, raw frame
decisions, executable/Dart hashes and statistics to
`docs/research/captures/mac-panel/`. It copies the first PNG to
`docs/captures/LA-89/shortcut-visible.png`. The evidence validator rejects an
attempt to label local-key samples as measured background-global delivery.
