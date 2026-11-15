# Live updates

The screens follow the core's change stream: what another device, an agent or a worker changes shows on the open screen within a couple of seconds, without a reload, and the open row, the selection and the scroll stay where they were. The freshness line says whether the stream is open.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The app opens one change stream (`/api/lina/events`, a WebSocket) for the whole page, whatever screen is open; moving between screens opens no other.
- A change from anywhere (another device, the owning agent, a worker run, a kanban card) shows on every open screen it touches within 2 s. Only the routes it touches are read again; a route that did not change answers 304 and its rows stay as they are.
- The stream also carries the conversations and the read marks (lina#742, lina-app#205). A `talk` event names the agent a turn was added to: that agent's row under `대화` and its open window read the conversation again (`GET /api/lina/agents/<agent>/talk`), and no other agent's and no list. So a message sent from another device shows in the open window and on the row within 5 s, with no reload. A `notices` event (read marks changed on another device) reads the board, which holds the bell's lines and counts. A resync reads the conversations on screen again too.
- Nothing polls. A still page whose reads answered reads nothing.
- The freshness line is empty while the stream is open: nothing is wrong, so the head says nothing (lina-app#187). Until its first connection opens it reads a neutral `연결 중`, however long that takes and however many tries fail: nothing is late before the stream was ever open (lina-app#172). On a phone the word is a band over the screen's last rows, so it waits the settle time from the first lists: a first connection that opens sooner raises no band at all, and one that takes longer reads `연결 중` from then on (lina-app#199). Once a stream that was open has had no connection for the settle time (3 s, `LIVE_SETTLE_MS` in `src/data/live.ts`) it reads grey `갱신 지연`, and the screens keep what they last drew; a drop the reconnect mends within the settle time never shows, and a reconnect clears the word at once (lina-app#150). The stream sends nothing while nothing changes, so a quiet open stream is current, not late.
- Moving between screens never moves the line (lina-app#176). Nothing on a route change touches the stream; the head that 작업 and 대화 draw in their own shells on a wide window reads the same word from the same moment. While the stream is open but the board's last read failed, the line counts `갱신 n초 전` from the last moment the screens were known current, on every screen, and reads `갱신 지연` once that is more than 30 s ago (`STALE_AFTER_S` in `src/app.tsx`). A hidden tab closes its socket without changing the word; shown again, it reads `갱신 지연` only if its reconnect has not landed within the settle time.
- After a drop (sleep, a network change, the tab hidden and shown) the app connects again with its last cursor and draws what it missed. A connection that fails is tried again after a wait that doubles, with jitter, up to 30 s; showing the tab or coming back online tries at once.
- An open whose reads failed (the core answered 500, or was restarting) fills by itself once the core answers again, with no input (lina-app#199): the routes whose last read failed are read again after a doubling, jittered wait (1 s up to 30 s, at most `HEAL_TRIES` = 8 times, about two minutes, in `src/data/live.ts`), and at once when the stream opens or reconnects, the tab is shown again or the network comes back, which also start the waits over. Nothing is read again while the tab is hidden, while the core cannot be reached (until the stream or the network comes back), or after the core refused the credential; a screen whose reads answered schedules nothing. A read that fails again keeps what the screen and the kept copy hold.
- A page opened again draws what it drew last time at once, from a copy it keeps on the device: no `불러오는 중` frame, and nothing is read before the stream opens (lina-app#194). The stream opens with the copy's cursor and only what the missed events touch is read, as after a drop; the slow routes (기기, 쿼터, 사용량, 점검), which no event names, are read once after that, as a first open reads them. Until the stream has caught up the freshness line says how old the copy is (`갱신 n초 전`, `갱신 지연` past 30 s), never `연결 중`; caught up, it says nothing. A cursor the core no longer keeps gets one resync (one refresh); no copy, a copy another app version wrote, or a copy of another owner reads every list as a first open does.
- The copy holds only the core's own answers: one per core (the page's origin and the core's base path) and owner, the finished cards cut to the first page, at most 2 M characters. It is removed when the core turns the page's credential away (a read answered 401 or 403, a renewal that brings a new token or none, the refusal after a renewal) and is never written for the synthetic scene. A core that is not reached keeps it. Storage that is full or refused keeps nothing, and the page reads the core as on a first open.
- When the core restarts with a new session token (its reads answer 401 or 403, or the stream is refused at the upgrade), the page reads its own address (`/app/`) once more, uncached, for the new token, reads every snapshot with it and reconnects at once with its cursor. One renewal per run of refusals: refused again, the line turns red `연결 끊김` and the page asks nothing more until it is shown again or comes back online. The token is never stored. A page signed in by cookie (no token in it) leaves a 401 to its sign-in and renews nothing.
- When the stream says to resync (the cursor is too old, or a store that was down reads again), the app reads every snapshot once: one refresh, which is the 5 list routes (`board`, `items`, `goals`, `cards`, `inbox`) and the details the open screen shows, never every card's detail (lina-app#100, #118).
- Nothing reloads the page: the open decision row stays open, the selection stays, and the list keeps its scroll.

## Sub-features

- `live-one` opens one stream per page
- `live-change` draws a change from anywhere within 2 s, reading only what it touches
- `live-stale` says `연결 중` before the stream was ever open, and `갱신 지연` once an open stream has been down for the settle time
- `live-resume` reconnects with the cursor and draws what was missed
- `live-resync` reads every snapshot once on a resync
- `live-kept` opens from the copy kept on the device and catches up from its cursor
- `live-token` reads a restarted core's new session token once and resumes
- `live-keep` keeps the open row, the selection and the scroll

## How to get to it (user POV)

- Open any screen and leave it open while something changes elsewhere.
- Look at the freshness line in the toolbar on a wide window, or the bottom bar on a phone.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`; the synthetic stream runs on the page's own copy of the scene. `&live=drop` drops the first connection 3 s after it opens while another device marks one notice read; `&live=resync` sends one resync 2 s after it opens; `&live=token` restarts the core with a new session token 3 s after it opens, while another device marks one notice read; `&live=talk` has another device send the first agent `배포 순서는 정해졌어요?` 3 s after it opens, its reply kept, and sends the core's `talk` event; `&live=down` refuses every connection. The read marks go out as the core's `notices` event (`{source: "notices", kind: "read", id: <owner>}`), the turns as its `talk` event (`{source: "talk", kind: "message", id: <agent>}`).

- **One socket.** Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive live`. On `#/inbox`, open 진행 중인 작업, 목표 and 마감일 in turn: `window.__linaStream.connections` holds one open connection, and the line is empty.
- **No polling.** Leave the page still for 12 s: `window.__linaStream.reads` does not move.
- **A change from elsewhere.** On `#/items/T4`, send `폭도 봐 주세요` in `댓글 달기`: the agent's reply is drawn about 5 s later, with no reload.
- **Drop and resume.** Load `&live=drop` on `#/items/T3` at 1280 (the 내 할 일 row 공지 문구 확인 selected, its detail beside the list) or on `#/inbox` in a 480 px tall window at 390 (the list scrolled to 40), and open the decision `배포를 금요일 오후에 할지 결정 필요`. The line never shows a word (the reconnect lands within the settle time; every word it showed is recorded); the second connection resumed with a cursor and got one missed event; the bell reads `알림 4`; the row is still open, and the selection and its detail (1280) or the scroll (390) did not move.
- **Resync.** Load `#/inbox` with `&live=resync`: about 2 s in, the page reads one refresh's worth of routes, exactly the 5 lists (수신함 shows no detail), and nothing more; still one connection.
- **New token.** Load `#/inbox` with `&live=token`: the line never shows a word; `window.__linaStream.renewals` is 1; the last connection resumed with a cursor and got one missed event; the bell reads `알림 4`; nothing in web storage; no reload.
- **Another device's message.** Load `#/talk/ag-1` with `&live=talk`: the window holds one message of the owner, then about 3 s in `배포 순서는 정해졌어요?` shows under it with the reply ending in `알려 드릴게요.`, within 5 s of the other device's write; the agent's row (the sidebar at 1280, the list after back at 390) reads the reply; no reload.
- **Down.** Load `#/inbox` with `&live=down`: the line reads `연결 중` and never `갱신 지연` (the stream was never open), 결정 필요 still has 4 rows, and 5 s bring 2 to 5 tries, none open.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/live/live-1280.{png,aria.yml,json}` and `live-390.{png,aria.yml,json}`.

## Gotchas

- Every step marks the window and checks the mark at the end; a reload would wipe it.
- At 390 the drop step needs a short window, or the list has nothing to scroll. At 1280 no pane of the synthetic scene overflows (a window shorter than the list scrolls the page, not the pane), so the wide drive proves the selection, the 390 drive the scroll.
- The synthetic scene lives in one page: another device's write is played by the synthetic stream itself (`&live=drop`); the unit tests (`src/screens.test.tsx`, `src/data/live.test.ts`) cover two stores on one scene and the 2 s limit under fake timers.
- No synthetic variant fails its reads, so no drive shows the heal: `src/failed-open.test.tsx` holds it on a fake clock (a core failing its first 15 s, one that keeps failing, a hidden tab, a refused credential), and a core shows it: fail the first 15 s of `/api/` GETs with a Playwright route and the rows appear by themselves after.
- `src/live-qa10.test.tsx` holds lina-app#176 on a fake clock: a failed board read on a quiet open stream reads `갱신 n초 전` across 작업, 대화 and a goal and turns `갱신 지연` exactly 30 s after it, and a tab hidden for a moment shows no word throughout, or `갱신 지연` exactly the settle time after it is shown when its reconnect does not land.
- No synthetic variant keeps an open stream down past the settle time, so the drive never shows `갱신 지연`; `src/chrome-qa9.test.tsx` holds both sides of lina-app#172 on a fake clock: a stream that connects 3 s after the first read reads `연결 중` then nothing, never `갱신 지연`, and an open stream that drops and stays down reads `갱신 지연` exactly after the settle time.
- On a live core the stream needs the dashboard's session token; the app takes it from the page the core serves.
- The synthetic scene keeps no copy, so no drive shows the kept copy: `src/data/stored.test.ts` and `src/live-stored.test.tsx` hold it, and a core shows it: reload any tab, and its rows are there before any read answers.

## Not goals

- No copy of the conversations: a 대화 window and an agent's last line are read when they are shown, and again when the stream's `talk` event names their agent; the kept copy holds none of them.
- No polling fallback while the stream is down; the line says the screens may be stale instead.
