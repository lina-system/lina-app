# LINA App

The desktop and mobile app for [LINA](https://github.com/thisisjun786/lina): conversations with your agents, work threads, questions, results and settings, plus the Mac launcher and menu bar.

> In development. No runnable release yet.

## How it fits

- **LINA Core** lives in [`thisisjun786/lina`](https://github.com/thisisjun786/lina). It holds the logic, memory and every decision.
- **This app** only shows and asks. It talks to Core through the published client protocol and never reaches a model, a worker or an outside service directly.
- The design contract for every screen is in Core's [`docs/design/surfaces.md`](https://github.com/thisisjun786/lina/blob/dev/docs/design/surfaces.md).

## Framework

The app framework is decided by measurement, not by preference. The checks in the "Flutter decision and design package" milestone (Korean input, global shortcut, non-activating panel, clipboard history, side-by-side speed against the system) decide whether Flutter is used for every surface, for some, or not at all. A surface that fails moves to native code behind the same design tokens. The decision and its numbers are recorded in the issues.

Only open-source components are used. No paid or source-restricted UI kit is part of the app.

## Contributing

- Issues and ideas for the app go to this repository's [Issues](https://github.com/thisisjun786/lina-app/issues). Problems in Core go to [`thisisjun786/lina`](https://github.com/thisisjun786/lina/issues).
- Pull requests target `main`, follow the pull request template, and link their issue with `Closes #n`.
- PR and issue text is written in English.
- Never put credentials, personal data or real conversations in an issue, commit or screenshot. Use synthetic data.

## Security

Report a vulnerability privately to the repository owner, as described in [SECURITY.md](SECURITY.md).

## License

Licensed under the Apache License, Version 2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)). Contributions are accepted under the same license.

## Foundation gate

Run `node scripts/foundation.mjs` with the pinned SDKs. See the
[foundation policy](docs/policy/foundation.md) for component paths, evidence,
codegen ownership and the native-build matrix, and the
[dependency policy](docs/policy/dependencies.md) for exact pins and updates.
