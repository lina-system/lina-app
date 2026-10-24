# Menu bar evidence

`guidance.png` is an isolated native NSAlert content-view capture on macOS 27,
rendered by XCTest with the app's existing icon and an explicit light appearance.
It is flattened onto the system window background because view caching excludes
the compositor. It is **not** a screenshot of a physical permission prompt or
proof that the menu bar is visible. No Screen Recording grant is used.

`stopped-core.json` records the signed release app's real Dart-to-AppKit status
channel while a synthetic loopback Core stops. It records one accepted socket,
the native menu titles and the disconnect latency; it contains no real endpoint,
agent or conversation data. The macOS CI job regenerates and uploads it.

Physical menu clicks, continued updates while tracking the menu, VoiceOver,
System Settings visibility persistence and the one-time guidance in an unlocked
session are deferred to the comment for #49 on issue #116.
