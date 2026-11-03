# LINA app verification map

This directory is the maintained source for verifying what people see and do in the LINA app. Read this index before driving the app, then use the matching feature file as the recipe. Feature ids are shared across platforms: the Mac and iPhone apps reuse them, and each file's `Platforms` section is the parity list between the web client and SwiftUI.

## Baseline preconditions

- Dependencies are installed with `npm ci` and Chromium is available to Playwright (`npx playwright install chromium`).
- Each run has its own id: `export VERIFY_RUN_ID=<short-id>`. The run directory is `verify-runs/$VERIFY_RUN_ID/` in the repository root.
- Launch a disposable instance with `node .agents/skills/verify-lina-app/scripts/verify.mjs launch`. It builds the client into the run directory and serves it on a free port on `127.0.0.1`.
- The instance serves the app under `/app/`, like the core does. Drives load `/app/?source=synthetic`, which draws the synthetic scene (`src/fixtures/synthetic.ts`) instead of reading a core: 3 agents with invented names, 수신함 `7`, 진행 중인 작업 `2` with a red `1`, 마감일 `5`, 완료 `1`, 목표 `5`, 알림 `5` (7 notices, 2 of them read), `기기 3 · 정상 1 · 경고 1 · 꺼짐 1`. `&error=quota` adds a failed quota source; `&running=none` takes the running cards out, leaving the stopped one.
- Run `verify.mjs doctor` and require `"healthy": true` before the first drive.
- Never drive an instance this run did not start, and never point the app at the owner's live core.

## Driving conventions

- Start every recipe from a fresh page load unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names, then `data-testid`, over CSS selectors or DOM position.
- Treat every command and quoted string as literal.
- Every feature is driven at 1280 and 390 wide, the widths CI captures.
- Writes on the synthetic instance change only the page's own copy of the scene; a page load starts the scene again, so a drive restores the fixture by reloading. Drivers read that copy through `window.__linaScene` to check what a write did to the record.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- `verify.mjs drive` writes, per feature and width, a screenshot (`.png`), an ARIA snapshot (`.aria.yml`) and a step log with each action and the state it produced (`.json`) under `verify-runs/$VERIFY_RUN_ID/evidence/<feature-id>/`.
- Record the feature id and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Never press

- On a disposable instance (`?source=synthetic`) every control may be pressed: writes go to the page's copy of the scene and a reload undoes them.
- On a live core (a read-only pass after a deploy), never press `완료 표시` (a check box), `되돌리기`, `보내기` (in `댓글` or `대화`), `다시 시도` or `모두 읽음`, and never choose a notice in the bell or an answer button. They write to the owner's record, and a read-only pass must leave it as it found it.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly these H2 sections in this order. `verify.mjs map` checks the order and the index.

1. `Platforms` lists `web`, `mac` and `iphone`, each with its state: `shipped`, `planned` or `not planned`.
2. `Intended behavior` states what a person must see or get. A QA run that finds otherwise reports a defect.
3. `Sub-features` lists short ids with one line for each behavior.
4. `How to get to it (user POV)` lists every user entry point.
5. `Driving it with verify.mjs` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
6. `Gotchas` lists traps that can waste or invalidate a verification run.
7. `Not goals` lists what the feature deliberately does not do. A QA run reports these as suggestions, never as defects.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands and observable proof.

## Keeping the map current

- A pull request that adds or changes a screen adds or updates that screen's feature file, and its driver in `scripts/verify.mjs`, in the same pull request.
- `/maintain-verification-skill` (`.agents/skills/maintain-verification-skill/`) is the periodic audit of this map against the app.

## Features

- [수신함](./inbox.md) covers decisions, runs waiting for review and the owner's to-dos.
- [진행 중인 작업](./running.md) covers stopped and running cards with their live times.
- [마감일](./due.md) covers dated goals and to-dos in four groups.
- [완료](./done.md) covers finished cards with their totals.
- [에이전트 screen](./agent-screen.md) covers one agent's running, review, goals and done line.
- [목표](./goals.md) covers the goal list and goal detail.
- [할 일 detail](./item-detail.md) covers a to-do with its runs and comment thread.
- [대화](./talk.md) covers talking with the agent that owns a goal or to-do, from its page.
- [작업 detail](./card-detail.md) covers a work card or a worker run outside any card.
- [기기·쿼터](./status.md) covers machines and quota.
- [Owner actions](./actions.md) covers done, undo, done with open to-dos, answers and retry.
- [Freshness](./freshness.md) covers the toolbar's freshness line and read failures.
- [알림](./bell.md) covers the bell, its notices and their read marks.
- [Phone](./phone.md) covers hit areas, type, press feedback, bars, sheets and the push and pop on a phone.
- [Navigation](./phone-nav.md) covers the phone navigation stack, the wide split view and back.
- [Install on the Home Screen](./install.md) covers the web app manifest, the icons and the service worker.
