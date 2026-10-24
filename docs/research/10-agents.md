<!-- SPDX-License-Identifier: Apache-2.0 -->
# Agent management verification

The Agents screen lists Core's agents, creates a named companion from the Lina
preset, renames it, and confirms deletion. Each action sends the generated
`agent_request` and projects the correlated `agent_result`; the app writes no
canonical agent state. It advertises `agents` 1.0 and disables management when
Core does not grant it. Names and list membership change only after an applied
mutation response containing a valid, complete agent list.

## Selection and recovery

With one available, selected agent, the header shows its name without a switcher.
Multiple agents have a keyboard-accessible dropdown and labeled list actions.
An unavailable retained agent keeps its draft and requires an explicit selection,
even when only one other agent remains. Removed agents' transcripts and documents
are cleared from the display. Creation does not switch away from an existing
conversation. Creating the first agent discovers its main conversation through
Core and opens Home directly, without a one-agent switcher.

When agent management is negotiated, a switch sends `choose` and waits for Core's
`none` effect response (the current protocol's successful choose effect). Sending
and stopping are fenced while that request is pending. The app then reads the
chosen agent's main conversation before admitting input. Conversation-only peers
retain explicit `history_get(agent_id)` navigation without management actions.
The shared Core connection, workspace, tools and devices do not change.

Drafts, queue mode, focus, search, reading position and documents remain keyed by
agent. Replies and pending input remain bound to their original conversation;
a late submit callback cannot send another agent's draft. Reconnection reads
Core's selected main conversation without replaying `choose` or another mutation.
A different Core/person identity starts a fresh presentation rather than reusing
same-named agent drafts. Unknown/deleted identifiers are not substituted. There
is no new deep-link or durable draft-restoration format in this change.

Management requests are serialized. Refusal keeps the existing state; an unknown
outcome disables further mutations until an explicit list refresh. An uncertain
selection also blocks input until history reconciles Core's choice. Old
connection replies cannot replace a newer catalog or unlock a newer request.
Forms opened on an earlier connection cannot write to a later connection.
Management notices render separately from conversation delivery feedback, so a
rename/create acknowledgment never hides an unknown send or stop outcome.
Refresh is available on the Agents screen; there is no invented agent-change
notification or automatic retry.

## Protocol limits and open questions

The vendored schema at `5b71d7dda93b05fd396c6872fc4c382ad26a9bf4` has no preset
catalog or creation preset field. At that same revision,
`internal/core/boot/management.go` creates with `Preset: "lina"`. The app therefore
labels this exact supported choice, sends only `operation: create` and `name`,
and does not offer arbitrary preset keys or edit generated types.
[Core #1765](https://github.com/lina-system/lina/issues/1765) requests the preset
catalog/selector, selected-agent/list notifications and context bindings.

Attachment queues, grants and their restoration are not exposed by this screen
or the current conversation input schema. End-to-end agreement for those fields,
additional presets and external-client selection changes remains **unverified**;
see Core #1765, Core #1707 and app #120. The app never grants permission or
retargets an attachment locally. Neutral `AgentMark` slots remain in use: the
owner's character/accent choice is still open in [#4](https://github.com/lina-system/lina-app/issues/4).

## Evidence

All fixtures and captures are synthetic. The initial six-test run had five
failures: one-agent switcher visible, no Core choose request, no create action,
stale submit callback targeting the new agent, and a draft reused across people.
The removed-agent guard already passed.

Focused commands (from each named package):

```sh
# packages/lina_app
flutter test --no-pub test/agents_test.dart test/conversation_test.dart test/core_screen_test.dart test/status_item_test.dart --concurrency=1 --reporter expanded
LINA_UPDATE_CAPTURES=1 flutter test --no-pub --update-goldens test/agents_capture_test.dart --concurrency=1 --reporter expanded
# packages/lina_protocol
flutter test --no-pub test/agents_connection_test.dart test/connection_test.dart --concurrency=1 --reporter expanded
# repository root
dv heavy -- node scripts/foundation.mjs
```

Socket tests negotiate `agents` and transport list/create/choose/rename/delete
over native TCP and Unix sockets, validating generated payloads and correlated
responses. Widget tests exercise delayed, refused, unknown and stale responses,
create/rename/delete confirmation, per-agent drafts, mid-turn input, reconnect,
capability absence and stale callbacks. Phone capture tests also exercise keyboard
selection, larger text and keyboard insets.

`docs/captures/10/` contains light/dark/high-contrast desktop and phone renders and
the phone creation dialog. These are Flutter widget captures, not installed-device
acceptance. Native artifacts are compiled by the existing CI platform matrix;
physical interaction and real-Core acceptance on macOS, Windows, Linux, iOS and
Android remain unverified and are recorded in
[this #107 comment](https://github.com/lina-system/lina-app/issues/107#issuecomment-6385044217).
