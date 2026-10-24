# App foundation verification

Run `node scripts/foundation.mjs` from a checkout with Flutter 3.47.8 stable
and Node 24.20.0 on PATH. CI runs the same command. On shared development
hosts use `dv heavy -- node scripts/foundation.mjs` for this full gate.
There are no credentials, Core service, signing keys or device accounts needed.

On Windows the standard Flutter SDK ships `flutter.bat` and `dart.bat`. Node
refuses to spawn a batch file without a shell, so the subprocess runner resolves
the command through `PATH` and `PATHEXT` and runs a batch launcher through
`cmd.exe /d /s /c` with each argument quoted and `%`/`"` caret-escaped; resolved
executables such as `git` keep their direct spawn. CI does not run this gate on
Windows, so only the command construction is covered by tests.

## Layout and registration

| Component | Path | Current state |
| --- | --- | --- |
| LINA app | `packages/lina_app/` | Active native Flutter thin client |
| Protocol package | `packages/lina_protocol/` | Active generated codec, conformance and socket tests |
| Design package | `packages/lina_design/` | Active generated tokens, themes, widgets, fonts and goldens |
| Foundation tooling | `packages/foundation_tools/` | Active Dart policy validator and tests; never shipped |
| Policy | `docs/policy/` | Foundation and dependency contracts |
| Gate | `scripts/foundation.mjs`, `scripts/verify/` | Node orchestration, path map and codegen registrations |
| Release | `release/manifest.json`, `scripts/build.mjs` | SDK pin and native-only build entry point; no artifacts yet |

`scripts/verify/scope.mjs` is the executable registry. Unknown paths fail,
including unknown packages and executable files hidden under documentation.
The gate checks the entire tracked tree, untracked nonignored files and paths
removed or renamed since HEAD. An unregistered app or design path fails in the
regression test before its registry entry is supplied. A nested pubspec also
needs its own registration: a directory prefix is not package registration.

The launcher benchmark analyzer and the accent design study have dedicated
`launcher-baseline` and `design-study` CI jobs. Their executable entry points
and tests are registered explicitly in the scope map; study assets are limited
to the `90-accent` data, font and SVG paths. These registrations do not admit
arbitrary scripts under research documentation. Benchmark CI validates synthetic
annotations only, not reference-Mac measurements.

To activate a component, add its `pubspec.yaml`, committed `pubspec.lock`,
`lib/` and behavioral `test/*_test.dart` files at its registered root. The app
uses `lina_design: {path: ../lina_design}`. The same change activates any checks
that guard its sources. Until then reserved components have no invented
analysis/test pass: evidence lists only packages with actual manifests.

Native runners compile the same app for five platforms. They do not decide
whether Flutter passes the physical-device gates in #1 and #2.

## Stages and failure behavior

The full gate always runs; there is no changed-path optimization yet.

1. Classify paths and validate the exact stable SDK against `.flutter-version`
   and `release/manifest.json`. Record the observed Flutter, Dart and Node versions.
2. Discover every Dart package. Missing or untracked manifests/lockfiles,
   missing tests, symlink package paths and `pubspec_overrides.yaml` fail.
3. Run `flutter pub get --enforce-lockfile` for every package. Compare lockfile
   bytes before and after each install and again at gate completion. An install
   that rewrites a lockfile fails even if its exit status is zero.
4. Run the Dart [dependency policy](dependencies.md) validator from its own
   locked package. YAML is parsed with `yaml` 3.1.3, not a partial regex parser.
5. Run registered generation and visual-value checks in the Flutter stage.
6. Run `flutter analyze --no-pub` and `flutter test --no-pub` in every package.
   Analysis includes the additional widget visual-value lint owned by #5 in
   stage 5; ordinary analyzer success alone does not establish that rule.
7. Check Git whitespace and run the Node behavioral tests for orchestration.

Every subprocess has a ten-minute deadline. A missing tool, timeout, signal,
nonzero exit, malformed configuration or missing required result fails the gate.
The gate stops dependent work after a failure; it never substitutes a passing
result for work it did not run. Lock enforcement cannot install a new dependency;
use the deliberate update procedure instead.

## Generated sources and lint

