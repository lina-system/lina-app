# Navigation

On a phone the app is a navigation stack: the first screen is the menu, a row pushes the next screen with a back control that names the screen it returns to, and the browser back button or the iOS edge swipe goes back. On a wide window it is a split view: sidebar, list and detail side by side.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Every navigation pushes a history entry with a hash route (`#/inbox`, `#/running`, `#/due`, `#/done`, `#/agents/<id>`, `#/goals`, `#/goals/<id>`, `#/items/<id>`, `#/cards/<id>`, `#/runs/<id>`, `#/status`).
- Back (the control, the browser button or the edge swipe) restores the screen, the selection and the scroll.
- On a phone, lists have a large title; the back control reads the title of the screen it returns to (`LINA` from a list, the list's name from a detail).
- On a wide window (900 px and up) the sidebar, the list and the detail sit side by side; the open row is an accent rounded rect with white text. With nothing selected the detail pane folds away and the list takes the width.
- On a phone the nav row and the bottom bar keep clear of the status bar and the home indicator (`env(safe-area-inset-*)`), so a Home Screen app on an iPhone puts neither under them.

## Sub-features

- `nav-stack` pushes screens on a phone
- `nav-back` names the screen back returns to
- `nav-restore` restores screen, selection and scroll on back
- `nav-split` shows the split view on a wide window

## How to get to it (user POV)

- Use the app on a phone or a narrow window.
- Use the browser back button, or swipe from the left edge on iOS.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Menu.** At 390, open `/app/?source=synthetic#/`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive phone-nav`. The large title reads `LINA`.
- **Push.** Choose `진행 중인 작업`, then the first card. Back reads `LINA`, then `진행 중인 작업`.
- **Back and scroll.** Go back in the browser. The list returns; a scrolled menu keeps its scroll after opening `목표` and going back.
- **Split view.** At 1280, open a card from 진행 중인 작업. The menu, the list and the detail show together with one selected row; browser back clears the selection and folds the detail pane, and the list takes the full width.
- **Safe areas.** At 390, set `--safe-top: 47px` and `--safe-bottom: 34px` on the page (the tokens the page reads from `env()`). The back control starts at 47 px or lower and the bottom bar's text ends 34 px or more above the bottom.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/phone-nav/phone-nav-1280.{png,aria.yml,json}` and `phone-nav-390.{png,aria.yml,json}`.

## Gotchas

- Headless Chromium has no notch and reports every `env(safe-area-inset-*)` as 0, so the safe-area step overrides the tokens instead; a device run still has to confirm it.
- The edge swipe cannot be driven headless; the driver uses the browser back button, which takes the same history path.
- A detail opened from a shared link has no history behind it; back then replaces it with its list.

## Not goals

- No tab bar.
- No restoring of folded or opened boxes on back.
