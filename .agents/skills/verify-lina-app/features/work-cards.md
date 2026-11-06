# Work cards

Each piece of work is one card: a work card (a kanban sub-card an agent runs a slice of a goal in) or a worker run started outside any card. The home (진행 중인 작업) lists them in one order, and each card updates in place from the change stream. A card is a kind icon, the agent mark, a one-line title and one grey state-and-time line; a work card's title is the core's checked line when it is written, else the card's own title until then, while a run without a checked title shows its kind word in grey. Every other line is the core's checked line (`plain`, lina#151), never a file name, a run id or an English topic.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Home order: one `결정 필요 <n>` line (only when there are any, the inbox's number), the stopped and running cards under `진행 중` with the running count and the stopped one in red (stopped on top, `중단됨 · <reason>` in red), then `대기`, `24시간 안에 끝남` and `이전에 끝남`, each with its count.
- A finished card says when it ended (`완료 · 20분 전`, `완료 · 2일 전`); how long it took (`20분 걸림`) is in its detail. Cards under `이전에 끝남` ended more than 24 hours ago.
- A wide window opens on the home; on a phone it is the `진행 중인 작업` row of the menu. On a phone nothing but the large title sits above the list.
- One card per run: follow-up rounds of one card stay one card; two jobs stay two cards even when they share a to-do and one generated title. Worker runs started by a card show only inside its detail.
- The title is `plain.title`; a running card's now line (wide windows) is `plain.now`. A work card without a checked title shows its own title, shortened to the row width (never sliced), on the home, 완료, the agent screen and its detail head, and its kind is read from the same text — but only while that own title passes the app's raw-text rule (a path, a command, an English word and so on). An own title the rule refuses draws nothing: the card keeps its kind of work in grey (`코드 작업`, `문서 작업`, `조사`, `기기 작업`), and its kind is read from the checked title alone. A run without a checked title keeps its kind of work in grey. A line the core has not written, or one that failed its check, is null and never shows raw text; a missing now line draws nothing.
- When the writer of the checked lines has stopped, the freshness line adds one orange `· 요약 멈춤`.
- Every count equals its list: the sidebar's `진행 중인 작업` grey and red numbers are the running list, `완료` is the two finished sections, and each section head is its rows.
- A card's detail: its kind icon and word, its name and state line; then `지금` (`plain.now`), `끝난 것` (only its result line, when it has one), `할 일` (the to-dos it owns), `기록` (its rounds, newest first, each head `라운드 n · <start–end> · <outcome>` linking to the round's worker run; see card-detail.md) and its comments. The rounds show once: `실행` (its worker runs by round, in the secondary label colour and regular weight) stands only while the record is not shown, and under the error line when the record's read failed. A box shows only when it adds something: nothing repeats the to-do list.
- A running card with to-dos shows a thin bar and its count (`1/3`) after its lines on a wide window; on a phone the bar is in its detail head only.
- A comment on a card shows its sentence with author and time. One that would show a path, a command, a hash, an issue number, an address or a cut-off fragment is one folded entry, `접힌 댓글 · <author> · <time>`; its text opens only when chosen.
- A round whose start fell out of the kept history shows one dim line, `라운드 n · 시작 기록 없음`, only when it holds content (a line it said, or a worker run), and draws that content under it dimmed; a round with only its end on record shows nothing. A line that would show a path or a command reads `접힌 댓글`.
- A stopped card's detail head shows `중단됨 · <reason>` in red, as on the home; its time stays grey.
- A card just created (예정, not started) shows only on its agent's screen, in a `예정 n` group after `검토 필요`, with no time beside it (agent-screen.md); the home keeps its order without it.
- 완료's agent filter is the address (`#/done?agent=<id>`): it survives a reload and every live update, nothing goes to web storage, each choice's count is the list it shows, and the filtered list's `최근 활동 <time>` reads the same as on the agent's screen.
- A card's detail and a worker run's page show the run's own timeline below the boxes and above the comments (card-detail.md); it refetches on the run's `worker` change event and keeps its open state.
- A card's checked lines change in place when its kanban event arrives: only the card list and that card's detail are read again (live.md).

## Sub-features

- `cards-home` orders the home: decisions, stopped and running, waiting, the last 24 hours, older
- `cards-one` keeps one card per run and per job
- `cards-plain` draws a work card's checked title, or its own title until that exists when the raw-text rule lets it; a run without one keeps its kind word, and a missing now line nothing
- `cards-writer` says 요약 멈춤 when the writer stopped
- `cards-counts` makes every count equal its list
- `cards-detail` shows now, done so far, next, to-dos and worker runs by round
- `cards-progress` draws a running card's to-dos as a bar and a count
- `cards-folded` folds a comment that would show a path, a command or a fragment
- `cards-no-start` draws a round with no start on record as one dim line, only with content
- `cards-done-filter` keeps 완료's agent filter in the address
- `cards-planned` shows a card just created on its agent's screen, not on the home
- `cards-timeline` shows each run's rounds once, newest first, heads linking to their worker runs, sentences bright and tools dim

## How to get to it (user POV)

