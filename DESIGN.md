# LINA design

Content leads: cool paper, ink and charcoal, generous space, firm headings and
one small cobalt accent. Use the canonical Core wordmark, `lina.`. Do use accent
for focus, selection, the primary action and Waiting for me. Do not fill panels
with accent, use cream/terracotta/serif styling, or invent a palette per screen.

## Source and generation

The pinned, byte-identical Core snapshots in `design/tokens/core/` retain all
canonical roles, terminal metadata and glyphs. `upstream.json` records the source
revision and digests. `app.json` adds layout/type tokens and namespaced extensions
for word-phrase wrapping and springs; each theme adds semantic app colors.
Aliases resolve against that theme. Existing Core roles cannot be overridden.
Update the snapshot deliberately with its revision/digests, then regenerate.

Run `node scripts/verify/design.mjs --write` to generate the ThemeExtension,
icon paths, glyph mapping and the tables below. `--check` verifies contrast,
all outputs (including unexpected files), source digests and role parity without
writing. The foundation gate and CI run it and the visual-value lint. Generated
Dart is formatted by the pinned SDK as part of generation. Never hand-edit it.

The Core Go/Lip Gloss generator, ANSI fallbacks, CSS and Swift outputs remain in
Core. App verification does not claim Core CI has run. Extension integration is tracked in
[lina-system/lina#1650](https://github.com/lina-system/lina/issues/1650). The framework wording in
Core is tracked separately by lina-system/lina#1632; this package follows the
Flutter app issue and SDK pin. #1 and #2 still own physical input/panel acceptance.

## Screen rules

| Surface | Do | Don't |
| --- | --- | --- |
| Home / conversation | Put Waiting for me above the composer; show full prose, speaker names and cited passage chips | Expose logs, IDs or memory internals in the default view |
| Work cards / running list | State the outcome, current state and one next action; reveal evidence in Details | Treat an unobserved state as done or zero |
| Library / evidence | Name the source and passage address; forward the exact versioned anchor to the viewer | Replace missing/revoked evidence or turn a citation into a generic source link |
| Plans / to-dos | Use the shared spacing, headings and state labels; keep hierarchy legible | Rely on color to distinguish status or hierarchy |
| Agents / LIFE | Pair a mark with initial/name; use the same icon grid | Use expression on approvals, failures, results, evidence or unknown |
| Settings / account forms | Keep platform focus, text scaling and input behavior; use shared form tokens | Show credentials or invent custom keyboard conventions |
| Results / diff | Use monospace for code, labeled additions/removals and Details | Convey a diff only with red/green |
| Launcher | Share token values with the native host; honor system accessibility | Claim this package verifies native panel or IME behavior |
| TUI | Use generated Unicode/ASCII equivalents with labels | Use private-use font glyphs, expression or color as the only state cue |

## Typography, motion and accessibility

Pretendard Regular and Bold are bundled under OFL-1.1; code uses bundled JetBrains Mono (OFL-1.1) through an app-specific
font token; Core’s CSS monospace stack remains unchanged. `LinaText` inserts word joiners only into its display
string between Hangul syllables inside a word, preserving the original semantics
label. It prefers breaks between Korean words; it does not alter a model, input
buffer or citation address. Use a selectable/document renderer with its own
copy-preserving paragraph implementation for editable/selected text; this widget
is for presentation labels and body copy. Long unbroken words use the engine's
emergency wrap. Body height is at least 1.5 and text scaling is never clamped.

Normal text requires 4.5:1; only at 24 logical pixels (18pt), or 56/3 pixels
(14pt) and weight at least 700, may it use 3:1. All shipped text pairs pass 4.5:1
regardless of size; high-contrast primary/secondary/accent text additionally
passes 7:1 on canvas and surface. Interactive boundaries/focus and selection
highlights against both surrounding surfaces pass 3:1. Selected text still
passes 4.5:1 on its highlight. The
canonical `line` token is decorative only. States pair an icon and a label,
including “모름”. Focus is visible. Interactive targets use the minimum token.

High contrast follows the platform and can also be explicitly selected. Springs
live in `lina.spring` extension fields, never a made-up DTCG type. Respect reduced
motion by using the reduced duration/static state. No decorative motion ships
in these widgets. Corners use Flutter's continuous rectangle shape.

## Icons and pending owner decisions

`design/tokens/icons.json` is the single app icon source: a pinned Lucide subset
(ISC with the Feather MIT notice) and original LINA state/identity drawings on
its grid and stroke. The generator emits Flutter paths and the terminal mapping
table together. No SF Symbols or private-use glyphs. Agent marks pair a shared
neutral shape with an initial/name; they do not finalize a preset character.

Core's existing cobalt is retained. Lucide is the provisional implementation
choice supported by the #90 exploration; the owner still decides the final
icon set, persona form/expressions and signature interactions in #4. Do not
promote research mockups to approved production character rules.

## Visual-value policy

All handwritten Dart under app/design `lib/` must obtain numbers, colors, fonts,
weights, geometry, durations and icon art from the design package. The lint
rejects numeric literals even when hidden behind a local constant, raw font
families and built-in color/icon/weight/curve/geometry presets. It scans every
library, including helpers, so moving a constant cannot evade it. Only the exact
outputs of the checked generators are exempt; ordinary comments and user-facing
text are allowed. Protocol generated files become a separate registered boundary
in #6. Change token sources instead of adding inline lint suppressions.

<!-- tokens:start -->
Generated from the pinned Core source plus app extensions. Do not edit.

| Role | Light | Dark | High contrast |
| --- | --- | --- | --- |
| border.focusWidth | `{"value":2,"unit":"px"}` | `{"value":2,"unit":"px"}` | `{"value":2,"unit":"px"}` |
| border.width | `{"value":1,"unit":"px"}` | `{"value":1,"unit":"px"}` | `{"value":1,"unit":"px"}` |
| color.accent | `#2F4BDB` | `#5685FF` | `#6795FF` |
| color.border | `#626978` | `#A6ADBD` | `#DDDDDD` |
| color.canvas | `#F8F9FC` | `#17191F` | `#000000` |
| color.diffAdded | `#17633D` | `#8FE0B4` | `#8FE0B4` |
| color.diffAddedBackground | `#E2F1E8` | `#15281F` | `#000000` |
| color.diffRemoved | `#AD2940` | `#FFACB8` | `#FFACB8` |
| color.diffRemovedBackground | `#FCE7EC` | `#301B24` | `#000000` |
| color.disabled | `#626978` | `#A6ADBD` | `#DDDDDD` |
| color.error | `#AD2940` | `#FFACB8` | `#FFACB8` |
| color.focus | `#2F4BDB` | `#5685FF` | `#6795FF` |
| color.line | `#CFD3DE` | `#383E4C` | `#FFFFFF` |
| color.muted | `#626978` | `#A6ADBD` | `#DDDDDD` |
| color.onAccent | `#FFFFFF` | `#000000` | `#000000` |
| color.onSelection | `#20232D` | `#F4F5F9` | `#FFFFFF` |
| color.selection | `#838A9B` | `#626D82` | `#626D82` |
| color.success | `#17633D` | `#8FE0B4` | `#8FE0B4` |
| color.surface | `#EEF0F6` | `#20232B` | `#000000` |
| color.text | `#20232D` | `#F4F5F9` | `#FFFFFF` |
| color.unknown | `#626978` | `#DDDDDD` | `#DDDDDD` |
| color.waiting | `#2F4BDB` | `#5685FF` | `#6795FF` |
| color.warning | `#805000` | `#F6D58C` | `#F6D58C` |
| color.working | `#2F4BDB` | `#5685FF` | `#6795FF` |
| control.minimum | `{"value":48,"unit":"px"}` | `{"value":48,"unit":"px"}` | `{"value":48,"unit":"px"}` |
| glyph.ascii.action | `>` | `>` | `>` |
| glyph.ascii.activityFrames | `&#124;/-\` | `&#124;/-\` | `&#124;/-\` |
| glyph.ascii.activitySeparator | `-` | `-` | `-` |
| glyph.ascii.agent | `*` | `*` | `*` |
| glyph.ascii.back | `<` | `<` | `<` |
| glyph.ascii.connecting | `~` | `~` | `~` |
| glyph.ascii.failed | `x` | `x` | `x` |
| glyph.ascii.live | `*` | `*` | `*` |
| glyph.ascii.mark | `.` | `.` | `.` |
| glyph.ascii.overflow | `...` | `...` | `...` |
| glyph.ascii.person | `>` | `>` | `>` |
| glyph.ascii.quit | `+` | `+` | `+` |
| glyph.ascii.recovering | `:` | `:` | `:` |
| glyph.ascii.refused | `!` | `!` | `!` |
| glyph.ascii.resyncing | `=` | `=` | `=` |
| glyph.ascii.retrying | `>` | `>` | `>` |
| glyph.ascii.rule | `-` | `-` | `-` |
| glyph.ascii.stageDone | `+` | `+` | `+` |
| glyph.ascii.stageFailed | `x` | `x` | `x` |
| glyph.ascii.stageNeedsInput | `!` | `!` | `!` |
| glyph.ascii.stageNext | `.` | `.` | `.` |
| glyph.ascii.stageWaiting | `o` | `o` | `o` |
| glyph.ascii.stageWorking | `*` | `*` | `*` |
| glyph.ascii.stopped | `o` | `o` | `o` |
| glyph.ascii.toolFailed | `x` | `x` | `x` |
| glyph.ascii.toolOk | `+` | `+` | `+` |
| glyph.ascii.toolRunning | `~` | `~` | `~` |
| glyph.ascii.unknown | `?` | `?` | `?` |
| glyph.ascii.waiting | `?` | `?` | `?` |
| glyph.unicode.action | `›` | `›` | `›` |
| glyph.unicode.activityFrames | `◐◓◑◒` | `◐◓◑◒` | `◐◓◑◒` |
| glyph.unicode.activitySeparator | `·` | `·` | `·` |
| glyph.unicode.agent | `●` | `●` | `●` |
| glyph.unicode.back | `‹` | `‹` | `‹` |
| glyph.unicode.connecting | `◌` | `◌` | `◌` |
| glyph.unicode.failed | `×` | `×` | `×` |
| glyph.unicode.live | `●` | `●` | `●` |
| glyph.unicode.mark | `.` | `.` | `.` |
| glyph.unicode.overflow | `…` | `…` | `…` |
| glyph.unicode.person | `›` | `›` | `›` |
| glyph.unicode.quit | `✓` | `✓` | `✓` |
| glyph.unicode.recovering | `◐` | `◐` | `◐` |
| glyph.unicode.refused | `⊘` | `⊘` | `⊘` |
| glyph.unicode.resyncing | `↻` | `↻` | `↻` |
| glyph.unicode.retrying | `↗` | `↗` | `↗` |
| glyph.unicode.rule | `─` | `─` | `─` |
| glyph.unicode.stageDone | `✓` | `✓` | `✓` |
| glyph.unicode.stageFailed | `×` | `×` | `×` |
| glyph.unicode.stageNeedsInput | `!` | `!` | `!` |
| glyph.unicode.stageNext | `·` | `·` | `·` |
| glyph.unicode.stageWaiting | `○` | `○` | `○` |
| glyph.unicode.stageWorking | `●` | `●` | `●` |
| glyph.unicode.stopped | `○` | `○` | `○` |
| glyph.unicode.toolFailed | `×` | `×` | `×` |
| glyph.unicode.toolOk | `✓` | `✓` | `✓` |
| glyph.unicode.toolRunning | `◐` | `◐` | `◐` |
| glyph.unicode.unknown | `?` | `?` | `?` |
| glyph.unicode.waiting | `?` | `?` | `?` |
| icon.grid | `{"value":24,"unit":"px"}` | `{"value":24,"unit":"px"}` | `{"value":24,"unit":"px"}` |
| icon.size | `{"value":20,"unit":"px"}` | `{"value":20,"unit":"px"}` | `{"value":20,"unit":"px"}` |
| icon.stroke | `{"value":2,"unit":"px"}` | `{"value":2,"unit":"px"}` | `{"value":2,"unit":"px"}` |
| motion.activityElapsed | `{"value":1000,"unit":"ms"}` | `{"value":1000,"unit":"ms"}` | `{"value":1000,"unit":"ms"}` |
| motion.activityFrame | `{"value":100,"unit":"ms"}` | `{"value":100,"unit":"ms"}` | `{"value":100,"unit":"ms"}` |
| motion.reduced | `{"value":0,"unit":"ms"}` | `{"value":0,"unit":"ms"}` | `{"value":0,"unit":"ms"}` |
| motion.settle | `{"value":160,"unit":"ms"}` | `{"value":160,"unit":"ms"}` | `{"value":160,"unit":"ms"}` |
| radius.card | `{"value":12,"unit":"px"}` | `{"value":12,"unit":"px"}` | `{"value":12,"unit":"px"}` |
| space.compact | `{"value":4,"unit":"px"}` | `{"value":4,"unit":"px"}` | `{"value":4,"unit":"px"}` |
| space.gutter | `{"value":24,"unit":"px"}` | `{"value":24,"unit":"px"}` | `{"value":24,"unit":"px"}` |
| space.inline | `{"value":8,"unit":"px"}` | `{"value":8,"unit":"px"}` | `{"value":8,"unit":"px"}` |
| space.page | `{"value":32,"unit":"px"}` | `{"value":32,"unit":"px"}` | `{"value":32,"unit":"px"}` |
| space.section | `{"value":24,"unit":"px"}` | `{"value":24,"unit":"px"}` | `{"value":24,"unit":"px"}` |
| type.body | `["Pretendard","sans-serif"]` | `["Pretendard","sans-serif"]` | `["Pretendard","sans-serif"]` |
| type.code | `["ui-monospace","monospace"]` | `["ui-monospace","monospace"]` | `["ui-monospace","monospace"]` |
| type.codeNative | `["JetBrainsMono","monospace"]` | `["JetBrainsMono","monospace"]` | `["JetBrainsMono","monospace"]` |
| type.labelSize | `{"value":14,"unit":"px"}` | `{"value":14,"unit":"px"}` | `{"value":14,"unit":"px"}` |
| type.lineHeight | `1.5` | `1.5` | `1.5` |
| type.size | `{"value":16,"unit":"px"}` | `{"value":16,"unit":"px"}` | `{"value":16,"unit":"px"}` |
| type.titleSize | `{"value":28,"unit":"px"}` | `{"value":28,"unit":"px"}` | `{"value":28,"unit":"px"}` |
| type.titleWeight | `700` | `700` | `700` |
| type.weight | `400` | `400` | `400` |

### Motion and wrapping extensions

Word wrapping: `word-phrase`. Spring: `{"mass":1,"stiffness":260,"damping":28}`.

### App icon / TUI mapping

| Icon | Unicode | ASCII | Source |
| --- | --- | --- | --- |
| citation | ▤ | `[doc]` | icons/file-text.svg (adapted path) |
| success | ✓ | `+` | icons/check.svg |
| error | × | `x` | icons/x.svg |
| working | ◐ | `~` | LINA |
| waiting | ! | `!` | LINA |
| unknown | ? | `?` | LINA |
| memory | ▥ | `[m]` | LINA |
| identity | ● | `@` | LINA |

### Contrast evidence

| Mode | Pair | Ratio | Minimum |
| --- | --- | --- | --- |
| light | text / canvas | 14.889 | 4.5 |
| light | text / surface | 13.757 | 4.5 |
| light | muted / canvas | 5.234 | 4.5 |
| light | muted / surface | 4.836 | 4.5 |
| light | accent / canvas | 6.332 | 4.5 |
| light | accent / surface | 5.851 | 4.5 |
| light | success / canvas | 6.906 | 4.5 |
| light | success / surface | 6.380 | 4.5 |
| light | warning / canvas | 6.507 | 4.5 |
| light | warning / surface | 6.013 | 4.5 |
| light | error / canvas | 6.296 | 4.5 |
| light | error / surface | 5.818 | 4.5 |
| light | unknown / canvas | 5.234 | 4.5 |
| light | unknown / surface | 4.836 | 4.5 |
| light | working / canvas | 6.332 | 4.5 |
| light | working / surface | 5.851 | 4.5 |
| light | waiting / canvas | 6.332 | 4.5 |
| light | waiting / surface | 5.851 | 4.5 |
| light | disabled / canvas | 5.234 | 4.5 |
| light | disabled / surface | 4.836 | 4.5 |
| light | focus / canvas | 6.332 | 3 |
| light | border / canvas | 5.234 | 3 |
| light | focus / surface | 5.851 | 3 |
| light | border / surface | 4.836 | 3 |
| light | onAccent / accent | 6.666 | 4.5 |
| light | onSelection / selection | 4.534 | 4.5 |
| light | selection / canvas | 3.284 | 3 |
| light | selection / surface | 3.034 | 3 |
| light | diffAdded / diffAddedBackground | 6.225 | 4.5 |
| light | diffRemoved / diffRemovedBackground | 5.612 | 4.5 |
| dark | text / canvas | 16.126 | 4.5 |
| dark | text / surface | 14.420 | 4.5 |
| dark | muted / canvas | 7.809 | 4.5 |
| dark | muted / surface | 6.983 | 4.5 |
| dark | accent / canvas | 5.183 | 4.5 |
| dark | accent / surface | 4.634 | 4.5 |
| dark | success / canvas | 11.286 | 4.5 |
| dark | success / surface | 10.091 | 4.5 |
| dark | warning / canvas | 12.395 | 4.5 |
| dark | warning / surface | 11.083 | 4.5 |
| dark | error / canvas | 9.910 | 4.5 |
| dark | error / surface | 8.861 | 4.5 |
| dark | unknown / canvas | 12.935 | 4.5 |
| dark | unknown / surface | 11.567 | 4.5 |
| dark | working / canvas | 5.183 | 4.5 |
| dark | working / surface | 4.634 | 4.5 |
| dark | waiting / canvas | 5.183 | 4.5 |
| dark | waiting / surface | 4.634 | 4.5 |
| dark | disabled / canvas | 7.809 | 4.5 |
| dark | disabled / surface | 6.983 | 4.5 |
| dark | focus / canvas | 5.183 | 3 |
| dark | border / canvas | 7.809 | 3 |
| dark | focus / surface | 4.634 | 3 |
| dark | border / surface | 6.983 | 3 |
| dark | onAccent / accent | 6.195 | 4.5 |
| dark | onSelection / selection | 4.784 | 4.5 |
| dark | selection / canvas | 3.371 | 3 |
| dark | selection / surface | 3.014 | 3 |
| dark | diffAdded / diffAddedBackground | 9.954 | 4.5 |
| dark | diffRemoved / diffRemovedBackground | 9.056 | 4.5 |
| high-contrast | text / canvas | 21.000 | 7 |
| high-contrast | text / surface | 21.000 | 7 |
| high-contrast | muted / canvas | 15.461 | 7 |
| high-contrast | muted / surface | 15.461 | 7 |
| high-contrast | accent / canvas | 7.320 | 7 |
| high-contrast | accent / surface | 7.320 | 7 |
| high-contrast | success / canvas | 13.489 | 4.5 |
| high-contrast | success / surface | 13.489 | 4.5 |
| high-contrast | warning / canvas | 14.815 | 4.5 |
| high-contrast | warning / surface | 14.815 | 4.5 |
| high-contrast | error / canvas | 11.845 | 4.5 |
| high-contrast | error / surface | 11.845 | 4.5 |
| high-contrast | unknown / canvas | 15.461 | 4.5 |
| high-contrast | unknown / surface | 15.461 | 4.5 |
| high-contrast | working / canvas | 7.320 | 4.5 |
| high-contrast | working / surface | 7.320 | 4.5 |
| high-contrast | waiting / canvas | 7.320 | 4.5 |
| high-contrast | waiting / surface | 7.320 | 4.5 |
| high-contrast | disabled / canvas | 15.461 | 4.5 |
| high-contrast | disabled / surface | 15.461 | 4.5 |
| high-contrast | focus / canvas | 7.320 | 3 |
| high-contrast | border / canvas | 15.461 | 3 |
| high-contrast | focus / surface | 7.320 | 3 |
| high-contrast | border / surface | 15.461 | 3 |
| high-contrast | onAccent / accent | 7.320 | 4.5 |
| high-contrast | onSelection / selection | 5.212 | 4.5 |
| high-contrast | selection / canvas | 4.029 | 3 |
| high-contrast | selection / surface | 4.029 | 3 |
| high-contrast | diffAdded / diffAddedBackground | 13.489 | 4.5 |
| high-contrast | diffRemoved / diffRemovedBackground | 11.845 | 4.5 |
<!-- tokens:end -->
