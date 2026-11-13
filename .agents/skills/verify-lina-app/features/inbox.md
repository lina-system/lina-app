# 수신함

수신함 is the first screen on a wide window. It lists what waits on the owner: decisions an agent needs (결정 필요), finished runs waiting for review (검토 필요), then the owner's own to-dos (내 할 일). Each item appears once. A decision opens its record in the detail frame at once, to be answered there; other rows open their item too, and the owner's to-dos can be ticked done.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Three groups in this order, each with a grey count equal to its rows: `결정 필요`, `검토 필요`, `내 할 일`. A group with no rows is not drawn.
- A decision row starts with the agent mark (colour dot and first letter), has a small context line above the sentence, and the kind word `질문` or `요청` with `n일 전` on the right. Decisions run oldest first.
- A decision is aimed at a goal or a to-do (the record's decision): its small line reads `목표 › 할 일` from the record (just `목표` for a goal). A question a work card asks is aimed at its card: its small line reads `목표 › 작업`. A part the title rule refuses (English words, a card number, a path) or holding a word the screens never use is left out; with no part left, there is no small line (lina-app#148).
- A decision row is a link named by agent, sentence and kind, its small line the record's `목표 › 할 일`. Choosing it opens that record at once in the one detail frame (lina-app#142; the right-hand pane at desktop width, a sheet on a phone) and the row is the selected one: the decision box with the full sentence (a card shows its question box on top), `진행 대기: <to-dos>` when to-dos of the record wait on it, then the answer buttons when the decision has fixed choices (the recommended one marked `추천`) or a one-line `답 달기` field with `보내기`. Answering is in actions.md: the row leaves, `답함 · 되돌리기` shows for 5 s, and the answer is sent when it ends.
- A review row shows the run with its agent, title and `대기 · 검토 필요 · n시간 전`: a worker run outside any card the core lists for review, and a work card whose run waits for review (the core's board does not list a card's own runs), whoever owns it and whether or not it has a to-do.
- A 내 할 일 row starts with the agent that added it and shows its due date on the right when it has one.
- An owner to-do that an open decision targets by its id shows once, as the decision; its to-do notice leaves the bell with it. Only an explicit id link counts, never similar text.
- Review and 내 할 일 rows are links named by agent and title, and open their item (`#/items/<id>` or `#/runs/<id>`).
- The 수신함 count in the sidebar equals the number of rows.

## Sub-features

- `inbox-decide` lists decisions with context, kind word and age
- `inbox-review` lists finished runs waiting on the owner
- `inbox-mine` lists the owner's own to-dos with who added them
- `inbox-open` opens a decision's record in the detail frame with its answers
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
- **Read the groups.** Read the lists named `결정 필요`, `검토 필요`, `내 할 일`. 4 row buttons, 2 and 2 links (검토 필요: the run outside any card and the card k-104, titled by its goal `결제 화면 개편`); two decision names end in `질문`, two in `요청`; no name repeats; the sidebar `수신함` count is `8`.
- **Order.** Read the ages on the decision rows. Each is the same age as or newer than the one above it.
- **Each decision reaches its record.** Follow every decision row in turn. A row aimed at a record opens `#/items/<id>` or `#/goals/<id>`, whose `결정 필요` box holds the same sentence, kind word and age, and whose title ends the row's small line. The card question opens `#/cards/<id>`, whose first box is that question and whose title ends the row's `목표 › 작업` line. The scene has decisions on to-dos and on a goal, and one card question.
- **Open at once.** Choose the first decision. Its record (`#/items/<id>`, the item title) opens in the detail frame (`data-frame` `panel` at 1280, `sheet` at 390), with `금요일 오후` marked `추천` there.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/inbox/inbox-1280.{png,aria.yml,json}` and `inbox-390.{png,aria.yml,json}`.

## Gotchas

- The ages count from the scene's own time, which is the time the page loaded; a long-lived tab ages them.
- On a wide window the detail opens beside the list; on a phone it replaces the list.

## Not goals

- Answers and done marks are driven in actions.md.
- No filtering by agent; the agent screen covers that.
