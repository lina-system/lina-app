# Raycast and Spotlight baseline evidence

Research for [#52](https://github.com/lina-system/lina-app/issues/52), informing
[#7](https://github.com/lina-system/lina-app/issues/7). Recorded on 2026-10-24.

This is the app repository's baseline annex to the
[Core feature map](https://github.com/lina-system/lina/blob/2ff382b35c624f1ff7fb0bca32ed67bb8d0c5f66/docs/research/raycast-feature-map.md).
It does not duplicate the 984 feature decisions. The relevant design contract is
[Launcher](https://github.com/lina-system/lina/blob/2ff382b35c624f1ff7fb0bca32ed67bb8d0c5f66/docs/design/surfaces.md#launcher).

## The bar

**No measured baseline is available.** The reference-Mac collection remains in
[#91](https://github.com/lina-system/lina-app/issues/91), in the same milestone,
depending on #52. A missing observation is not zero and is not a pass.

| Required evidence | Spotlight | Raycast |
| --- | --- | --- |
| Warm observations per input/gap condition | 0 / 30; unverified | 0 / 30; unverified |
| Hotkey → visible panel, median / p90 (ms) | Unverified | Unverified |
| Last key → first result, median / p90 (ms) | Unverified | Unverified |
| Lost physical keys, total per condition | Unverified | Unverified |
| Process-set resident memory, median / p90 (MiB) | Unverified | Unverified |
| Cold run after login | Not run | Not run |
| Ten real-key trials cross-checked with 240 fps video | Not run | Not run |

Expand this table to the six input/gap conditions per launcher when evidence
arrives: ABC `safari` and Korean 2-Set `사파리`, each at 0, 8 and 30 ms. The full
[protocol](launcher-baseline-protocol.md) defines acquisition, evidence and
statistics. It requires 30 trials **per condition per launcher**, so language and
typing speed cannot be pooled into one misleading p90.

The upstream note's approximately 150–200 ms Spotlight open time, approximately
90 ms Raycast open time and 350–450 MB Raycast memory are third-party reports on
different or unspecified machines and methods. They remain context only; they
are not cells in the measured baseline, thresholds, or evidence for choosing a
framework. A relative claim such as “search 50% faster” supplies no absolute
first-result baseline.

## Initial preflight evidence from #52

These historical observations predate the signed Probe installation below.
They are read-only observations, not benchmark trials. No key was posted, no
screen was recorded, no permission was requested and no system setting changed.

| Check | Observation | Consequence |
| --- | --- | --- |
| Hardware | Apple M2 Pro, Mac14,12, 32 GiB RAM | Matches the reference hardware family |
| OS | macOS 27.0.1, build 26A434 | Record this exact build again at collection time |
| Swift | Apple Swift 6.4, arm64 | A native capture tool can be built; none was run |
| Displays | One display visible to AppKit | Refresh rate, scale and capture cadence remain unverified |
| Raycast lookup | `com.raycast.macos` not found by `NSWorkspace`; absent from `/Applications` | No side-by-side Raycast trials available |
| Accessibility | `AXIsProcessTrusted()` returned false | This probe is not authorized to inject the required keys |
| Screen Recording | `CGPreflightScreenCaptureAccess()` returned false | This probe cannot collect the required display evidence |
| Signing identities | `security find-identity -v -p codesigning`: 0 valid identities | No certificate-backed identity observed; a recorder's signature is unverified |
| Physical validation | No controlled fresh-login session or 240 fps phone-camera access | Cold and physical-key validation must be collected by the operator |

macOS permissions belong to the responsible executable/application. The probe's
results do not prove any future recorder is authorized. Ad-hoc signing is possible
without a certificate-backed identity; it does not grant Accessibility or Screen
Recording permission. The operator must verify the actual recorder's stable
signature and permissions before recording.

## Recommendation for #7

Keep the existing same-Mac relative gate: LINA's open and first-result median and
p90 must be no greater than Spotlight's **for every condition**, with no lost
keys. Raycast is a comparison, not a substitute for the Spotlight gate. There is
no supported absolute millisecond or memory budget yet.

Do not choose or reverse the launcher implementation based on public estimates
or these synthetic analyzer tests. Collect #91 first, then use the measured table
for the launcher checks in #2, #27 and #53. The Core design currently specifies a
native panel; this research makes no framework change and leaves the app's
Flutter pin untouched. #7 remains the owner's decision and stays open.

## Recorder and personal-login pilot attempt

The recorder now lives inside the existing
[LINA Probe app](../../scripts/benchmarks/probe/README.md), using the same bundle
ID, installed path and local signing certificate. Rebuilding with `build.sh`
preserved the designated requirement; `run.sh status` returned 0 with both
Accessibility and Screen Recording enabled at 2026-10-24T11:53:22.903Z and again
after rebuilding. The private build manifest records the binary/source hashes,
source revision, Swift 6.4, SDK 27.0 and successful strict signature verification.
No permission settings were changed.

| Current session observation | Recorded value |
| --- | --- |
| Hardware | Mac14,12, Apple M2 Pro, 32 GiB RAM |
| OS | macOS 27.0.1, build 26A434 |
| Main display | 3840 × 2160 pixels, 1920 × 1080 points, scale 2, reported 60 Hz |
| Spotlight | 1.0, build 236.0.21.401 |
| Raycast | Installed, bundle reports 2.9.0.0 (0); onboarding remains unverified |
| Active input source | ABC; Korean 2-Set is available |
| System Spotlight shortcut | Enabled, key code 49 with Command (⌘Space); unchanged |
| Foreground/session | `loginwindow`; desktop locked, no main display available to ScreenCaptureKit |
| Completed pilot trials | **0**; no latency, key-loss or RSS measurements |

This account is a personal login, not the synthetic account required for the
baseline. The initial setup attempt was retained privately with its manifest
and failure reason. Spotlight was not running, and the locked desktop exposed
no capturable main display. No shortcut or query keys were posted, no frame was
captured, and no complete trial JSON with frames/keys/RSS exists. A subsequent
explicit lock guard rejects this state before injection or capture. No attempt
was made to unlock the account. There are no crops to publish.

The recorder stores posting-call brackets and raw mach display ticks with their
timebase; full-cadence ScreenCaptureKit metadata and bounded BGRA frame writes;
post-trial Vision recognition; physical sequences; a five-second deadline; and
process-set RSS at final key + one second, with helper rediscovery and separate
shared indexing services. Its focus checks and PID-targeted query delivery are
**pilot-method deviations**, not independently validated physical-key timing.
Queue errors, cadence gaps, timeouts, unknown key loss and missing process
samples remain failures/unknowns. These implementation details and synthetic
unit tests do not establish screen-path correctness on the reference device.

No complete CSV was available. Running the existing analyzer on the header-only
CSV returns exit 2 for the missing warmup/alternating schedule. All six
conditions for each launcher remain **unverified**, with 0/30 warm observations;
there are no medians, p90 values or memory totals to report.

## Delivered and outstanding

- Delivered: signed-app recorder implementation, frozen configuration and
  private-evidence format, timing/JSON/CSV tests, macOS compile CI, environment
  manifest and an honestly retained failed setup attempt.
- Still needed before even a complete pilot: an unlocked desktop left idle for
  at least five minutes, running launchers, inspected panel/field/result regions,
  frozen expected rows and safe neutral foreground. Raycast onboarding and
  shortcut ownership must be checked through supported UI.
- Owner collection: the synthetic account and settled indexing, complete
  384-row alternating schedule across both input methods and all key gaps,
  separate fresh-login cold runs, ten physical-key trials with 240 fps phone
  video, and observer-cost/synchronization checks. Inspect crops for private
  content before publication and adjudicate physical-key loss from evidence.
- After that evidence: fill the numerical baseline and let the owner update #7.
  No comment was posted to #7 and neither #7 nor #91 is closed by this change.

## Reproducing the read-only preflight

Run on the intended account without requesting grants:

```sh
sw_vers
sysctl -n hw.model hw.memsize machdep.cpu.brand_string
xcrun swift --version
security find-identity -v -p codesigning
xcrun swift -e 'import AppKit; import ApplicationServices; import CoreGraphics; print("raycast_installed=\(NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.raycast.macos") != nil)"); print("accessibility_trusted=\(AXIsProcessTrusted())"); print("screen_recording_allowed=\(CGPreflightScreenCaptureAccess())"); print("displays=\(NSScreen.screens.count)")'
```

Keep certificate identities and account-specific output local. Publish only the
non-identifying observations needed to assess the benchmark.
