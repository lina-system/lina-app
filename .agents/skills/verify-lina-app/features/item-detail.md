# 할 일 detail

A to-do opens in the one detail frame: its check box, done condition, state and time, the runs on it, the full comment thread with replies and a one-line field to comment.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- A to-do opens in the one detail frame (lina-app#142), wherever it is chosen (the home, a goal, 마감일, 수신함): the right-hand pane beside the list at desktop width, a sheet rising from the bottom over the list at phone width, opened where the owner is looking. The tab, the header and the list stay as they were (a to-do chosen on the home never turns the list into 수신함). Back closes the frame; the list is at the scroll it had and the chosen row stays highlighted.
- The head shows the round check box (named `<title> 완료로 표시`, `<title> 완료됨` once checked) with `state · time` (while a decision on it is open, the time is when it was asked, the same as its 수신함 row, lina-app#149), and `되돌리기` while the owner's own done mark can be taken back (ten minutes, after the toast). Ticking it is in actions.md.
- A pending decision on the to-do (or on a goal, on its goal page) shows on top as a `결정 필요` box: the sentence, then agent, kind word (`질문` or `요청`) and age. Under it is the place to answer it, the same answer as from 수신함: its choice buttons (the recommended one tagged `추천`), or a `답 달기` field and `보내기`.
- `완료 조건`, then `실행` with one line per run (`title · state`), then `댓글`, then `대화` (talk.md).
- Each comment shows its sentence, then author and time; replies sit under it with their author, time and result word (`반영함`, `답변 필요`, `반영 안 함`). Never only a count.
- Times read `방금` under a minute, `n분 전` under an hour, `n시간 전` from 60 minutes and `n일 전` from a day: a reply 55 minutes old reads `<author> · 55분 전`, one 80 minutes old `<author> · 1시간 전`.
- A resolved thread folds to one line `해결됨 · <first words>`; choosing it opens the thread.
- At the bottom of `댓글`: a one-line field `댓글 달기` and `보내기`. While `보내기` cannot send, one grey line under it says why: `글 입력 대기` while the field is empty, `보내는 중` while a comment is on its way; the line is gone once it can send. Every answer field (a decision's, a stopped card's) follows the same rule.
- 보내기: on screen the comment shows at once under the thread with `<agent>에게 보냄 · 방금` and the field empties; in the record (`POST /api/lina/work/items/<id>/comments`) a new open comment by the owner. When the agent's reply reaches the record, the next refresh shows it under the comment with its result word and the pending line goes.
- A refused comment comes back into the field, the core's reason shows as one red line under it, and the thread is as it was.

## Sub-features

- `item-head` shows the check box, state and time
- `item-runs` lists the runs on the to-do
- `item-thread` shows comments with replies and folds resolved ones
- `item-comment` sends a comment and shows it pending until the reply

## How to get to it (user POV)

- Choose a to-do on a goal page or a 마감일 row.
- From 수신함: choose a `결정 필요` row aimed at a to-do; the to-do opens at once in the detail frame with its decision box and the place to answer it. In the scene, `배포를 금요일 오후에 할지 결정 필요` opens `배포 순서 정하기` (`#/items/T2`). A decision aimed at a goal opens the goal page with the same box.
- Address `/app/#/items/<id>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open a to-do.** On `결제 화면 개편`, choose `카드 입력 폼 다듬기`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive item-detail`.
- **Read it.** The check box `카드 입력 폼 다듬기 완료로 표시` is not `aria-disabled`; boxes `완료 조건`, `실행`, `댓글`, `대화`; the run line reads `카드 입력 폼 다듬기 · 진행 중`; 2 comments and 2 replies; the open reply reads `<author> · 1시간 전`, the one in the resolved thread `<author> · 55분 전 · 반영함`.
- **Resolved thread.** One `해결됨 · …` line, closed.
- **Button.** `보내기` is grey with `글 입력 대기` under it while the field is empty, and accent with no line once it has text; on a phone it is at least 44 px tall.
- **Comment.** Type `휴대폰 가로 화면도 봐 주세요` into `댓글 달기` and choose `보내기`. At once `<agent>에게 보냄 · 방금` shows and the field is empty; the synthetic record holds the owner's comment. Within 25 s the reply line `<agent> · 방금 · 반영함` shows and the pending line is gone.
- **Entry through 수신함 (its own path, a fresh load).** On `#/inbox` choose `배포를 금요일 오후에 할지 결정 필요` (its small line `릴리스 노트 정리 › 배포 순서 정하기`). The address is `#/items/T2`, the title `배포 순서 정하기`, and its `결정 필요` box holds that sentence, `질문` and `n일 전`.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/item-detail/item-detail-1280.{png,aria.yml,json}` and `item-detail-390.{png,aria.yml,json}`.

## Gotchas

- The synthetic agent replies to a comment 5 s after it, so the reply shows on the first 10 s refresh after that; a live core replies when the agent does.
- A drive writes to the synthetic copy only; reloading the page starts the scene again.

## Not goals

- No editing or deleting a comment.
- Talking with the agent is its own box, `대화` (talk.md).
