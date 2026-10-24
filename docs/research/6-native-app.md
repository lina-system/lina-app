# Native app skeleton verification

Observed on macOS 27, Apple M2 Pro, Xcode 27.1, with Flutter **3.47.8 stable**
and Dart 3.13.7. The SDK pin was not changed. All data in the captured screens
and protocol tests is synthetic.

## Local evidence

| Check | Observed result |
| --- | --- |
| Foundation gate | Passed: dependency locks/licenses, snapshot/codegen drift, visual lint, four package analyzers/tests and Node regressions |
| Protocol corpus | 201 positive envelopes round-trip without numeric loss; 44 client/server receive cases match outputs/errors/counters |
| Native transport | Unix and TCP socket tests pass: handshake validation, rejection, timeout, oversized frames, drop, pending effect uncertainty, no resend, preview until Core's saved card |
| Composition | Headless Korean composition/commit and send-action test passes; one complete input request, draft retained until Core receipt |
| Appearance | System signals and desktop fallbacks tested; narrow/large-text layout has no overflow |
| macOS release | Built; ad-hoc signed; `codesign --verify --deep --strict` passes for build and installed copy |
| iOS device release | Compiled with `--no-codesign`; no device run or provisioning claim |
| iOS simulator | Debug simulator build passed; no simulator launch claim |
| Linux, Windows, Android | Not buildable locally with the available host toolchains; dedicated native CI jobs own these builds |
| Real Core | Go binary built at the pinned revision; runtime refused macOS with `Core requires a Linux state root`. No real-Core connection pass is claimed |
| Installed Mac GUI, startup, RSS, physical IME | Unverified: console session was locked. No app was launched, and no login/lock/sleep setting was changed |

macOS bundle content is **47,505,506 bytes** including the complete engine notices.
The installed copy occupies **46,476 KiB**; actual disk
allocation is distinct from the content-byte inventory. Startup and resident
memory are **unverified**, not zero. No release artifact has been published.

The artifact records include a source revision and dirty-tree flag. Each local
artifact names the implementation commit it built; CI rebuilds every native
target at the final PR head. The
source-controlled release manifest retains their sizes, hashes and signing
provenance. `build/artifacts/<target>.json` includes the full file inventory.

## Reproduce

Use one heavy slot at a time on a shared development host:

```sh
dv heavy -- node scripts/foundation.mjs
dv heavy -- node scripts/build.mjs macos
dv heavy -- node scripts/build.mjs ios
dv heavy -- node scripts/build.mjs ios-simulator
dv heavy -- node scripts/verify/mac-smoke.mjs
```

The Mac smoke script copies the built application into a fresh isolated install
directory, verifies its signature and runs `du -sk` for allocated size. When the
console is unlocked it performs three direct executable launches without a dev
server. It measures process-spawn to Flutter's first rasterized-frame signal,
then runs `ps -o rss= -p <app-pid>` three seconds later. It terminates and joins
each launched process. When locked, it records an explicit unverified reason and
launches nothing. Results go to `build/mac-install.json`.

A synthetic socket peer is available independently:

```sh
cd packages/lina_protocol
dart run bin/fixture_peer.dart
```

Use the printed loopback address in the app. The one-connection fixture peer
sends a welcome, preview card, saved card and unknown outcome. It grants no
conversation capability and refuses mutations. It closes on client disconnect;
it has no canonical store and executes no effects. Tests construct both Unix
and TCP peers from the same vendored corpus. This proves client handling, not
Core authentication or durable application-service outcomes.

On a Core-supported Linux host, the optional isolated Core smoke is:

```sh
cd packages/lina_protocol
dart run bin/core_smoke.dart /absolute/path/to/lina
```

It first tests the actual compiled compatibility table's refusal, then an
explicit development-only app row, using fresh synthetic state and cleaning up
its child processes. A development manifest is never a release acceptance row.

## Captures and remaining acceptance

`docs/captures/6/` contains Flutter-rendered disconnected, connected, rejected and
mobile/large-text screens, plus separate macOS design-package goldens. The
existing Linux design goldens are retained. No desktop screen-capture permission
was requested. Refresh the app captures with:

```sh
cd packages/lina_app
LINA_UPDATE_CAPTURES=1 flutter test --no-pub --update-goldens test/core_screen_test.dart
```

The screenshot flag opts into raster comparison; ordinary CI still asserts
layout, semantics and state behavior on every platform. The separate platform
font baselines avoid treating CoreText/FreeType differences as app regressions.

[App #107](https://github.com/lina-system/lina-app/issues/107) contains exactly the
remaining owner/physical-device work: installed unlocked-Mac launch, startup/RSS
and no-web-behavior checks, real Korean IMEs on all five platforms, and the
composer/launcher decisions in #1/#2. It shares #6's milestone. The Core contract
and compatibility-table documentation is tracked in
[Core #1662](https://github.com/lina-system/lina/issues/1662).