`scripts/verify/generators.json` always registers these three checks:

| ID | Owner | Required behavior when activated |
| --- | --- | --- |
| `theme` | #5 | Regenerate ThemeExtension and DESIGN.md token tables; fail on any difference; verify contrast |
| `visual-values` | #5 | Reject hardcoded widget visual values across app and design sources |
| `protocol` | #6 | Regenerate Dart types from the canonical JSON Schema; fail on any difference and round-trip conformance fixtures |

The theme and visual-value checks are active. Theme verification also checks
reviewed font/license asset digests; the generated table includes contrast and
Unicode/ASCII icon mappings. Node regression tests cover drift, bad contrast,
source corruption and hardcoded visuals. The protocol check is active: it verifies the pinned Core snapshot and generated
Dart types. Its package runs exact-number conformance and socket fault tests. Their guarded paths must be empty while deferred; adding generated output
or widgets without activating the corresponding check fails. Removing a required
registration fails. A deferred result is not codegen or accessibility evidence.
TUI Lip Gloss generation and the canonical schema belong to Core, not this repo.

An active entry has `status: "active"`, an owner, a nonempty `outputs` list,
a `generator` with `name`, exact semantic `version` and SHA-256 of its checked-in
entry script, and a `command` array. Commands use `node path/to/script.mjs` or
`dart run path/to/script.dart` from the repository root, without a shell.
Third-party generator libraries also require exact manifest pins and lockfiles.
Changing the script updates its digest deliberately. Nothing downloads a tool
at an implicit latest version.

A check must regenerate in a temporary directory and compare **all** files,
including additions and deletions, or regenerate in place so the gate's before/
after snapshot detects changes. A nonwriting `--check` command is responsible
for detecting stale committed output itself; the gate propagates its failure.
The gate also rejects any mutation of declared output files/directories, including
new files. Paths must stay in the repository and contain no symlink. For lint,
`outputs` names the inspected source roots, which must remain unchanged.
Owners add their drift and lint fixtures when activating the registrations.
Generated files are never hand-edited.

## Evidence

`build/foundation-evidence.json` is written on pass and failure and uploaded by
CI even when a stage fails. It contains HEAD, dirty-checkout status, start/end
times, actual tool versions, selected components, commands, output, elapsed
milliseconds, explicit deferred checks and the failure reason. It is ignored
by Git. A local dirty run proves only that working tree; CI verifies the candidate
commit. This is neither a signed release manifest nor physical-device evidence.
CI keeps the existing required `flutter` job name.

## Native build and device matrix

All artifacts use `node scripts/build.mjs <platform>`, including the full gate.
Supported targets are macos, ios, ios-simulator, android, windows and linux; there
is no web build. iOS device code is a release build without signing; the simulator
uses debug mode. Android uses Flutter's development debug key. macOS receives
an ad-hoc signature, which is verified after notice packaging. No target is
published, notarized or given a store distribution signature by this command.

`build/artifacts/<target>.json` records source revision/dirty status, SDK,
file inventory, exact byte size, tree digest, engine-notice digest and signing
provenance. CI uploads these records alongside its foundation evidence. Native
outputs retain the generated license registry and full engine notices. Local
observations and the physical acceptance limits are in
[the native app record](../research/6-native-app.md).

CI compiles Linux, Android, Windows, macOS, iOS device and iOS simulator targets.
Compilation does not establish device input, startup, memory, signing acceptance
or the platform's Core compatibility row. The existing Linux design goldens
remain unchanged; macOS has reviewed CoreText baselines in `docs/captures/6/`.
Other hosts run layout/semantics tests without a pixel-baseline claim.

## Design-source discrepancy

The linked Core `surfaces.md` and `host-protocol.md` currently describe React,
TypeScript and Wails, whereas app issues #3/#5/#6 and the committed SDK pin require
Flutter/Dart. This repository follows its explicit issue scope. The owner must
reconcile Core's framework wording; this gate does not rewrite canonical design
or protocol schemas. Thin-client, generated-source and permissive-license rules
are retained from the Core policies.
The Core reconciliation is tracked in
[lina-system/lina#1632](https://github.com/lina-system/lina/issues/1632).
