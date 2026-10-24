# App host protocol

The canonical contract is Core's `docs/design/host-protocol.md`. The app consumes
its draft 2020-12 JSON Schema; it never forks the wire format or writes canon.
`protocol/upstream.json` pins Core revision
`5b71d7dda93b05fd396c6872fc4c382ad26a9bf4` and SHA-256 for every byte-identical
schema/fixture file. The inventory check rejects missing and extra files too.

## Dart type generator decision

Use **lina-schema-dart 1.0.0**, the Apache-2.0 generator in
`scripts/verify/protocol.mjs`. Its exact version and entry-script digest are
registered in `scripts/verify/generators.json`. It uses Node built-ins and the
pinned Dart formatter; there is no downloaded generator or extra runtime package.
Run `node scripts/verify/protocol.mjs --write` after deliberately updating the
snapshot and its provenance. Never edit `lib/generated/protocol.dart` manually.

The generator emits typed immutable object accessors for the schema's object
definitions and the envelope, payload dispatch and the original schema. The
small runtime validates the vocabulary actually used by this snapshot, including
conditional rules, closed objects/enums, exact numeric bounds and nested maps.
Generation refuses unimplemented schema keywords rather than silently widening
the accepted wire language. This is a schema-specific generator, not a claim to
implement every draft 2020-12 vocabulary. A schema update may require expanding
and testing the runtime before accepting the new snapshot.

Exact decimal JSON is necessary: `values/exact_number.json` contains
`9007199254740993.125`, and stream cursors reach uint64 maximum. An int/double-only
model would lose information. `ExactNumber` retains decimal values, and the codec
preserves explicit nulls, absent optional fields and schema-defined map keys.
The receive boundary ignores valid unknown kinds and removes additive payload
fields while keeping the common envelope strict. Strict encoding retains the
closed schema. Frame and nesting limits bound input allocation.

The foundation Flutter stage regenerates into a temporary directory, compares
all generated outputs, validates snapshot digests, then runs Dart tests. The
corpus currently contains **201 positive envelopes** and **44 receive cases**
across the client 1.0/1.1 fixture directories. Positive envelopes round-trip with
exact numbers; both client and server cases compare decoded output, error codes
and the receiver's actual counters. Application-service fixtures are vendored
but do not prove native Core service execution in this app's tests.

Core's wording changes are tracked in
[lina-system/lina#1662](https://github.com/lina-system/lina/issues/1662), including
its Deferred item and the relationship to the existing framework reconciliation
in lina-system/lina#1632. No Core schema bytes were changed here.

## Connection and state

`lina_protocol` is a Dart-only package, kept outside the widget visual-value
boundary and tested to reject UI imports. Unix sockets (`unix:///path`) and
native TCP (`tcp://tailnet-host:port`) share bounded newline-delimited JSON-RPC.
The endpoint is explicitly supplied by the person, an environment variable or a
build define. TCP belongs on the private tailnet; Core's listener authenticates
the device/owner. No client identity field grants permission, and no model,
worker or external service is contacted by this app.

The app offers client **1.0**, conversation, agent management (`agents` 1.0),
memory, read-only progress and the eight basic result card
types. Parsing the broader fixture corpus does not advertise client 1.1 surfaces,
mini apps or mocks. Welcome must match the request/RPC ids, Core sender/main,
epoch, selected version and an offered subset of capabilities. A typed refusal
stays rejected even after EOF. Core's compiled table currently lists the TUI;
it must reject this app until a supported development or accepted release row
exists. The client never substitutes the TUI identity to bypass that table.

The screen holds only presentation preferences, current topic snapshots, request
correlation and per-agent drafts, search, focus and reading position in memory.
Agent management uses the generated list/create/choose/rename/delete requests;
create currently uses Core’s Lina default because the schema has no preset selector.
See the [agent verification record](../research/10-agents.md) for the tracked gaps.
Core discovers the selected main conversation; snapshots and cursor checks route
updates independently of the currently visible agent. The conversation
[verification record](../research/9-conversation.md) distinguishes shipped
behavior from the attachment/thread/voice follow-up. It has no database or file
writer for conversations, results, memory, permissions or completion. Requests
are sent once. A timeout/drop does not retry an effect, claim success or clear a
draft. Results display the status Core supplied; requesting a save cannot mark
a preview saved. Unknown outcomes are shown as “모름”. Acknowledged input is
labeled “Received by Core”, never a saved result or verified work completion.

The native text field preserves `TextEditingValue` and its composition range;
there is no trim, formatter, length truncation or draft writeback during
composition. Enter/send is guarded during composition and for one frame after
it ends. The draft clears only after a correlated applied `item_done`, and only
if it has not since changed or begun composing. Physical IME acceptance remains
with #1 and the device follow-up; a headless composition test cannot establish
candidate-window placement or Core's real conversation ledger.

The [memory verification record](../research/11-memory.md) documents the scoped
memory projection and explicit Core-confirmed remember/correct/forget requests.
Unsupported memory operations and metadata remain unobserved; Core #1768 owns
the missing schema. No memory canon is persisted by the app.

## Native surface slots

`PlatformSlots.composer` can substitute a native text surface with the same
controller, focus, submit callback and generated `LinaTokens`. #1 decides whether
any platform needs it. `PlatformSlots.launcher` defines the native launcher's
show/close boundary and passes those same tokens; #2 decides its implementation.
Neither placeholder claims native panel, shortcut or clipboard acceptance.

System brightness, text scaling, high contrast and reduced motion are retained.
Appearance provides in-memory theme, high-contrast, reduced-motion and larger-text
fallbacks for desktops. These fallbacks never turn off a system accessibility
request. There is no web target, WebView or web-tech shell.
