# LINA app verification map

This directory is the maintained source for verifying what people see and do in the LINA app. Read this index before driving the app, then use the matching feature file as the recipe. Feature ids are shared across platforms: the Mac and iPhone apps reuse them, and each file's `Platforms` section is the parity list between the web client and SwiftUI.

## Baseline preconditions

- Dependencies are installed with `npm ci` and Chromium is available to Playwright (`npx playwright install chromium`).
- Each run has its own id: `export VERIFY_RUN_ID=<short-id>`. The run directory is `verify-runs/$VERIFY_RUN_ID/` in the repository root.
- Launch a disposable instance with `node .agents/skills/verify-lina-app/scripts/verify.mjs launch`. It builds the client into the run directory and serves it on a free port on `127.0.0.1`.
- The instance renders the synthetic fixture (`src/fixtures/synthetic.ts`): agents `River` and `Harbor`, summary Goals `2`, To-dos `3`, Runs `1`.
- Run `verify.mjs doctor` and require `"healthy": true` before the first drive.
- Never drive an instance this run did not start, and never point the app at the owner's live core.

## Driving conventions

- Start every recipe from a fresh page load unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names, then `data-testid`, over CSS selectors or DOM position.
- Treat every command and quoted string as literal.
- Every feature is driven at 1280 and 390 wide, the widths CI captures.
- The app keeps no user data yet, so a drive needs no data restore. When a feature starts writing, its file says how to restore the fixture.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- `verify.mjs drive` writes, per feature and width, a screenshot (`.png`), an ARIA snapshot (`.aria.yml`) and a step log with each action and the state it produced (`.json`) under `verify-runs/$VERIFY_RUN_ID/evidence/<feature-id>/`.
- Record the feature id and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

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

- [Home](./home.md) covers the version, the summary counts, and each agent's goals and to-dos.
- [Note input](./note-input.md) covers typing a note, including Korean composed with an input method.
- [Install on the Home Screen](./install.md) covers the web app manifest, the icons and the service worker.
