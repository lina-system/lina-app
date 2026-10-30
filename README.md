# LINA App

The desktop and mobile app for [LINA](https://github.com/lina-system/lina): conversations with your agents, work threads, questions, results and settings, plus the Mac launcher and menu bar.

> In development. No runnable release yet.

## How it fits

- **LINA** lives in [`lina-system/lina`](https://github.com/lina-system/lina). It holds the logic, memory and every decision.
- **This app** only shows and asks. It talks to LINA through its published client protocol and never reaches a model, a worker or an outside service directly.

## Framework

The app framework is decided by measurement, not by preference. Korean input, global shortcut, non-activating panel, clipboard history and side-by-side speed against the system decide what each surface is built with. The decision and its numbers are recorded in the issues.

Only open-source components are used. No paid or source-restricted UI kit is part of the app.

## Contributing

- Issues and ideas for the app go to this repository's [Issues](https://github.com/lina-system/lina-app/issues). Problems in LINA go to [`lina-system/lina`](https://github.com/lina-system/lina/issues).
- Pull requests target `main` and link their issue with `Closes #n`.
- PR and issue text is written in English.
- Never put credentials, personal data or real conversations in an issue, commit or screenshot. Use synthetic data.

## License

Available under the Sustainable Use License ([LICENSE](LICENSE)). Third-party components keep their own licenses.
