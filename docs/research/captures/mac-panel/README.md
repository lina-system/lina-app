# Evidence index

All content is synthetic. Absolute local paths in logs are normalized to
`<repo>`/`<user>`. A rendered UI capture is not a physical-device recording.

| File | What it establishes |
| --- | --- |
| `flutter-panel.png` | Headless Flutter widget rendering; no IME/Spaces claim |
| `flutter-measurement.json` | Signed Flutter process RSS and programmatic ordering/focus observations |
| `native-measurement.json` | Signed native harness RSS and ordering proxy; different workload |
| `native-green.log` | XCTest clipboard and shortcut validation results |
| `native-red.log` | Initial CLT lacked XCTest; a tooling limitation, not behavioral red |
| `flutter-red.log`, `flutter-green.log` | Missing composer test target before implementation, then composition tests pass |
| `layout-red.log`, `capture.log` | Actual ListTile/Material painting assertion before fix, then layout/capture pass |
| `scope-red.log`, `scope-green.log` | Unregistered spike rejected, then registered with evidence-path restrictions |
| `flutter-startup-red.log`, `flutter-startup-green.log` | Hidden first-frame timeout before explicit engine start, then successful handshake |
| `build.log` | Release build/signing commands and results |
| `package-name-red.log` | Hyphenated spike directory rejected before Dart-name normalization; green in foundation log |
| `foundation.log` | Repository foundation gate result |

See [the research note](../../mac-panel.md) for exact limits and the remaining
physical tests in [#102](https://github.com/lina-system/lina-app/issues/102).
