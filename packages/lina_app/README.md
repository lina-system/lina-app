# LINA native app

One Flutter 3.47.8 codebase with macOS, iOS, Android, Windows and Linux runners.
The screen consumes `lina_design` tokens and `lina_protocol` generated types.
There is no web runner.

From the repository root:

```sh
node scripts/foundation.mjs
node scripts/build.mjs macos
node scripts/build.mjs ios
node scripts/build.mjs ios-simulator
node scripts/build.mjs android
node scripts/build.mjs windows
node scripts/build.mjs linux
```

Run only targets supported by the current host. On shared hosts, prefix full
gates/builds with `dv heavy --`. macOS is ad-hoc signed; iOS release compilation
uses `--no-codesign`, and the simulator builds in debug mode because Flutter does
not support release simulator builds. Android uses the development debug key;
none is a store-ready or notarized distribution.

Supply a Core address in the screen, `LINA_CORE_ENDPOINT`, or the same Dart build
define. macOS/Linux use `unix:///absolute/path/to/core.sock`; other devices use
`tcp://your-tailnet-core:port`. Core decides whether this platform/protocol row
is supported. The default Core release table currently rejects `lina-app`.
A development-only test manifest does not establish release acceptance.

The composer sends once, preserves Korean composition and waits for Core before
clearing the matching draft. The screen shows connection loss, rejection,
preview/saved results and unknown outcomes explicitly. Appearance settings and
drafts are in-memory presentation state. There is no local canonical database.

[Host contract](../../docs/policy/host-protocol.md) ·
[Native verification evidence](../../docs/research/6-native-app.md)

## Conversation

Home now discovers the selected agent through Core and retains per-agent drafts,
search, input mode, reading position and open documents while navigating or
reconnecting. Send/queue, streaming, stop and explicit retry use the generated
protocol. Command/control-Enter submits; ordinary Enter keeps multiline input.
See the [conversation verification record](../../docs/research/9-conversation.md)
for captures, tests and the explicitly tracked remaining rich-input/thread work.
