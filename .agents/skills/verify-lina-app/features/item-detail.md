# 할 일 detail

A to-do opens on its own page: its check box, done condition, state and time, the runs on it and the full comment thread with replies.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The head shows the round check box (inert, named `<title> 완료로 표시`) with `state · time`.
- A pending decision shows its sentence, agent, kind word and age.
- `완료 조건`, then `실행` with one line per run (`title · state`), then `댓글`.
- Each comment shows its sentence, then author and `n분 전`; replies sit under it with their author, time and result word (`반영함`, `답변 필요`, `반영 안 함`). Never only a count.

## Sub-features

- `item-head` shows the check box, state and time
- `item-runs` lists the runs on the to-do
- `item-thread` shows comments with replies

## How to get to it (user POV)

- Choose a to-do on a goal page, a 수신함 row or a 마감일 row.
- Address `/app/#/items/<id>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open a to-do.** On `결제 화면 개편`, choose `카드 입력 폼 다듬기`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive item-detail`.
- **Read it.** The check box `카드 입력 폼 다듬기 완료로 표시` is `aria-disabled`; boxes `완료 조건`, `실행`, `댓글`; the run line reads `카드 입력 폼 다듬기 · 완료`; 2 comments and 2 replies, each reply with `author · n분 전`.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/item-detail/item-detail-1280.{png,aria.yml,json}` and `item-detail-390.{png,aria.yml,json}`.

## Gotchas

- Read-only here: typing a comment is lina-app#4.

## Not goals

- No answering, done marks or undo (lina-app#5).
