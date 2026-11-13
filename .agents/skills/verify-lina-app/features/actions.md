# Owner actions

The owner answers decisions, marks goals and to-dos done, takes a done mark back within ten minutes and asks a stopped card to try again, all through the core's client API (`/api/lina/work/items/<id>/done`, `/undo`, `/comments`, `/retry`, and `/api/plugins/kanban/work/inbox/<card>/answer` for a card's question). Each write shows its effect at once and falls back to the record's state when the core refuses.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- A ticked row stays where it is, struck through with a checked box, for the toast's 5 s (undo puts it back unchecked); in a list that drops done items (수신함 내 할 일) it leaves when the toast ends, or on the next refresh after that.
- Every count is the length of the list it labels at every moment: a decision row hidden for its answer's toast is out of `결정 필요` and the sidebar `수신함`, and undo puts both back.
- Text buttons (`보내기`, `함께 완료`, `취소`, `되돌리기`, `다시 시도`, `모두 읽음`, `닫기`) are accent when enabled and grey only when disabled; on a phone they are at least 44 px tall.
- Done: a tap on a round check box (수신함 내 할 일, a goal's to-dos, a to-do's head, a goal's head, a goal line whose to-dos are all closed) strikes the row through and checks the box at once, sends done at once, and shows the toast `완료로 표시함 · 되돌리기` for 5 s. The box is then named `<title> 완료됨` (before: `<title> 완료로 표시`). In the record the item is done, with the owner's mark.
- Undo: `되돌리기` in the toast sends undo; after the toast the item's page shows `되돌리기` in its head until the mark's ten minutes are over, and a checked box can be tapped again in that time. In the record the item is back in the state it had.
- Done with open to-dos: ticking a goal with open to-dos asks once `열린 할 일 n개도 함께 완료할까요?` with `함께 완료` and `취소`; `함께 완료` sends `withOpen: true` and closes the goal and its open to-dos together; one undo reopens all of them.
- Answer: a 결정 필요 row expands in place (see inbox). Choosing an answer button (the recommended one marked `추천`) or sending the answer field hides the row and shows `답함 · 되돌리기` for 5 s. The answer is sent only when the toast ends; `되돌리기` in the toast brings the row back and sends nothing. In the record the answer is an owner comment of kind `answer` on the goal or to-do, which marks its decision answered; for a card's question it is an owner comment on the card, and the question leaves the work inbox.
- Retry: a stopped card in 진행 중인 작업 has `다시 시도`; it asks the card's to-do's agent to try again (a comment on the to-do; a card whose to-do is not known gets a comment on the card: the core's board does not list a card's own runs, so a work card always takes it on the card), and the row reads `<agent>에게 요청함` for five seconds.
- Every write: the control is disabled while the request runs. A refusal shows one red line under the control, mapped from the core's `detail` in `src/words.ts`: `열린 할 일 있음`, `10분 지나 되돌릴 수 없음`, `되돌릴 완료 표시 없음`, `열린 결정 없음`, `이미 닫힌 항목`, `글 없음`, `글은 2000자까지`, `쓰기가 너무 많음` (429), `찾을 수 없음`; any other line as the core gives it. The screen goes back to the record's state.

## Sub-features

- `action-done` marks a goal or to-do done with a toast
- `action-undo` takes the mark back from the toast or the page
- `action-with-open` asks before closing a goal with open to-dos
- `action-answer` answers a decision after the toast
- `action-retry` asks a stopped card to try again
- `action-refused` shows the refusal and reverts

## How to get to it (user POV)

- 수신함: the 내 할 일 check boxes and the 결정 필요 rows.
- A goal page (`#/goals/<id>`): its head's check box and its to-dos' boxes; a to-do page (`#/items/<id>`): its head.
- 진행 중인 작업: `다시 시도` on a stopped card.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene. Each step that needs the starting scene reloads the page; drivers read the page's copy of the record through `window.__linaScene`.

Each step below starts from a fresh load, so its counts hold on their own.

- **Held done row.** In 수신함 tick `공지 문구 확인 완료로 표시`. After the record is done the row is still listed as `공지 문구 확인 완료됨`, struck through, `내 할 일` reads 2 (sidebar 수신함 8 at 1280); when the toast ends the row is gone, `내 할 일` 1 (수신함 7).
- **Undo a held row.** Tick `저장소 접근 권한 주기 완료로 표시`, then 되돌리기 in the toast: the row is back unchecked, the record planned, `내 할 일` 2.
- **Counts during an answer's toast.** Expand `배포를 금요일 오후에 할지 결정 필요` and choose `금요일 오후 · 추천`: `결정 필요` reads 3 with 3 rows (sidebar 수신함 7); 되돌리기 in the toast: 4 rows, `결정 필요` 4, 수신함 8.
- **Done, then undo.** Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive actions`. On `#/goals/G2` tick `결제 실패 화면 검토 완료로 표시`. At once the box is `결제 실패 화면 검토 완료됨`, the title is struck through and the toast reads `완료로 표시함`; the record says done. 되돌리기 in the toast: the box is unchecked and the record is back to waiting.
- **되돌리기 on the page.** On `#/items/T3` tick the head's box. No 되돌리기 in the head while the toast shows; after it, the head shows `되돌리기` (the record's window is 600 s); choosing it reopens the record.
- **Done with open to-dos.** On `#/goals/G1` tick the goal. `열린 할 일 3개도 함께 완료할까요?` and nothing written yet; `함께 완료` and `취소` are accent text buttons; `함께 완료`: the goal and its 3 to-dos are done, 4 boxes checked; 되돌리기 in the toast reopens all four as they were.
- **Answer with choices.** In 수신함 expand `배포를 금요일 오후에 할지 결정 필요` and choose `금요일 오후 · 추천`. The row leaves, `답함` shows, no answer in the record yet; after the toast the record has the owner's answer `금요일 오후` and the row stays gone.
- **Free-text answer and a card question.** Expand `자주 쓰는 검색어 열 개 확인 필요`, type into `답 달기`, `보내기`; after the toast the record has the answer. Do the same on `카드 번호를 앞 여섯 자리까지 표시할지 결정 필요`: the card gets the owner's comment and its question leaves the work inbox. From the fresh load's 4 decisions, 2 are left.
- **Retry.** On `#/running` choose `다시 시도`. The row reads `<agent>에게 요청함`; the card `결제: 오류 문구 바꾸기` has the owner's comment `다시 시도해 주세요.`; after five seconds the line goes and `다시 시도` is back.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/actions/actions-1280.{png,aria.yml,json}` and `actions-390.{png,aria.yml,json}`.

## Gotchas

- Never press these controls on a live core (README, Never press).
- The answer waits for the toast: a check right after the tap sees no answer in the record, by design.
- Refusals (409 after ten minutes, a goal with open to-dos sent without `withOpen`, an answer with no open decision) are held by the unit tests in `src/screens.test.tsx` and `src/data/data.test.ts`; the synthetic scene does not reach them through the screen.

## Not goals

- No editing an answer once sent; a new comment does that.
- No quick add (lina-app#9).
