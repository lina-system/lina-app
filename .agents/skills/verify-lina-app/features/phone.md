# Phone

On a phone the app feels and moves like a native iOS app: iOS text sizes, 44 pt hit areas, an immediate pressed state on every control, a push that slides in from the right and a pop that slides out, an edge swipe back in the installed app, bars that hold still while only the screen scrolls, and popovers that open as bottom sheets. Every rule here is measured; a measurement that misses is a defect.

## Platforms

- `web`: shipped.
- `mac`: not planned (the wide window keeps the split view).
- `iphone`: planned (M1); the native app gets these from UIKit.

## Intended behavior

The phone layout is the stack drawn up to 899 px wide (`data-layout="phone"`); every rule is measured at 390 and 430 wide. The wide split view (900 px and up) is not changed by any of these rules.

- Hit areas: every element a person can tap (every `a`, `button`, `input`, `textarea`, `summary`, and every element with a role of `button`, `link`, `checkbox` or `textbox`) has a box of at least 44x44 CSS px. This covers the bottom-bar tools, the back control, the bell, quick add, check boxes, disclosure toggles, worker-run rows, notice rows, the comment and talk fields, `보내기`, toast `되돌리기` and every text button. The glyph inside may stay small.
- Text: body text is 17 px (iOS Body at the default Dynamic Type size); no visible text is smaller than 13 px (iOS Footnote). The large title keeps its size.
- Rows: a row of a list or a detail shows at most two lines, the title and one status line. An open decision row shows its whole sentence.
- Dividers (both layouts): the line between two rows lies on the lower row's top edge (within 1 px) and starts at that row's text, after its icon, mark or check box, like iOS. It is never inside a row, so it never reads as an underline of the row above.
- Press: every row and button shows its pressed state through `:active` at once, with no transition before it (a row fills grey, a button dims). The grey tap flash is off (`-webkit-tap-highlight-color` is transparent) and controls use `touch-action: manipulation`. A long press on chrome or a row selects no text and shows no callout; text fields, comment bodies, talk bubbles, box texts, the detail title and an open decision sentence stay selectable.
- Push and pop: opening a screen slides it in from the right; the back control and the edge swipe slide it out to the right. The direction is set before the swap. Without `document.startViewTransition`, or under `prefers-reduced-motion: reduce`, the screen swaps at once. A back or forward the app did not start (the browser's button, Safari's own swipe) swaps at once too, since the browser already draws it.
- Edge swipe: in the installed Home Screen app only (`display-mode: standalone` or `navigator.standalone`), a touch that starts within 20 px of the left edge and moves at least 72 px right goes back the same way as the back control. It does nothing in a browser tab, on the first screen, or when the gesture is mostly vertical.
- Back keeps the scroll the screen had, every time, whatever the device's speed, and no frame shows the screen without it (no blank frame, no jump to the top before the restore). A late swap of an overtaken transition never brings back the screen or the scroll it was started for.
- Bars: the nav bar and the bottom bar do not move; only the screen between them scrolls. The screen uses `overscroll-behavior: contain`; the page itself has `overscroll-behavior: none` and does not scroll. Content keeps clear of the safe areas and of the keyboard.
- Sheets: the bell's notices open as a bottom sheet across the full width, flush with the bottom, over a dimmed screen. It keeps `role="dialog"`; Escape and a tap on the dimmed screen close it, and that tap goes no further.

## Sub-features

- `phone-hit` gives every control a 44x44 hit area
- `phone-type` sets body 17 px and nothing under 13 px
- `phone-rows` keeps rows to a title and one status line
- `phone-dividers` puts every divider on its row's top edge, from the row's text
- `phone-press` shows the pressed state at once, without tap flash, zoom delay or text selection
- `phone-slide` slides a push in and a pop out, or swaps at once
- `phone-swipe` goes back on a left-edge swipe in the installed app
- `phone-bars` holds the bars still while only the screen scrolls
- `phone-sheet` opens the bell's notices as a bottom sheet

## How to get to it (user POV)

- Open the app on a phone or in a window narrower than 900 px.
- Add it to the Home Screen and open it from there for the edge swipe.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`; each step opens it fresh.

- **Wide.** At 1280, run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive phone`. The page draws the split view and no phone stack.
- **Dividers.** At 1280 and 390, on home, `#/inbox` (수신함), `#/due` (마감일), `#/running` (진행 중인 작업), `#/goals/G2` and the bell's notices, every divider between two rows is within 1 px of the lower row's top edge, and a divider drawn from the text starts at the row's text within 1 px. A miss names the row by role and name (`link "공지 문구 확인": divider 5 px below the row's top`).
- **Measure.** At 390, then 430, open `#/`, `#/running` (진행 중인 작업), `#/goals/G2` (a goal), `#/items/T4` (a to-do) and `#/cards/k-101` (a card). On each, every tappable element measures at least 44x44 with `getBoundingClientRect`, every visible text node's computed `font-size` is at least 13 px, and no row shows more than two lines. A miss names the element by role and name (`button "빠른 추가" 32x28`).
- **Sheet.** At 390 and 430, open `#/inbox` and press `알림 5`. The dialog `알림` spans the width and ends at the bottom of the window; the same measurements hold. Escape closes it; pressed again, a tap on the dimmed screen closes it and the page stays on `#/inbox`.
- **Press.** At 390, press and hold `진행 중인 작업` on the menu: its background changes with no running animation. Press and hold the bell: its opacity drops. The row's tap highlight is `rgba(0, 0, 0, 0)`, its `touch-action` is `manipulation` and its `user-select` is `none`; on `#/items/T4` the field `댓글 달기` and a comment stay selectable.
- **Bars.** At 390 in a 480 px tall window, open `#/items/T4` and scroll the screen to the end: the screen scrolls, the page does not, the nav bar and the bottom bar keep their places, the screen's overscroll is `contain` and the page's `none`.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/phone/phone-1280.{png,aria.yml,json}` and `phone-390.{png,aria.yml,json}`; the 430 measurements are steps in `phone-390.json`.

## Gotchas

- The 390 drive also measures 430 by resizing the same page; both widths are steps of `phone-390.json`.
- Measure a sheet only after its slide ends; mid-slide it still sits below the window.
- `touch-action` is not inherited: it is set on every control and on each scroller.
- Headless Chromium has hover, so a stuck hover after a tap cannot be seen there; the phone's `(hover: none)` rule clears it on a device.
- `:active` fires on iOS Safari only when a touch listener is on the page; the edge swipe's listeners on the document provide it.
- On 기기·쿼터 a machine row shows three lines (name, state, meters); see Not goals.
- A divider is a `::before` line, which `getBoundingClientRect` cannot see; the driver places it from its computed `top` and `left` against its containing block. The phone menu's dividers are the top border of each row's link.

## Not goals

- No interactive edge swipe that follows the finger; the swipe goes back when the finger lifts.
- No new rules for the wide split view.
- 기기·쿼터 machine rows keep their meters on a third line: on a 390 px phone the meters beside the name cut the machine's name short.
