# 진행 중인 작업

진행 중인 작업 lists the work cards and outside worker runs that are running or stopped. Stopped ones come first, their state words in red naming the hand needed; running ones count up their time.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Stopped cards first, whenever there are any: with no running card the stopped ones are still listed; the empty state shows only when there are neither.
- Stopped cards first. Red marks the problem, not the row: the title keeps the normal label colour, `중단됨 · <reason>` is red, and the time after it (`52분 전`) is grey; then running cards with `진행 중 · n분째` (or `n시간째`).
- A stopped row says in a few words why and who it waits on, from what the core serves (`reason`, `waitingOn`, `retry`; lina#629): `중단됨 · <owner> 확인 필요` (waiting on the owner, or decision or feedback), `중단됨 · <agent> 검토 대기` (waiting on an agent), `중단됨 · 검토 대기` (review), `중단됨 · <reason> · 다시 시도 예정` or `… · 다시 시도 안 함` (retry scheduled or none; a failed run no later run replaced reads `실패 · 다시 시도 안 함`), in red. When the core does not say (no `waitingOn` or `retry`, or null), the state line is one grey line. Rows waiting on the owner come first in the group, then the newest stop.
- The stopped group holds only work that still needs someone: the stopped cards and the runs with no card that nothing replaced. A worker run a later run of the same to-do replaced, and stopped work whose goal is done, are not listed. The header, the sidebar and the agent pages show that same number.
- A card is a thin kind icon, the agent mark, a one-line title and one grey state line. The title, tried in this order: its checked title, its own title when it passes the raw-text rule, the title of its to-do in the work record (a run's to-do, or the to-do of a card's runs), its card's title (a run), and its goal's title last; with none, a grey `제목 없음`. The kind of work is the icon only.
- A worker run that names its card (`card`, lina#630), or whose card's opened detail lists it, or of a to-do under a goal, is not a row of its own in any list, whether or not the cards list holds that card: it shows inside that card or goal. On a wide window, a running card adds a second grey line with what it is doing now when the core gives its checked now line. Titles and now lines are the core's checked lines only (work-cards.md).
- Waiting and finished cards are not in this list; they follow it on the same screen, in their own sections (work-cards.md).
- Running times count up every second on the page, without a reload.
- On a phone nothing but the large title sits above the list.
- The sidebar shows the running cards as a grey number and the stopped cards as their own small red number beside it (`2` grey, `1` red); the two are never summed into one count.
- Each card's kind icon (code, docs, research, device) tells the kind of work apart.
- A stopped card has `다시 시도` after it; choosing it asks the agent (see actions.md) and the row reads `<agent>에게 요청함` for five seconds.

## Sub-features

- `running-stopped` puts stopped cards on top with their state words in red
- `running-time` counts the running time up live
- `running-now` shows the now line on a wide window
- `running-retry` asks a stopped card to try again
- `running-ended` keeps replaced runs, runs of a card and stopped work under a done goal out, names who a stopped row waits on, and puts the owner's first

## How to get to it (user POV)

- Choose `진행 중인 작업` in the sidebar or on the phone's first screen.
- Address `/app/#/running`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open the screen.** Choose `진행 중인 작업`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive running`.
- **Order.** Read the list `진행 중인 작업`. 3 links; the first name ends in `중단됨 · 응답 없음`, the others in `진행 중`; no `실패 화면 검토` card; the sidebar reads `2` with a red `1`.
- **Stopped colours.** Read the stopped card's colours. The title matches a running card's title colour, `중단됨 · 응답 없음` (the core does not say who it waits on) and `52분 전` both match a running card's time colour.
- **Ended runs, live shape.** Load `/app/?source=synthetic&runs=ended#/running` (the board lists the runs of cards, each with its card's id). The stopped rows are eight: first `야간 보고서 정리하기` and `결제: 영수증 문구 정하기`, both `중단됨 · 나 확인 필요`; then `배포 안내 메일 다듬기` (`<agent> 검토 대기`), `알림 문구 고르기` (`실패 · 다시 시도 안 함`), `백업: 복구 스크립트 점검` (`응답 없음 · 다시 시도 안 함`) and `결제 화면 개편` (`다시 시도 예정`), all in `rgb(255, 59, 48)`; `결제: 오류 문구 바꾸기` and one grey `제목 없음` with a grey `중단됨 · 응답 없음`. No run of a card (`#/runs/r15` and the like) is a row; no `검색 색인 다시 만들기` (a later run replaced it) and no `가이드 초안 다시 다듬기` (its goal is done); the group header and the sidebar read a red `8`.
- **State lines.** Read each grey line. `중단됨 · 응답 없음 · n분 전`, then `진행 중 · n분째` or `n시간째`.
- **Retry.** The stopped card has one `다시 시도` button; choosing it is driven in actions.md.
- **No running card.** Load `/app/?source=synthetic&running=none#/running`. One row, the stopped card, with an accent `다시 시도`; no `없음`.
- **Now line.** Look for `변경마다 한 줄 요약을 붙이는 중`. Visible at 1280, absent at 390.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/running/running-1280.{png,aria.yml,json}` and `running-390.{png,aria.yml,json}`.

## Gotchas

- The minute only changes once a minute; a drive that needs to see the count move must wait past a minute boundary.
- The synthetic scene marks every read after the first as unchanged, so nothing moves except the clock.

## Not goals

- No live change stream yet; the page polls every 10 s (lina-app#8 replaces it).
