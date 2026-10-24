# Foundation tooling

Development-only Dart validator for exact dependency pins, lockfile sources,
registered path dependencies and runtime license/font notice coverage.
It uses a real YAML parser and runs under the pinned Flutter SDK. Nothing in
this package is bundled with LINA. Node's foundation runner installs its
committed lockfile before invoking `bin/check_dependencies.dart`.

For focused work, run `flutter test test/dependencies_test.dart` in this package.
The complete gate is documented in [foundation policy](../../docs/policy/foundation.md).
