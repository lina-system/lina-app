# 에이전트 screen

Each configured agent has a screen: its running cards, cards needing review, its goals, then one line for what it finished today. The name comes from the core.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The sidebar lists every agent with its colour dot, first letter and the count of its running cards, hidden at 0, and its stopped cards as a separate small red number, also hidden at 0.
- The screen reads `진행 중` → `검토 필요` → `예정` → `목표` → one line `완료 · 오늘 n ›`; finished work never sits between running work and goals. The done line opens 완료 filtered to this agent (`#/done?agent=<id>`).
- `예정` holds the agent's cards just created and not started, with no time beside them; they show nowhere else (not on the home).
- `진행 중` holds the agent's stopped cards (first) and running cards. A stopped card's title keeps the label colour; only `중단됨 · <reason>` is red and its time is grey; `검토 필요` holds its cards waiting for review.
- The header shows counts only: `진행 중 n · 검토 필요 n · 예정 n · 목표 n`, drawn with the same count component as the sidebar and the section headings: grey secondary numbers, stopped cards as the small red number. Stopped cards add their own small red number beside `진행 중`, never summed into it; grey plus red equals the section's rows.
- A goal line has a progress dial, the name, the done condition and `진행 중 n` when to-dos run.

## Sub-features

- `agent-sidebar` lists agents with dot, letter and running count
- `agent-sections` orders running, review, planned, goals and the done line
- `agent-header` counts each section

## How to get to it (user POV)

- Choose an agent under `에이전트` in the sidebar or on the phone's first screen.
- Address `/app/#/agents/<id>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open an agent.** Choose the second agent under `에이전트`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive agent-screen`.
- **Sections.** Read the section headings. `진행 중`, `검토 필요`, `목표`, then `완료 · 오늘 n`.
- **Count colours.** Read the colour of every header number. Each uses the shared count component; the grey ones match the section headings' colour, the stopped count is `rgb(255, 59, 48)` (light), none is black.
- **Stopped colours.** In `진행 중`, the stopped card's title matches the running card's title colour, its state words are red, and its time matches the running card's time colour.
- **Done line.** Its link opens `#/done?agent=<this agent>`.
- **Planned.** Open `#/agents/ag-3`: the sections end `예정` → `목표`; its card `백업: 복구 연습 준비하기` reads `예정` with no time; the header reads `예정 1`; the home has no link to `#/cards/k-106`.
- **Header.** Compare each header's grey number with the section's rows that are not stopped, and its red number with the stopped rows. They are equal.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/agent-screen/agent-screen-1280.{png,aria.yml,json}` and `agent-screen-390.{png,aria.yml,json}`.

## Gotchas

- Names and colours come from the scene's seed; drive by position under `에이전트`, not by a name.
- An agent with no cards in a section has no list for it; the header then reads 0.

## Not goals

- No agent settings or chat.
- No quick add from the agent screen (lina-app#9).
