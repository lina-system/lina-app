# macOS menu bar status

The native `NSStatusItem` uses the canonical `lina.` wordmark and an AppKit menu.
Its read-only rows show the selected conversation agent and Core connection state;
`런처 열기` shows the existing non-activating launcher and `대화 열기` opens the
existing conversation window. The status button has the same accessible text and
tooltip. No state relies on color. No agent is selected implicitly: before the
person picks one, the menu says `현재 에이전트: 선택 안 됨`.

## Ownership and lifecycle

The main Flutter engine now prewarms with its window hidden at app startup,
including login startup. That engine owns the **same single `CoreConnection`**
used by the conversation. Closing its window retains the connection, draft and
selection. The launcher answer engine still owns no connection. Swift observes
presentation snapshots only; it has no endpoint, protocol client, timer, retry or
second socket. Quit unregisters the channel and removes the status item before
shutting down both existing engines.

Agent selection comes directly from the conversation picker, including renamed
agents and selection removal after a new welcome. A transient EOF retains the
last welcome and selected name, while the status changes to `연결 끊김`. Starting
a new handshake clears the old welcome, so its agent cannot be advertised as
currently available. Rejection remains distinct from ordinary disconnection.

## Local channel

`org.lina.app/status-item/v1` uses Flutter's standard method codec on the **main
conversation engine only**. Dart calls `update` with exactly
`{phase: String, agentName: String?}`. The phases are `disconnected`, `connecting`,
`connected`, and `rejected`; Swift rejects unknown phases or malformed snapshots.
The localized labels are `연결 끊김`, `연결 중`, `연결됨`, and `연결 거부됨`.
It returns null; unknown methods return `FlutterMethodNotImplemented`.

The observer publishes the initial snapshot, every existing connection change
and picker changes. Socket EOF/error already notifies this model immediately.
This establishes the five-second deadline for **a Core process that stops and
closes its sockets**. A suspended process or a silent network black hole is not
an EOF and is not covered by this stopped-process check; no new heartbeat or
protocol method is invented.

## macOS guidance

On macOS 26 and later, the first explicit opening of the conversation window
shows a native `메뉴 막대에 허용` sheet explaining System Settings → Menu Bar.
A versioned local preference records that the sheet was presented. Hidden
prewarming, login startup and the non-activating launcher never activate the app
to show it. It does not infer permission from icon visibility or change a system
preference. Test modes disable the real preference; XCTest uses an isolated
suite. The OS continues to own menu bar visibility and placement.

## Verification

- `flutter test --no-pub test/status_item_test.dart test/core_screen_test.dart`:
  TCP/Unix stopped fake Core reaches the channel within five seconds, one
  accepted socket, picker/name/removal synchronization and listener cleanup.
- `swift test --package-path packages/lina_app/macos -j 2 --filter LinaStatusItemTests`:
  native labels, accessible text, actual `NSMenu` action dispatch, strict snapshot
  decoding, removal and one-time/OS/test/hidden-window guidance guards.
- `dv heavy -- node scripts/foundation.mjs`: pinned SDK, analysis, widget tests,
  protocol and design generation, licenses and registered scope.
- `dv heavy -- node scripts/build.mjs macos`, then
  `node scripts/status-item.mjs`: the signed release app connects to a loopback
  fake Core once. Stopping that peer must produce `Core: 연결 끊김` in the actual
  AppKit menu within five seconds. The harness records native snapshots and
  latency in `docs/captures/49/stopped-core.json`, then terminates its app and
  sockets. CI's macOS job runs the same check alongside the existing launcher
  first-frame and focus fixture.

[Evidence](../captures/49/README.md) distinguishes automated checks from physical
menu use. Physical visibility, menu tracking, permission/visibility persistence
and VoiceOver acceptance require an unlocked console and remain on
[#116](https://github.com/lina-system/lina-app/issues/116). No physical pass is
inferred from XCTest or a hidden release process. #2 still owns the framework
decision; the narrow status channel does not change the #118 rendering split.
