# LINA app component

`LinaApp` consumes `lina_design` through its path dependency and applies its
light, dark and high-contrast themes. It follows platform appearance and contrast
and accepts an explicit `ThemeMode`; the caller supplies the home widget.
The integration test verifies the actual path dependency and platform switching.

This package has no native runners, Core transport or navigation yet. Those
belong to #6 after the physical acceptance work in #1/#2. Protocol generation is
still deferred and guarded by the foundation gate. This is not a runnable release.

See [DESIGN.md](../../DESIGN.md) and the
[foundation policy](../../docs/policy/foundation.md).
