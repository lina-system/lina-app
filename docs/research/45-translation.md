<!-- SPDX-License-Identifier: Apache-2.0 -->
# Device translation in the launcher

`tr good morning` translates English to Korean using Apple Translation on
macOS 15 or later. The answer is selectable, scrollable native text. The source
and target selectors choose a pair; **Swap** reverses the pair and uses the
current translation as the new source when available. **Use as default** saves
only the two language identifiers on this Mac. Text and translations are never
persisted. Pair commands such as `tr:en:ko good morning`, `tr:ko:en 안녕하세요`,
and `tr:ja:ko おはよう` override the default for that query. The selectors expose
English, Korean, Japanese, simplified/traditional Chinese, French, German,
Spanish, Italian, Portuguese, Russian and Arabic; actual pair availability is
checked with Apple. Invalid or unsupported pairs never reach another provider.

The provider checks `LanguageAvailability` before starting a translation. If
packs are missing, it offers **Download languages**. Only that explicit action
calls Apple's `prepareTranslation()` and its system permission/download UI.
Once installed, the ordinary typing path translates locally without preparing
or requesting a download. There is no web fallback, Core request, translation
history or third-party dependency. Older systems show the minimum OS requirement.
Failures leave a Retry action; edits invalidate pending work and stale responses.
Marked text defers translation, swapping, preference changes and submission.

The AppKit provider lives in `LauncherTranslation.swift`. An embedded SwiftUI
hosting view supplies Apple's `translationTask` lifecycle and system download UI;
AppKit still owns input, results, language controls and selectable output. The
shared result list routes a translation row, while `LauncherPanel.swift` is
unchanged. A short debounce prevents starting a translation for every keystroke.

**Continue in conversation / 대화로 이어 가기** (Return or row activation) adds the
source, language pair and translation to the existing agent message draft and
opens LINA. It appends to an existing draft, retains the selected agent, and sends
nothing to Core. An active composer IME session refuses delivery and preserves
the result for retry. Native waits for the main engine's `draftReady` handshake,
then sends `appendDraft: {text: String}` on the existing local launcher channel;
Dart returns a Boolean acknowledgement. The hidden answer engine never receives
the draft. This extends only local presentation, not the Core protocol. Front-app
paste remains #85.

## Verification

```sh
LINA_TRANSLATION_CAPTURES="$PWD/docs/captures/45" swift test --package-path packages/lina_app/macos -j 2 --filter 'TranslationTests|DictionaryTests|CalculatorContentTests|ContentTests'
node scripts/translation.mjs
dv heavy -- node scripts/foundation.mjs
```

`translation.mjs` executes the installed-language XCTest seam under
`sandbox-exec` with `(deny network*)`. In that same test process a socket probe
must fail with EPERM/EACCES; ECONNREFUSED is not sufficient. The production
provider receives injected installed-language status and a synthetic Korean
translation, and must produce the row and draft without invoking the download
path or forwarding a query/submission to Core. This proves offline routing and
presentation, **not Apple's actual model output**. SwiftPM's nested manifest
sandbox is disabled for this invocation; the outer network-denial sandbox remains
in force for SwiftPM and the test process.

Native tests cover commands, saved defaults, swap, explicit download, missing
and unsupported languages, OS availability, failure/retry, composition, stale
completion rejection, provider switching and draft acknowledgements. Flutter
tests cover the channel handshake, invalid payloads, appending without a Core
request and preserving the existing draft/composition. The macOS native CI job
runs these tests, the offline seam and the actual-language availability probe,
and uploads [captures](../captures/45/README.md).

The implementation Mac reported the English/Korean pair installed. Its console
was locked; no settings were changed and no physical typing, download prompt,
network-disconnected model translation or VoiceOver check is claimed. Those
checks are recorded on [#116](https://github.com/lina-system/lina-app/issues/116).
