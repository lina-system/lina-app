# 할 일 detail

A to-do opens on its own page: its check box, done condition, state and time, the runs on it, the full comment thread with replies and a one-line field to comment.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The head shows the round check box (named `<title> 완료로 표시`, `<title> 완료됨` once checked) with `state · time`, and `되돌리기` while the owner's own done mark can be taken back (ten minutes, after the toast). Ticking it is in actions.md.
- A pending decision on the to-do (or on a goal, on its goal page) shows on top as a `결정 필요` box: the sentence, then agent, kind word (`질문` or `요청`) and age.
- `완료 조건`, then `실행` with one line per run (`title · state`), then `댓글`.
- Each comment shows its sentence, then author and `n분 전`; replies sit under it with their author, time and result word (`반영함`, `답변 필요`, `반영 안 함`). Never only a count.
- A resolved thread folds to one line `해결됨 · <first words>`; choosing it opens the thread.
- At the bottom of `댓글`: a one-line field `댓글 달기` and `보내기` (disabled while the field is empty or a comment is on its way).
- 보내기: on screen the comment shows at once under the thread with `<agent>에게 보냄 · 방금` and the field empties; in the record (`POST /api/lina/work/items/<id>/comments`) a new open comment by the owner. When the agent's reply reaches the record, the next refresh shows it under the comment with its result word and the pending line goes.
- A refused comment comes back into the field, the core's reason shows as one red line under it, and the thread is as it was.

## Sub-features

- `item-head` shows the check box, state and time
- `item-runs` lists the runs on the to-do
- `item-thread` shows comments with replies and folds resolved ones
- `item-comment` sends a comment and shows it pending until the reply

## How to get to it (user POV)

- Choose a to-do on a goal page, a 마감일 row, or a `결정 필요` row in 수신함 aimed at it (its small line reads `목표 › 할 일`): that opens the to-do with its decision box. A decision aimed at a goal opens the goal page with the same box.
- Address `/app/#/items/<id>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open a to-do.** On `결제 화면 개편`, choose `카드 입력 폼 다듬기`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive item-detail`.
- **Decision.** In 수신함 expand the decision `배포를 금요일 오후에 해도 될까요?` and follow its `릴리스 노트 정리 › 배포 순서 정하기` line. The address is `#/items/T2` (배포 순서 정하기), whose `결정 필요` box holds that sentence, `질문` and `n일 전`.
- **Read it.** The check box `카드 입력 폼 다듬기 완료로 표시` is not `aria-disabled`; boxes `완료 조건`, `실행`, `댓글`; the run line reads `카드 입력 폼 다듬기 · 진행 중`; 2 comments and 2 replies, each reply with `author · n분 전`.
- **Resolved thread.** One `해결됨 · …` line, closed.
- **Button.** `보내기` is grey while the field is empty and accent once it has text; on a phone it is at least 44 px tall.
- **Comment.** Type `휴대폰 가로 화면도 봐 주세요` into `댓글 달기` and choose `보내기`. At once `<agent>에게 보냄 · 방금` shows and the field is empty; the synthetic record holds the owner's comment. Within 25 s the reply line `<agent> · n분 전 · 반영함` shows and the pending line is gone.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/item-detail/item-detail-1280.{png,aria.yml,json}` and `item-detail-390.{png,aria.yml,json}`.

## Gotchas

- The synthetic agent replies to a comment 5 s after it, so the reply shows on the first 10 s refresh after that; a live core replies when the agent does.
- A drive writes to the synthetic copy only; reloading the page starts the scene again.

## Not goals

- No editing or deleting a comment.
- No conversation with the agent beyond the thread (lina-app#9).
