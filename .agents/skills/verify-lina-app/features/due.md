# 마감일

마감일 groups dated goals and to-dos into 지남, 오늘, 이번 주 and 이후, as the core groups them.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Groups in the order `지남`, `오늘`, `이번 주`, `이후`, each with a grey count equal to its rows; empty groups are not drawn.
- Each row starts with its agent mark and shows the date as `n월 n일`. Overdue dates are red, today's orange.
- A row opens its goal or to-do.
- The sidebar count equals the rows on the screen.

## Sub-features

- `due-groups` groups dated items
- `due-colour` marks overdue red and today orange

## How to get to it (user POV)

- Choose `마감일` in the sidebar or on the phone's first screen.
- Address `/app/#/due`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open the screen.** Choose `마감일`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive due`.
- **Groups.** Count the links in each named group list. 5 in all, at least one in `지남` and in `오늘`; the sidebar reads `5`.
- **Colours.** Read the date colours. `지남` is `rgb(255, 59, 48)`, `오늘` `rgb(255, 149, 0)` (light).
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/due/due-1280.{png,aria.yml,json}` and `due-390.{png,aria.yml,json}`.

## Gotchas

- `이번 주` and `이후` split on the scene's Monday-based week, so a to-do moves between them by weekday; the total stays 5.
- Dark mode uses `#FF453A` and `#FF9F0A`; the colour step assumes the light scheme.

## Not goals

- No calendar view and no date editing.
