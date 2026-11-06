# 작업 detail

A work card (`#/cards/<id>`) or a worker run outside any card (`#/runs/<id>`) opens its detail: title, state and time, what it is doing now, the to-dos it covers, the worker runs it started (dimmed, one line each) and its comments.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The head reads the title and `진행 중 · n분째` (or the stopped, waiting or done line). A work card's title is its checked title, or its own title until the checked one is written, shortened to the row width; the kind stays the icon and word. A run outside any card without a checked title keeps its kind of work in grey.
- A question the card asks the owner (from the work inbox) shows on top as a `결정 필요` box: the sentence, then agent, `질문` and age.
- Below the boxes and above the comments, `기록` is the run's own timeline (lina#201), on a card (its worker runs' records together) and on a worker run's page. It is the card's one round list: one block per round, newest first, headed `라운드 n · <start–end> · <outcome>` (`어제 23:41` when not today; the end alone when the start is not on record, never a dangling dash) with the outcome `진행 중`, `검토 통과`, `검토 반려`, `작업 중단`, `작업 마침` or `완료 기록 없음`. On a card each round's head is the keyboard-reachable link to that round's worker run (`#/runs/<id>`). Rows read oldest first: the run's sentences in the label colour, tool steps as one dim `도구 사용 n번`, the owner's comments with author and time, a sentence said n times in a row once with `×n`; a round whose start is not on record opens with one dim `시작 기록 없음`; a round's result line follows its rows (`결과`); a comment made between rounds is its own block. A sentence or a result line that would show raw English, a path, a command, an id or a run number is left out, with no placeholder; a round left with no rows still shows its head. A comment that would show raw text stays as its folded entry (`접힌 댓글`). Each block folds; its open state and the scroll survive the record's refetch on its run's `worker` change event. A failed read shows one line `읽기 실패: 기록` in its place, and the rest of the detail keeps working.
- A worker run a card started is not on the board's list (the core lists only runs outside any card); its round's head still opens its own page: the card it belongs to and its timeline.
- `지금` shows the now line while it runs.
- `할 일` lists the to-dos the card covers with round boxes.
- `실행` stands only while the record is not shown (no record yet, or under the error line when its read failed, so the worker links never disappear). It lists the worker runs the card started, one line each, told apart by a smaller title and avatar, never by fading; the state word keeps normal secondary contrast. They never show as their own card elsewhere.
- A to-do the card covers is checked only when it is done; a card whose run is still going covers open to-dos.
- `댓글` shows each comment with author and time.
- A run outside any card opens at `#/runs/<id>` with its own state and the to-do it takes on.
- A worker run's page names the model that run used once, under its head, the way 설정 names it, with its effort (`model-a · 보통`). A run that started on the fallback model ends the line with `대체 모델` (`model-b · 높음 · 대체 모델`). A run with no model draws no line. The rounds of that page's 기록 draw no model line. The settings revision is not shown.
- On a card's 기록, each round shows its own run's model under the round's head, dim, once: the worker run that round was, the same one its head opens. A round whose run has none shows nothing. A comment block shows none.
- Only boxes that add something are drawn.

## Sub-features

- `card-head` shows a work card's checked or own title (a run's checked title or kind word), state and time
- `card-now` shows what it does now
- `card-runs` dims the worker runs it started
- `run-detail` opens a run outside any card, or a card's own worker run
- `run-model` names a run's model once under its head; a card's 기록 also names each round's own run
- `card-timeline` shows the run's own record round by round

## How to get to it (user POV)

- Choose a card on 진행 중인 작업, 완료, an agent screen or a goal page.
- Choose a `결정 필요` row in 수신함 whose small line reads `목표 › 작업`: it is the card's question; it opens in place, and its `목표 › 작업` link opens the card with the question box on top.
- Choose a 검토 필요 row in 수신함 for a run.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open a card.** On 진행 중인 작업, choose `릴리스 변경 목록 정리`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive card-detail`.
- **Read it.** State `진행 중 · n분째`; boxes `지금`, `할 일`, `기록`, `댓글` (no `실행` beside the record); 3 check boxes reading `변경 목록 모으기` (checked), `모은 변경 확인`, `공지 문구 확인`; the round heads link to `#/runs/r1`, `#/runs/r10`, `#/runs/r9`; 4 comments (the agent's note in round 1 and the owner's three, which are also the record's comment rows).
- **Own title.** Open `#/cards/k-102`: its head reads `위키: 결제 화면 문서 정리` with the `문서` kind and no `지금`, not `코드 작업`.
- **Card question.** In 수신함 open `카드 번호는 앞 여섯 자리까지 보여 줄까요?` in place and choose its `목표 › 작업` link. The address is `#/cards/<id>` and the first box is `결정 필요` with that sentence, `질문` and `n일 전`.
- **Open a run.** In 수신함 choose the 검토 필요 row. The address is `#/runs/<id>` and the state reads `대기 · 검토 필요 · n시간 전`.
- **Timeline.** Driven in work-cards.md on `#/cards/k-101` and `#/runs/r1`; here `#/runs/r6`'s single round reads `라운드 1 · <hh:mm>–<hh:mm> · 작업 마침` and its raw result line is left out: no result line, no `가린 문장`.
- **Model.** Open `#/runs/r1`: one line under the head, `model-a · 보통`, and no model line inside 기록. On `#/cards/k-101`, round 3 of 기록 shows `model-a · 보통` under its head, dim, once; rounds 2 and 1 show nothing (their runs have no model), and the comment blocks show none. Open `#/runs/r8`: one line under the head, `model-b · 높음 · 대체 모델`, and none inside 기록. Open `#/runs/r6`: no model line. None of these pages shows a settings revision.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/card-detail/card-detail-1280.{png,aria.yml,json}` and `card-detail-390.{png,aria.yml,json}`.

## Gotchas

- The worker run line uses the run's own state, never its to-do's.

## Not goals

- No sentences of a round that ended before the last fetch: the hub does not keep them (lina#201), so such a round shows its span, outcome and result only.
- No retry or review actions yet.
