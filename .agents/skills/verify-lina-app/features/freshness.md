# Freshness

The toolbar says how fresh the data is. A failed source shows one orange line while the rest of the screen keeps working.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Nothing while the change stream is open: the head shows a word only when something is wrong (lina-app#187; `실시간` is gone app-wide); a neutral `연결 중` until the stream's first connection opens, however long that takes (lina-app#172), and over a page drawn from its kept copy (live.md) `갱신 n초 전`, or `갱신 지연` past 30 s, until the stream has caught up from the copy's cursor (lina-app#194); grey `갱신 지연` once a stream that was open has been down for the settle time (3 s, `LIVE_SETTLE_MS` in `src/data/live.ts`, live.md), so a drop the reconnect mends sooner never shows and the two words cannot alternate faster than that; a reconnect clears the word at once (lina-app#150); red `연결 끊김` when the core cannot be reached. Only after a read fails while the stream is open does the line read `갱신 n초 전`: while the stream is open nothing is read until something changes, so the age counts from the last moment the stream vouched for the screens, not from the last read, and `갱신 지연` follows only 30 s later (lina-app#152).
- At 390 the line is the bottom band, drawn over the screen's last rows: `연결 중` shows there only once the first connection has taken longer than the settle time from the first lists (lina-app#199), so the band does not cover a row while a stream opens within 1 to 2 s, as on the hub. `src/failed-open.test.tsx` holds it; no synthetic variant opens its stream late, so only a core with its stream delayed shows it.
- Nothing else stands beside the word: the stopped writer of the checked lines (`요약 중단됨`) is in `상태`'s `점검` panel, not here (lina-app#150).
- A source listed in the core's `errors[]`, or a route whose read failed, shows `읽기 실패: <source word>` in orange; other screens still draw.
- A list whose reads all failed before any answered (the core answered 500 as the page opened, lina-app#199) is not loading: the line says that one thing, `읽기 실패: <source words>` and `다시 시도` beside it, never with `불러오는 중` or `연결 중`. `다시 시도` reads the failed routes again at once; the page also reads them again by itself (live.md). Once a read answers, the line is as above.

## Sub-features

- `fresh-line` says whether the screens are current
- `fresh-failed` names a failed source

## How to get to it (user POV)

- Look at the toolbar on a wide window, or the bottom bar on a phone (drawn only while the line has a word, lina-app#187).

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Freshness.** Open 수신함. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive freshness`. The line is empty and takes no width.
- **Failed source.** Load `/app/?source=synthetic&error=quota#/inbox`. With the stream open the line is `읽기 실패: 쿼터` alone, with no dot before it; a dot joins it only to a word before it: `&live=down&error=quota` reads `연결 중 · 읽기 실패: 쿼터`. 결정 필요 still has 4 rows.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/freshness/freshness-1280.{png,aria.yml,json}` and `freshness-390.{png,aria.yml,json}`.

## Gotchas

- No synthetic variant fails every read: `src/failed-open.test.tsx` holds the all-failed line and `다시 시도` at 390 and 1280.
- `연결 끊김` needs a core that stops answering; the unit tests cover it (`src/screens.test.tsx`), the drive does not. `연결 중` is driven in live.md with `&live=down`, and `갱신 지연` is held by `src/chrome-qa9.test.tsx`; `&live=drop` and `&live=token` reconnect within the settle time, so their drives check that the line never shows a word. The settle time itself is held by `src/data/live.test.ts` on a fake clock.

## Not goals

- The bell and its read marks are in bell.md.
