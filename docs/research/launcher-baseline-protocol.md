# Reference Mac launcher measurement protocol

For [#52](https://github.com/lina-system/lina-app/issues/52); remaining execution
is tracked by [#91](https://github.com/lina-system/lina-app/issues/91). This
operationalizes the [pinned Core method](https://github.com/lina-system/lina/blob/2ff382b35c624f1ff7fb0bca32ed67bb8d0c5f66/docs/research/raycast-feature-map.md#the-bar).
The [LINA Probe recorder](../../scripts/benchmarks/probe/README.md) implements a
conservative personal-login pilot path. Its targeted key delivery and focus
checks require separate physical validation; they do not establish this exact
baseline method. The Python analyzer does not post keys, capture screens or run OCR.

## Prepare the reference session

1. Use the M2 Pro reference Mac, connected to power, with a synthetic test account
   and no personal search results, conversations or notifications. Record model,
   RAM, macOS version/build, Spotlight and Raycast versions, display resolution,
   scaling, refresh rate, power mode and accessibility animation settings. Wait
   for indexing to settle; document background load without terminating the
   person's processes. Record Spotlight and Raycast settings that affect search.
2. Prepare a small Swift recorder using public Accessibility, CoreGraphics,
   ScreenCaptureKit and Vision APIs. Record its source revision, build command,
   SDK/Swift versions, SHA-256 and `codesign --verify --strict` result. Keep one
   stable signed executable for TCC grants; do not treat a separately authorized
   shell or probe as permission for the recorder. That executable is
   [LINA Probe](../../scripts/benchmarks/probe/README.md): add recorder commands
   to `scripts/benchmarks/probe/` and rebuild with its `build.sh`, which keeps the
   path, bundle ID `dev.lina.probe` and certificate-based signature fixed so the
   grants survive rebuilds. Run it only through `run.sh`; do not wrap the
   recorder in another app, sign it ad hoc, or execute its binary from a shell.
3. The operator enables Accessibility and Screen Recording for LINA Probe.
   `scripts/benchmarks/probe/run.sh status` must exit 0 before any injection;
   fail without it. Capture only the
   synthetic account. Do not disable SIP, edit TCC databases or silently remap
   system shortcuts. Never use paste or Unicode insertion to simulate Korean
   typing: it bypasses the input method being measured.
4. Test `safari` with ABC and `사파리` with Korean 2-Set. Physical letter-key
   sequences are `s a f a r i` and `t k v k f l`, respectively. Record hardware key
   codes, down/up timestamps and the active input source; do not infer it from
   the output text. Freeze the exact expected top row for each launcher/layout
   in the manifest after inspecting the installed version. Use synthetic data
   with Safari installed and selected as the expected app result.
5. Both launchers use the method's ⌘Space. Only the target owns it during a trial.
   Between alternating trials, the operator changes ownership through supported
   settings UI, outside the timed region, and restores the same neutral front
   app. Log the ownership check and setup delay. Do not measure app activation,
   a deep link or a different hotkey and label it a ⌘Space sample. If maintaining
   the same shortcut is impractical, document the deviation for the owner;
   it is not evidence for this exact protocol until accepted.

## Acquisition and timing

Use one monotonic host clock for event posting and frame display times. Store
raw ticks, timebase numerator/denominator and the conversion to nanoseconds.
ScreenCaptureKit's `SCStreamFrameInfo.displayTime` must be converted from its
mach timebase, not treated as milliseconds or compared with wall-clock time.
Save the posting instant at the call that posts each key-down; do not substitute
an application handler's later receipt time.

Configure `minimumFrameInterval = .zero` and keep the display timestamps, frame
status, content rectangle and scale of every delivered frame. Setting zero alone
does not prove full-refresh capture. Record actual cadence, dropped frames,
queue overflow and writer errors. Start the capture before the shortcut, including
closed-panel baseline frames. Keep compression/OCR off the input-posting path;
perform recognition from the stored frames after the trial. Check observer cost
in the phone validation. A timing-boundary capture gap makes that observation
`capture_invalid`, not an unusually fast result.

Save the configured panel, query-field and top-result rectangles, including their
coordinate system and conversion to display pixels. Mask unrelated animated
pixels. Freeze pixel-change thresholds and OCR settings before timed trials.
Publish enough cropped frames to check the thresholds. Never select a threshold
after seeing the timings to improve the result.

For each trial:

1. Verify the target, shortcut ownership, blank query and same neutral front app.
   Both launchers remain running for warm trials. Start capture while the panel
   is closed. Post ⌘Space, release modifiers and begin the query immediately.
   Log the actual hotkey-to-first-key delay; do not wait for panel readiness.
2. Post the six physical letter keys with requested gaps of 0, 8 or 30 ms between
   key-downs. Zero means no intentional delay, not a claim of simultaneous
   delivery. Record actual intervals and scheduling jitter. Do not send Return
   to commit the final Korean syllable or launch Safari during the timed region.
3. **Open time:** the first frame whose panel region changes from the closed
   baseline, minus the hotkey-down posting time. Inspect it to exclude a cursor,
   unrelated animation or another panel. Save the baseline, previous and first
   changed frames and their display timestamps.
4. **First result:** the first of three consecutive display frames in which OCR
   reads the frozen expected top row, minus the last letter-key-down time. This
   includes an unchanged display frame only when frame-status metadata proves
   the previous pixels persisted. A missing frame is not proof of persistence.
   Match the result region, not a query suggestion or query-field echo. Save
   the three frame references, recognized strings and confidence. If the row
   is already present at the last key, report 0 ms and retain the earlier
   timestamps/frames; a stable pre-existing answer must not create a negative
   latency. Verify that the result still matches after the completed query.
5. **Lost keys:** compare the query field (including marked Korean text) with
   the posted sequence. Preserve the synthetic observed text and field frames.
   Annotate lost physical keys from those records; do not count Hangul syllables
   as keys or treat edit distance as ground truth. Log composition/substitution
   faults separately in trial JSON. If a count cannot be established, leave it
   unknown; never coerce it to zero. Result readiness does not prove that all
   query keys arrived.
6. Sample the launcher process set's RSS one second after the last key, with the
   panel still open, independently of whether search succeeded. Store sampling
   times, PID role, parent PID and resident bytes per process. Rediscover helpers
   each trial, including reparented Raycast web-content/Node helpers; do not rely
   only on the main PID or direct children. List shared OS indexing services
   separately instead of assigning their entire cost to Spotlight. A missing
   required process sample leaves the aggregate unknown.
7. Allow a fixed five-second observation deadline after the last key; retain the
   full attempt if it expires. Record `open_timeout` or `result_timeout`, clear
   the query, close the panel, and restore the neutral foreground state outside
   the timer. Keep the setup and cooldown consistent and logged. Do not replace
   a failed trial with a success under the same iteration number.

RSS is summed resident memory, in bytes, and can double-count shared pages. It
is not `phys_footprint`, compressed memory or Activity Monitor's “Memory” column.
Report process attribution and sample timing with the numbers. If physical
footprint is collected too, publish it separately with its API and permissions.

## Schedule and independent validation

For each of the six `(layout, gap_ms)` conditions, collect in this order:

- Two warmup pairs: Spotlight then Raycast, iterations 1 and 2.
- Thirty measured warm pairs: Spotlight then Raycast, iterations 1 through 30.

That is 384 rows: 24 warmups and 360 measured observations, 180 per launcher.
The issue's “30 per launcher” is interpreted per condition so the p90 is based
on 30 observations without mixing input methods or typing rates. Preserve actual
acquisition order; sorting afterward cannot repair a non-alternating session.
Keep incomplete sessions as evidence. If a collection is invalid, perform and
identify a new complete session rather than editing the old one into a pass.

Collect one **cold** trial per launcher as the first invocation after a separate
fresh login, with ABC and a 30 ms gap. Record startup/login-item behavior and
time since login; do not call quitting/relaunching an app a cold login run.
Cold trials are individual values in an appendix, not part of the warm median
or p90. No logout or reboot of an active personal session is needed for the
preparatory work in #52.

Validate ten additional trials with **real physical keys** filmed at 240 fps,
five per launcher, covering both layouts and all three gap conditions across
the set. Record actual human key intervals; do not pretend a human produced an
exact 0 ms gap. Retain synchronized screen/keyboard evidence, annotate key-down
and panel/result frames, and compare posted-key and real-key measurements under
the observed timing conditions. A 240 fps frame spans approximately 4.17 ms;
also report display-frame quantization and synchronization uncertainty. State
any disagreement or observer effect. These ten trials do not replace the 30
automated trials or enter their distributions.

## Evidence bundle and annotation CSV

Keep one bundle with:

- A session manifest containing the setup above, capture-tool provenance,
  preflight results, clock mapping, actual display cadence, thresholds, OCR
  configuration, shortcut ownership and process attribution rules.
- One JSON record per attempt, with unique relative path, condition, acquisition
  order, raw key timestamps, frame metadata/references, expected/observed field
  text, expected/recognized result, loss adjudication, timeout/capture faults
  and per-process RSS samples. Include hashes of all referenced capture files.
- The original recording/frame evidence and enough cropped PNGs to check the
  panel/result/field boundaries. Store crops under `docs/captures/52/` when
  publishing; use commit-pinned raw links in the PR. Inspect for private content
  before publishing. Retain raw evidence privately if it cannot be sanitized
  without changing the measured region; explain that limitation.
- `warm-trials.csv`, derived from those records in acquisition order, plus the
  cold-run and phone-video appendices. Do not submit a synthetic fixture as a
  capture or annotate invented numeric values.

The [CSV template](launcher-baseline-template.csv) contains only the header.
It is deliberately incomplete and the analyzer rejects it until real annotations
exist. Columns are:

| Column | Meaning |
| --- | --- |
| `launcher` | `spotlight` or `raycast` |
| `layout` | `abc` or `korean-2-set` |
| `gap_ms` | Requested physical key-down gap: `0`, `8` or `30` |
| `phase` | `warmup` or `warm`; keep cold/phone trials separately |
| `iteration` | Per-condition pair number, restarting at 1 for each phase |
| `status` | `ok`, `open_timeout`, `result_timeout` or `capture_invalid` |
| `open_ms` | Nonnegative frame-derived milliseconds, or empty if unobserved |
| `first_result_ms` | Nonnegative frame-derived milliseconds, or empty if unobserved |
| `lost_keys` | Nonnegative integer of established lost physical keys; empty if unknown |
| `rss_bytes` | Positive sum of the complete attributed process set; empty if unknown |
| `evidence` | Unique relative path to that trial's JSON; never an account path or URL |

`ok` requires both timings and a verified key count; a positive lost-key count
is a valid measurement of loss. Memory may still be unknown. `result_timeout`
keeps open time but no result time; `open_timeout` and `capture_invalid` have no
timing values. Unknown and failed observations remain in their 30-trial group.

From the repository root:

```sh
python3 scripts/benchmarks/launcher_baseline.py /path/to/bundle/warm-trials.csv > /path/to/bundle/summary.md
python3 -m unittest discover -s scripts/benchmarks/tests -p 'test_launcher_baseline.py' -v
```

The standard-library analyzer checks the exact six-condition schedule, distinct
evidence references, warmups, alternation, finite values and status consistency.
It reports median and nearest-rank p90 (the 27th sorted observation of 30), total
lost keys and median/p90 RSS in MiB. Warmups are excluded. If any timing, memory
or key observation is missing, that aggregate is **unverified**, not a
percentile over only the survivors. It exits 2 on invalid or incomplete
annotations and 0 on complete annotations. Failure counts remain visible.

An exit of 0 proves annotation shape and arithmetic only. The script does not
open evidence files or validate captures, signatures, OCR, lost-key adjudication,
memory attribution, cold trials or phone video. The reviewer must trace the
annotated numbers back to those artifacts before replacing the baseline table.
CI runs only synthetic analysis tests, never a Mac benchmark.

## Decision handoff

Insert all twelve per-condition summary rows into the feature map, along with
the cold values, physical-validation findings, environment and limitations.
Compare LINA with Spotlight on the same Mac/configuration for both latency
percentiles in every condition, and require zero LINA key loss. Report Raycast
alongside it. No absolute memory budget is inferred before those observations.
Post the measured evidence and recommendation to #7; the owner closes #7.
