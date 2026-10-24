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
preview/saved results and unknown outcomes explicitly. A typed refusal names the
cause Core reported and the next action; an access refusal is not described as a
version/platform mismatch. A welcome without the `conversation` capability
disables the composer and says conversation is not available from this Core
instead of inviting a send. Appearance settings and drafts are in-memory
presentation state. There is no local canonical database.

[Host contract](../../docs/policy/host-protocol.md) ·
[Native verification evidence](../../docs/research/6-native-app.md)

## Conversation

Home now discovers the selected agent through Core and retains per-agent drafts,
search, input mode, reading position and open documents while navigating or
reconnecting. Send/queue, streaming, stop and explicit retry use the generated
protocol. Hardware Enter (including keypad Enter) sends committed text;
Shift+Enter inserts a newline. Command/control-Enter also sends. Composition and
its commit frame never trigger a send; mobile soft return remains a newline.
Invalid Core addresses and unreachable sockets show a cause and recovery action
in the connection form, preserving both the address and the conversation draft.
A `not_authorized` refusal says access was refused and points to device approval
in Core; other refusal codes keep their own wording, and the rejected state and
draft survive EOF. A welcome that does not negotiate `conversation` says so
without inviting a send.
See the [conversation verification record](../../docs/research/9-conversation.md)
for captures, tests and the explicitly tracked remaining rich-input/thread work.

## macOS launcher

The Mac app starts an accessory launcher with Control-Option-Space. Swift owns
the input and result list; a pre-warmed Flutter view draws the reply area.
**Open LINA** opens the full app. **Open at login** is an explicit opt-in using
SMAppService; tests cannot change it. See the [channel and verification record](../../docs/research/31-launcher.md).
Search results, Korean first-key input, Liquid Glass and Command-Space takeover
remain separate work. The owner's framework decision stays open in #2.
