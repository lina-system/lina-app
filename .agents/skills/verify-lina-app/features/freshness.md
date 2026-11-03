# Freshness and the bell

The toolbar says how fresh the data is and the bell lists the notices. A failed source shows one orange line while the rest of the screen keeps working.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- `갱신 n초 전` ticks every second; grey `갱신 지연` after 30 s with no answer; red `연결 끊김` when the core cannot be reached.
- A source listed in the core's `errors[]`, or a route whose read failed, shows `읽기 실패: <source word>` in orange; other screens still draw.
- The bell carries a red badge with the number of notices, hidden at 0, and opens a list of notice lines; Escape or a click outside closes it.

## Sub-features

- `fresh-line` ticks the freshness line
- `fresh-failed` names a failed source
- `fresh-bell` counts and lists notices

## How to get to it (user POV)

- Look at the toolbar on a wide window, or the bottom bar on a phone.
- Choose the bell.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Freshness.** Open 수신함. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive freshness`. The line reads `갱신 n초 전` and changes within a few seconds.
- **Bell.** Read the bell button. Named `알림 7`; choosing it lists 7 links under `알림`; Escape closes it.
- **Failed source.** Load `/app/?source=synthetic&error=quota#/inbox`. The line adds `· 읽기 실패: 쿼터` and 결정 필요 still has 4 rows.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/freshness/freshness-1280.{png,aria.yml,json}` and `freshness-390.{png,aria.yml,json}`.

## Gotchas

- `갱신 지연` and `연결 끊김` need a source that stops answering; the unit tests cover them (`src/screens.test.tsx`), the drive does not.

## Not goals

- No read marks on notices yet (lina-app#6).
