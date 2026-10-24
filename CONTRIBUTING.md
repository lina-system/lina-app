# Contributing

The LINA app is licensed under the Apache License, Version 2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)). A contribution you submit is licensed under the same terms (section 5 of the license).

- New source files start with `SPDX-License-Identifier: Apache-2.0` in their comment syntax.
- Dependencies must have a permissive license compatible with Apache-2.0. Paid or source-restricted UI kits are not accepted.
- One change per pull request, title in Conventional Commits style (`feat(launcher): ...`), body from the template, `Closes #n`.
- Screen changes include a screenshot or recording.
- Logic belongs in LINA Core. The app only shows and asks.

- Follow the [foundation](docs/policy/foundation.md) and
  [dependency](docs/policy/dependencies.md) policies. Commit every Dart package
  lockfile; verify with `node scripts/foundation.mjs` before requesting review.
- Keep new packages in `packages/` and register them in
  `scripts/verify/scope.mjs`. The explicitly scoped #88 research app lives in
  `spikes/korean-input/` and is registered with the same dependency/analyze/test
  gate. Unknown paths and missing checks fail the gate.
