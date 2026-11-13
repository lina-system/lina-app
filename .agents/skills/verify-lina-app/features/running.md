# 진행 중인 작업

진행 중인 작업 lists the work cards that are running or stopped, each group named for what its rows are: stopped ones in their own `중단됨` group first, their state words in red naming the hand needed (lina-app#134); running ones under `진행 중` after them, counting up their time (lina-app#141). A worker run is never a row of its own.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Two groups, each headed by what its rows are and the number of its own rows (lina-app#134): `중단됨 <n>` (one red number) holds the stopped cards; `진행 중 <n>` (grey) under it holds only running cards, `진행 중 · 시작 n분 전` (or `시작 n시간 전`). The stopped group comes first, so on a phone the work that needs a hand is on the first screen (lina-app#141). With nothing running but something stopped or planned, `진행 중 0` stands as one head line with no rows, so the tab reads alive (lina-app#148); with nothing stopped, no `중단됨` group. Planned cards are their own `예정 <n>` group under `진행 중` (work-cards.md). The empty state shows only when there are none of them. Every head's number equals its rows.
- Red marks the problem, not the row: a stopped row's title keeps the normal label colour, `중단됨 · <reason>` is red, and the time after it (`52분 전`) is grey.
- A stopped row says in a few words why and who it waits on, from what the core serves (`reason`, `waitingOn`, `retry`; lina#629): `중단됨 · <owner> 확인 필요` (waiting on the owner, or decision or feedback), `중단됨 · <agent> 검토 대기` (waiting on an agent), `중단됨 · 검토 대기` (review), `중단됨 · <reason> · 다시 시도 예정` or `… · 다시 시도 안 함` (retry scheduled or none; a failed run no later run replaced reads `실패 · 다시 시도 안 함`), in red. When the core does not say (no `waitingOn` or `retry`, or null), the state line is one grey line. Rows waiting on the owner come first in the group, then the newest stop.
- The stopped group holds only work that still needs someone: the stopped cards, every one of them a row (lina-app#148). A stopped card's own title loses its issue references and commit hashes (a bracket holding one goes whole) instead of hiding the card; when nothing may be drawn after that and it has no goal, the row reads `<agent>의 중단 카드`. Stopped work whose goal is done is not listed, and no worker run is, stopped or not (lina-app#141). The header, the sidebar and the agent pages show that same number.
- A card is a thin kind icon, the agent mark, a title and one grey state line; the title takes a second line before it is cut, on a stopped row (lina-app#133) and on a running row (lina-app#141), so two titles that start alike read apart at 390. A stopped row whose card carries the core's `ask` (lina#690: what it needs, a short checked sentence) shows it as one grey line right under its title, the same at both widths; with no `ask` (or null), or an `ask` holding what the title rule refuses (English words, a card number, a path, a cut-off sentence) or a word the screens never use, nothing more is drawn (lina-app#148). Rows of one group never read the same: when another row of the group has the same title and ask, the row's second grey line is the card's own name (its references cut), or, with none that may be drawn or the same name again, the day and time it last moved. The title, tried in this order (lina-app#122): its goal's title first (the `goalTitle` the core puts on a card's row when it gives one, lina#666, then the goal the goals list puts it in); then its checked title, its own title when it passes the raw-text rule (on stopped work, a Latin word alone does not fail it), and the title of the to-do its runs take on in the work record. The kind of work is the icon only. Work none of these names is not a row, and no line counts it: no row or line ever reads `이름 없는 실행`, `제목 없음` or `제목 없는 n건` (lina-app#141).
- No worker run is a row of its own in any list (lina-app#141, owner rule 11-13): a run of a card, of a goal or of a to-do shows inside that card, goal or to-do, and a run with none of them is not listed at all; its page still opens from its address or its notice. On a wide window, a running card adds a second grey line with what it is doing now when the core gives its checked now line. Titles and now lines are the core's checked lines only (work-cards.md).
- Waiting and finished cards are not in this list; they follow it on the same screen, in their own sections (work-cards.md).
- Running times count up every second on the page, without a reload.
- On a phone nothing but the large title sits above the list.
- The sidebar shows the running cards as a grey number and the stopped cards as their own small red number beside it (`2` grey, `1` red); the two are never summed into one count.
- Each card's kind icon (code, docs, research, device) tells the kind of work apart.
- A stopped row has `다시 시도` after it only when running it again can clear the stop (no response, failed, budget, gate, hold, or the core does not say); a row waiting on the owner's answer or feedback, or on a review, has none and opens its detail (lina-app#134). Choosing it asks the agent (see actions.md) and the row reads `<agent>에게 요청함` for five seconds.

## Sub-features

- `running-stopped` puts stopped cards in their own `중단됨` group under `진행 중`, with their state words in red
- `running-time` counts the running time up live
- `running-now` shows the now line on a wide window
- `running-retry` asks a stopped card running again can clear to try again
- `running-ended` keeps every worker run and stopped work under a done goal out, names who a stopped row waits on and what it asks, and puts the owner's first

## How to get to it (user POV)

- Choose `진행 중인 작업` in the sidebar, or in the phone's `메뉴`; the screen's header and the back that returns to it read `작업`, the tab's name (lina-app#148). On a phone the 작업 tab's first screen is the home (work-cards.md), which holds this list too.
- Address `/app/#/running`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open the screen.** Choose `진행 중인 작업`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive running`.
- **Order.** Read the list `중단됨`: 1 link ending in `중단됨 · 응답 없음`. Read the list `진행 중인 작업` under it: 2 links, each name ending in `진행 중`. No waiting card (k-104, `#/cards/k-104`) in either; the sidebar reads `2` with a red `1`.
- **Stopped colours.** Read the stopped card's colours. The title matches a running card's title colour, `중단됨 · 응답 없음` (the core does not say who it waits on) and `52분 전` both match a running card's time colour.
- **Ended runs, live shape.** Load `/app/?source=synthetic&runs=ended#/running` (the board lists the runs of cards, each with its card's id). The stopped rows, in the list `중단됨`, are seven, all cards: first `야간 보고서 정리하기` (k-108, with the one grey line `야간 보고서를 받을 사람 확인 필요` under its title, the core's `ask`), `결제 화면 개편` (k-107, titled by its goal) and `CLI 배포 순서 정하기` (k-112, its own title: a stopped card's Latin word alone does not hide it), all `중단됨 · 도윤 확인 필요`; then `배포 안내 메일 다듬기` (`<agent> 검토 대기`), `백업: 복구 스크립트 점검` (`응답 없음 · 다시 시도 안 함`) and `결제 화면 개편` (`다시 시도 예정`), all in `rgb(255, 59, 48)`; `결제 화면 개편` (k-103) with a grey `중단됨 · 응답 없음`. No other row has an ask line. No run is a row (`#/runs/…`: not r14, r20 nor any run of a card), no line reads `제목 없는 n건` or `이름 없는 실행`; the `중단됨` header and the sidebar read a red `7`. The four rows waiting on the owner or a review have no `다시 시도`; the other three have one. At 390 no stopped title is cut, and none takes more than two lines.
- **State lines.** Read each grey line. `중단됨 · 응답 없음 · n분 전`, then `진행 중 · 시작 n분 전` or `시작 n시간 전`.
- **Retry.** The stopped card has one `다시 시도` button; choosing it is driven in actions.md.
- **No running card.** Load `/app/?source=synthetic&running=none#/running`. The `진행 중` head reads `0` with no rows; `중단됨` with one red `1` and one row, the stopped card, with an accent `다시 시도`; no `없음`.
- **Now line.** Look for `변경마다 한 줄 요약을 붙이는 중`. Visible at 1280, absent at 390.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/running/running-1280.{png,aria.yml,json}` and `running-390.{png,aria.yml,json}`.

## Gotchas

- The minute only changes once a minute; a drive that needs to see the count move must wait past a minute boundary.
- The synthetic scene marks every read after the first as unchanged, so nothing moves except the clock.

## Not goals

- No live change stream yet; the page polls every 10 s (lina-app#8 replaces it).
