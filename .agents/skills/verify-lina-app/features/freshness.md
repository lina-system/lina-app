# Freshness

The toolbar says how fresh the data is. A failed source shows one orange line while the rest of the screen keeps working.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- `실시간` while the change stream is open; grey `갱신 지연` while it is down (live.md); red `연결 끊김` when the core cannot be reached. Before the stream first opens, `갱신 n초 전` counts from the last read and turns `갱신 지연` after 30 s.
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

- `연결 끊김` needs a core that stops answering; the unit tests cover it (`src/screens.test.tsx`), the drive does not. `갱신 지연` is driven in live.md with `&live=down` and `&live=drop`.

## Not goals

- The bell and its read marks are in bell.md.
