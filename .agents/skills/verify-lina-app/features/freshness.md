# Freshness

The toolbar says how fresh the data is. A failed source shows one orange line while the rest of the screen keeps working.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- `실시간` while the change stream is open; grey `갱신 지연` once it has been down for the settle time (3 s, `LIVE_SETTLE_MS` in `src/data/live.ts`), a stream that never opens included (live.md), so a drop the reconnect mends sooner never shows and the two words cannot alternate faster than that; a reconnect reads `실시간` at once (lina-app#150); red `연결 끊김` when the core cannot be reached. Only in the moment between the first read and the stream's first answer does the line read `갱신 n초 전`.
- Nothing else stands beside the word: the stopped writer of the checked lines (`요약 중단됨`) is in `상태`'s `점검` panel, not here (lina-app#150).
- A source listed in the core's `errors[]`, or a route whose read failed, shows `읽기 실패: <source word>` in orange; other screens still draw.

## Sub-features

- `fresh-line` says whether the screens are current
- `fresh-failed` names a failed source

## How to get to it (user POV)

- Look at the toolbar on a wide window, or the bottom bar on a phone.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Freshness.** Open 수신함. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive freshness`. The line reads `실시간`.
- **Failed source.** Load `/app/?source=synthetic&error=quota#/inbox`. The line adds `· 읽기 실패: 쿼터` and 결정 필요 still has 4 rows.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/freshness/freshness-1280.{png,aria.yml,json}` and `freshness-390.{png,aria.yml,json}`.

## Gotchas

- `연결 끊김` needs a core that stops answering; the unit tests cover it (`src/screens.test.tsx`), the drive does not. `갱신 지연` is driven in live.md with `&live=down`; `&live=drop` and `&live=token` reconnect within the settle time, so their drives check that the line never leaves `실시간`. The settle time itself is held by `src/data/live.test.ts` on a fake clock.

## Not goals

- The bell and its read marks are in bell.md.
