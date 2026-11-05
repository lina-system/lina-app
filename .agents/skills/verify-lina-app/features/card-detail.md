# 작업 detail

A work card (`#/cards/<id>`) or a worker run outside any card (`#/runs/<id>`) opens its detail: title, state and time, what it is doing now, the to-dos it covers, the worker runs it started (dimmed, one line each) and its comments.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The head reads the title and `진행 중 · n분째` (or the stopped, waiting or done line).
- A question the card asks the owner (from the work inbox) shows on top as a `결정 필요` box: the sentence, then agent, `질문` and age.
- Below the boxes and above the comments, `기록` is the run's own timeline (lina#201), on a card (its worker runs' records together) and on a worker run's page: one block per round, newest first, headed by its own start and end (`어제 23:41` when not today) and its outcome (`진행 중`, `검토 통과`, `검토 반려`, `작업 중단`, `작업 마침`, `완료 기록 없음`). Rows read oldest first: the run's sentences in the label colour, tool steps as one dim `도구 사용 n번`, the owner's comments with author and time, a sentence said n times in a row once with `×n`; a round whose start is not on record opens with a dim `시작 기록 없음`; a round's result line follows its rows (`결과`); a comment made between rounds is its own block. Raw English, paths, commands, ids and run numbers never show: such a line reads `가린 문장`. Each block folds; its open state and the scroll survive the record's refetch on its run's `worker` change event. A failed read shows one line `읽기 실패: 기록` in its place, and the rest of the detail keeps working.
- A worker run a card started is not on the board's list (the core lists only runs outside any card), so its row in `실행` names it by its kind (`코드 작업`) and still opens its own page: the card it belongs to and its timeline.
- `지금` shows the now line while it runs.
- `할 일` lists the to-dos the card covers with round boxes.
- `실행` lists the worker runs the card started, one line each, told apart by a smaller title and avatar, never by fading; the state word keeps normal secondary contrast. They never show as their own card elsewhere.
- A to-do the card covers is checked only when it is done; a card whose run is still going covers open to-dos.
- `댓글` shows each comment with author and time.
- A run outside any card opens at `#/runs/<id>` with its own state and the to-do it takes on.
- Only boxes that add something are drawn.

## Sub-features

- `card-head` shows title, state and time
- `card-now` shows what it does now
- `card-runs` dims the worker runs it started
- `run-detail` opens a run outside any card, or a card's own worker run
- `card-timeline` shows the run's own record round by round

## How to get to it (user POV)

- Choose a card on 진행 중인 작업, 완료, an agent screen or a goal page.
- Choose a `결정 필요` row in 수신함 whose small line reads `목표 › 작업`: it is the card's question; it opens in place, and its `목표 › 작업` link opens the card with the question box on top.
- Choose a 검토 필요 row in 수신함 for a run.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open a card.** On 진행 중인 작업, choose `릴리스 노트: 변경 목록 정리`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive card-detail`.
- **Read it.** State `진행 중 · n분째`; boxes `지금`, `할 일`, `실행`, `기록`, `댓글`; 3 check boxes; 3 worker run rows, one per round, dimmed by colour and weight at full opacity and without a state of their own; 2 comments.
- **Card question.** In 수신함 open `카드 번호는 앞 여섯 자리까지 보여 줄까요?` in place and choose its `목표 › 작업` link. The address is `#/cards/<id>` and the first box is `결정 필요` with that sentence, `질문` and `n일 전`.
- **Open a run.** In 수신함 choose the 검토 필요 row. The address is `#/runs/<id>` and the state reads `대기 · 검토 필요 · n시간 전`.
- **Timeline.** Driven in work-cards.md on `#/cards/k-101` and `#/runs/r1`; here `#/runs/r6`'s single round reads `… · 작업 마침` with its raw result line as `가린 문장`.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/card-detail/card-detail-1280.{png,aria.yml,json}` and `card-detail-390.{png,aria.yml,json}`.

## Gotchas

- The worker run line uses the run's own state, never its to-do's.

## Not goals

- No sentences of a round that ended before the last fetch: the hub does not keep them (lina#201), so such a round shows its span, outcome and result only.
- No retry or review actions yet.
