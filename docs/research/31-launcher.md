# Production macOS launcher

The production macOS host in `packages/lina_app/macos/Runner/Launcher` owns the
non-activating NSPanel, native NSTextField, NSTableView, navigation and dismissal.
A hidden Flutter engine runs `launcherMain` from `lina_app` and draws the
answer area for ordinary queries. `define <word>` uses the native device dictionary
view in that area; see [dictionary verification](44-dictionary.md). Search providers, launcher-capability requests, mini-app content,
Korean first-key acceptance, Liquid Glass and Command-Space takeover remain in
their owning issues. The current answer area explicitly says search is not
connected and offers the native **Open LINA** action for the existing app.

## Window lifecycle

The app has accessory activation policy and `LSUIElement`, so its launcher has
no Dock or Command-Tab entry. The panel can become key but never main, uses the
floating level, `canJoinAllSpaces`, `fullScreenAuxiliary`, `transient` and
`ignoresCycle`, and disallows window tabs. Show never calls `NSApp.activate`.
It chooses the pointer's display, restores the saved position for that display
and clamps it to the visible frame. Dragging saves that display's position.
Escape, outside clicks, key loss, application switches, session resignation and
screen lock hide it. Dismissal never activates a previous app.

Control-Option-Space is the initial Carbon shortcut, using the measured #89
boundary. The foreground AppKit matcher rejects repeats and extra modifiers;
duplicate native event timestamps toggle once. A registration conflict is
shown in the native status label. Reopening the app still opens the panel.
No system shortcuts or preferences are changed. Command-comma focuses the
native Open at login setting. A programmatic Cocoa Edit menu preserves standard
cut/copy/paste/select-all and undo/redo responder-chain shortcuts for both native
and Flutter editors. Quit releases the shortcut and both engines.

The first show waits for Dart's `waitUntilFirstFrameRasterized`; an early show
request queues, a second toggle cancels it. The hidden engine starts explicitly
because a hidden view has no `viewWillAppear` to start it. The engine and view
remain alive between shows. Opening the full app is an explicit action and may
activate LINA; it uses a separate Flutter engine and the existing Core screen.

Open at login uses `SMAppService.mainApp` on macOS 13+. It is opt-in: no launch
path registers it. The checkbox reports the system's status, including pending
System Settings approval, and rolls back its presentation after errors. It is
disabled on older macOS and in all test/evidence/startup-measurement modes.
No login setting was changed for verification. Login launches stay hidden.

## Shared tokens

`design/tokens/swift-upstream.json` pins the byte-identical Swift output of Core
#1010 at the same revision as the Dart snapshot. `swift-tokens.mjs` checks that
provenance and copies it to the registered generated directory. It generates
app dimensions/type roles from the same validated `app.json` and Core snapshots
used by `lina_design`; launcher dimensions are shared DTCG extensions. Dynamic
Core colors follow light, dark and high contrast. AppKit loads the already
bundled Pretendard fonts and uses the platform fallback if unavailable.

The opaque token surface is deliberate pending #32's system material work.
No spike `SpikeTokens`, new runtime package or new palette is shipped.

## Local presentation API

Channel **`org.lina.app/launcher/v1`**, Flutter standard method codec, main
thread. This is local presentation state, not a Core protocol extension. The
answer engine has this channel and the main app's `PlatformSlots.launcher`
adapter uses a separate messenger with the same channel name.

| Direction / method | Arguments | Result / behavior |
| --- | --- | --- |
| Answer Dart → `ready` | none | Called after the first rasterized frame; enables showing and registers the shortcut once; returns state |
| Dart → `state` | none | Current state; answer engine only |
| Dart → `show` | none | Queue until ready, then key/order panel and focus native input; state on answer engine, null on main engine |
| Dart → `hide` | none | Cancel a pending show and order out; state on answer engine, null on main engine |
| Swift → `queryChanged` | `{query: String}` | Native committed/draft presentation update; never logged or sent to Core |
| Swift → `submit` | `{query: String, resultID: String?}` | Native Return/row activation; currently displays an unavailable message, never executes an action |
| Swift → `stateChanged` | state | Visibility/readiness notification |

State: `{ready: Bool, visible: Bool, loginItem: String, shortcut: String,
error: String?, activationPolicy: Int, uiElement: Bool}`. Login status is `enabled`, `requiresApproval`, `notRegistered`,
`notFound`, `unsupported`, `unknown` or `disabledInTests`. Unknown methods return
`FlutterMethodNotImplemented`. No network, file, URL, arbitrary command, input
injection, login mutation or Core method is exposed over the channel. Login
changes require the native checkbox action. The result list accepts native
`LauncherResult` display models. The [local calculator](40-calculator.md) fills it
for arithmetic and copied-result history; the [device dictionary](44-dictionary.md)
supplies a definition and opens Dictionary.app. Both providers consume their own
queries and result actions without emitting `queryChanged` or `submit`. Ordinary
drafts retain the channel behavior above; search providers remain separate work.

## Verification and limits

- Red: a normal titled panel failed nine XCTest assertions before the fix.
- Native XCTest covers flags/level/collection behavior, pending readiness,
  position clamping, native arrows/Return/Escape, marked-text deferral, shortcut
  filtering and login registration refusal in tests.
- Flutter tests cover the platform-slot adapter, answer-only widget ownership
  and the explicit unavailable response. No result action or agent call is faked.
- Node regressions reject changed, missing and extra Swift output, tampered
  provenance and app-token drift. Foundation runs them and checks all generation.
- The release first-frame smoke passed on the reference Mac. The console was
  locked during the first external-fixture attempt, which failed closed before
  launching it. Probe Accessibility and Screen Recording grants were present;
  Safari fullscreen acceptance is not inferred from them.
- The macOS native CI job passed on PR head `502cae9`: nine native XCTests,
  hidden readiness and external-fixture focus verification. The fixture stayed
  active with unchanged PID through show, typing `abc` and Escape, and recorded
  no deactivation notification. The full panel [capture](../captures/31/launcher.png),
  [raw observations](../captures/31/focus.json) and [provenance](../captures/31/ci-provenance.json)
  are committed. This is macOS 26.6.2 CI evidence, separate from physical
  Safari/Spaces acceptance and the locked local macOS 27 session.

Reproduce with one heavy slot at a time:

```sh
swift test --package-path packages/lina_app/macos -j 2 --filter LinaLauncherTests
dv heavy -- node scripts/foundation.mjs
dv heavy -- node scripts/build.mjs macos
node scripts/launcher.mjs smoke
node scripts/launcher.mjs evidence
```

The remaining physical acceptance is tracked in [#116](https://github.com/lina-system/lina-app/issues/116),
which shares #31's milestone and depends on #31. It contains exactly the Safari
fullscreen, pointer-display, typing, Escape/outside-click recording and active-app
log check. The unlocked session was unavailable; no physical pass is claimed.

## Open question

#2 remains the owner's Flutter-versus-native decision. This implementation
follows #31's fixed split and the measured embedding boundary in #89. Replacing
the answer renderer with a native view leaves window, input, list and key
ownership intact; nothing here forecloses a fully native panel.

The first macOS CI run kept the external fixture PID unchanged through show,
`abc` and Escape, but reported `NSApp.isActive == true` while the key panel was
visible. This process-local AppKit flag is retained as a diagnostic; it is not
the foreground-app assertion. The verifier requires the fixture's own active
state at each sample and no `didResignActive` notification from the independent
fixture, in addition to unchanged foreground PID, typed text and dismissal.
