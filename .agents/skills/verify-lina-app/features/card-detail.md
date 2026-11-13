# 작업 detail

A work card (`#/cards/<id>`) or a worker run outside any card (`#/runs/<id>`) opens its detail in the one detail frame: title, state and time, what it is doing now, the to-dos it covers, the worker runs it started (dimmed, one line each) and its comments, one line each.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- A card or a run opens in the one detail frame (lina-app#142), wherever it is chosen: the right-hand pane beside the list at desktop width (it scrolls on its own, so it opens where the owner is looking however far down the list they chose it; the window, the toolbar and the menu never scroll away), a sheet rising from the bottom over the list at phone width, with `닫기`. The tab, the header and the list stay as they were. Back closes the frame; the list is at the scroll it had and the chosen row stays highlighted.
- The head reads the title and `진행 중 · 시작 n분 전` (or the stopped, waiting or done line). A stopped card or run reads the same words and the same time as its 중단됨 row on the home, from one function (`stopReason` in `src/model/stop-reason.ts`, the time from `cardTime`): `중단됨 · <owner> 확인 필요 · 3시간 전` on both, never `중단됨 · 결정 필요` on one and `확인 필요` on the other.
- A stopped card that waits on the owner has the place to answer it under its head: a `답 달기` field and `보내기`, sent as the answer to its question (the same as from 수신함). While `보내기` cannot send, one grey line under it says why (`글 입력 대기`, `보내는 중`). A card stopped on anyone else has none. A work card's title is its checked title, or its own title until the checked one is written — only while that own title passes the app's raw-text rule, else the kind word stands in grey — shortened to the row width; the kind stays the icon and word. A run outside any card without a checked title keeps its kind of work in grey.
- A question the card asks the owner (from the work inbox) shows on top as a `결정 필요` box: the sentence, then agent, `질문` and age.
- Below the boxes and above the comments, `기록` is the run's own timeline (lina#201), on a card (its worker runs' records together) and on a worker run's page. It is the card's one round list: one block per round, newest first, headed by one history line `<time> · <outcome>[ · <result sentence>]` with no round number (lina-app#61, #123, #142; `어제 23:41` when not today): the time is a going round's start and an ended round's end (its start when the end is not on record), the outcome `진행 중`, `검토 통과`, `검토 필요`, `중단됨`, `완료` or `완료 기록 없음`, then the round's result line, cut to its first sentence, when it left one a person may read (`02:11 · 검토 통과 · 병합된 변경 41개를 모음`). There is no second result line. On a card each round's head is the keyboard-reachable link to that round's worker run (`#/runs/<id>`). Rows read oldest first, one event per line in the form `<time> · <one sentence>` (`14:05`, `어제 23:41`, `11월 9일 08:10`; lina-app#123, #128): the run's sentences in the label colour, tool steps as one dim `도구 사용 n번`, the owner's comments with author and time, a sentence said n times in a row once with `×n`; a round whose start is not on record opens with one dim `시작 기록 없음`; a round's result line follows its rows (`결과`); a comment made between rounds is its own block. A sentence or a result line that would show raw English, a path, a command, an id or a run number is left out, with no placeholder; a round left with no rows still shows its head. A comment that would show raw text stays as its folded entry (`접힌 댓글`). Each block folds; its open state and the scroll survive the record's refetch on its run's `worker` change event. A failed read shows one line `읽기 실패: 기록` in its place, and the rest of the detail keeps working.
- A card's detail is read when the card opens, never at the first load (lina-app#100). While it is read the card shows its list row at once: the head (title, kind, state and time) and `지금`, with `불러오는 중` below; the boxes fill in when it answers.
- A worker run a card started is not on the board's list (the core lists only runs outside any card); its round's head still opens its own page: the card it belongs to and its timeline. Opened on its own before its card (a reload or a link from elsewhere), the run's record names its card (`cardId`) and the page reads that card's detail: meanwhile it shows the kind word, model line and `불러오는 중`, never a round outcome it cannot know yet; then the card row and the timeline as when opened from the card. A worker run with no record to read (an older run the core has none for) cannot name its card before the card opens: its page keeps the kind word and one `읽기 실패: 기록` line, never `찾을 수 없음`.
- `지금` shows the now line while it runs.
- `할 일` lists the to-dos the card covers, each with a round mark that only shows its state: the card cannot change a to-do, so the mark is no control and has no action name (no `<title> 완료로 표시`); a done one reads `완료` to a screen reader (lina-app#128).
- `실행` stands only while the record is not shown (no record yet, or under the error line when its read failed, so the worker links never disappear). It lists the worker runs the card started, one line each, `<time> · <state word>`: when it started (first seen), then `진행 중` while it beats, else how its round ended (`완료`, `중단됨`), else `완료 기록 없음`; never `코드 작업`, and never the card's title again on every line (the head carries it, lina-app#142). They never show as their own card elsewhere.
- A to-do the card covers is checked only when it is done; a card whose run is still going covers open to-dos.
- `댓글` shows each comment as one history line, `<time> · <first sentence>`: ids, hashes, paths, commands and addresses are left out of the sentence and it is cut at 60 characters with `…`; the author is the line's tooltip. Only a comment with no readable word left reads `접힌 댓글`. A comment row in `기록` is the same one line.
- A run outside any card opens at `#/runs/<id>` with its own state and the to-do it takes on.
- A worker run's page names the model that run used once, under its head, by the plain name the model list gives it, with its effort (`<name> · 보통`). A run that started on the fallback model ends the line with `대체 모델` (`<name> · 높음 · 대체 모델`). A model the list names only by an id is an alias (`model-a`, `model-b`) and draws no line (lina-app#128); neither does a run with no model. The rounds of that page's 기록 draw no model line. The settings revision is not shown.
- On a card's 기록, each round shows its own run's model under the round's head, dim, once: the worker run that round was, the same one its head opens. A round whose run has none shows nothing. A comment block shows none.
- Only boxes that add something are drawn.

## Sub-features

- `card-head` shows a work card's checked or own title (a run's checked title or kind word), state and time
- `card-now` shows what it does now
- `card-runs` dims the worker runs it started
- `run-detail` opens a run outside any card, or a card's own worker run
- `run-model` names a run's model once under its head; a card's 기록 also names each round's own run
- `card-timeline` shows the run's own record round by round, one `<time> · <sentence>` line per event; a finished run with no record lists its start and its result line

## How to get to it (user POV)

- Choose a card on 진행 중인 작업, 완료, an agent screen or a goal page.
- Choose a `결정 필요` row in 수신함 whose small line reads `목표 › 작업`: it is the card's question; choosing it opens the card in the detail frame with the question box on top and the place to answer it.
- Choose a 검토 필요 row in 수신함 for a run.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open a card.** On 진행 중인 작업, choose `릴리스 변경 목록 정리`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive card-detail`.
- **Read it.** State `진행 중 · 시작 n분 전`; boxes `지금`, `할 일`, `기록`, `댓글` (no `실행` beside the record); 3 to-do marks (no check box, nothing named `완료로 표시` or `aria-disabled`) beside `변경 목록 모으기` (done), `모은 변경 확인`, `공지 문구 확인`; the round heads link to `#/runs/r1`, `#/runs/r10`, `#/runs/r9`; 4 comments (the agent's note in round 1 and the owner's three, which are also the record's comment rows).
- **Own title.** Open `#/cards/k-102`: its head reads `위키: 결제 화면 문서 정리` with the `문서` kind and no `지금`, not `코드 작업`.
- **Card question.** In 수신함 choose `카드 번호를 앞 여섯 자리까지 표시할지 결정 필요`. The address is `#/cards/<id>` and the first box is `결정 필요` with that sentence, `질문` and `n일 전`.
- **Open a run.** In 수신함 choose the 검토 필요 row. The address is `#/runs/<id>` and the state reads `대기 · 검토 필요 · n시간 전`.
- **Timeline.** Driven in work-cards.md on `#/cards/k-101` and `#/runs/r1`; here `#/runs/r6`'s single round reads `<hh:mm> · 완료` and its raw result line is left out: no result sentence, no `가린 문장`.
- **Model.** The scene's models have no plain name (`model-a`, `model-b` are ids): `#/runs/r1`, `#/cards/k-101`, `#/runs/r8` and `#/runs/r6` show no model line and no `model-` text. A model with a plain name reads `<name> · 보통` once under a run's head (src/screens.test.tsx). None of these pages shows a settings revision.
- **Card's worker run.** `#/runs/r1` reads `릴리스 변경 목록 정리` with `진행 중`; `#/cards/k-104`'s 실행 line reads `<hh:mm> · 완료 기록 없음` under its head `결제: 실패 화면 검토`; neither reads `코드 작업`.
- **Past events without a record.** `#/runs/r7` (finished, no record) shows `기록` with two lines, `<hh:mm> · 작업 시작` and `<hh:mm> · 용어 표를 맨 앞으로 옮김`.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/card-detail/card-detail-1280.{png,aria.yml,json}` and `card-detail-390.{png,aria.yml,json}`.

## Gotchas

- The worker run line uses the run's own state, never its to-do's.

## Not goals

- No sentences of a round that ended before the last fetch: the hub does not keep them (lina#201), so such a round shows its span, outcome and result only.
- No retry or review actions yet.
