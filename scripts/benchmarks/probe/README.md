# LINA Probe

The single signed macOS app that holds the Accessibility and Screen Recording
grants for the launcher baseline in [#91](https://github.com/lina-system/lina-app/issues/91).
The [protocol](../../../docs/research/launcher-baseline-protocol.md) requires one
stable executable for those grants; recorder commands are added here instead of
in a new tool.

| Fixed | Value |
| --- | --- |
| App | `/Applications/LINA Probe.app` |
| Bundle ID | `dev.lina.probe` |
| Signature | `local` by default: `LINA Probe Local Signing`, a self-signed code-signing certificate kept in `~/Library/Application Support/LINA Probe/signing/` |

TCC records the app's designated requirement (bundle ID plus certificate), so a
rebuilt app keeps its grants as long as the same identity signs it. Do not
delete that signing folder or switch to ad-hoc signing (`LINA_PROBE_SIGN=adhoc`
is for CI build checks only): either change makes macOS treat the rebuild as a
new app that must be switched on again.

## Signing

`sign.sh APP IDENTITY` is the only place the app is signed; `build.sh` calls it.
`IDENTITY` is `local`, `adhoc`, or any keychain code-signing identity name or
SHA-1. A named identity is signed with the hardened runtime and a secure
timestamp. `build.sh` takes the identity from `LINA_PROBE_SIGN`, else the first
line of `~/Library/Application Support/LINA Probe/sign-identity`, else `local`.

To move to a Developer ID certificate once it is in the login keychain:

```sh
echo 'Developer ID Application: <Name> (<TEAMID>)' > ~/Library/Application\ Support/LINA\ Probe/sign-identity
scripts/benchmarks/probe/build.sh
```

The designated requirement changes with the certificate, so switch LINA Probe
on once more in both Privacy lists afterwards. Later rebuilds keep the grants.

```sh
scripts/benchmarks/probe/build.sh            # build, sign, install, write build.json provenance
scripts/benchmarks/probe/run.sh request      # first run: macOS adds LINA Probe to both Privacy lists
scripts/benchmarks/probe/run.sh status       # exit 0 only when both grants are on, 3 otherwise
```

`run.sh` launches the app through LaunchServices (`open -n -W`) so macOS checks
LINA Probe itself, not the terminal, ssh session or agent that started it. It
needs a logged-in GUI session; it does not unlock the screen.

The status JSON (`accessibility`, `screen_recording`, executable path, PID and
time) and `build.json` (source revision, Swift/SDK versions, executable SHA-256,
cdhash, designated requirement, `codesign --verify --strict`) belong in the
evidence manifest.

## Recorder commands

The recorder is part of the same app; **never run its executable directly**.
All evidence goes to a new UUID directory under the app's private
`captures/` application-support directory (mode 0700). Nothing is uploaded.

```sh
scripts/benchmarks/probe/run.sh status
scripts/benchmarks/probe/run.sh manifest
scripts/benchmarks/probe/run.sh snapshot                 # private, read-only setup capture
scripts/benchmarks/probe/run.sh prepare --launcher spotlight
scripts/benchmarks/probe/run.sh pilot --config /absolute/path/to/frozen-config.json
```

`manifest` records OS/build, hardware, power/load, display pixels/points/refresh,
input sources, launcher versions, shortcut settings, animation preference,
visible-window geometry, permission state and a copy of `build.json`. Builds
include hashes of the compiled sources as well as the binary. Account paths,
window owners and process paths in these files are **private evidence**.

`prepare` is an untimed Spotlight setup step. It requires an unlocked desktop,
300 seconds of HID idle time, a running but closed Spotlight panel, and the
existing system ⌘Space assignment. It opens the panel with that shortcut, saves
one private screenshot and focused-field geometry, then dismisses the panel
and restores the original front app. It does not type a query. A listen-only
event tap cancels on real input; cancellation never posts cleanup keys or
reactivates an app over the person's work. It does not wake or unlock the Mac.
Failures retain their manifest and reason in the unique attempt directory.

Before a pilot, inspect setup pixels and freeze all geometry/thresholds and the
exact expected top-row text. Run Spotlight once outside the timed region if it
is not running. Confirm the query is blank. Use the same neutral foreground
app each time. A config has these fields (the rectangles below illustrate the
**schema**, not calibrated coordinates):

```json
{
  "launcher": "spotlight",
  "layout": "abc",
  "gap_ms": 30,
  "source_rect": [600, 200, 700, 400],
  "panel_rect": [0, 0, 1400, 800],
  "field_rect": [20, 20, 1360, 80],
  "result_rect": [20, 120, 1360, 80],
  "expected_result": "Safari",
  "input_source_id": "com.apple.keylayout.ABC",
  "neutral_bundle_id": "com.apple.finder",
  "shortcut_ownership": "Operator inspected Spotlight cmd-space ownership before this block",
  "refresh_hz": 60,
  "pixel_delta": 20,
  "changed_fraction": 0.02
}
```

`source_rect` is in main-display-local, top-left **points**. The three inner
rectangles are capture-local **pixels**, after the display's scale factor.
Mask unrelated animations by keeping `panel_rect` inside the actual panel.
The query ROI must contain the Accessibility search-field rectangle; otherwise
letter delivery is refused. `pixel_delta` is the minimum RGB-channel change
(0–255); `changed_fraction` is the required fraction of panel pixels. These
values must be fixed before timing, then checked using retained boundary frames.

For Korean use `korean-2-set` and
`com.apple.inputmethod.Korean.2SetKorean`, selected outside the timed region.
The recorder verifies the actual active source and posts physical `t k v k f l`;
it never inserts Unicode, pastes, presses Return, or changes the input source.
For Raycast use `raycast`, finish onboarding and switch ⌘Space ownership through
supported settings UI before configuring the trial. The system Spotlight
assignment must be off; the manifest's operator ownership note must document
the Raycast assignment. `prepare` intentionally supports only the existing
Spotlight shortcut. A different shortcut is not a ⌘Space observation.

Each `pilot` invocation is a block and rechecks HID idle time, the unlocked
session, input source, neutral app, closed panel and shortcut ownership. After
250 ms of closed-panel capture, it posts ⌘Space and immediately attempts the
physical query, without readiness polling. Before every letter it checks that
the system's focused field belongs to the target and lies inside the frozen
query region. Letters go directly to that PID, preventing a race from typing
into another app. This conservative safety check adds measurable overhead and
may abort a trial before the panel is ready: such failures remain evidence.
The actual first-key delay, intervals and posting-call brackets are retained.
**Targeted delivery plus AX safety checks is a pilot-method deviation** requiring
physical-key validation before these measurements can establish a baseline.

Capture uses ScreenCaptureKit `minimumFrameInterval = .zero`, preserving every
callback's mach display ticks, status, content rectangle/scale and receipt
ticks. Full cadence is checked from the delivered timestamps, not inferred from
that setting. A four-buffer disk queue stores BGRA pixels without compression
or OCR on the input path; overflow, missing metadata and writer errors are
retained. Capture is limited to four million pixels and checks free disk space
against six seconds of raw frames. Hashing, Vision accurate OCR (English/Korean,
no language correction), pixel comparison and private PNG previews run only
after capture stops. Raw JSON is saved before that work, and hashes are saved
before OCR, so a recognition failure does not erase the attempt.

The observation deadline is five seconds after the final key. RSS sampling
starts at final key + one second even if no result appears. It uses
`proc_pidinfo(PROC_PIDTASKINFO)` resident bytes, with per-process sample ticks,
PID, parent PID, role and executable. Each sample rediscovers bundle executables
(including reparented helpers, using `proc_pidpath`) and recursive descendants.
Unattributed Node/WebKit processes make Raycast RSS unknown; shared OS indexing
services are listed separately. RSS is not physical footprint and can count
shared pages twice. A failed RSS read does not shorten observation.

## Annotation and verification

Keep the original JSON, raw frames and any personal pixels private. Inspect the
field, posted sequence, baseline/change frames and result region; only then add
an `annotation` object to a **copy** of the JSON:

```json
{"annotation": {"inspected": true, "lost_keys": 0, "note": "Explain the inspected field/sequence evidence"}}
```

That is an annotation example, not a measured zero. Record composition and
substitution faults separately in `composition_faults` and
`substitution_faults`; leave key loss unknown if physical-key loss cannot be
established. OCR string distance is never a key count. Publish only inspected
panel/field/result crops with no personal content; no automatic publication is
provided.

```sh
python3 scripts/benchmarks/probe_trials.py /private/bundle \
  attempt-1/trial.json attempt-2/trial.json > /private/bundle/warm-trials.csv
python3 scripts/benchmarks/launcher_baseline.py /private/bundle/warm-trials.csv
scripts/benchmarks/probe/tests/run.sh
python3 -m unittest discover -s scripts/benchmarks/tests -p 'test_*.py' -v
node --test scripts/verify/foundation.test.mjs
```

Pass paths in actual acquisition order; use `--phase warm --iteration 1` for a
measured block. The exporter preserves failure rows, requires the exact physical
sequence and posting timestamps, a closed baseline, five-second observation,
valid cadence/persistence, and three consecutive expected-row frames confirmed
again after the query. Unknown loss cannot become `ok`; missing RSS stays empty.
It conservatively invalidates gaps anywhere in the observation, including gaps
away from a timing boundary. It does not certify evidence authenticity or
manual annotations. The existing analyzer still requires the entire 384-row
schedule; a pilot or failed preflight remains **unverified**.

The Swift model tests have no screen access or grants. CI runs those tests, the
Python tests, and an isolated app compile on macOS. Only that disposable CI
bundle uses ad-hoc signing; the installed reference app keeps its identity.

## Panel shortcut stimulus

`run.sh panel-shortcut` opens a synthetic foreground window with a **Send panel
shortcut** button for the mac-panel study. Each click posts one fixed
Control+Option+Space chord through the existing authorized probe. It is not a
shell/script bridge and accepts no arbitrary keys or app targets. The chord is
`spikes/mac-panel/macos/Runner/Platform/PanelMeasurementChord.swift`: `build.sh`
compiles that file into both this probe and the panel app, so the posted chord
and the chord the panel registers in measurement mode are one definition. The
panel registers it instead of the saved preference, so a shortcut chosen in the
study UI cannot make the measurement time out. It refuses
without existing Accessibility/post-event access, while locked, if the panel
app is absent, or after ten sends. It requests no permission. The control quits
after the tenth send (or after three minutes). Use the companion
`node scripts/mac-panel.mjs measure-visible` collector; wait for each
`LINA_VISIBLE_READY` before clicking. The resulting sample must identify the
Carbon global-hotkey route, an external foreground app and a matching displayed
Flutter frame. This is a synthetic OS key stimulus, not a physical key-to-photon
measurement. Rebuild with the same signing identity to retain existing grants.
