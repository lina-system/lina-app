# 수신함

수신함 is the first screen on a wide window. It lists what waits on the owner: decisions an agent needs (결정 필요), finished runs waiting for review (검토 필요), then the owner's own to-dos (내 할 일). Each item appears once and a row opens its item.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Three groups in this order, each with a grey count equal to its rows: `결정 필요`, `검토 필요`, `내 할 일`. A group with no rows is not drawn.
- A decision row starts with the agent mark (colour dot and first letter), has a small context line above the sentence, and the kind word `질문` or `요청` with `n일 전` on the right. Decisions run oldest first.
- A decision is aimed at a goal or a to-do (the record's decision): its small line reads `목표 › 할 일` from the record (just `목표` for a goal), and the row opens that goal or to-do, which shows the decision box. A question a work card asks is aimed at its card: its small line reads `목표 › 작업`, and the row opens the card, which shows the question box on top.
- A review row shows the run with its agent, title and `대기 · 검토 필요 · n시간 전`.
- A 내 할 일 row starts with the agent that added it and shows its due date on the right when it has one.
- Each row is a link named by agent, sentence and kind, and opens its item (`#/items/<id>`, `#/goals/<id>`, `#/cards/<id>` or `#/runs/<id>`).
- The 수신함 count in the sidebar equals the number of rows.

## Sub-features

- `inbox-decide` lists decisions with context, kind word and age
- `inbox-review` lists finished runs waiting on the owner
- `inbox-mine` lists the owner's own to-dos with who added them
- `inbox-open` opens the item behind a row

## How to get to it (user POV)

- Open the app on a wide window: 수신함 is selected.
- On a phone, choose `수신함` on the first screen.
- Address `/app/#/inbox`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open 수신함.** Load `/app/?source=synthetic#/inbox`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive inbox`. The title reads `수신함`.
- **Read the groups.** Read the lists named `결정 필요`, `검토 필요`, `내 할 일`. 4, 1 and 2 links; two decision names end in `질문`, two in `요청`; no name repeats; the sidebar `수신함` count is `7`.
- **Order.** Read the ages on the decision rows. Each is the same age as or newer than the one above it.
- **Each decision reaches its record.** Open every decision row in turn. A row aimed at a record opens `#/items/<id>` or `#/goals/<id>`, whose `결정 필요` box holds the same sentence, kind word and age, and whose title ends the row's small line. The card question opens `#/cards/<id>`, whose first box is that question and whose title ends the row's `목표 › 작업` line. The scene has decisions on to-dos and on a goal, and one card question.
- **Open a row.** Click the first decision. The address becomes `#/items/<id>` and the item title shows.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/inbox/inbox-1280.{png,aria.yml,json}` and `inbox-390.{png,aria.yml,json}`.

## Gotchas

- The ages count from the scene's own time, which is the time the page loaded; a long-lived tab ages them.
- On a wide window the detail opens beside the list; on a phone it replaces the list.

## Not goals

- No answer buttons or done marks yet (lina-app#5).
- No filtering by agent; the agent screen covers that.
