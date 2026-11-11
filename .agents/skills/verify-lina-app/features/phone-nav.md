# Navigation

On a phone the app is a navigation stack under three tabs (`대화 · 작업 · 상태`): each tab's first screen shows the tabs under its large title (`작업`'s is the menu), a row pushes the next screen in from the right with a back control that names the screen it returns to, and the back control, the browser back button or, in the installed app, a swipe from the left edge slides it out again. On a wide window it is a split view: sidebar, list and detail side by side.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Every navigation pushes a history entry with a hash route (`#/inbox`, `#/running`, `#/due`, `#/done`, `#/agents/<id>`, `#/goals`, `#/goals/<id>`, `#/items/<id>`, `#/cards/<id>`, `#/runs/<id>`, `#/status`).
- Back (the control, the browser button or the edge swipe) restores the screen, the selection and the scroll, and no frame shows the screen before its scroll is back.
- On a phone a push slides the next screen in from the right, and the back control or the edge swipe slides the top one out to the right (same-document View Transitions, direction set before the swap). Without `startViewTransition` or under reduced motion the screen swaps at once. The browser's own back or forward (its button, Safari's swipe in a tab) swaps at once, with the scroll back before the next frame, since the browser already draws that step.
- In the installed Home Screen app, a swipe from within 20 px of the left edge, at least 72 px to the right and mostly sideways, goes back like the back control. It does nothing in a browser tab (the browser's own swipe goes back there), on the menu, or for a mostly vertical gesture.
- On a phone, lists have a large title; the back control reads the title of the screen it returns to (the tab's name, `작업` from a work list, from a list; the list's name from a detail).
- On a wide window (900 px and up) the sidebar, the list and the detail sit side by side; the open row is an accent rounded rect with white text. With nothing selected the detail pane folds away and the list takes the width.
- On a phone the nav row and the bottom bar keep clear of the status bar and the home indicator (`env(safe-area-inset-*)`), so a Home Screen app on an iPhone puts neither under them.

## Sub-features

- `nav-stack` pushes screens on a phone
- `nav-back` names the screen back returns to
- `nav-restore` restores screen, selection and scroll on back
- `nav-slide` slides a push in and a pop out on a phone
- `nav-swipe` goes back on a left-edge swipe in the installed app
- `nav-split` shows the split view on a wide window

## How to get to it (user POV)

- Use the app on a phone or a narrow window.
- Use the back control or the browser back button; in the app opened from the Home Screen, swipe from the left edge.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Menu.** At 390, open `/app/?source=synthetic#/`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive phone-nav`. The large title reads `작업`.
- **Push.** Choose `진행 중인 작업`, then the first card. Back reads `작업`, then `진행 중인 작업`.
- **Back and scroll.** Go back in the browser. The list returns. In a 480 px tall window, scroll the menu to 120, open `완료` and go back in the browser as soon as the address changes: the menu is at 120 again as soon as the address is back, on every run.
- **Slide.** In a 480 px tall window, scroll the menu to 120, open `완료`, then press back. The root carries `data-nav="push"`, then `data-nav="pop"`; every animation frame that shows the menu after back has its rows and scroll 120.
- **Reduced motion.** Emulate `prefers-reduced-motion: reduce` and open `목표`: the root never carries `data-nav`.
- **Edge swipe.** In a touch context with `navigator.standalone` set (the installed app), open `진행 중인 작업` from the menu, wait for the slide to end, and send synthetic touches from x 6 to x 200: the page returns to `#/`. From x 120, mostly vertical, shorter than 72 px, on the menu, or in a plain tab, the same touches leave the page where it was and call no history back.
- **Split view.** At 1280, open a card from 진행 중인 작업. The menu, the list and the detail show together with one selected row; browser back clears the selection and folds the detail pane, and the list takes the full width.
- **Safe areas.** At 390, set `--safe-top: 47px` and `--safe-bottom: 34px` on the page (the tokens the page reads from `env()`). The back control starts at 47 px or lower and the bottom bar's text ends 34 px or more above the bottom.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/phone-nav/phone-nav-1280.{png,aria.yml,json}` and `phone-nav-390.{png,aria.yml,json}`.

## Gotchas

- Headless Chromium has no notch and reports every `env(safe-area-inset-*)` as 0, so the safe-area step overrides the tokens instead; a device run still has to confirm it.
- The edge swipe is driven with synthetic `TouchEvent`s in a touch context with `navigator.standalone` forced true; Chromium cannot emulate `display-mode: standalone`, and a real finger on a device still has to confirm the feel.
- A swipe sent while the push still slides is ignored, as on iOS; the driver waits for the slide to end.
- On a phone the next screen enters the document when its slide starts, a frame or two after the tap; a step that reads it right after a tap waits for the root to drop `data-nav` first, or it reads the screen it left.
- The menu does not scroll in a 390x844 window; the scroll steps use a 480 px tall window so the scroll they check is real.
- A detail opened from a shared link has no history behind it; back then replaces it with its list.

## Not goals

- No bottom tab bar: the three tabs sit under the large title of each tab's first screen, not at the bottom (see talk-tab.md).
- No restoring of folded or opened boxes on back.
