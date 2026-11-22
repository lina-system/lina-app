# 보고서

An agent's long report reaches the owner as one report card in the conversation and in its work card's detail. The card opens the report as the document alone: beside the conversation on a wide window, in a sheet on a phone. The viewer reads like a document (a reading width, three text sizes, real headings, tables, the report's own images) and draws charts, diagrams, callouts and folds from the body. The open report follows its agent's edits, and its earlier versions are one tap away.

## Platforms

- `web`: shipped: the card in 대화 and in a work card's detail, the inspector at 900 px and wider, the sheet below that.
- `mac`: planned (the GPUI app draws an inspector beside the conversation; nothing is built in `native/` yet).
- `iphone`: planned (the GPUI app's full-height sheet; nothing is built in `native/` yet).

## Intended behavior

- A message line `[[report:<id>|<page>|<summary>]]` (lina#263's reference) shows as one card: an icon, the title on one line, one grey line `<agent> · 업데이트 <time>`. The chat never shows the report's body or the raw line. An agent row's last line reads the summary.
- A report page address in a message's words (`…/reports/<id>/page`) opens the viewer on a plain click (also one that lands on the link's text); a modified or middle click, and any other address (the old dashboard's `/r/…`), stays the browser's.
- Wide window (900 px and up): the card opens the report in the right-hand inspector beside the conversation, which stays visible and usable. Its left edge drags (or takes the arrow keys) to widen or narrow it, keeping at least 360 px for the chat, and the width is kept. A second card replaces its content without a new history entry. `닫기` or Escape closes it and leaves the conversation, its scroll and its draft as they were.
- Phone and narrow window: the card opens a sheet at about half the screen over the chat. Its bar drags up to the whole screen (or a double tap), down past a quarter to close; `닫기`, Escape, the dimmed area and back close it too, and only it.
- The viewer: the report's title, the agent, `업데이트 <time>`, the version, and `목표 · <goal>` when the report has one; no dashboard rows. Text sizes `작게`, `보통`, `크게` (kept on the device). The body's `#` is a heading under the title, `##` under that. A number column aligns right in even figures; a long table scrolls in its own box under a header row that stays; a narrow viewer folds each row into a card with every cell after its column's name.
- Images: only the report's own (`images/<n>` or `/reports/<id>/images/<n>`, lina#263's image route); any other address shows a grey note and is never fetched. An image inside a fold, a callout or a table cell is read, drawn and opened large like any other, in document order. One image in a paragraph is wide, several stand side by side, each with its caption (its title, else its alt) under it. A tap opens it large over the whole window (above the app's bars, at every width) with `이전 그림`, `다음 그림` among the document's images, `n / m`, `닫기`, Escape and the arrow keys; its Escape closes only it. An image the core does not give reads `[그림: <caption>] 그림을 불러오지 못함`.
- Blocks in fenced code: ````lina:chart [bar|line|share|stacked] [title]```` then a table (first column the labels, up to four series; `share` is a donut of one series or stacked bars; one row is a stat row; `type:` and `title:` lines say the same), ````mermaid```` (theme colours light and dark, `−`, `맞춤`, `+` and a sideways drag in its own box; `맞춤` shows the whole diagram inside its box, the steps run from the smaller of 50 % and the fit up to 300 %, and `−` or `+` is disabled at either end; it opens at no less than 75 %, so a wide one is read by dragging), ````lina:callout [note|decision|warning] [title]```` (a quiet box), and `````lina:fold <title>````` (closed; it may hold blocks in shorter fences; one holding a decision or warning box shows `안에 결정 필요` or `안에 주의` on its closed line, the box staying in place inside).
- A block that does not parse (a non-number cell, no table, more than four series, an unknown chart or callout kind, an unknown `lina:` name, an empty diagram, a fold without a title, a diagram Mermaid refuses) shows its source and one line `<kind> 블록을 그리지 못함: <why>`. Nothing is dropped.
- When the agent edits the open report (the core's `reports` change event), the viewer shows the new version in place with a small `업데이트됨`; a tap on it clears it. A `reports` event that replaces only the report's image files (a Desk sync: same version, time and body) redraws its images in place; each image stays on screen until its new copy is in. `버전 N개` lists every version (number, time, line); one opens with `이전 버전 vN을 보는 중` and `최신 보기`, and its head reads that version's own time.
- A work card's detail shows a `보고서` box with the same card for each report that belongs to the card.

## Sub-features

- `report-card` one card per reference line in the chat and per report of a work card
- `report-inspector` the wide inspector: beside the chat, resizable, closeable, replaced by the next card
- `report-sheet` the phone sheet: half height, drag to full or close
- `report-reading` header, text sizes, headings, tables with sticky headers, number columns and row cards
- `report-images` own images only, wide, side by side, captions, lightbox with previous and next
- `report-blocks` charts, diagram, callouts, folds, and broken blocks with their source
- `report-updates` in-place update with its mark, version history, and images redrawn when only they change

## How to get to it (user POV)

- 대화 → an agent → a report card in its messages, or a report page link in a message.
- 작업 → a work card the report belongs to → `보고서` → the card.
- Address `/app/#/reports/<id>` (`?v=<n>` for one earlier version).

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic&reports=demo`: four synthetic reports (`rep_5e1f0a7c2b90` long, three versions, on `k-101` and `G1`, with a wide table, three generated images and one outside image, line, bar, share and stat charts, a diagram, callouts and a fold holding a decision; `rep_0b5d3c6e8a14` plain markdown with no blocks; `rep_9c2e7f41d6a3` six broken blocks; `rep_3a7c0e5f9b21`, reachable by address only, with images only inside a fold, a callout and a table cell and one image the core does not give), and the first agent's window holds the lines that sent the first two and a sentence linking the third and an old `/r/` address. `window.__linaReportElsewhere.edit(<id>)` edits a report as its agent would, and `window.__linaReportElsewhere.images(<id>)` replaces only its images (same version and body), each with the `reports` event after it.

- **Cards.** Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive reports`. On `#/talk/ag-1` two cards read `가상 릴리스 변경 정리 · 중간 보고` and `가상 백업 점검 메모`, each with `<agent> · 업데이트 …`; the window holds neither `묶음별 변경` nor `[[report:`.
- **Open.** Choose the first card. At 1280 the inspector reads the title, the chat beside it is at least 360 px with its `메시지` field visible; at 390 the sheet's top is between 300 and 520 px and `data-height` is `half`.
- **Resize or drag.** At 1280 drag `report-resize` 160 px left: its `aria-valuenow` grows by more than 100. At 390 drag `report-sheet-bar` 250 px up: `data-height` is `full`.
- **Images.** Choose the first image: `1 / 3`; `다음 그림` twice reads `3 / 3` with `다음 그림` disabled; `이전 그림` reads `2 / 3`; one `report-image-outside` note.
- **Update and history.** `__linaReportElsewhere.edit("rep_5e1f0a7c2b90")`: `업데이트됨` shows and the report's `data-version` is `4`; `버전 4개` lists `v4 v3 v2 v1`; `v1` shows `이전 버전 v1을 보는 중`, `최신 보기` takes it away.
- **Images inside blocks.** `#/reports/rep_3a7c0e5f9b21`: three images drawn (inside the fold, in the callout, in a table cell), none left loading, and one line `[그림: 불러오지 못하는 그림] 그림을 불러오지 못함`. `__linaReportElsewhere.images("rep_3a7c0e5f9b21")` redraws all three.
- **Large image.** Open any image: the layer is at x 0, y 0 and the window's full size, and the point 20 px below the top is the layer, at 1280 and 390. Escape closes it and leaves the viewer; a second Escape closes the viewer.
- **Diagram fit.** Press `맞춤`: the diagram's right edge is inside its box and `−` is disabled.
- **Earlier version time.** Open `v1` from `버전 N개`: the head's time (its title) is the time on v1's line.
- **Images alone.** `__linaReportElsewhere.images("rep_5e1f0a7c2b90")`: the first image's address changes and its picture reads `교체 1`, the report's `data-version` stays the same.
- **Broken blocks.** `#/reports/rep_9c2e7f41d6a3`: six `report-block-broken` blocks, each with its error line and its source.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/reports/reports-1280.{png,aria.yml,json}` and `reports-390.{png,aria.yml,json}`.

## Gotchas

- Without `&reports=demo` the scene has no reports: the chat shows no card and `#/reports/<id>` reads `보고서를 찾을 수 없음`.
- Mermaid loads only when a report holds a diagram; its first drawing takes a moment (`그리는 중`).
- The inspector's width and the text size are kept in the browser's storage across reloads; a fresh context starts at 460 px and `보통`.
- A Desk report's body keeps its own image addresses (`../img/a.png`); the core's API does not say which of its image places each one is, so those images show as notes (see the run's report.md).

## Not goals

- Importing old reports or serving the old dashboard's `/r/…` addresses (lina#788); those links open in the browser as before.
- Editing a report, or writing one from the app.
- Opening images from outside the report, local files or other reports.
- The Mac and iPhone GPUI layouts (`native/`).
