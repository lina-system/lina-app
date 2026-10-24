<!-- SPDX-License-Identifier: Apache-2.0 -->
# Emoji and symbols in the launcher

Type a Korean or English name (`하트`, `heart`, `저작권`, `copyright`) to find
emoji and symbols locally. Return or double-click copies the selected Unicode
string to the clipboard. Command-C keeps its normal text-editing behavior.
`emoji`, `이모지`, `symbols` or `기호` browses the catalog; a following term narrows
it. Explicit emoji searches, matched names and copies stay in the native provider
without query/submit messages to Flutter or Core. Dictionary commands and
calculator expressions retain precedence. Bare numeric input remains suppressed;
use explicit emoji mode to search number symbols.

Select a result to **Pin/Unpin**, choose a **Skin tone**, or enter comma-separated
**Your keywords** and press **Save keywords**. Keywords can include Korean,
English and spaces. Searching is case-insensitive and accepts decomposed Hangul.
There are at most 80 matching rows, sorted by exact names/user keywords, exact
annotation keywords, then other token matches, with shorter English names first.
The common names `heart` and `하트` explicitly rank ❤️ first so Return copies
the expected sequence. The list remains scrollable with native keyboard selection.

Empty search shows up to 50 most recently copied entries first, then remaining
pins, followed by calculator history. Duplicate recent/pinned entries appear
once. Only successful clipboard writes update recents. The preference applies
only to catalogued, fully qualified tone sequences; symbols such as ❤️ stay
unchanged. Typing an exact tone variant preserves that variant on copy. The
catalog contains 2,298 bilingual base entries. Skin tone variants use their base
entry's names and keywords; unsupported system glyphs depend on the macOS font.

Preferences live in the local UserDefaults key `launcher.emoji.preferences.v1`:
base glyph recents/pins, up to 20 keywords of 100 characters per entry and a tone
index (default plus five tones). Search drafts are not stored. No cloud API,
external service, input injection or automatic paste is used. Paste into the
front app belongs to #85. Test/evidence app modes use in-memory preferences. Native copy tests inject
an isolated clipboard. The window lifecycle is unchanged.

The catalog is generated offline from pinned CLDR 47.0.0 English/Korean
annotations and Unicode Emoji 16.0, under Unicode-3.0. See the
[dependency policy](../policy/dependencies.md#native-emoji-name-data) and notices.
Missing/untranslated Korean entries are excluded. SwiftPM and the Xcode app
both bundle the same JSON; XCTest fails if that resource is missing.

```sh
node --test scripts/verify/emoji.test.mjs
node scripts/verify/emoji.mjs --check
swift test --package-path packages/lina_app/macos -j 2 --filter 'EmojiTests|CalculatorContentTests|DictionaryTests|ContentTests'
dv heavy -- node scripts/foundation.mjs
```

Native tests cover bilingual names, symbols, aliases, valid tones, successful
and failed writes, stale drafts, composition, preference persistence, recents,
pins and provider switching. The macOS CI job renders the actual native view
into `launcher-evidence` (`docs/captures/46/`), using an unordered fixture window.
These captures show layout, not physical key events, IME candidate placement or
VoiceOver behavior. Physical Mac acceptance is tracked in #116.
