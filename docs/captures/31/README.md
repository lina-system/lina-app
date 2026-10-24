# Launcher evidence

All content is synthetic. `launcher.png` and `focus.json` are produced together
by `node scripts/launcher.mjs evidence`, from a signed release with a separate
fixture application. The image captures only the launcher's opaque window via
ScreenCaptureKit's own-process API. It cannot include another app's pixels.

The fixture records the frontmost PID before show, after show, after sending
`abc` through the panel's AppKit event dispatch, and after Escape. The verifier
requires the fixture's PID and active state at every step, zero fixture
deactivation notifications, the key
panel, the typed text and dismissal. This is automated AppKit input evidence,
not physical keyboard, Korean IME, Safari fullscreen, Space switching or a
multi-display hardware test.

`node scripts/launcher.mjs smoke` separately checks a hidden, rasterized Flutter
first frame and the versioned method-channel readiness handshake. Both modes
force login registration off. The external fixture and launcher are terminated
and joined even if a measurement fails.

Local GUI collection was initially refused because the console was locked.
Existing Probe grants alone do not prove fullscreen acceptance. See
[the launcher record](../../research/31-launcher.md) for observed results and
remaining physical acceptance.

`answer-area.png` is a headless Flutter widget render of only the embedded reply
area, generated with `LINA_UPDATE_CAPTURES=1 flutter test --no-pub --update-goldens
test/launcher_test.dart`. It is not a desktop or panel-focus capture.

## Committed run

The full panel image and `focus.json` were collected by the production macOS job
in [run 40091876622](https://github.com/lina-system/lina-app/actions/runs/40091876622)
on macOS 26.6.2, testing PR head `502cae9` through its GitHub merge checkout.
All nine native tests, hidden first-frame smoke and external-fixture verification
passed. The fixture stayed active with PID 11378 at every phase and recorded no
deactivation notification. `abc` reached the native field; Escape hid the panel.
The full-panel PNG was visually inspected after download.

`ci-provenance.json` records the run, exact source revisions, clean build snapshot,
SDK, artifact/tree digests and image/log hashes. `focus.json` retains its raw
`dirty: true`: collection wrote a new PNG before checking Git status. The build
and foundation records before capture report clean source. These CI observations
do not replace the explicitly unverified physical check in #116.
