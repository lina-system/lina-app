# LINA App

The desktop and mobile app for [LINA](https://github.com/lina-system/lina), a fork of Hermes Agent. It shows conversations, work threads, questions and results, and talks to LINA only through LINA's client protocol. The web client is TypeScript and Preact, built with Vite, and installs on a phone Home Screen. Available under the GNU Affero General Public License v3.0 ([LICENSE](LICENSE)); the shared repository policy is in [lina-system/.github](https://github.com/lina-system/.github/blob/main/POLICY.md).

## Development

The app version is `package.json`'s `version`, `0.0.1-alpha.YYYYMMDD.N`. `npm test` generates one TypeScript module per core schema file (`openapi/board-client.yaml`, `openapi/work-client.yaml`, `openapi/talk-client.yaml`, copied from lina-system/lina), checks that tracked files contain no personal data, typechecks, runs the tests, and checks that renaming a field the screen reads fails the build. `npm run build` produces the client. `npm run capture` takes captures of every screen at 1280 (light and dark) and 390 wide on the synthetic scene. The core serves the build under `/app/`; `npm run dev` and `npm run preview` serve it there too, and `/app/?source=synthetic` draws the synthetic scene instead of reading the core.

## Work-only install

`npm run build:work` (`VITE_LINA_MODE=work`) writes a goals / to-do app into `dist-work/`. It keeps home, inbox (board-client decide / review / mine), due, today, done, goals, item and goal detail, comments, quick-add, owner-done and undo. It has no 대화 or 상태 tabs, no talk SSE, no running / card / run / round / group screens, no worker cards, retry or work-card inbox. The PWA name is `LINA 작업`. Point the core's `dashboard.app_dist` at `dist-work` (or copy that folder into place). Rollback is pointing `dashboard.app_dist` back at the previous dist. `npm run build` with no flag is the full app, identical to today. `npm run preview:work` serves `dist-work/` under `/app/`. After a work-only build, `LINA_WORK_ONLY=1 npx playwright test tests/work-only.spec.ts` checks that talk, status and agent-ops are gone; the default `npm run capture` still serves `dist/` and skips that file.
