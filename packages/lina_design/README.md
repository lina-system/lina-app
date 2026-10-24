# LINA design package

The app's single Flutter presentation package. It exports the generated
`LinaTokens` ThemeExtension, `linaTheme`, `LinaText`, `LinaIcon`, `StatusLabel`
and `CitationChip` / `PassageAnchor`. Fonts and third-party notices ship as assets.

Use `LinaTokens.of(context)` for values and `Theme.of(context).textTheme` for
styles. `CitationChip.onOpen` forwards the exact versioned passage anchor supplied
by the caller; routing and protocol conversion belong to the app/Core adapter.
`unavailableLabel` preserves revoked/deleted/disconnected evidence without opening
it. `LinaText` is display-only Korean word-phrase wrapping with original semantics;
use a copy-preserving document renderer for selection/editing.

[DESIGN.md](../../DESIGN.md) contains screen rules, source provenance, generated
values, contrast evidence, icon mappings and the pending owner decisions.

From the repository root:

```sh
node scripts/verify/design.mjs --write
node scripts/verify/design.mjs --check
node scripts/verify/visual-values.mjs
node --test scripts/verify/design.test.mjs
```

From this package, run `flutter test --no-pub test/widgets_test.dart`. Updating
captures deliberately uses the same command with `--update-goldens`; inspect all
three PNGs in `docs/captures/5/` and commit them. The pinned Linux SDK renders the
CI reference images with bundled fonts. Other native platforms remain unverified.
