# Live updates

The screens follow the core's change stream: what another device, an agent or a worker changes shows on the open screen within a couple of seconds, without a reload, and the open row, the selection and the scroll stay where they were. The freshness line says whether the stream is open.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The app opens one change stream (`/api/lina/events`, a WebSocket) for the whole page, whatever screen is open; moving between screens opens no other.
- A change from anywhere (another device, the owning agent, a worker run, a kanban card) shows on every open screen it touches within 2 s. Only the routes it touches are read again; a route that did not change answers 304 and its rows stay as they are.
- Nothing polls. A still page reads nothing.
- The freshness line reads `실시간` while the stream is open. Once it has been down for the settle time (3 s) it reads grey `갱신 지연`, and the screens keep what they last drew; a drop the reconnect mends within the settle time never shows, and a reconnect reads `실시간` at once (lina-app#150).
- After a drop (sleep, a network change, the tab hidden and shown) the app connects again with its last cursor and draws what it missed. A connection that fails is tried again after a wait that doubles, with jitter, up to 30 s; showing the tab or coming back online tries at once.
- When the core restarts with a new session token (its reads answer 401 or 403, or the stream is refused at the upgrade), the page reads its own address (`/app/`) once more, uncached, for the new token, reads every snapshot with it and reconnects at once with its cursor. One renewal per run of refusals: refused again, the line turns red `연결 끊김` and the page asks nothing more until it is shown again or comes back online. The token is never stored. A page signed in by cookie (no token in it) leaves a 401 to its sign-in and renews nothing.
- When the stream says to resync (the cursor is too old, or a store that was down reads again), the app reads every snapshot once.
- Nothing reloads the page: the open decision row stays open, the selection stays, and the list keeps its scroll.

## Sub-features

- `live-one` opens one stream per page
- `live-change` draws a change from anywhere within 2 s, reading only what it touches
- `live-stale` says `갱신 지연` while the stream is down
- `live-resume` reconnects with the cursor and draws what was missed
- `live-resync` reads every snapshot once on a resync
- `live-token` reads a restarted core's new session token once and resumes
- `live-keep` keeps the open row, the selection and the scroll

## How to get to it (user POV)

- Open any screen and leave it open while something changes elsewhere.
- Look at the freshness line in the toolbar on a wide window, or the bottom bar on a phone.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`; the synthetic stream runs on the page's own copy of the scene. `&live=drop` drops the first connection 3 s after it opens while another device marks one notice read; `&live=resync` sends one resync 2 s after it opens; `&live=token` restarts the core with a new session token 3 s after it opens, while another device marks one notice read; `&live=down` refuses every connection.

- **One socket.** Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive live`. On `#/inbox`, open 진행 중인 작업, 목표 and 마감일 in turn: `window.__linaStream.connections` holds one open connection, and the line reads `실시간`.
- **No polling.** Leave the page still for 12 s: `window.__linaStream.reads` does not move.
- **A change from elsewhere.** On `#/items/T4`, send `폭도 봐 주세요` in `댓글 달기`: the agent's reply is drawn about 5 s later, with no reload.
- **Drop and resume.** Load `&live=drop` on `#/items/T3` at 1280 (the 내 할 일 row 공지 문구 확인 selected, its detail beside the list) or on `#/inbox` in a 480 px tall window at 390 (the list scrolled to 40), and open the decision `배포를 금요일 오후에 할지 결정 필요`. The line never leaves `실시간` (the reconnect lands within the settle time; every word it showed is recorded); the second connection resumed with a cursor and got one missed event; the bell reads `알림 4`; the row is still open, and the selection and its detail (1280) or the scroll (390) did not move.
- **Resync.** Load `#/inbox` with `&live=resync`: about 2 s in, the page reads one refresh's worth of routes (5 lists and every card) and nothing more; still one connection.
- **New token.** Load `#/inbox` with `&live=token`: the line never leaves `실시간`; `window.__linaStream.renewals` is 1; the last connection resumed with a cursor and got one missed event; the bell reads `알림 4`; nothing in web storage; no reload.
- **Down.** Load `#/inbox` with `&live=down`: after the settle time the line reads `갱신 지연`, 결정 필요 still has 4 rows, and 5 s bring 2 to 5 tries, none open.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/live/live-1280.{png,aria.yml,json}` and `live-390.{png,aria.yml,json}`.

## Gotchas

- Every step marks the window and checks the mark at the end; a reload would wipe it.
- At 390 the drop step needs a short window, or the list has nothing to scroll. At 1280 no pane of the synthetic scene overflows (a window shorter than the list scrolls the page, not the pane), so the wide drive proves the selection, the 390 drive the scroll.
- The synthetic scene lives in one page: another device's write is played by the synthetic stream itself (`&live=drop`); the unit tests (`src/screens.test.tsx`, `src/data/live.test.ts`) cover two stores on one scene and the 2 s limit under fake timers.
- On a live core the stream needs the dashboard's session token; the app takes it from the page the core serves.

## Not goals

- No cursor kept across a page load: a new page starts from the tail.
- No polling fallback while the stream is down; the line says the screens may be stale instead.
