# 완료

완료 lists finished cards only, newest first, each with its total time.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Only cards in state 완료; failed or review-needed cards never show here.
- Newest first.
- Each card reads `완료 · n분` (its total), with the kind icon, agent mark and title.
- The sidebar count equals the rows.

## Sub-features

- `done-list` lists finished cards newest first
- `done-total` shows each card's total time

## How to get to it (user POV)

- Choose `완료` in the sidebar, on the phone's first screen, or the `완료 · 오늘 n` line on an agent screen.
- Address `/app/#/done`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open the screen.** Choose `완료`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive done`.
- **Read the list.** Read the list `완료`. One link ending in `완료`; its grey line reads `완료 · 9분`.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/done/done-1280.{png,aria.yml,json}` and `done-390.{png,aria.yml,json}`.

## Gotchas

- Worker runs that a card started are inside that card, so they never add rows here.

## Not goals

- No filter by agent or date yet.
