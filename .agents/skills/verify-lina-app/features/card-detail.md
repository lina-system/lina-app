# 작업 detail

A work card (`#/cards/<id>`) or a worker run outside any card (`#/runs/<id>`) opens its detail: title, state and time, what it is doing now, the to-dos it covers, the worker runs it started (dimmed, one line each) and its comments.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The head reads the title and `진행 중 · n분째` (or the stopped, waiting or done line).
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
- `run-detail` opens a run outside any card

## How to get to it (user POV)

- Choose a card on 진행 중인 작업, 완료, an agent screen or a goal page.
- Choose a 검토 필요 row in 수신함 for a run.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open a card.** On 진행 중인 작업, choose `릴리스 노트: 변경 목록 정리`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive card-detail`.
- **Read it.** State `진행 중 · n분째`; boxes `지금`, `할 일`, `실행`, `댓글`; 2 open check boxes, 1 worker run row at full opacity, 2 comments.
- **Open a run.** In 수신함 choose the 검토 필요 row. The address is `#/runs/<id>` and the state reads `대기 · 검토 필요 · n시간 전`.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/card-detail/card-detail-1280.{png,aria.yml,json}` and `card-detail-390.{png,aria.yml,json}`.

## Gotchas

- The worker run line uses the run's own state, never its to-do's.

## Not goals

- No timeline of the run's steps yet (lina-app#13).
- No retry or review actions yet.
