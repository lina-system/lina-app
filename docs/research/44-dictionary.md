# Device dictionary in the launcher

`define serendipity` and `define 사과` look up the complete word using the public
macOS `DCSCopyTextDefinition` API. The native answer area shows selectable,
scrollable plain text. Return in the input or on the result row, and double-click,
open that exact word in Dictionary.app. URL delimiters and Unicode are encoded as
one `dict:///` path component, and the opener explicitly targets Dictionary.app.
A failed open leaves the panel visible with an error.

Lookup runs on a serial background queue; editing invalidates old completions
and clears the previous row immediately. Marked text is not looked up or
submitted. These queries and actions stay in the native provider and do not
reach the Flutter query/submit channel. The window lifecycle is unchanged.

Dictionary Services selects the person's active, installed dictionaries. English
and Korean availability therefore depends on those dictionaries, exactly as in
Dictionary.app. Missing words show an explicit no-definition message with guidance
to enable the needed dictionary in that app's settings. The launcher never
downloads dictionaries, changes preferences, or falls back to an online service.

## Reproduce

```sh
swift test --package-path packages/lina_app/macos -j 2 --filter DictionaryTests
dv heavy -- node scripts/dictionary.mjs
dv heavy -- node scripts/foundation.mjs
```

`dictionary.mjs` builds a small executable that calls the production provider
under `sandbox-exec` with `(deny network*)`. In the same process it attempts a
loopback connection and requires EPERM/EACCES; ECONNREFUSED or a missing probe
cannot pass. It then calls Dictionary Services for both acceptance words and
records actual definitions or explicit nulls in `docs/captures/44/offline.json`.
The verifier distinguishes a successful network-isolation check from word
acceptance: an absent dictionary is recorded as **unverified**, never a passing
definition. This proves the lookup process runs with networking denied; it does
not assert control over independently running system services or Dictionary.app
following an explicit open action.

The macOS native CI job runs these checks and uploads `launcher-evidence` with
the offline record and two PNGs of the actual native view rendered with clearly
labeled synthetic English/Korean definitions. The capture test neither orders a
window nor launches Dictionary.app. Captures demonstrate layout; they are not
proof of installed dictionary content or physical input. Native tests inject the
opener and verify exact-word routing, both Return paths, missing entries, open
failure, composition deferral, and late-result rejection.

The implementation session is on Linux and the named reference Mac cannot be
resolved. Real device typing, installed English/Korean content, and observing
Dictionary.app at the exact entry remain physical acceptance in #116. No local
macOS test or physical acceptance is claimed by the Linux foundation result.
