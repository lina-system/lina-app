# 알림

The bell in the toolbar (the navigation bar on a phone) carries the core's unread count and opens the notice list. Read marks are kept by the core per owner (`POST /api/lina/notices/read`), never in the browser, so the phone and the desktop show the same number after their next refresh.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The badge is the core's `counts.unread`, hidden at 0; the button is named `알림 n` (`알림` at 0).
- The dialog `알림` lists every notice line; unread ones have a blue dot, read ones are dimmed. `모두 읽음` (disabled when nothing is unread) and `닫기` sit on top; Escape or a click outside also closes it.
- Choosing a notice: on screen its item opens and the badge drops by one at once; in the record that notice is read (`{keys: [key]}`).
- `모두 읽음`: on screen the badge goes and every line dims; in the record every notice is read (`{all: true}`).
- A refused read mark puts the lines back as they were and shows the core's line in red in the dialog.
- Nothing is kept in `localStorage` or `sessionStorage`.

## Sub-features

- `bell-count` shows the core's unread count
- `bell-list` lists notices with read ones dimmed
- `bell-read-one` opens a notice and marks it read
- `bell-read-all` marks every notice read

## How to get to it (user POV)

- Choose the bell in the toolbar on a wide window, or in the navigation bar on a phone.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene: 7 notices, 2 of them read; the drive opens it fresh for each width.

- **Count and list.** Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive bell`. The bell is named `알림 5`; its dialog lists 7 lines, 2 dimmed; `모두 읽음` is enabled; `닫기` and Escape close it.
- **Read one.** Choose the first unread line. The address becomes that notice's item, the bell reads `알림 4`, and the record's unread count is 4.
- **Read all.** Open the bell and choose `모두 읽음`. The bell is named `알림` with no badge, all 7 lines are dimmed, every notice in the record is read, and web storage is empty.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/bell/bell-1280.{png,aria.yml,json}` and `bell-390.{png,aria.yml,json}`.

## Gotchas

- Never press a notice or `모두 읽음` on a live core (README, Never press).
- That two devices agree is held by a unit test with two stores on one synthetic scene (`src/screens.test.tsx`); a single drive has one device.

## Not goals

- No per-notice unread toggle and no notice settings.
