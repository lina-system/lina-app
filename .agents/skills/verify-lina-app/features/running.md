# 진행 중인 작업

진행 중인 작업 lists the work cards and outside worker runs that are running or stopped. Stopped ones come first in red and name the hand needed; running ones count up their time.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Stopped cards first, red, with a grey line like `중단됨 · 응답 없음 · 52분 전`; then running cards with `진행 중 · n분째` (or `n시간째`).
- A card is a thin kind icon, the agent mark, a one-line title and one grey state line. On a wide window, a running card adds a second grey line with what it is doing now when the core gives one.
- Waiting and done cards are not here.
- Running times count up every second on the page, without a reload.
- On a phone nothing but the large title sits above the list.
- The sidebar count equals the number of cards.

## Sub-features

- `running-stopped` puts stopped cards on top in red
- `running-time` counts the running time up live
- `running-now` shows the now line on a wide window

## How to get to it (user POV)

- Choose `진행 중인 작업` in the sidebar or on the phone's first screen.
- Address `/app/#/running`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open the screen.** Choose `진행 중인 작업`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive running`.
- **Order.** Read the list `진행 중인 작업`. 3 links; the first name ends in `중단됨 · 응답 없음`, the others in `진행 중`; no `실패 화면 검토` card.
- **State lines.** Read each grey line. `중단됨 · 응답 없음 · n분 전`, then `진행 중 · n분째` or `n시간째`.
- **Now line.** Look for `변경 목록을 기능별로 묶는 중`. Visible at 1280, absent at 390.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/running/running-1280.{png,aria.yml,json}` and `running-390.{png,aria.yml,json}`.

## Gotchas

- The minute only changes once a minute; a drive that needs to see the count move must wait past a minute boundary.
- The synthetic scene marks every read after the first as unchanged, so nothing moves except the clock.

## Not goals

- No retry button on stopped cards yet.
- No live change stream yet; the page polls every 10 s (lina-app#8 replaces it).
