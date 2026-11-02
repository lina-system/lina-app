# Contributing

The LINA app is not accepting outside pull requests during alpha. Bug reports and ideas are welcome in Issues.

## Build and test

Node 24. `npm ci` installs the pinned toolchain.

- `npm test` generates the TypeScript client from `openapi/lina-client.yaml`, typechecks, runs the tests, and checks that a renamed schema field fails the build.
- `npm run build` builds the app. The version stamped into the build is `0.0.1-alpha.YYYYMMDD.N`.
- `npm run capture` builds, then takes captures at 1280 and 390 wide on synthetic data. CI uploads those captures. Do not commit them.

## License

Contributions are licensed under the project's [AGPL-3.0 License](./LICENSE).
