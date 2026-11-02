# Home

Home is the first screen. It shows the app version, a summary of how many goals, to-dos and runs exist, and, per agent, each goal with its to-dos, their state, the reason for that state and who added them.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The version reads `0.0.1-alpha.YYYYMMDD.N` and equals `package.json`'s `version`.
- The summary list `Summary` shows Goals, To-dos and Runs, and the numbers equal the data the app was given.
- Every agent has a level-2 heading with its name, and under it each goal and its to-dos.
- Each to-do line reads `<title> · <state> · <reason> · <added by>`; the reason is left out when there is none. States read `planned`, `in progress`, `waiting`, `stopped` or `done`.
- Korean titles render whole, with no broken or clipped syllables.
- The page never scrolls sideways at 1280 or 390 wide.

## Sub-features

- `home-version` shows the build's version.
- `home-summary` shows the goal, to-do and run counts.
- `home-agents` lists agents with their goals and to-dos.
- `home-state-line` shows each to-do's state, reason and author.
- `home-fit` keeps the page inside the window width.

## How to get to it (user POV)

- Open the app's address in a browser.
- Open the LINA icon on the Home Screen after installing it (see [install](./install.md)).

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The instance renders the synthetic fixture.

- **Open the app.** Load `/`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive home`. The page title is `LINA`.
- **Version.** Read the version under the `LINA` mark. The element `data-testid="version"` equals `package.json`'s `version`.
- **Summary.** Read the list named `Summary`. Goals `2`, To-dos `3`, Runs `1` (`data-testid` `goal-count`, `todo-count`, `run-count`).
- **Agents and work.** Read the agent headings. Headings `River` and `Harbor`; the goal `샘플 목표` is visible; the to-do `Write the fixture` reads `in progress · working · River`; the to-do `Note a line` reads `waiting · input · Harbor`.
- **Fit.** Check the page width. `document.documentElement.scrollWidth` is at most `clientWidth + 1` at both widths.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/home/home-1280.{png,aria.yml,json}` and `home-390.{png,aria.yml,json}` show the version, the three counts and both agents.

## Gotchas

- The fixture is built into the client. Doctor fails when the counts are not `2`, `3`, `1`, which means the page is not this run's fixture instance.
- The version is read from `package.json` at build time. After a version bump, relaunch; doctor reports a build revision that differs from the checkout.
- A to-do with no reason has one `·` fewer. Assert the whole line, not a split by position.

## Not goals

- Home does not change any to-do; it only shows them.
- Home does not refresh by itself. Live data from the core arrives with the screen issues that read it.
- Home does not sort or filter agents.
