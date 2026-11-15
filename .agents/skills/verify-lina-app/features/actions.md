# Owner actions

The owner writes a to-do for themself, answers decisions, marks goals and to-dos done, takes a done mark back within ten minutes and asks a stopped card to try again, all through the core's client API (`POST /api/lina/work/items` for a new to-do, `/api/lina/work/items/<id>/done`, `/undo`, `/comments`, `/retry`, and `/api/plugins/kanban/work/inbox/<card>/answer` for a card's question). Each write shows its effect at once and falls back to the record's state when the core refuses.

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
- Answer: a 결정 필요 row opens its record in the detail frame (see inbox), where the decision is answered. Choosing an answer button (the recommended one marked `추천`) or sending the answer field hides the row and shows `답함 · 되돌리기` for 5 s. The answer is sent only when the toast ends; `되돌리기` in the toast brings the row back and sends nothing. In the record the answer is an owner comment of kind `answer` on the goal or to-do, which marks its decision answered; for a card's question it is an owner comment on the card, and the question leaves the work inbox.
- Add (lina-app#95, #154): `할 일 추가` at the end of the 작업 tab's `내 할 일 <n>` line (drawn with no to-dos too) opens, under the line, one field `할 일` that takes at most 25 characters (the core's `1-25 characters after trimming`) with `<n>자 남음` beside it, an optional `마감일` date, `저장` and `취소`; the field takes focus and scrolls clear of a phone's keyboard. `저장` (disabled while the field is empty) sends `{text, due}` (`due` null with no date). The row is never drawn before the core takes it: the core answers the new `/work/items` row and the record's read that follows (or the `work` event) brings it under `내 할 일`, the form closes and the toast reads `할 일 추가함`. The new row stands first in the list, where the form was, above the `외 n개` fold, keeping its round check box, at every width: the core lists the owner's to-dos in the order they were made, so it is the last of them and would fall behind the fold (54 on the hub; lina-app#175). It stays first while the home is open, a done mark's undo included; the head still counts every row. In the record it is an owner's to-do with no goal (`mine`, added by the owner). A refusal keeps the text in the field and shows the core's one line under it.
- Retry: a stopped card in 진행 중인 작업 that running again can clear has `다시 시도` (not one waiting on an answer or a review, running.md); it asks the agent to try again: a work card always with the owner's comment `다시 시도해 주세요.` on the card (even once its read detail names its runs' to-do), a run with a comment on its to-do. The row reads `<agent>에게 요청함` until the card's state or its last event moves (lina-app#157), however long that takes; `다시 시도` stays hidden meanwhile and a second press sends nothing. The card's detail head reads the same words for as long, never `결정 기록 있음` (lina-app#211, card-detail.md).
- A work card's request is read back from the card (lina-app#208): its row reads the card's comments, and an owner's `다시 시도해 주세요.` newer than the row's last beat (its stop time when it has none) reads `<agent>에게 요청함` after a reload, in a second window and on a page opened from its kept copy (the copy keeps every stopped card's read detail), with no `다시 시도`. Until those comments are read, `다시 시도` is drawn grey and disabled. A beat after the comment ends the request and `다시 시도` stands again. A run's request lives on its to-do in the core's own words, which the app cannot tell from other comments: it stands only on the page that sent it (lina#749).
- Every write: the control is disabled while the request runs. A refusal shows one red line under the control, mapped from the core's `detail` in `src/words.ts`: `열린 할 일 있음`, `10분 지나 되돌릴 수 없음`, `되돌릴 완료 표시 없음`, `열린 결정 없음`, `이미 닫힌 항목`, `글 없음`, `글은 <n>자까지` (the number from the core's `text must be 1-<n> characters`: 2000 for a comment, 25 for a new to-do), `쓰기가 너무 많음` (429), `찾을 수 없음`; a text the writing guide refuses (`Guide: … · work fields <field>`, lina-app#183) reads `글쓰기 규칙 · <rules> 없는 제목만 저장됨` when the core names the rules it hit (`괄호`, `번호`, `명령·옵션`, `경로`, `내부 이름`, `앞의 '이름: ' 꼬리표`, `기기 이름`) and otherwise `글쓰기 규칙에 맞지 않는 제목 · 번호, 명령·옵션, 경로, 내부 이름, 괄호, 앞의 '이름: ' 꼬리표는 뺌` (`글` for a field that is not a title), with no `다시 시도`; any other refusal reads `저장하지 못함 · 다시 시도`, never the core's own words (lina-app#154). The screen goes back to the record's state.
- A refused add keeps its text and its line until the text changes or the owner leaves the home (a page opened from it, which keeps the home drawn underneath); only a taken add closes the form, and its toast reads `할 일 추가함` alone (lina-app#154).

## Sub-features

- `action-add` writes an owner's to-do from the 내 할 일 line
- `action-done` marks a goal or to-do done with a toast
- `action-undo` takes the mark back from the toast or the page
- `action-with-open` asks before closing a goal with open to-dos
- `action-answer` answers a decision after the toast
- `action-retry` asks a stopped card to try again
- `action-refused` shows the refusal and reverts

## How to get to it (user POV)

- 수신함: the 내 할 일 check boxes and the 결정 필요 rows.
- 작업 (`#/`): `할 일 추가` after the `내 할 일 <n>` line.
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
- **Answer with choices.** In 수신함 open `배포를 금요일 오후에 할지 결정 필요` and in its frame choose `금요일 오후 · 추천`. The row leaves, `답함` shows, no answer in the record yet; after the toast the record has the owner's answer `금요일 오후` and the row stays gone.
- **Free-text answer and a card question.** Open `자주 쓰는 검색어 열 개 확인 필요`, type into its frame's `답 달기`, `보내기` (on a phone close the sheet afterwards); after the toast the record has the answer. Do the same on `카드 번호를 앞 여섯 자리까지 표시할지 결정 필요`: the card gets the owner's comment and its question leaves the work inbox. From the fresh load's 4 decisions, 2 are left.
- **Add, by hand until the driver has it.** On `#/` choose `할 일 추가`, type `영수증 정리` into `할 일`, set `마감일`, choose `저장`: the list `내 할 일` holds the row `영수증 정리` with its date first, above any fold, the line reads `내 할 일 3`, the toast `할 일 추가함`; `window.__linaScene` has the to-do under `board.inbox.mine`. Its box ticks done and 되돌리기 takes it back like any other.
- **Retry.** On `#/running` choose `다시 시도`. The row reads `<agent>에게 요청함`; the card `결제: 오류 문구 바꾸기` has the owner's comment `다시 시도해 주세요.`; six seconds later (past the toast) the line still stands and there is no `다시 시도`, since the card has not moved.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/actions/actions-1280.{png,aria.yml,json}` and `actions-390.{png,aria.yml,json}`.

## Gotchas

- Never press these controls on a live core (README, Never press).
- An add cannot be taken back: the core has no route that removes an owner's to-do, so its toast offers no 되돌리기. The new to-do's done mark can be undone like any other.
- A refused add is held by the unit tests in `src/screens.test.tsx` and `src/data/data.test.ts`; the synthetic scene refuses only empty, over-long or wrongly dated text, which the screen does not send. The synthetic scene still takes up to 2000 characters where the core takes 25; the field's 25-character limit keeps the screen from sending more (lina-app#154).
- The answer waits for the toast: a check right after the tap sees no answer in the record, by design.
- A reload resets the synthetic scene, so the scene cannot show a retry surviving a reload: that is held by `src/retry-asked.test.tsx` (fresh page, second window, kept copy) and was shown on a disposable core with a `gave_up` card (lina-app#208).
- Refusals (409 after ten minutes, a goal with open to-dos sent without `withOpen`, an answer with no open decision) are held by the unit tests in `src/screens.test.tsx` and `src/data/data.test.ts`; the synthetic scene does not reach them through the screen.

## Not goals

- No editing an answer once sent; a new comment does that.
- No add from 수신함 or the agent screen; the 작업 tab's 내 할 일 line is the one place.
