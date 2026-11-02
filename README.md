# LINA App

The desktop and mobile app for [LINA](https://github.com/lina-system/lina), a fork of Hermes Agent. It shows conversations, work threads, questions and results, and talks to LINA only through LINA's client protocol. The web client is TypeScript and Preact, built with Vite, and installs on a phone Home Screen. Available under the GNU Affero General Public License v3.0 ([LICENSE](LICENSE)); the shared repository policy is in [lina-system/.github](https://github.com/lina-system/.github/blob/main/POLICY.md).

## Development

The app version is `package.json`'s `version`, `0.0.1-alpha.YYYYMMDD.N`. `npm test` generates the API client from `openapi/lina-client.yaml`, typechecks, runs the tests, and checks that renaming a field the screen reads fails the build. `npm run build` produces the client. `npm run capture` takes captures at 1280 and 390 wide on the synthetic fixture. The checked-in schema stands in until the core serves its own file (lina-system/lina#39).
