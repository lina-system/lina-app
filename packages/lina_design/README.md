# LINA design component

Registered in `scripts/verify/scope.mjs`. Issue #5 adds the Flutter manifest,
lockfile, DTCG-driven ThemeExtension, shared widgets, Pretendard assets and golden
tests here. Generated Dart belongs under `lib/generated/`; widget lint inspects
both this package and `packages/lina_app/lib/`. Activate `theme` and
`visual-values` in `scripts/verify/generators.json` in that change.
See [foundation policy](../../docs/policy/foundation.md).
