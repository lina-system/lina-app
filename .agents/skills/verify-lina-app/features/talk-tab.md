# 대화 tab

The first of the three tabs at the top (`대화 · 작업 · 상태`). The owner chooses one agent and talks with it in the middle, in that agent's own app conversation (lina#482), with the agent's card, its goals, beside the conversation. There is no conversation with all agents at once.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The tabs `대화`, `작업`, `상태` sit in the toolbar on a wide window and under the large title on a phone's first screen of each tab. The tab of the screen shown is pressed. `대화` opens `#/talk`, `작업` opens `#/`, `상태` opens `#/status`.
- The pressed tab is one look at every width: a segment in `--tab-current` on the `--tab-track` the other tabs show. In dark it stands at least 3:1 against its neighbours, on a phone too (lina-app#143, `src/design/contrast.test.ts`).
- At 390 the list's header has `메뉴`, the same entry the 작업 tab's first screen has, opening the same sheet (lina-app#167).
- `#/talk` lists the agents. On a wide window they are the sidebar and the middle, the whole width with no empty right column, reads `에이전트를 고르면 대화가 열림` (lina-app#150); on a phone they are the screen's rows. Every row, at every width, has the first line of the agent's last message under its name (one line, cut; a reply's markdown marks such as `##`, `>`, `-`, `**`, backticks and a link's address are left out, lina-app#187), or `아직 나눈 대화 없음` when there is none, and the same counts on the right: running in grey, 중단됨 in red (lina-app#143).
- The rows read their last messages at most 2 at a time (lina-app#162): a browser keeps 6 connections to one host and a gateway that does not answer holds each read about 30 s, so the live hub's 9 rows reading at once left none for the change stream and the store, and the head read `갱신 지연` on first entry until they gave up. The open window's own read does not wait behind them (`src/talk-preview.test.tsx`).
- Choosing an agent opens `#/talk/<agent>`: its name, `앱 대화 · 메신저 대화와 따로 남음`, the earlier turns of that app conversation read from the core (`GET /api/lina/agents/<agent>/talk`, the core's `[LINA app]` first line and the blank line after it left out, so no empty line stands above the owner's message, lina-app#150), the field `메시지` and `보내기`. With no earlier turn it reads `아직 나눈 대화 없음`.
- While the earlier turns are being read the window reads `불러오는 중`, not an empty box (a gateway that does not answer holds that read about 30 s, lina-app#154).
- An address naming no agent the core lists (`#/talk/<unknown>`) reads `찾을 수 없는 대화` with a link `대화` back to the list: no field, no send, no raw id (lina-app#154).
- Enter or `보내기` sends (`POST /api/lina/agents/<agent>/talk`) at once, never held behind the history read (lina-app#154). The field empties, the message shows on the right at once, drawn fainter until the core answers the send, the reply streams in on the left with three typing dots in its bubble (still when motion is reduced), and stays when it ends. A reopened window shows the exchange again.
- The window reads like a phone's messages app (lina-app#187), at 390 and 1280, light and dark: the owner's messages are rounded bubbles on the right in the accent, plain text as typed; the agent's on the left, under its mark (the coloured circle with its first letter, `AgentMark`; no pictures yet, lina-app#111) and its name, once at the top of each group. Consecutive messages of one sender within 5 minutes are one group with a small gap, its last bubble with a tighter corner and its time (`14:05`, small and grey) once at its end. A date stands before each day's first message: `오늘`, `어제`, else `11월 13일` (with the year when it is not this year). A bubble is at most 75% of the column (and 640 px).
- The agent's reply draws its markdown (`src/markdown.tsx`, rules in `src/markdown.test.tsx`): bold, italic, inline code, fenced code blocks (monospace, own background, a long line scrolls sideways inside the block), bullet and numbered lists, links (http, https and mailto only, a new tab, `rel="noopener noreferrer"`), blockquotes, headings as bold text, and tables (scrolling sideways inside the bubble). Nothing a reply writes as HTML is ever an element; a link to any other scheme and an image stay as written. A mark with no end yet (while the reply streams) is text until it closes.
- A new message, the owner's or the agent's, scrolls the window to the bottom. Read up (more than 48 px from the end), a new message does not pull the owner down: a round `맨 아래로` button over the bottom of the thread shows, with the count of messages that came in meanwhile (`맨 아래로 1`), and returns to the bottom. The owner's own message always goes to the bottom.
- The field is rounded and grows with its lines up to 5, then scrolls; Enter sends, Shift+Enter breaks a line, and an Enter that ends a Hangul composition only finishes the syllable. `보내기` is a round icon button, its name `보내기`, in the accent when there is something to send and dim while the field is empty or a turn is going: no line under the field says why (lina-app#187; `댓글` and `답` keep their own `글 입력 대기` line, lina-app#158).
- Leaving the window while the reply streams (another agent, the list, another tab) does not cancel the turn: the request runs to its end (lina-app#127). Coming back, the sent message is in the agent's window, the reply streams on under it and stays, or `답을 받지 못함` shows if it broke off; `보내기` stays disabled until it ends. Why not cancel: the owner has no way to stop a turn (see Not goals), so leaving is not a cancel, and whether a cut request cancels the agent's turn on the core is not confirmed, so a cut request could leave a turn the window no longer shows.
- The agent's card: on a wide window the right column headed `에이전트` (never `카드`; the counts, the agent's goals, `완료 · 오늘 n`); on a phone the same card folded above the conversation as `에이전트 · 목표 n` with each goal's progress, opening to the same rows. Each goal row writes its progress `<done>/<total>` as text beside the dial at every width (lina-app#175), and that number is the goal's own: done and all of the to-dos its page lists, every agent's included (`goalTodos`, the one count the folded band, the goal lists and the agent screen read), never only this agent's. A goal with no to-dos shows its name alone there, never `0/0`, as on its row (lina-app#160, #167). That summary is one line by design (cut, every goal a tap away), like the agent row's last message, the tabs and the chips; nowhere else on this screen is text cut: a goal's title and its done condition wrap at a word in the 320 px right column at 1280 as on the phone (lina-app#156, #167). The counts read `진행 중 n · 중단됨 n · 검토 필요 n · 목표 n`: every number after its word, `중단됨 n` only when not 0 and the only red part.
- A goal chosen on the card stays under `대화` (`#/talk/<agent>?goal=<id>`, lina-app#143). On a wide window it opens in the right column beside the window, with back `에이전트` to the card; on a phone it is one screen deeper, with back reading the agent's name. It is the same goal page as from `작업`: its state, its to-dos' states and its `작업` rows are the work tab's fold (goals.md, lina-app#170), so a goal whose cards are all stopped reads `중단됨` here too and lists those cards. The goal's own links (its to-dos) open under `작업` as before.
- On a phone, with all well, no bottom strip is drawn and the field bar sits at the bottom of the screen, the field 10 px above the home indicator or the keyboard, like a chat app's; with a word in the strip the field sits 10 px above the strip (lina-app#187, `tests/bottom-strip.spec.ts` at 390 light and dark, with and without a 300 px keyboard).
- On a phone, with the card open, a goal row scrolled into view stops above the field and the bottom strip (the screen's scroll padding keeps their height clear).
- On a phone the open card (its counts, goals and `완료 · 오늘 n`) scrolls in its own region, which ends above the field and the bottom strip with the window's head and the card's toggle in view: with 28 goals the last one, scrolled to inside the region, is the element at its own centre (lina-app#162).
- A refused turn shows one red line as soon as the core answers, the message leaves the window and comes back into the field (unless something new was typed meanwhile). The line reads the error code in the body before the status (lina-app#158): `에이전트가 바쁨` (429, and 409 without `no_owning_agent`: the agent gateway's `admission_conflict` and others), `맡은 에이전트 없음` (409 `no_owning_agent`, the core's own, only in a to-do's `대화`), `에이전트 연결 안 됨` (503), `없는 에이전트` (404), `에이전트가 연결을 거절함` (502), `글은 4000자까지` (413), any other `저장하지 못함 · 다시 시도`. A reply that breaks off reads `답을 받지 못함`.
- The line sits inside the field's bar, above the field: on a phone the bar is sticky over the bottom of the screen and nothing covers the line, with or without the keyboard's height (lina-app#158).
- On a phone the field's bar is opaque (`--bg`): a message scrolled under it never shows through the field, with the card's goals open too (lina-app#167).

## Sub-features

- `tabs` shows the three tabs and opens each tab's first screen
- `talk-agents` lists the agents to talk with, and no window on all of them
- `talk-history` shows the earlier turns of the agent's app conversation
- `talk-agent-send` sends and streams the reply in the agent's own window
- `talk-card` shows the agent's card and goals beside the window, folded on a phone
- `talk-goal` opens a goal from the card under `대화` and back returns to the window

## How to get to it (user POV)

- Choose `대화` in the tabs, then an agent.
- Address `/app/#/talk`, `/app/#/talk/<agent>` or `/app/#/talk/<agent>?goal=<id>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`. The first agent has two earlier turns, the others none; the synthetic agent answers every message with `네, 보고 있어요. 지금 하는 일을 정리해서 바로 알려 드릴게요.` in four pieces, one frame every 400 ms. `&talk=busy` and `&talk=down` refuse every turn with 429 and 503.

- **Open the tab.** On `#/inbox`, choose `대화`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive talk-tab`. The address is `#/talk`, `대화` is pressed, 3 agents are listed; on a wide window the middle reads `에이전트를 고르면 대화가 열림` and spans the panes (no empty 320 px column; `tests/talk-tab.spec.ts`). The first row reads `변경 목록을 모으는 중이에요. 배포 순서는 답을 기다려요.`, the second `아직 나눈 대화 없음`.
- **Choose an agent.** Choose the first agent. One earlier message of the owner reads `어디까지 왔어요?`, the window reads `앱 대화 · 메신저 대화와 따로 남음`, and the card's goals include `릴리스 노트 정리` and not `결제 화면 개편` (on a phone, after opening `에이전트 · 목표 n`).
- **Send.** Type `오늘 어디까지 했어요?` and press Enter: the typing dots show, then the reply ends in `알려 드릴게요.`, the dots are gone and the field is empty.
- **Chat look.** The dates read `어제`, `오늘`; every group has one time, and each of the agent's groups one mark and one name; no `글 입력 대기`, `보내는 중` or `답하는 중` in the window; `보내기` is a dim icon with no text on an empty field.
- **Growing field.** Type three lines with Shift+Enter: the field holds them and is taller; at eight lines it is no taller than about 6.5 lines and scrolls; Enter sends them and the empty field is back to one line.
- **Read up.** In a 480 px tall window, send `하나 더 알려 주세요`: the window is at the bottom; scroll it to the top while the reply streams: `맨 아래로` shows, the reply ends without moving the window, and `맨 아래로` returns to the bottom and goes.
- **Goal.** Choose `릴리스 노트 정리` on the card: the address is `#/talk/ag-1?goal=G1`, the goal's title shows (on a wide window beside the window, `대화` still pressed); back returns to `#/talk/ag-1`.
- **Phone.** At 390 the field and the `보내기` icon are at least 44 px tall and back reads `대화`.
- **Goal, card, tabs (spec).** `npx playwright test tests/talk-tab.spec.ts` (after `npm run build`): the goal route at 1280 light and dark and 390; at 390×420 with the card open the last goal row ends above the field and the strip, brought into view and at the end; in dark the pressed tab has the same background at 1280 and 390, apart from its neighbours.
- **Many goals (spec).** `npx playwright test tests/talk-goals.spec.ts` (after `npm run build`): the core's client API, not `?source=synthetic`, serves the synthetic scene with the first agent holding 28 goals; at 390 the open card's region scrolls, ends above the field and the strip, and `elementFromPoint` at the last goal's centre is that goal, scrolled to inside the region and brought into view (lina-app#162).
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/talk-tab/talk-tab-1280.{png,aria.yml,json}` and `talk-tab-390.{png,aria.yml,json}`.
- **Refused send (spec).** `npx playwright test tests/talk-refused.spec.ts` (after `npm run build`): on `&talk=busy` a send reads `에이전트가 바쁨`, the message is back in the field, and `elementFromPoint` at the line's middle and left corners is the line itself (1280 light and dark, 390, and 390 with a 300 px keyboard inset).
- **Nothing cut, bar opaque, menu (spec).** `npx playwright test tests/layout-qa8.spec.ts` (after `npm run build`): the core's client API serves the synthetic scene with every title, question and done condition made as long as the hub's; at 1280 the `#/talk/ag-1` page has no element whose text runs past its clipping box (the agent rows' last message excepted); at 390 dark, with the card open, the field bar's background is opaque and `elementFromPoint` at the middle and both ends of the field's line is the field, with the turns scrolled to the top and the end; `#/talk` has `메뉴`, and its sheet's `수신함` opens `#/inbox` (lina-app#167).
- **Chat on the core API (spec).** `npx playwright test tests/talk-chat.spec.ts` (after `npm run build`): the core's client API, not `?source=synthetic`, serves the first agent's history with a long markdown reply: its heading, bold, list, link (`https`, new tab, `noopener noreferrer`), blockquote, code block and table are drawn; the code block and the table scroll sideways inside the bubble and the page does not; `<img onerror>` and `[x](javascript:…)` stay text and run nothing; the agent's two messages of yesterday are one group. A send held by the core shows the message fainter at the bottom; scrolled to the top, the reply that comes in leaves the window there and `맨 아래로 1` shows above the field, then returns to the bottom. A refused send reads `에이전트가 바쁨` with the message back in the field, and a dropped core turns the head to `연결 끊김` or `갱신 지연` (1280 light and dark, 390).
- **Leave mid-reply.** `npx playwright test tests/talk-leave.spec.ts` (after `npm run build`): send to the first agent, open the second before the reply ends (at 390 back to the list and in again), come back: both own messages show with the typing dots, then the reply ends in `알려 드릴게요.` (1280 light and dark, 390).

## Gotchas

- `보내기` also exists in `댓글` and in a to-do's `대화`; find this one inside `getByTestId("agent-talk")`.
- On a live core a turn runs on the agent's gateway; a read-only pass never sends one.
- A spec that serves the core with `page.route` blocks service workers (`test.use({ serviceWorkers: "block" })`): once the app's worker takes the page its reads go past `page.route` to `vite preview`, which answers 404.
- The synthetic window keeps its turns in the page's source only: a reload starts the scene again.
- The synthetic source keeps a turn in the agent's earlier turns only when its reply completes; until then a reopened window shows it from the page's own record of what it sent.

## Not goals

- No conversation with all agents at once.
- No messenger chat: this window is the agent's app conversation only.
- No delivery state per message (lina-system/lina-app#72), no stopping a reply mid-stream.
