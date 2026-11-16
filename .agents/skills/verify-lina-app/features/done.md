# 완료

완료 lists finished cards only, newest first, each with when it ended; a filter shows one agent's.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Only cards in state 완료; failed or review-needed cards never show here.
- Newest first.
- Each card reads `완료 · <when it ended>` (`완료 · 30분 전`, `완료 · 2일 전`), with the kind icon, agent mark and name. How long it took (`소요 20분`) is in its detail head, never on the row.
- One unit for every count (lina-app#221): the sidebar's `완료` is the work tab's `완료` head, and both are rows. The rows are the lines the work tab lists under `완료`: cards whose lines read the same are one line `<title> ×N` opening the newest; the `×N` stays on its row to say how many entries it holds, and the row counts one (lina-app#168, #179, #186). Each filter choice counts the rows it lists. Until every finished card is read, the count is the rows drawn and the finished cards the core holds (`finishedTotal`, lina#729) that the page has not read, each of which may be a row; once they are read, the rows alone, so the number can drop as the read folds them (the hub's 524 entries folded to 514 rows read 514, lina-app#221). A finished card nothing names is not drawn and not counted, so no row reads `제목 없음` (lina-app#221): the rule, from the hub's 11-16 rows, is that a finished row is named by its goal's title, else its checked title or its own title where the row rule lets it, else the to-do its runs take on, else the Hangul words of its own title once its refs and Latin words go, when at least 4 Hangul letters are left (lina-app#214); the hub's finished rows carry no checked title, result or now line, so nothing of their record can name them, and the ones nothing names are old cards with no history kept (`detail: false`, `기록 보관 안 됨`). Such a card's page still opens from its address. The screen reads every finished card and counts nothing until they are in (`불러오는 중`); 오늘's `완료` line and an agent's `완료 · 오늘 n` wait for them the same way.
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
- **Read the list.** Read the list `완료`. Two links ending in `완료`, one of them `가이드 초안 다듬기` (r7; r8, the earlier run of the same task, is not a row: work-cards.md); each grey line reads `완료 · <n>분|시간|일 전`.
- **Total in the detail.** Choose the first row: its detail head reads `완료 · <n> 전 · 소요 <n>분`.
- **Filter.** Driven in work-cards.md: the address keeps the agent, a reload keeps it pressed, counts equal lists.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/done/done-1280.{png,aria.yml,json}` and `done-390.{png,aria.yml,json}`.
- **Hub shape, lines (lina-app#179, #186).** Load `/app/?source=synthetic&hub=round11#/done`: three finished cards titled alike but for a hash are one `허브 앱 빌드 올리기 ×3` line; the list's rows, the `전체` choice's count, the sidebar's `완료` (at 1280) and the work tab's `완료` rows with its fold are the same number, the `×3` line one row (lina-app#221).

## Gotchas

- Worker runs that a card started are inside that card, so they never add rows here.

## Not goals

- No filter by date.
