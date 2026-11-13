# Work cards

Each piece of work is one card: a work card (a kanban sub-card an agent runs a slice of a goal in). A worker run is never a card of its own in a list: it shows inside its card, goal or to-do (lina-app#141). The home (진행 중인 작업) lists the cards in one order, and each card updates in place from the change stream. A card is a kind icon, the agent mark, a title and one grey state-and-time line; a work card's title is the core's checked line when it is written, else the card's own title until then, while a run's own page without a checked title shows its kind word in grey. Every other line is the core's checked line (`plain`, lina#151), never a file name, a run id or an English topic.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Home order (lina-app#141), the same at both widths: one `결정 필요 <n>` line (only when there are any, the inbox's number) and the inbox's `검토 필요` group; the stopped cards in their own `중단됨` group with one red count (`중단됨 · <reason>` in red; running.md, lina-app#134); the running cards under `진행 중` with their count (with none, the head alone reads `진행 중 0` when anything is stopped or planned); the planned cards under `예정` with their count (lina-app#148); `대기` (the waiting cards `검토 필요` does not already hold); the owner's to-dos folded to one line, `내 할 일 <n>` with a chevron, which opens its rows in place under it when chosen and folds them again; then `최근 완료` and `완료`, each with its count. On a phone the first screen shows the decisions and the first stopped rows before any to-do, however many to-dos the owner holds. A to-do's and a running card's title take a second line before they are cut, like a stopped row's. No line counts the work nothing names (running.md).
- A finished card says when it ended (`완료 · 20분 전`, `완료 · 2일 전`); how long it took (`소요 20분`) is in its detail. Cards under `완료` ended more than 24 hours ago. A work card's end and a stopped card's last beat come from its list row (`endedAt`, `lastHeartbeatAt`, lina#577), so they are right before the card is ever opened. A core whose rows carry neither leaves an unopened finished card at `완료` with no time under `완료`, and a stopped one timed from its elapsed time, until it opens (lina-app#100).
- The first load reads the lists only, never each card's detail: every list area reads `불러오는 중` until the lists answer, then its rows (or `없음`).
- A wide window opens on the home, and so does the phone: the 작업 tab's first screen is the home under the large title and the tabs, its lines readable without a tap. The menu (오늘, 수신함, 진행 중인 작업, 마감일, 완료, the agents, 목표) opens from `메뉴` at the left of the phone's header as a bottom sheet; choosing a row goes there and closes it (lina-app#124).
- No add button is drawn, on either width, while no route writes a new to-do (lina-app#95 brings it back); a control is never drawn disabled without a reason.
- One card per run: follow-up rounds of one card stay one card. Cards are never merged. No worker run is a row in the finished groups, 완료 or the agent screen (lina-app#141): runs started by a card show only inside its detail, and a run's page still opens from its address.
- The title is `plain.title`; a running card's now line (wide windows) is `plain.now`. A work card without a checked title shows its own title, shortened to the row width (never sliced), on the home, 완료, the agent screen and its detail head, and its kind is read from the same text — but only while that own title passes the app's raw-text rule (a path, a command, an English word and so on). An own title the rule refuses draws nothing: the card keeps its kind of work in grey (`코드 작업`, `문서 작업`, `조사`, `기기 작업`), and its kind is read from the checked title alone. A run without a checked title keeps its kind of work in grey. A line the core has not written, or one that failed its check, is null and never shows raw text; a missing now line draws nothing.
- When the writer of the checked lines has stopped, the header says nothing of it: the owner cannot act on it, so it is one row `요약 중단됨` in `상태`'s `점검` panel (lina-app#150).
- Every count equals its list: the sidebar's `진행 중인 작업` grey and red numbers are the running list, `완료` is the two finished sections, and each section head is its rows.
- A card's detail: its kind icon and word, its name and state line; then `지금` (`plain.now`), `완료된 것` (only its result line, when it has one), `할 일` (the to-dos it owns), `기록` (its rounds, newest first, each head one line `<time> · <outcome>[ · <result sentence>]`, no round number, linking to the round's worker run; see card-detail.md) and its comments. The rounds show once: `실행` (its worker runs by round, in the secondary label colour and regular weight) stands only while the record is not shown, and under the error line when the record's read failed. A box shows only when it adds something: nothing repeats the to-do list.
- A running card with to-dos shows a thin bar and its count (`1/3`) after its lines on a wide window; on a phone the bar is in its detail head only.
- A comment on a card is one history line, `<time> · <first sentence>`, its author the line's tooltip (lina-app#142), newest first (lina-app#149). A path, a command, a hash, an issue number, an address or an id (`G73`, `t_27363156`, `rc=1`) in it is left out of the sentence, which is cut at a word end within 60 characters with `…`; a sentence with an English word, or one that starts inside a word or a number, is skipped whole, never spliced. A machine notice (by the dispatcher or the worker, or opening with a tag such as `[받음]`, `[대기 충족]`) is no line; a run of comments with nothing readable left is one `접힌 댓글` line (`접힌 댓글 n건`).
- A round whose start fell out of the kept history shows one dim line, `시작 기록 없음`, only when it holds content (a line it said, or a worker run), and draws that content under it dimmed; a round with only its end on record shows nothing. A line that would show a path or a command reads `접힌 댓글`.
- A stopped card's detail head shows `중단됨 · <reason>` in red, as on the home; its time stays grey.
- A card just created (예정, not started) shows on its agent's screen, in a `예정 n` group after `검토 필요`, with no time beside it (agent-screen.md), and on the home in its own `예정` group under `진행 중`, so a card that turns planned never leaves the tab (lina-app#148).
- 완료's agent filter is the address (`#/done?agent=<id>`): it survives a reload and every live update, nothing goes to web storage, each choice's count is the list it shows, and the filtered list's `최근 활동 <time>` reads the same as on the agent's screen.
- A card's detail and a worker run's page show the run's own timeline below the boxes and above the comments (card-detail.md); it refetches on the run's `worker` change event and keeps its open state.
- A card's checked lines change in place when its kanban event arrives: only the card list and that card's detail are read again (live.md).

## Sub-features

- `cards-home` orders the home: decisions, stopped, running, waiting, the owner's to-dos folded to one line, the last 24 hours, older
- `cards-one` keeps one card per run and per job, and no worker run as a row
- `cards-plain` draws a work card's checked title, or its own title until that exists when the raw-text rule lets it; its detail head never reads a kind word (lina-app#149), and a missing now line nothing
- `cards-writer` says 요약 중단됨 in 상태 · 점검 when the writer stopped, never beside the header
- `cards-counts` makes every count equal its list
- `cards-detail` shows now, done so far, next, to-dos and worker runs by round
- `cards-progress` draws a running card's to-dos as a bar and a count
- `cards-folded` draws a comment as its first sentence with any path, command or id left out
- `cards-no-start` draws a round with no start on record as one dim line, only with content
- `cards-done-filter` keeps 완료's agent filter in the address
- `cards-planned` shows a card just created on its agent's screen and in the home's `예정` group
- `cards-timeline` shows each run's rounds once, newest first, heads linking to their worker runs, sentences bright and tools dim

## How to get to it (user POV)

- Open the app on a wide window, or choose `진행 중인 작업` on a phone's first screen.
- Choose a card for its detail.
- Address `/app/#/running` or `/app/#/cards/<id>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`. In its scene k-101 is in its third follow-up round, k-102 has no checked lines at all (its own title `위키: 결제 화면 문서 정리` and kind `문서` stand in), r7 and r8 are two worker runs with no card or to-do, so no list draws them (r7 finished 30 minutes ago, r8 two days ago), k-103 is stopped with no response, r1 (k-101's job) and r6 have records (lina#201), and k-106 was just created (예정 · ready, no run yet). `&writer=stopped` (`/app/?source=synthetic&writer=stopped#/running`) stops the writer; `&todos=many` gives the owner 50 more to-dos and k-102 a long goal title (lina-app#141).

- **Home.** Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive work-cards`. On `#/` at both widths, with no tap, the lists read `수신함`, `검토 필요` (1 row, k-104), `중단됨`, `진행 중인 작업`, `예정` (1 row, k-106), `내 할 일` (one button `내 할 일 2`, folded, no row until chosen; chosen, 2 rows), `최근 완료` (the waiting card waits on review, so no `대기`; nothing is older); the decisions line is `결정 필요 4`; the first card under `중단됨` ends `중단됨 · 응답 없음`.
- **Counts.** Each section's count (and red count) equals its rows; at 1280 the sidebar's 진행 중인 작업 numbers add up to the running list and 완료 equals the two finished sections.
- **One card per run.** `릴리스 노트 정리` (k-101, titled by its goal) shows once and r9, r10 not at all; no link on the home goes to a worker run (`#/runs/…`).
- **Own title.** No raw run title or live line (`adding one-line summaries`, `editing card-form.tsx`, `guide-draft.md`) is on the home; `변경마다 한 줄 요약을 붙이는 중` shows at 1280 only. The k-102 card's row is named by its goal, `결제 화면 개편`, in the title colour with the `문서` icon; its detail head reads its own title `위키: 결제 화면 문서 정리`, the kind `문서` and no `지금`.
- **Detail.** `#/cards/k-101` shows `지금`, `할 일`, `기록`, `댓글` and no `실행`; its round heads read `<hh:mm> · 진행 중`, `<hh:mm> · 검토 필요 · 문서만 바뀐 변경을 따로 묶음`, `<hh:mm> · 완료 · 병합된 변경 41개를 모음`, where the oldest round's time is r9's own end (2시간 40분 전).
- **Group heading and finished times.** The home's `진행 중` head reads `2` and no red number, its `중단됨` head a red `1` alone; `최근 완료` reads `완료 · <n>분 전` or `<n>시간 전`, `완료` (when there is any) `완료 · <n>일 전`; k-105 (`백업 주기 점검`, its goal; never opened) reads `완료 · 2시간 전` under `최근 완료`.
- **Comments with raw text.** `#/cards/k-103` has three comments, one line each, newest first: the newest keeps its own cut-off end; the middle one (a file and a hash) reads `<hh:mm> · 키 12개를 바꿈`; the oldest reads as written. The page shows neither `errors.json`, `3f2a1c9` nor `접힌 댓글`.
- **No start on record.** `#/cards/k-103` shows `<hh:mm> · 중단됨` (no end, its run no longer beats) and `시작 기록 없음` (regular weight) with the line it left under it, `오류 문구 초안을 남김`, dimmed; round 2, which kept only its end, is not drawn. Its head reads `중단됨 · 응답 없음` in red and its time in grey.
- **완료 filter.** On `#/done` choose the first agent: the address becomes `#/done?agent=<id>`, a reload keeps it pressed, its count equals its rows, `최근 활동` equals the agent screen's, and web storage stays empty.
- **To-do bar.** At 1280 the home's running cards read `할 일 1/3` and `할 일 0/1`; at 390 there is none on the home. `#/cards/k-101`'s head shows the bar and the words `할 일 1/3` at both widths; the home's rows keep `1/3` beside the bar.
- **Timeline.** `#/cards/k-101`'s boxes end `기록`, `댓글`. Its blocks read `going`, `comment`, `rejected`, `comment`, `ended`: `<hh:mm> · 진행 중`, `댓글` (`<hh:mm> · 변경 목록은 표로 보여 주세요`), `<hh:mm> · 검토 필요 · 문서만 바뀐 변경을 따로 묶음` (with the owner's note `<hh:mm> · 변경마다 한 줄 요약을 붙여 주세요`), `댓글` (`<hh:mm> · 문서만 바뀐 변경은 따로 묶어 주세요.`), `<hh:mm> · 완료 · 병합된 변경 41개를 모음` (its end and its result sentence, no dash). No head carries a round number. The story runs in time order: each request comes before the round that does it, and the going round does what round 2 was sent back for. The going round's rows read newest first, each after its `<hh:mm> · `, `요약을 표로 옮기는 중 ×3` (label colour), `도구 사용 4번` (dim), `변경마다 한 줄 요약을 붙이는 중`; its raw English line is left out with no placeholder; the oldest block opens with `시작 기록 없음`; no `Running`, `npm`, `packages` or `가린 문장` anywhere. The owner's three comments in the record are the owner's three in `댓글`, at the same times. Focusing round 3's head and pressing Enter opens `#/runs/r1` (not on the board), a page named by its card's title with its timeline.
- **Writer stopped.** `/app/?source=synthetic&writer=stopped#/running` shows no `요약 중단됨` beside the freshness line; at 390 the phone measurements hold. `#/status` with the same query has one `요약 중단됨` row in the list `점검`.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/work-cards/work-cards-1280.{png,aria.yml,json}` and `work-cards-390.{png,aria.yml,json}`.

## Gotchas

- Round times are clock times of the scene's own `now`; match their shape, not their digits.
- A card's update in place from its kanban event is driven in the unit tests (`src/screens.test.tsx`, work cards): the synthetic page has no hand that writes checked lines on its own.
- The `phone` driver measures `#/cards/k-102`, `#/runs/r7`, `#/cards/k-103` and `#/done?agent=ag-1` with the other phone screens.

## Not goals

- No menu on the phone's first screen; the home is the first screen and the menu is one header button away.
- No interactive filter on the home; filtering by agent is the agent screen (agent-screen.md).
- No goal-level card grouping on the home (goals.md).
