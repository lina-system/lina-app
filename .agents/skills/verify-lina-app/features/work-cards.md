# Work cards

Each piece of work is one card: a work card (a kanban sub-card an agent runs a slice of a goal in) or a worker run started outside any card. The home (진행 중인 작업) lists them in one order, and each card updates in place from the change stream. A card is a kind icon, the agent mark, a one-line title and one grey state-and-time line; every line is the core's checked line (`plain`, lina#151), never the raw title, a file name, a run id or an English topic.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Home order: one `결정 필요 <n>` line (only when there are any, the inbox's number), the stopped and running cards in one list (stopped on top, `중단됨 · <reason>` in red), then `대기`, `24시간 안에 끝남` and `이전에 끝남`, each with its count.
- A wide window opens on the home; on a phone it is the `진행 중인 작업` row of the menu. On a phone nothing but the large title sits above the list.
- One card per run: follow-up rounds of one card stay one card; two jobs stay two cards even when they share a to-do and one generated title. Worker runs started by a card show only inside its detail.
- The title is `plain.title`; a running card's now line (wide windows) is `plain.now`. A line the core has not written, or one that failed its check, is null and draws nothing: a card with no checked lines shows its icon, mark and state line only, and its detail shows its kind and state without a title.
- When the writer of the checked lines has stopped, the freshness line adds one orange `· 요약 멈춤`.
- Every count equals its list: the sidebar's `진행 중인 작업` grey and red numbers are the running list, `완료` is the two finished sections, and each section head is its rows.
- A card's detail: its kind icon and word, its title and state line; then `지금` (`plain.now`), `끝난 것` (`plain.result` and its finished to-dos), `다음` (its first open to-do), `할 일` (the to-dos it owns), `실행` (its worker runs, dimmed, grouped by follow-up round, newest round first, each round with its own start and end time) and its comments.
- A card's checked lines change in place when its kanban event arrives: only the card list and that card's detail are read again (live.md).

## Sub-features

- `cards-home` orders the home: decisions, stopped and running, waiting, the last 24 hours, older
- `cards-one` keeps one card per run and per job
- `cards-plain` draws only the checked lines, nothing in place of a missing one
- `cards-writer` says 요약 멈춤 when the writer stopped
- `cards-counts` makes every count equal its list
- `cards-detail` shows now, done so far, next, to-dos and worker runs by round

## How to get to it (user POV)

- Open the app on a wide window, or choose `진행 중인 작업` on a phone's first screen.
- Choose a card for its detail.
- Address `/app/#/running` or `/app/#/cards/<id>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`. In its scene k-101 is in its third follow-up round, k-102 has no checked lines at all, r7 and r8 are two jobs on one to-do with one generated title (r7 finished 30 minutes ago, r8 two days ago), and k-103 is stopped with no response. `&writer=stopped` stops the writer.

- **Home.** Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive work-cards`. On `#/` (1280) or the menu's `진행 중인 작업` (390) the lists read `수신함`, `진행 중인 작업`, `대기`, `24시간 안에 끝남`, `이전에 끝남`; the decisions line is `결정 필요 4`; the first card ends `중단됨 · 응답 없음`.
- **Counts.** Each section's count equals its rows; at 1280 the sidebar's 진행 중인 작업 numbers add up to the running list and 완료 equals the two finished sections.
- **One card per run.** `릴리스 노트: 변경 목록 정리` shows once and r9, r10 not at all; `가이드 초안 다듬기` shows twice, to `#/runs/r7` and `#/runs/r8`.
- **Checked lines.** No raw title or live line (`grouping merged PRs`, `payment card-form polish`, `guide-draft.md`) is on the home; `변경 목록을 기능별로 묶는 중` shows at 1280 only. The k-102 card has no title and reads `진행 중`; its detail has no title, the kind `코드` and no `지금`.
- **Detail.** `#/cards/k-101` shows `지금`, `끝난 것`, `다음`, `할 일`, `실행`, `댓글`; its rounds read `라운드 3 · <hh:mm> · 진행 중`, `라운드 2 · <hh:mm>–<hh:mm>`, `라운드 1 · …`, every worker run dimmed.
- **Writer stopped.** `#/running&writer=stopped` shows one `· 요약 멈춤`; at 390 the phone measurements hold.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/work-cards/work-cards-1280.{png,aria.yml,json}` and `work-cards-390.{png,aria.yml,json}`.

## Gotchas

- Round times are clock times of the scene's own `now`; match their shape, not their digits.
- A card's update in place from its kanban event is driven in the unit tests (`src/screens.test.tsx`, work cards): the synthetic page has no hand that writes checked lines on its own.
- The `phone` driver measures `#/cards/k-102` and `#/runs/r7` with the other phone screens.

## Not goals

- No tabs on the phone's first screen; the menu stays the first screen and the home is its `진행 중인 작업` row.
- No interactive filter on the home; filtering by agent is the agent screen (agent-screen.md).
- No goal-level card grouping on the home (goals.md).
