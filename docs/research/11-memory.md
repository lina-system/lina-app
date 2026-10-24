<!-- SPDX-License-Identifier: Apache-2.0 -->
# Memory view verification

Memory shows the selected agent's personal knowledge and knowledge shared with
all agents. Core is the only writer. The app uses the vendored memory request and
result types, negotiating `memory` 1.0 separately from conversation. It neither
stores memory on disk nor reads external logs or `memories/` itself.

## Supported behavior

- List pages carry the selected `agent_id`. The display also filters holders to
  that agent or `all`. Sources retain exact references and Core-supplied evidence
  status/deletion markers. Missing update time, correction actor, source origin
  and observation status are unobserved, not inferred from reference strings.
- Remember previews the destination layer and privacy scope. Its default is the
  selected agent's personal layer and `local`; the person can explicitly choose
  shared knowledge, `private` or `never-leaves`.
- Correct lets Core retain the displayed item's holder/scope and accepts Core's
  replacement identity. Forget requires explicit confirmation describing recall
  exclusion and retention of conversation turns. It sends only `forget`, never
  raw-turn deletion or permanent deletion.
- Mutations are sent once. Only a correlated matching `memory_result`, committed
  item id and `effect_state=applied` confirm a change. The app then reads Core's
  list; it never inserts proposed text or removes items optimistically.
- Refusal does not claim success. Uncertain outcomes clear the projection and
  require a read before another write. Reconnect, agent changes, foreground
  return and observed snapshot revocation changes discard old projections.
  Late responses cannot update another session or selected agent. Open editors
  containing invalidated existing items are discarded with that projection.
- Paging is explicit and labelled partial. Missing items, invalid/repeated
  cursors and failed reads are unobserved, not a complete empty list. Restart
  reads again rather than restoring app-owned memory state.
- Persona has a separate explanation naming fixed core, default voice, user voice
  and growth. Its action returns to the selected agent's conversation, where the
  person enters and sends their request. No persona edit becomes a memory write.

## Schema and acceptance limits

[Core #1768](https://github.com/lina-system/lina/issues/1768) is the single schema
follow-up. Permanent deletion, logged layer moves, external source management,
provenance/actor/time/item-kind fields and the persona layer read projection are
unavailable. The UI explains the gaps and disables unsupported actions. Reserved
empty import/promotion messages are not used. Generated types are unchanged.

Memory results have no revocation watermark or subscription. The app clears on
revocation changes observed in existing snapshots, refreshes on view entry,
foreground and reconnect, and offers manual refresh. Immediate invalidation of a
memory changed on another device while this view stays open remains unverified
until Core publishes that contract. The displayed list is a Core snapshot.

Automated restart tests recreate the controller against a synthetic Core. They
do not prove disk persistence, next-turn recall or deletion of derived artifacts
in installed Core. These checks, physical Mac input/accessibility and all
unbriefed-participant trials remain unrun in
[#107](https://github.com/lina-system/lina-app/issues/107#issuecomment-6385052375).
Participant/event denominators are 0/0. No device or human pass is claimed.

The brief's `docs/research/conversation-and-memory.md` was absent. References were
Core's `docs/design/conversation-and-memory.md`, the published TUI memory command
contract and management handlers at vendored revision
`5b71d7dda93b05fd396c6872fc4c382ad26a9bf4`.

## Automated verification

The first widget test failed because the Memory navigation entry was absent.
Controller/widget tests cover scoped reads, paging, applied/refused/missing
receipts, no optimistic changes or resend, correction/forget payloads, uncertain
writes, stale replies, revocation, capability loss, removed agents, restart,
explicit confirmation/cancellation, source tombstones and agent switching.
An additional regression commits Korean composition without changing the text:
submission remains disabled during composition and enables on its commit. The
editor listens to the full editing value, including composing-range changes.

```sh
# packages/lina_app
flutter test --no-pub test/memory_controller_test.dart test/memory_screen_test.dart --concurrency=1
LINA_UPDATE_CAPTURES=1 flutter test --no-pub --update-goldens test/memory_capture_test.dart --concurrency=1
# repository root
dv heavy -- node scripts/foundation.mjs
```

Six synthetic widget captures in `docs/captures/11/` cover light, dark and high
contrast at desktop and phone widths. Capture tests also check semantics, large
text and phone keyboard insets with a scrollable editor. They are rendering
evidence, not physical-device screenshots. Visual values use the design package.
