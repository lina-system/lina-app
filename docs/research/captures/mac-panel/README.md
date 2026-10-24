# Evidence index

All content is synthetic. Absolute local paths in logs are normalized to
`<repo>`/`<user>`. The original widget-rendered UI capture is not a device recording. The ten visible-frame PNGs are actual own-window compositor captures on the reference Mac.

| File | What it establishes |
| --- | --- |
| `visible-latency.json`, `visible-frame-01.png` … `visible-frame-10.png` | Ten foreground native shortcut → WindowServer displayed Flutter frames, timestamps and hashes; no global-routing claim |
| `visible-validation-*.log`, `local-shortcut-*.log`, `shortcut-event-*.log`, `visible-evidence-*.log` | Collector, key matching, Carbon ID and evidence-validation red/green tests |
| `visible-lock-guard.log` | Locked-session GUI collection refused before app launch |
| `flutter-panel.png` | Headless Flutter widget rendering; no IME/Spaces claim |
| `flutter-measurement.json` | Signed Flutter process RSS and programmatic ordering/focus observations |
| `permissions.json` | Signed-harness Screen Recording / Accessibility preflight; no prompt or recording |
| `native-measurement.json` | Signed native harness RSS and ordering proxy; different workload |
| `native-green.log` | XCTest clipboard and shortcut validation results |
| `native-red.log` | Initial CLT lacked XCTest; a tooling limitation, not behavioral red |
| `flutter-red.log`, `flutter-green.log` | Missing composer test target before implementation, then composition tests pass |
| `layout-red.log`, `capture.log` | Actual ListTile/Material painting assertion before fix, then layout/capture pass |
| `scope-red.log`, `scope-green.log` | Unregistered spike rejected, then registered with evidence-path restrictions |
| `flutter-startup-red.log`, `flutter-startup-green.log` | Hidden first-frame timeout before explicit engine start, then successful handshake |
| `build.log` | Original release build/signing commands and results |
| `merged-build.log` | Merged-base Flutter release build; explicit App Sandbox signing verification |
| `package-name-red.log` | Hyphenated spike directory rejected before Dart-name normalization; green in foundation log |
| `foundation.log` | Passing repository gate before #5 merged |
| `merged-foundation-macos.log` | After #5: three Linux-reference goldens differ on macOS; Linux CI is authoritative |

See [the research note](../../mac-panel.md) for exact limits and the remaining
physical tests in [#102](https://github.com/lina-system/lina-app/issues/102).