- Open the app on a wide window, or choose `진행 중인 작업` on a phone's first screen.
- Choose a card for its detail.
- Address `/app/#/running` or `/app/#/cards/<id>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`. In its scene k-101 is in its third follow-up round, k-102 has no checked lines at all (its own title `위키: 결제 화면 문서 정리` and kind `문서` stand in), r7 and r8 are two jobs on one to-do with one generated title (r7 finished 30 minutes ago, r8 two days ago), k-103 is stopped with no response, r1 (k-101's job) and r6 have records (lina#201), and k-106 was just created (예정 · ready, no run yet). `&writer=stopped` (`/app/?source=synthetic&writer=stopped#/running`) stops the writer.

- **Home.** Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive work-cards`. On `#/` (1280) or the menu's `진행 중인 작업` (390) the lists read `수신함`, `진행 중인 작업`, `대기`, `24시간 안에 끝남`, `이전에 끝남`; the decisions line is `결정 필요 4`; the first card ends `중단됨 · 응답 없음`.
- **Counts.** Each section's count equals its rows; at 1280 the sidebar's 진행 중인 작업 numbers add up to the running list and 완료 equals the two finished sections.
- **One card per run.** `릴리스 변경 목록 정리` shows once and r9, r10 not at all; `가이드 초안 다듬기` shows twice, to `#/runs/r7` and `#/runs/r8`.
- **Own title.** No raw run title or live line (`adding one-line summaries`, `editing card-form.tsx`, `guide-draft.md`) is on the home; `변경마다 한 줄 요약을 붙이는 중` shows at 1280 only. The k-102 card is named `위키: 결제 화면 문서 정리` in the title colour with the `문서` icon; its detail head reads the same, the kind `문서` and no `지금`.
- **Detail.** `#/cards/k-101` shows `지금`, `할 일`, `기록`, `댓글` and no `실행`; its round heads read `라운드 3 · <hh:mm> · 진행 중`, `라운드 2 · <hh:mm>–<hh:mm> · 검토 반려`, `라운드 1 · <hh:mm> · 작업 마침`, where round 1's time is r9's own end (2시간 40분 전).
- **Group heading and finished times.** The home's `진행 중` head reads `2` and a red `1`; `24시간 안에 끝남` reads `완료 · <n>분 전` or `<n>시간 전`, `이전에 끝남` `완료 · <n>일 전`.
- **Folded comments.** `#/cards/k-103` has three comments: the first reads as written; the second (a file and a hash) and the third (cut off) read `접힌 댓글 · …`, and the page shows neither `errors.json` nor `3f2a1c9` until the second is opened.
- **No start on record.** `#/cards/k-103` shows `라운드 3 · <hh:mm> · 중단됨` (no end, its run no longer beats) and `라운드 1 · 시작 기록 없음` (regular weight) with the line it left under it, `오류 문구 초안을 남김`, dimmed; round 2, which kept only its end, is not drawn. Its head reads `중단됨 · 응답 없음` in red and its time in grey.
- **완료 filter.** On `#/done` choose the first agent: the address becomes `#/done?agent=<id>`, a reload keeps it pressed, its count equals its rows, `최근 활동` equals the agent screen's, and web storage stays empty.
- **To-do bar.** At 1280 the home's running cards read `할 일 1/3` and `할 일 0/1`; at 390 there is none on the home. `#/cards/k-101`'s head shows the bar and the words `할 일 1/3` at both widths; the home's rows keep `1/3` beside the bar.
- **Timeline.** `#/cards/k-101`'s boxes end `기록`, `댓글`. Its blocks read `going`, `comment`, `rejected`, `comment`, `ended`: `라운드 3 · <hh:mm> · 진행 중`, `댓글 · <hh:mm>` (표로 보여 주세요), `라운드 2 · <hh:mm>–<hh:mm> · 검토 반려` (with the owner's note `변경마다 한 줄 요약을 붙여 주세요`), `댓글 · <hh:mm>` (문서만 바뀐 변경은 따로 묶어 주세요.), `라운드 1 · <hh:mm> · 작업 마침` (no dash before a lone end). The story runs in time order: each request comes before the round that does it, and the going round does what round 2 was sent back for. The going round's rows read `변경마다 한 줄 요약을 붙이는 중` (label colour), `도구 사용 4번` (dim), `요약을 표로 옮기는 중 ×3`; its raw English line is left out with no placeholder; the oldest block opens with `시작 기록 없음`; no `Running`, `npm`, `packages` or `가린 문장` anywhere. The owner's three comments in the record are the owner's three in `댓글`, at the same times. Focusing round 3's head and pressing Enter opens `#/runs/r1` (not on the board), a page named `코드 작업` with its timeline.
- **Writer stopped.** `/app/?source=synthetic&writer=stopped#/running` shows one `· 요약 멈춤`; at 390 the phone measurements hold.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/work-cards/work-cards-1280.{png,aria.yml,json}` and `work-cards-390.{png,aria.yml,json}`.

## Gotchas

- Round times are clock times of the scene's own `now`; match their shape, not their digits.
- A card's update in place from its kanban event is driven in the unit tests (`src/screens.test.tsx`, work cards): the synthetic page has no hand that writes checked lines on its own.
- The `phone` driver measures `#/cards/k-102`, `#/runs/r7`, `#/cards/k-103` and `#/done?agent=ag-1` with the other phone screens.

## Not goals

- No tabs on the phone's first screen; the menu stays the first screen and the home is its `진행 중인 작업` row.
- No interactive filter on the home; filtering by agent is the agent screen (agent-screen.md).
- No goal-level card grouping on the home (goals.md).
