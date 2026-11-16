# Navigation

On a phone the app is a navigation stack under three tabs (`대화 · 작업 · 상태`): each tab's first screen shows the tabs under its bar, the pressed tab its one title (`작업`'s is the home's lines, with its menu behind the icon `메뉴` at the bar's left; lina-app#193), a row pushes the next screen in from the right with a back control that names the screen it returns to, and the back control, the browser back button or, in the installed app, a swipe from the left edge slides it out again. A detail (goal, to-do, work card, run) is not a pushed screen: it rises as a sheet over the screen it was opened from (lina-app#142). On a wide window it is a split view: sidebar, list and detail side by side.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- Every navigation pushes a history entry with a hash route (`#/inbox`, `#/running`, `#/due`, `#/done`, `#/agents/<id>`, `#/goals`, `#/goals/<id>`, `#/items/<id>`, `#/cards/<id>`, `#/runs/<id>`, `#/cards/<card>/runs/<n>`, `#/talk`, `#/talk/<agent>`, `#/talk/<agent>?goal=<id>`, `#/status`).
- Back (the control, the browser button or the edge swipe) restores the screen, the selection and the scroll, and no frame shows the screen before its scroll is back.
- On a phone a push slides the next screen in from the right, and the back control or the edge swipe slides the top one out to the right (same-document View Transitions, direction set before the swap). Without `startViewTransition` or under reduced motion the screen swaps at once. The browser's own back or forward (its button, Safari's swipe in a tab) swaps at once, with the scroll back before the next frame, since the browser already draws that step.
- In the installed Home Screen app, a swipe from within 20 px of the left edge, at least 72 px to the right and mostly sideways, goes back like the back control. It does nothing in a browser tab (the browser's own swipe goes back there), on a tab's first screen, or for a mostly vertical gesture.
- On a phone, lists have a large title; the back control reads the title of the screen it returns to (the tab's name, `작업` from a work list, from a list).
- On a phone a detail rises as a sheet from the bottom over the screen it was opened from (lina-app#142), which stays drawn under it with its title and its scroll; the sheet has `닫기`, and back (the control, the browser button, the edge swipe or a tap on the dimmed screen) closes it. While the sheet is open the back control reads the screen under it, the one it returns to: the list's name, or the agent's name for a goal chosen on its card in `대화` (`#/talk/<agent>?goal=<id>`, lina-app#143), which stays under that tab with the agent's card, not its window, under the sheet. The screen under it never slides. Closing it leaves that screen at its scroll with the chosen row highlighted.
- On a wide window (900 px and up) the sidebar, the list and the detail sit side by side; the open row is an accent rounded rect with white text. With no detail open the detail pane folds away and the list takes the width; the row whose detail was just closed stays highlighted. The list and the detail each scroll in their own pane under the toolbar; the window never scrolls.
- On a phone the nav row and the bottom bar keep clear of the status bar and the home indicator (`env(safe-area-inset-*)`), so a Home Screen app on an iPhone puts neither under them.
- The three tabs under a tab's first bar show the pressed one as on a wide window, in dark too (see talk-tab.md).
- When the page carries `window.__LINA_APP_LABEL__ = {text, kind}` (set by the core on /app/, lina#730), a small chip with that text stands right before the bell: in the wide toolbar of every tab and in the phone navbar on every screen, detail sheets included (lina-app#181). `kind: "test"` is tinted orange, `real` or no kind is grey. At 390 the chip keeps its full text (up to 20 characters) and the back control's title shrinks first; the large titles and the three tabs are untouched. Text outside 1..20 characters after trim, or no variable, draws no element.

## Sub-features

- `nav-stack` pushes screens on a phone
- `nav-back` names the screen back returns to
- `nav-restore` restores screen, selection and scroll on back
- `nav-slide` slides a push in and a pop out on a phone
- `nav-swipe` goes back on a left-edge swipe in the installed app
- `nav-split` shows the split view on a wide window
- `nav-install-label` shows which install the app is open on beside the bell

## How to get to it (user POV)

- Use the app on a phone or a narrow window.
- Use the back control or the browser back button; in the app opened from the Home Screen, swipe from the left edge.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **First screen.** At 390, open `/app/?source=synthetic#/`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive phone-nav`. The pressed tab reads `작업` and no large title repeats it (the screen's heading `작업` is for a screen reader), the bar's `메뉴` is an icon with no word, the first row of `진행 중인 작업` is visible with no tap, and no menu is drawn.
- **Push.** Open `메뉴`, choose `진행 중인 작업`: the title reads `작업` and back reads `작업`. Choose the first card: it rises as a sheet (`detail-frame`, `data-frame="sheet"`) over the list, whose title `작업` stays, and back reads `작업` (one name for the work list, lina-app#148).
- **Tap the dark part.** With the card's sheet open at 390, once its rise has ended, the strip between the bar's bottom and the sheet's top is at least 8 px tall, and a real pointer tap (`page.mouse.click`) in its middle closes the sheet: the address is `#/running` again and no `detail-frame` is drawn (lina-app#184). A call on the scrim element does not count; whatever is drawn at that point takes the tap. The driver then opens the card again for the next step.
- **Back and scroll.** Go back in the browser. The list returns. In a 480 px tall window, scroll the home to 120, open `완료` from `메뉴` and go back in the browser as soon as the address changes: the home is at 120 again as soon as the address is back, on every run.
- **Slide.** In a 480 px tall window, scroll the home to 120, open `완료` from `메뉴`, then press back. The root carries `data-nav="push"`, then `data-nav="pop"`; every animation frame that shows the home after back has its rows and scroll 120.
- **Reduced motion.** Emulate `prefers-reduced-motion: reduce` and open `목표` from `메뉴`: the root never carries `data-nav`.
- **Edge swipe.** In a touch context with `navigator.standalone` set (the installed app), open `진행 중인 작업` from `메뉴`, wait for the slide to end, and send synthetic touches from x 6 to x 200: the page returns to `#/`. From x 120, mostly vertical, shorter than 72 px, on the first screen, or in a plain tab, the same touches leave the page where it was and call no history back.
- **Split view.** At 1280, open a card from 진행 중인 작업. The menu, the list and the detail show together with one selected row; browser back folds the detail pane, the list takes the full width and the chosen row stays highlighted.
- **Safe areas.** At 390, set `--safe-top: 47px` and `--safe-bottom: 34px` on the page (the tokens the page reads from `env()`). The back control starts at 47 px or lower; with `&live=down` the bottom bar's `연결 중` ends 34 px or more above the bottom; with all well no bottom bar is drawn and the screen's bottom padding is at least 54 px (lina-app#187).
- **Install label.** Before the page loads, set `window.__LINA_APP_LABEL__ = {text: "시험 사본", kind: "test"}` (Playwright `page.addInitScript`). At 1280 and 390, on `#/talk`, `#/today`, `#/status` and `#/cards/k-101`, `install-label` reads `시험 사본`, sits right before the bell and overlaps neither the title nor the back control. Without the variable there is no `install-label`. `npx playwright test tests/capture.spec.ts -g "install label"` captures both kinds as `captures/label-*`.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/phone-nav/phone-nav-1280.{png,aria.yml,json}` and `phone-nav-390.{png,aria.yml,json}`.

## Gotchas

- Headless Chromium has no notch and reports every `env(safe-area-inset-*)` as 0, so the safe-area step overrides the tokens instead; a device run still has to confirm it.
- The edge swipe is driven with synthetic `TouchEvent`s in a touch context with `navigator.standalone` forced true; Chromium cannot emulate `display-mode: standalone`, and a real finger on a device still has to confirm the feel.
- A swipe sent while the push still slides is ignored, as on iOS; the driver waits for the slide to end.
- On a phone the next screen enters the document when its slide starts, a frame or two after the tap; a step that reads it right after a tap waits for the root to drop `data-nav` first, or it reads the screen it left.
- The scroll steps use a 480 px tall window so the scroll they check is real on any scene.
- A detail opened from a shared link has no history behind it; back then replaces it with its list.

## Not goals

- No bottom tab bar: the three tabs sit under the bar of each tab's first screen, not at the bottom (see talk-tab.md).
- No restoring of folded or opened boxes on back.
