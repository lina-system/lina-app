---
name: verify-lina-app
description: "Launch a disposable LINA web app on the synthetic fixture, drive its screens in Chromium the way a person does, and capture screenshots, ARIA snapshots and step logs as proof. Use to prove a UI change, to run the browser QA a pull request labelled ui gets, or when anyone asks whether a LINA app screen works."
---

# Verify the LINA app

The LINA app is a Preact web client (Vite) that people use in a desktop browser and from a phone Home Screen. This skill drives a disposable copy of it in Chromium through Playwright, using one helper, `scripts/verify.mjs`, and the feature map in [`features/`](features/README.md). Every command below runs from the repository root.

The instance is always disposable and seeded with fixture data. The client reads the core's client API by default; every drive loads `/app/?source=synthetic`, which swaps the core for the synthetic scene built into the client (`src/fixtures/synthetic.ts`), so the instance talks to no core. Never point a verification run at the owner's live core, and never drive an instance this run did not start.

## Launch

```sh
npm ci                                   # once per checkout
npx playwright install chromium          # once per machine
export VERIFY_RUN_ID=pr-123              # any short id; default "local"
node .agents/skills/verify-lina-app/scripts/verify.mjs launch
```

`launch` regenerates the API client, builds the app into `verify-runs/$VERIFY_RUN_ID/dist`, and starts `vite preview` on a free port on `127.0.0.1` in the background. The app is served under `/app/`, as the core serves it. It records the process id, port, version and git revision in `verify-runs/$VERIFY_RUN_ID/state.json`, and the server log in `preview.log` beside it. Ready means usable: the line `ready: http://127.0.0.1:<port> (pid <pid>, run <id>, version <version>)` appears only after a browser has loaded the page and read the version and the fixture counts. `launch --no-build` reuses the run's existing build.

Two runs with different `VERIFY_RUN_ID`s run side by side; each has its own build, port and evidence. `launch` refuses to start a second instance for a run id that already has a live one.

## Doctor

```sh
node .agents/skills/verify-lina-app/scripts/verify.mjs doctor
```

Read-only. It prints JSON with `"healthy"`, `problems` and `notes`, and exits `1` when unhealthy. It checks that the recorded process is alive, `/app/` answers `200`, the page's version equals `package.json`'s, and the sidebar and bell show the scene's counts (수신함 `7`, 진행 중인 작업 `2` with a red `1`, 마감일 `5`, 완료 `1`, 목표 `5`, `알림 5`, `기기 4 · 정상 2 · 경고 1 · 꺼짐 1`), which is how it tells this run's fixture instance from any other page. A note says when the checkout has moved past the build's revision; relaunch to drive the current code. Run doctor before the first drive, after any failed drive, and whenever anything looks off.

## Drive

```sh
node .agents/skills/verify-lina-app/scripts/verify.mjs drive inbox
node .agents/skills/verify-lina-app/scripts/verify.mjs drive running card-detail
node .agents/skills/verify-lina-app/scripts/verify.mjs drive --all
node .agents/skills/verify-lina-app/scripts/verify.mjs map
```

`drive` runs the recipe of each named feature at 1280 and 390 wide in headless Chromium. Feature ids are the file names in [`features/`](features/README.md); each file's `Driving it with verify.mjs` section lists the steps and the result each one must show. Drivers find elements by role and accessible name (`getByRole("list", { name: "결정 필요" })`, `getByRole("checkbox", { name: "<title> 완료로 표시" })`, `getByRole("button", { name: "알림 5" })`, rows named by agent, sentence and state) and then by `data-testid` (`freshness-line`, `nav-inbox`, `device-line`, `screen-title`, `back`). It prints `ok` or `DEFECT` per feature and width, exits `1` on any defect, and after the drive lists map drift.

`map` checks the map alone: every feature file is listed in the index, has a driver, and has the seven sections in order, and every driver has a file. It exits `1` on drift.

To drive a step no driver covers yet, use Playwright against the URL in `state.json`, by role and accessible name, and add the step to the feature's driver in the same pull request.

## Evidence

`drive` writes, per feature and width, to `verify-runs/$VERIFY_RUN_ID/evidence/<feature-id>/`:

- `<feature-id>-<width>.json`: feature, width, URL, version, revision, time, and each action with the state it produced, plus the defect if one step failed.
- `<feature-id>-<width>.png`: full-page screenshot after the last step.
- `<feature-id>-<width>.aria.yml`: ARIA snapshot of the page after the last step.

Proof standards: exercise the real user path, not internal setters or test-only routes; capture each action and the state it produced, not only the final screen; mocks only where a production boundary already isolates the external system. `verify-runs/` is ignored by git. Attach evidence to a pull request as a CI artifact or as files in a comment, never as committed files.

## Cleanup

```sh
node .agents/skills/verify-lina-app/scripts/verify.mjs cleanup
```

`cleanup` stops the process group this run started (by the recorded process id, never by name), confirms the port is free, and removes the run's build and `state.json`. It keeps `evidence/` and `preview.log`, and prints where they are. Run it after every run, including failed ones. When `launch` fails it already stops what it started.

## Browser QA on a pull request labelled `ui`

A pull request that changes what people see carries the `ui` label and gets one browser QA run on the features it touches.

1. Pick the features: the feature files the pull request adds or changes, plus every feature whose screen its code changes. A pull request that adds or changes a screen without touching its feature file is map drift.
2. Launch, doctor, drive those features, and read every step log and screenshot. Drive by hand, with Playwright, any `Intended behavior` line or Done when item the drivers do not cover.
3. Answer in a pull request comment in exactly four parts:
   - **Defects**: anything that breaks a feature's `Intended behavior` or the pull request's Done when, with the feature id, width, step and evidence file. A defect blocks the merge like a P1 review finding.
   - **Confirmed Done when**: each Done when item proven, with the evidence file that proves it.
   - **Suggestions**: improvements that are not defects, including anything a feature lists under `Not goals`. Suggestions go into the sprint's one suggestions issue, not into this pull request.
   - **Map drift**: feature files that no longer match the app, missing feature files, and `map` output.
4. Clean up and check that the evidence is still there.

The `UI QA` workflow (`.github/workflows/ui-qa.yml`) runs the scripted part on every push to a pull request labelled `ui`: it drives every feature, fails on a defect, writes defects and map drift to the job summary, and uploads the evidence. The agent's comment adds the confirmed Done when items and the suggestions.

## Keeping the map honest

- Every pull request that adds or changes a screen adds or updates its feature file and driver in the same pull request.
- `/maintain-verification-skill` audits this skill and the map against the app. `/create-verification-skill` is the generator this skill follows.
