# 완료

완료 lists finished cards only, newest first, each with when it ended; a filter shows one agent's.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Only cards in state 완료; failed or review-needed cards never show here.
- Newest first.
- Each card reads `완료 · <when it ended>` (`완료 · 30분 전`, `완료 · 2일 전`), with the kind icon, agent mark and name. How long it took (`20분 걸림`) is in its detail head, never on the row.
- The sidebar count equals the rows.
- An agent filter sits above the list: `전체` and each agent with its count. Choosing one keeps it in the address (`#/done?agent=<id>`), so a reload or a live update keeps it; each count equals the list it shows, and the filtered list shows the agent's `최근 활동` (work-cards.md).

## Sub-features

- `done-list` lists finished cards newest first
- `done-ended` says when each card ended; its total is in its detail
- `done-filter` shows one agent's finished cards from the address

## How to get to it (user POV)

- Choose `완료` in the sidebar or on the phone's first screen; the `완료 · 오늘 n` line on an agent screen opens it filtered to that agent.
- Address `/app/#/done` or `/app/#/done?agent=<id>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open the screen.** Choose `완료`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive done`.
- **Read the list.** Read the list `완료`. Three links ending in `완료`, two of them `가이드 초안 다듬기` (two jobs, two cards); each grey line reads `완료 · <n>분|시간|일 전`.
- **Total in the detail.** Choose the first row: its detail head reads `완료 · <n> 전 · <n>분 걸림`.
- **Filter.** Driven in work-cards.md: the address keeps the agent, a reload keeps it pressed, counts equal lists.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/done/done-1280.{png,aria.yml,json}` and `done-390.{png,aria.yml,json}`.

## Gotchas

- Worker runs that a card started are inside that card, so they never add rows here.

## Not goals

- No filter by date.
