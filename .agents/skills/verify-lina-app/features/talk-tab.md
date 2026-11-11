# 대화 tab

The first of the three tabs at the top (`대화 · 작업 · 상태`). The owner chooses one agent and talks with it in the middle, in that agent's own app conversation (lina#482), with the agent's card, its goals, beside the conversation. There is no conversation with all agents at once.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The tabs `대화`, `작업`, `상태` sit in the toolbar on a wide window and under the large title on a phone's first screen of each tab. The tab of the screen shown is pressed. `대화` opens `#/talk`, `작업` opens `#/`, `상태` opens `#/status`.
- `#/talk` lists the agents. On a wide window they are the sidebar and the middle reads `에이전트를 고르면 대화가 열림`; on a phone they are the screen's rows, each with its running and goal counts.
- Choosing an agent opens `#/talk/<agent>`: its name, `앱 대화 · 메신저 대화와 따로 남음`, the earlier turns of that app conversation read from the core (`GET /api/lina/agents/<agent>/talk`, the core's `[LINA app]` first line left out), the field `메시지` and `보내기`. With no earlier turn it reads `아직 나눈 대화 없음`.
- Enter or `보내기` sends (`POST /api/lina/agents/<agent>/talk`). The field empties, the message shows on the right, the reply streams in on the left under the agent's mark with one live dot, and stays when it ends. A reopened window shows the exchange again.
- The agent's card: on a wide window the right column `카드` (running, review and goal counts, the agent's goals, `완료 · 오늘 n`); on a phone the same card folded above the conversation as `카드 · 목표 n` with each goal's progress, opening to the same rows.
- A refused turn shows one red line and the message stays in the field: `에이전트가 바쁨` (429), `에이전트 연결 안 됨` (503), `없는 에이전트` (404), `에이전트가 연결을 거절함` (502), `글은 4000자까지` (413). A reply that breaks off reads `답을 받지 못함`.

## Sub-features

- `tabs` shows the three tabs and opens each tab's first screen
- `talk-agents` lists the agents to talk with, and no window on all of them
- `talk-history` shows the earlier turns of the agent's app conversation
- `talk-agent-send` sends and streams the reply in the agent's own window
- `talk-card` shows the agent's card and goals beside the window, folded on a phone

## How to get to it (user POV)

- Choose `대화` in the tabs, then an agent.
- Address `/app/#/talk` or `/app/#/talk/<agent>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`. The first agent has two earlier turns, the others none; the synthetic agent answers every message with `네, 보고 있어요. 지금 하는 일을 정리해서 바로 알려 드릴게요.` in four pieces, one frame every 400 ms. `&talk=busy` and `&talk=down` refuse every turn with 429 and 503.

- **Open the tab.** On `#/inbox`, choose `대화`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive talk-tab`. The address is `#/talk`, `대화` is pressed, 3 agents are listed; on a wide window the middle reads `에이전트를 고르면 대화가 열림`.
- **Choose an agent.** Choose the first agent. One earlier message of the owner reads `어디까지 왔어요?`, the window reads `앱 대화 · 메신저 대화와 따로 남음`, and the card's goals include `릴리스 노트 정리` and not `결제 화면 개편` (on a phone, after opening `카드 · 목표 n`).
- **Send.** Type `오늘 어디까지 했어요?` and press Enter: the live dot shows, then the reply ends in `알려 드릴게요.`, the dot is gone and the field is empty.
- **Phone.** At 390 the field and `보내기` are at least 44 px tall and back reads `대화`.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/talk-tab/talk-tab-1280.{png,aria.yml,json}` and `talk-tab-390.{png,aria.yml,json}`.

## Gotchas

- `보내기` also exists in `댓글` and in a to-do's `대화`; find this one inside `getByTestId("agent-talk")`.
- On a live core a turn runs on the agent's gateway; a read-only pass never sends one.
- The synthetic window keeps its turns in the page's source only: a reload starts the scene again.

## Not goals

- No conversation with all agents at once.
- No messenger chat: this window is the agent's app conversation only.
- No delivery state per message (lina-system/lina-app#72), no stopping a reply mid-stream.
