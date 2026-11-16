# 수신함

수신함 is the first screen on a wide window. It lists what waits on the owner: decisions an agent needs (결정 필요), finished runs waiting for review (검토 필요), then the owner's own to-dos (내 할 일). Each item appears once. A decision opens its record in the detail frame at once, to be answered there; other rows open their item too, and the owner's to-dos can be ticked done.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Three groups in this order, each with a grey count equal to its rows: `결정 필요`, `검토 필요`, `내 할 일`. A group with no rows is not drawn.
- A decision row starts with the agent mark (its picture, or colour dot and first letter), has a small context line above the sentence, and its record's state word with `n일 전` on the right: the word its head and its goal's `할 일` line read (`결정 대기`, or the record's own wait such as `피드백 대기`; a card's question `결정 대기`), and the time since the question was asked, the time those lines read too (lina-app#179). Decisions run oldest first.
- A decision is aimed at a goal or a to-do (the record's decision): its small line reads `목표 › 할 일` from the record (just `목표` for a goal). A question a work card asks is aimed at its card: its small line reads `목표 › 작업`. A record's parts read by the row title rule (work-cards.md, lina-app#170), the name its 내 할 일 row and its detail head read: references and ids are cut, a name with a Latin word in it reads by its Hangul words (lina-app#222, `foldTitle`), a name with fewer than 4 Hangul letters left is left out. A card question's parts keep the stricter rule: one with English words, a card number or a path, or holding a word the screens never use, is left out (lina-app#148). With no part left, there is no small line.
- A decision row is a link named by agent, sentence and state word, its small line the record's `목표 › 할 일`. Choosing it opens that record at once in the one detail frame (lina-app#142; the right-hand pane at desktop width, a sheet on a phone) and the row is the selected one: the decision box with the full sentence (a card shows its question box on top), `진행 대기: <to-dos>` when to-dos of the record wait on it, then the answer buttons when the decision has fixed choices (the recommended one marked `추천`) or a one-line `답 달기` field with `보내기`. Answering is in actions.md: the row leaves, `답함 · 되돌리기` shows for 5 s, and the answer is sent when it ends. Once it is sent, the record's head reads `답함 · <time>` and its decision slot shows the question and the answer together (`질문 · 답`, item-detail.md, lina-app#153).
- A review row shows the run with its agent, title and `대기 · 검토 필요 · n시간 전`: a worker run outside any card the core lists for review, and a work card whose run waits for review (the core's board does not list a card's own runs), whoever owns it and whether or not it has a to-do.
- A 내 할 일 row starts with the agent that added it and shows its due date on the right when it has one; an open to-do whose date has passed says `지남` above its red date, as its head does (item-detail.md, lina-app#221). A to-do the owner wrote (`할 일 추가`, actions.md) is listed here like any other once the core takes it.
- An owner to-do that an open decision targets by its id shows once, as the decision; its to-do notice leaves the bell with it. Only an explicit id link counts, never similar text.
- Review and 내 할 일 rows are links named by agent and title, and open their item (`#/items/<id>` or `#/runs/<id>`).
- The 수신함 count in the sidebar equals the number of rows.
- No row text is cut, at 390 and at 1280 with a detail open beside the list (the list then about 380 px wide): a decision's question and its small line, and a to-do's title, wrap at a word and the row grows (lina-app#167), as the work rows do (lina-app#156).

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
- **Read the groups.** Read the lists named `결정 필요`, `검토 필요`, `내 할 일`. 4 row buttons, 2 and 2 links (검토 필요: the run outside any card and the card k-104, titled by its goal `결제 화면 개편`); three decision names end in `결정 대기`, one (T12, which waits on feedback) in `피드백 대기`; no name repeats; the sidebar `수신함` count is `8`.
- **Order.** Read the ages on the decision rows. Each is the same age as or newer than the one above it.
- **Each decision reaches its record.** Follow every decision row in turn. A row aimed at a record opens `#/items/<id>` or `#/goals/<id>`, whose `결정 필요` box holds the same sentence, kind word and age, and whose title ends the row's small line. The card question opens `#/cards/<id>`, whose first box is that question and whose title ends the row's `목표 › 작업` line. The scene has decisions on to-dos and on a goal, and one card question.
- **Open at once.** Choose the first decision. Its record (`#/items/<id>`, the item title) opens in the detail frame (`data-frame` `panel` at 1280, `sheet` at 390), with `금요일 오후` marked `추천` there.
- **Nothing cut beside a detail (spec).** `npx playwright test tests/layout-qa8.spec.ts` (after `npm run build`): with every question and title as long as the hub's, open the first decision at 1280; with the detail open no element on the page has text running past its clipping box. The same holds beside a detail opened from `목표`, `마감일` and `오늘` (lina-app#167).
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/inbox/inbox-1280.{png,aria.yml,json}` and `inbox-390.{png,aria.yml,json}`.

## Gotchas

- The ages count from the scene's own time, which is the time the page loaded; a long-lived tab ages them.
- On a wide window the detail opens beside the list; on a phone it replaces the list.

## Not goals

- Answers and done marks are driven in actions.md.
- No filtering by agent; the agent screen covers that.
- No add here: `할 일 추가` sits on the 작업 tab's 내 할 일 line (actions.md).
