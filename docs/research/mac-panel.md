# macOS panel feasibility study

Research for [#89](https://github.com/lina-system/lina-app/issues/89), informing
[owner decision #2](https://github.com/lina-system/lina-app/issues/2).
**Recommendation: keep AppKit responsible for the window, shortcut and
clipboard; retain Flutter for the panel UI provisionally.** The embedded
Flutter panel became key without changing the foreground app in this run.
Shortcut-to-visible Flutter frames are now measured below. Physical Korean IME,
full-screen/Spaces, dismissal and background-global-shortcut checks remain in [#102](https://github.com/lina-system/lina-app/issues/102).
This does not close or decide #2. The evidence table and recommendation are
[posted on #2](https://github.com/lina-system/lina-app/issues/2#issuecomment-6382797958).

## Build and evidence

- Reference hardware: Apple M2 Pro, macOS 27.0.1 (26A434), arm64.
- SDK: Flutter 3.47.8 stable, Dart 3.13.7; Xcode 27.1 (27A9275), Swift 6.4.
- Both apps use release builds and an ad-hoc signature (`codesign --sign -`),
  verified with `codesign --verify --strict` (also `--deep` for Flutter).
  The Flutter re-sign explicitly preserves its App Sandbox entitlement.
  There is no Developer ID signature or notarization; this is research for an
  unsigned alpha, not a signed distribution claim.
- The screen was unlocked when the measured runs began. No lock/sleep/input
  method settings were changed, no permission was granted and no keyboard or
  clipboard data was injected into another app. The general clipboard stayed
  disabled. Every launched test app terminates at the end of its run.
- Xcode initially refused use because of its license, so the native fallback
  was built with Command Line Tools. A later license check passed without this
  task changing the license or developer-directory setting; the full Flutter
  build and XCTest checks then ran successfully. Xcode is not a remaining blocker.
- Normal background applications and development workloads were left running. Background agent/Core/LIFE
  counts and whole-machine load were not measured. These are process-local
  spike numbers, not a non-competition or production-load acceptance result.

Commands (from the repository root):

```sh
dv heavy -- node scripts/mac-panel.mjs native
dv heavy -- node scripts/mac-panel.mjs flutter
node scripts/mac-panel.mjs smoke-flutter
node scripts/mac-panel.mjs measure
node scripts/mac-panel.mjs measure-flutter
node scripts/mac-panel.mjs measure-visible-local
node scripts/mac-panel-evidence.mjs
swift test --package-path spikes/mac-panel -j 2 --filter MacPanelPlatformTests
dv heavy -- node scripts/foundation.mjs
```

Raw results are in [captures/mac-panel](captures/mac-panel/README.md). The
[PNG](../captures/LA-89/flutter-panel.png) is a **rendered Flutter widget capture**
using synthetic state, not a screen recording or physical IME proof. It is
produced by `MAC_PANEL_CAPTURE=1 flutter test --no-pub test/capture_test.dart`
from `spikes/mac-panel/`. The system font is read only for local evidence and
is not bundled. CI tests the spike layout without relying on that font. After merging #5,
the repository gate on macOS reaches three design-package Linux-reference golden
differences (about 2.3%); those references are unchanged. Linux CI validates the
canonical golden images. The spike's four widget tests pass locally.

## Evidence for each Done-when item in #2

A pass applies only to the observation named below. A missing physical test is
unverified, not a failure of Flutter and not a pass inferred from code.

| #2 item | Status | Evidence and limits |
| --- | --- | --- |
| Configurable global shortcut opens/closes while another app is frontmost | **Unverified** | Carbon registration succeeds in the signed runs; validation is tested and the UI offers two saved combinations. Physical key delivery, alternate registration, conflict handling and repeated toggling in another app need #102. |
| Non-activating panel above the active app, receiving keys; Esc/outside click; full-screen/Spaces | **Unverified** overall | **Pass** for ordinary-window ordering: ten embedded-Flutter shows made the panel key while the original external app stayed foreground, including after hiding. Actual typing, Esc/outside-click focus return, full-screen and Spaces need #102. NSPanel flags alone are not proof. |
| Korean input and no submission on composition Enter | **Unverified** | Synthetic Flutter editing-value tests pass for composing Enter, the same-frame commit guard, committed Enter exactly once and Shift+Enter/Escape routing. Physical macOS 2-Set is not emulated by those tests; see the per-criterion table below. |
| Local clipboard history skips concealed/transient items and never reaches Core | **Pass** for the spike | XCTest uses a private NSPasteboard with multiple items; a marker on any item rejects the whole copy before reading text. Five modern/legacy markers, source ignores, opt-in baseline, bounds, deduplication and clearing are covered. No Core/network/persistence API exists. Real password-manager integrations were not exercised. |
| Flutter renders token-based UI; native code owns window/shortcut/clipboard; API documented | **Pass** | Embedded release builds and the hidden first-frame/channel handshake pass. `SpikeTokens` keeps this study workload fixed; production screens use the now-landed `lina_design` package from #5. Boundary below. |
| Signed-app shortcut-to-visible latency and resident memory | **Measured** | Ten native foreground shortcut events to matching WindowServer-displayed Flutter frames: median **140.83 ms**, p90 **248.95 ms**. Signed release RSS: **117.59 MiB** in the separate idle/ordering run. Background Carbon delivery and physical key-to-photon timing are not established by this foreground measurement. |
| Record every result with recordings/logs; define native replacement for failures | **Unverified** for device recordings | This table, raw logs, measurements, ten actual captured compositor frames and the widget-rendered PNG are committed. #102 supplies real-device recordings. No physical check has established a failing Flutter component; no larger native replacement is justified yet. |

### Korean criteria, separately

| Criterion | Status | Required physical observation |
| --- | --- | --- |
| Inline marked syllable and candidate window at caret | Unverified | macOS Korean 2-Set, in the NSPanel's Flutter field |
| No dropped syllables during rapid input | Unverified | Repeated rapid `동해물과 백두산이`, compared with native text input |
| Composition Enter preserves text; committed Enter submits once | Unverified | Record marked text, commit and local submission counter; no Core is connected |
| IME-consumed keys never dismiss, submit or trigger shortcuts | Unverified | Exercise candidate selection, Enter and Escape while composing |
| Backspace, arrows and focus movement match native input | Unverified | Compare the same sequence against a synthetic native fixture |

The composer uses Flutter's existing macOS text-input bridge. It reads the
controller's composing range without modifying marked text and retains its
submission guard through the frame in which composition ends. Enter submits
only committed nonblank text, then clears the field; Shift+Enter remains a
newline. Key repeats do not submit. Autocorrect and suggestions are off. The
local counter is diagnostic only; it does not prove Core ledger exactly-once
behavior in #1. There is no custom IME bridge and no character-limit rewrite.

## Shortcut-to-visible measurement

On the reference M2 Pro Mac, the ad-hoc-signed, sandboxed Flutter 3.47.8 release
produced **10 measured native-shortcut-to-visible-frame samples: median
140.83 ms, nearest-rank p90 248.95 ms**. One warm-up was excluded. All ten
accepted frames show the complete Flutter panel and the expected alternating
marker; [the first captured frame](../captures/LA-89/shortcut-visible.png) is an
actual ScreenCaptureKit image, not a widget golden.

Command: `node scripts/mac-panel.mjs measure-visible-local`. After each
`LINA_VISIBLE_READY`, the existing CUA driver sent `ctrl+alt+space` to the
synthetic **foreground window in the same app**. That native AppKit keyDown
passes the configured physical-key/modifier matcher and the normal shortcut
callback. No timer, method-channel call or direct `show()` call starts a trial.
The separate background route continues to use Carbon `RegisterEventHotKey`.

The measured interval starts at **`NSEvent.timestamp` for the shortcut key** and
ends at **`SCStreamFrameInfo.displayTime` of the first accepted frame**, converted
from mach absolute ticks with the recorded timebase. Apple's SDK defines that
attachment as the time when the WindowServer displayed the frame. The callback
receipt timestamp supplies an independent observation upper bound. The collector
requires a complete frame, an on-screen/visible window and the expected Flutter
marker; hidden, stale, blank and wrong-marker frames cannot complete a trial.

| Trial | Native shortcut → displayed Flutter frame (ms) |
| --- | --- |
| 1 | 125.07 |
| 2 | 258.09 |
| 3 | 144.14 |
| 4 | 135.44 |
| 5 | 142.94 |
| 6 | 243.44 |
| 7 | 127.48 |
| 8 | 138.72 |
| 9 | 137.31 |
| 10 | 248.95 |

Raw native/WindowServer/receipt timestamps, frame decisions, per-frame SHA-256,
app/Dart binary hashes and the exact input route are in
[visible-latency.json](captures/mac-panel/visible-latency.json). The ten PNGs
are `visible-frame-01.png` through `visible-frame-10.png` beside it. Run
`node scripts/mac-panel-evidence.mjs` to recompute all durations/statistics and
verify hashes, raw-frame matches and input-route claims. CI also proves that
stale/hidden frames, modified hashes, ordering-only evidence, invented summaries
and a false global-route claim fail this validator.

**Scope of the result:** this is a warm foreground AppKit shortcut measurement
with an opaque, read-only synthetic panel and clipboard off. It includes input
delivery to the app, app handling, Flutter rendering and WindowServer presentation
for that condition. It is neither a programmatic ordering proxy nor physical
keyboard-to-photon latency. It does not establish background Carbon routing,
external-app focus preservation, full-screen/Spaces, cold launch or Spotlight
parity. The prior ordering numbers remain separate below. No acceptance speed
threshold is inferred from these ten samples.

The previous global Screen Recording preflight did not describe the narrower
capture capability. macOS 14.4's `SCShareableContent.currentProcess` explicitly
returns content capturable by the current process without TCC consent. The
collector filters it to its own PID/window, captures no other app, and uses an
opaque surface so no private background can enter the PNGs. No permission was
granted. A locked session was refused before collection; the successful run
occurred after the owner had unlocked it.

CUA's app-bound keyboard driver does not enter the system global-hotkey router,
so that route cannot be inferred from these samples. The collector also supports
`measure-visible` with physical global shortcut input and an external synthetic
fixture for the remaining background checks in #102. Those are separate test
conditions; the foreground visible-frame measurement above is complete in #89.

## Separate ordering and resident-memory measurements

| Release app | n | Ordering proxy median (ms) | p90 (ms) | RSS after run (MiB) |
| --- | --- | --- | --- | --- |
| Native harness | 10 | 5.97 | 13.24 | 51.16 |
| Flutter panel | 10 | 2.50 | 2.62 | 117.59 |

`PanelMeasurement` starts the monotonic timer immediately before a programmatic
`PanelHost.show`, and stops after `makeKeyAndOrderFront` and first-responder
selection. Ten samples include the first show and subsequent warm shows.
Nearest-rank p90 is reported without an inferred threshold. RSS is one
`MACH_TASK_BASIC_INFO.resident_size` sample after the eight-second run and final
hide; it includes the embedded engine for the Flutter app. It is not a median
idle-memory benchmark, a whole process-set metric or peak memory.

**These timings do not include physical key delivery, the compositor, display
scanout or a visible Flutter frame.** The runtime API also exposes an ordering
measurement starting at the Carbon event timestamp for a real shortcut, but
that path has not been timed here. The native harness has a much simpler UI,
so its lower RSS is not a feature-matched Flutter/native comparison. The
[launcher baseline](raycast-feature-map.md) has no measured absolute budget yet.

## Platform channel boundary

Channel: `org.lina.spike/mac_panel/v1`, Flutter's standard method codec, main
thread. All successful methods return the same state map; this is local
presentation state, not a Core protocol extension.

| Direction / method | Payload and result | Responsibility |
| --- | --- | --- |
| Dart → `ready` | No arguments → state | Called after the first Dart frame. Registers the saved/default shortcut. Explicit native engine start avoids a hidden-window startup deadlock. |
| Dart → `measurementReady` | No arguments → state | Benchmark-only: start own-window capture after the read-only Flutter marker frame; otherwise no effect. |
| Dart → `state` | No arguments → state | Read current state. |
| Dart → `hide` | No arguments → state | Order the panel out; never activate a previous application. |
| Dart → `configureShortcut` | `{keyCode: int, modifiers: string[]}` → state | Carbon physical key code 0–127 and distinct `command/control/option/shift`; require command, control or option. Register the replacement before releasing the previous shortcut. Persist only after success. |
| Dart → `setClipboardEnabled` | `{enabled: bool}` → state | Start/stop 500 ms polling; enabling baselines the current change count and does not import existing clipboard data. Disabling clears history. |
| Native → `stateChanged` | State map | Push changes in visibility, history or settings. No content is logged. |

State fields: `visible: bool`, `clipboardEnabled: bool`, `history: string[]`
(newest first), `shortcut: {keyCode, modifiers}`, `orderMs: double|null`,
`originalAppStayedActive: bool|null`, `captureSequence: int` (-1 outside measurement mode). Invalid/unavailable settings return
`FlutterError(code: "panel_configuration")`; unknown methods return
`FlutterMethodNotImplemented`. Dart shows a recoverable error and keeps the
previous configuration. There are no file, URL, arbitrary-command, input
injection, network or Core methods.

Native ownership:

- `LauncherPanel` is an NSPanel created with `.nonactivatingPanel`, floating
  level, `.canJoinAllSpaces` and `.fullScreenAuxiliary`. It can become key but
  never main. AppKit draws the system material; Flutter draws the contents.
- `PanelHost` positions on the pointer's screen and orders the panel without
  `NSApp.activate`. Mouse monitors exist only while open. Dismissal orders out
  without force-activating an app, so an outside click's destination is respected.
- `GlobalShortcut` uses Carbon `RegisterEventHotKey` for background delivery
  and a matching AppKit keyDown monitor while its app is active. Repeats, extra
  modifiers and unrelated Carbon IDs are rejected; duplicate timestamps toggle
  once. It does not install a
  keyboard event tap or request Accessibility/Input Monitoring. Conflicts are
  surfaced rather than silently discarding the old registration.
- `ClipboardWatcher` scans the union of item types before text is read. It
  rejects `org.nspasteboard.ConcealedType`, `TransientType`, `AutoGeneratedType`,
  `de.petermaurer.TransientPasteboardType` and `com.agilebits.onepassword`.
  Source markers for Passwords and Keychain Access are ignored. Source markers
  are optional; they cannot reliably attribute an unmarked copy to its app.
- History is at most 50 text entries of 32 KiB UTF-8 each, deduplicated and
  newest first. A change-count race drops the read. Disabling, session resignation,
  lock notification or termination clears it. It is memory-only, intentionally
  avoiding a plaintext persistence prototype. Persistent encrypted history is
  production scope, not implemented by this research app.

## Launcher and Platform adaptation recommendation

Keep the native boundary above even if Flutter is selected. macOS window
activation/Spaces policy, global shortcut registration and NSPasteboard marker
inspection are platform facilities; moving their ownership into Dart would not
remove the need for platform code. The measured ordinary-window behavior and
successful embedding support continuing with Flutter for the UI. They do not
settle Korean input, physical shortcuts or speed versus Spotlight/Raycast.

If #102 establishes a Korean input failure after an input-handler fix, replace
only the composer with an `NSTextView` hosted behind the same draft/commit API
and tokens. If full-screen/Spaces or focus behavior fails, fix the AppKit window
host first; replacing Flutter-painted list rows would not address that failure.
A larger native panel is justified only by a feature-matched measurement that
fails the agreed performance bar. No such failure is claimed here.

This is the app-repository adaptation of Core's linked Launcher and Platform
adaptation design. Core's canonical `surfaces.md` still has older Wails/React
wording; reconciliation belongs to
[lina-system/lina#1632](https://github.com/lina-system/lina/issues/1632), after the
owner's decision. This spike does not change Core schemas, TUI code or close #2.

## Remaining physical protocol

Run #102 in an owner-controlled, unlocked session using only synthetic fixtures.
Record the OS/SDK/build revision, signature verification, keyboard/input source,
current permission state and whether the fixture is ordinary/full-screen/on
another Space. Never unlock or change system security settings for the test.
If an Accessibility/Input Monitoring prompt blocks a step, record the specific
permission and stop that step until the owner handles it. Restore only test
fixtures and quit both test apps afterward.

1. Start a synthetic fixture app and invoke each configured global shortcut;
   log the active PID as a boolean comparison, not the app name or user content.
2. Type into the panel, dismiss by Esc and by a click in the fixture; prove the
   next physical key reaches the expected target. Repeat over full-screen and
   across Spaces, including the first invocation.
3. Run all five Korean rows above, including candidate-window placement and
   fast typing. Use recordings, not pasted Hangul, as IME evidence.
4. Extend the completed foreground visible-frame result to physical background
   Carbon shortcuts and matched baseline conditions, recording raw timing rows. Rerun RSS with the same workload and
   sample schedule before any production comparison.
5. Update this table and the evidence comment on #2. The owner decides whether
   the unverified checks pass and whether a named native fallback is required.
