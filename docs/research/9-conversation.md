# Conversation screen verification

The app now opens the main conversation selected by Core, with a Home starting
state, per-agent drafts and a fixed composer. Core's authenticated history
response selects the first agent. A draft typed while discovery is pending follows
the first explicit selection as well as the default selection; reconnect validates that the retained agent
still appears in Welcome. A removed agent keeps its draft and cannot receive a
submission until the person explicitly chooses an available agent.

## Shipped scope

- Home shows Core's waiting/progress projection in Core order. Today is explicitly
  unknown until its projection is integrated. The left navigation holds Home,
  Agents, Goals, Map, Library and Memos; unimplemented views say so and retain the
  conversation composer. This does not implement the separately owned agents,
  memory or work-card products.
- Text input supports native paste/selection, multiline input, Korean composition
  guards, Enter/keypad Enter to send, Shift+Enter for a newline and extra
  command/control-Enter shortcuts, steering, queueing, interruption and explicit
  retry after a definite failed/refused admission. Pending or uncertain input is
  never resent. Only a correlated applied receipt clears the unchanged draft.
- Each agent retains its draft, search, queue mode, focus node, reading position,
  selected document and main conversation target in memory. Navigation has back
  and forward controls; resize/resume/reconnect reuse that presentation. This is
  not durable conversation storage or draft persistence across process death.
- Stream snapshots replace one topic, deltas append once, item completion replaces
  the stable key, and gaps/new epochs require a fresh snapshot. Reply routing uses
  Core's topic identity, never the agent currently selected by the person.
- Composing, accepted, queued, responding, completed, user-stopped, failed and
  disconnected have explicit labels. An inactive turn without a confirmed agent
  answer is unknown, not completed. Restored inactive turns also remain unknown:
  an older answer in the snapshot cannot prove the latest turn succeeded.
  A stopped reply requires Core's stop receipt
  and inactive state. The missing canonical per-turn terminal outcome is recorded
  in Core #1707; these labels do not certify delegated-work completion.
- Prose is selectable and long fenced code scrolls horizontally. Document cards
  open a read-only panel covering half the desktop window or a phone sheet; full
  screen on desktop keeps the composer. Phone sheets have only the supported
  close control; keeping the composer alongside the phone panel remains #120.
  A newer result card preserves the loaded version and offers Read latest.
  Version-pinned result reads collect every returned
  text page, and stale reads cannot replace a newer selected result. A failure
  from a superseded read cannot set the error on the document now being read.
  Saved status comes exclusively from Core.
- All visual values come from `lina_design`, including three new layout tokens.
  One `AgentMark` widget supplies the neutral identity placeholder. No expression
  is invented, and `PlatformSlots.launcher` is untouched.

## Automated evidence

Flutter remains pinned to **3.47.8**. All fixtures and captures are synthetic.

The red widget run failed because startup did not discover a conversation and
switching agents retained the wrong draft. The final widget tests cover draft
isolation, navigation/reconnect/resize reading position, all eight labels,
composition guards, capability/removed-agent checks, late replies, duplicate and
gapped streams, stop/retry,
uncertain input without resend, full document pages, superseded document read
failures, and conversation → delegation → question → restart/reconnect with a
fixture Core.

`topic_window_test.dart` covers replacement/deduplication, gaps, foreign topics,
old revisions, epoch changes, exponent-form integer cursors and uint64 precision.
Native socket tests exercise the real `CoreConnection` receive boundary, including
invalid handshake data, pending-effect uncertainty and no resend.

Commands, run in the named package unless stated otherwise:

```sh
# packages/lina_app
flutter test --no-pub test/conversation_test.dart test/core_screen_test.dart --concurrency=1
LINA_UPDATE_CAPTURES=1 flutter test --no-pub --update-goldens test/conversation_capture_test.dart
# packages/lina_protocol
flutter test --no-pub test/topic_window_test.dart test/connection_test.dart
# repository root
dv heavy -- node scripts/foundation.mjs
```

`docs/captures/9/` contains light, dark and high-contrast desktop (1280×1000)
and phone (390×844) raster evidence. Capture tests additionally check phone
keyboard insets and larger text. Ordinary CI runs layout/semantics assertions;
only the explicit capture flag compares/updates pixels, since platform font
rasterizers differ. These are rendered widget captures, not installed-Mac proof.

## Real Core and acceptance limits

Core was built from the exact vendored revision
`5b71d7dda93b05fd396c6872fc4c382ad26a9bf4` in an isolated, ignored build directory.
The optional `core_smoke.dart` passed actual compiled-table refusal, explicit
development-row admission on Linux, and termination/disconnection. The unconfigured
Core exposed no conversation capability. The harness now secures its synthetic
control root, and transport streams allow a listener to dispose after a disconnect.
No real credentials or personal Core state were used.

The following focused Core tests passed through `dv heavy`, with Go compilation
limited to two packages at a time and tests run serially:

- `TestM1TUIConversationInstalledCore`: installed conversation, streaming, restart
  and history restoration with a synthetic provider.
- `TestM1TUIQuestionConversationScopeInstalledCore`: real installed-Core question
  routing and conversation scope.
- `TestM2ConversationWorkerRunningInstalledCore`: conversation worker delegation
  and running controls.

Those tests exercise Core/TUI, not the Flutter process. The app sequence is
fixture-driven. Installed-Mac app end-to-end behavior, physical Korean IMEs and
human no-web-feel acceptance remain with [#107](https://github.com/lina-system/lina-app/issues/107).

## Decisions and remaining scope

[#120](https://github.com/lina-system/lina-app/issues/120), in the same milestone
and depending on #9, contains the exact remaining functional Done-when portions:
Today/actionable Home rows, attachment capture/transport/queues, artifact threads,
chat edits and versioned context, full rich/image rendering, voice revisions,
extended task/thread restoration and remaining native interaction work.
[Core #1707](https://github.com/lina-system/lina/issues/1707) requests missing
canonical schema pieces; generated protocol types were not hand-edited.

The current cobalt and provisional Lucide source remain in use. [#4](https://github.com/lina-system/lina-app/issues/4)
will fill the neutral mark slot with the approved agent face/form, expression
rules, final icon choice and accent decision. No model selector was added.

## Connection and composer acceptance gaps

The connection form now distinguishes invalid syntax from an unreachable Core,
shows accepted address formats or a start/check/reconnect action, and stays open
with the entered address after a failure. Its message remains in connection
status when closed. A successful retry clears the failure and closes the form;
neither failure nor retry alters the conversation draft or submits it.

Hardware Enter and keypad Enter send committed, nonempty drafts. Shift+Enter
replaces the selection with a newline and puts the caret after it. Cmd/Ctrl+Enter
remain extra send keys. These bindings apply only to the composer, suppress
repeat sends, and leave composition and its commit frame to the IME. Mobile soft
return retains the existing newline action. This follows the contract in
[korean-input.md](korean-input.md#composer-contract-used-by-this-experiment).

`flutter test --no-pub test/scope_gap_test.dart --concurrency=1` reproduced seven
failures before the fix: silent invalid/unreachable addresses, missing Enter and
keypad Enter sends, missing Shift+Enter insertion, and no send after composition
committed. It then passed all ten tests, including correction to a real synthetic
TCP peer, unchanged drafts, exact receipt handling, repeat suppression, modifier
keys and isolation from the search field. The two additional captures are
`docs/captures/9/connection-invalid.png` (phone) and
`docs/captures/9/connection-unavailable.png` (desktop); all data is synthetic.
The functional and review follow-ups #120 and #123 are unchanged by this work.
