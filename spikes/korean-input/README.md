# Korean input research

A single local composer, generated with Flutter **3.47.8**, for
[lina-app#88](https://github.com/lina-system/lina-app/issues/88) and the owner
framework decision in [#1](https://github.com/lina-system/lina-app/issues/1).
Native runners: Android, iOS, Linux, macOS and Windows. There is no web target.

```sh
cd spikes/korean-input
flutter pub get --enforce-lockfile
flutter analyze
flutter test test/composer_test.dart
flutter run -d linux --dart-define=IME_TRACE=true
```

Choose `macos`, `windows` or a connected mobile device instead of `linux` on
that platform. Check `flutter --version` against the repository pin first.
Mobile targets must be enabled in the local Flutter SDK configuration and need
the platform SDK/signing setup; the committed runners are not evidence of a
successful device build.

Enter sends a committed draft to an in-memory receipt. Shift+Enter inserts a
newline. F9 adds a marker when the IME does not own input; fcitx5-hangul uses the
same key for Hanja candidates, deliberately exercising shortcut ownership.
During composition, these keys are left to the IME. The visible send count is
a local test sink, not a Core ledger or network transmission. The Send locally
button also serves as a focus target. Soft keyboards retain their multiline
return key; the button sends.

Diagnostics are off by default. `IME_TRACE=true` prints the draft, selection,
composing range, local receipt and counters to stdout. **Use synthetic text
only**, including when capturing screens. Nothing is persisted by the app.

## Reproduce the Linux host experiment

Requires Linux x64, GTK3 development libraries, fcitx5, fcitx5-hangul, the fcitx5
GTK3 frontend, Python 3 with PyGObject/GTK3, Xvfb, xdotool, ImageMagick, D-Bus and
a Korean font. On a shared devflow host, run the build and experiment inside
one heavy slot:

```sh
dv heavy -- bash -c 'flutter build linux --debug --dart-define=IME_TRACE=true && tool/linux_ime.sh /tmp/korean-input-evidence'
```

Without devflow, run those two commands directly on a dedicated machine.
The script creates a private X server, D-Bus session and temporary fcitx5
configuration. It sends ASCII 2-beolsik key sequences with XTest, never
`enterText`, clipboard paste or precomposed Unicode. It runs the same editing
cases against a native GTK TextView. It records screenshots, traces and
`observations.json`. Existing login-session IME settings are untouched.

This recorder exits nonzero for missing infrastructure or absent Hangul input.
A completed recording may contain failed acceptance criteria: read the evidence,
not just the exit status. Xvfb is not Omarchy, Wayland or physical-device proof.
See [the results and device protocol](../../docs/research/korean-input.md).
