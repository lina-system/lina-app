<!-- SPDX-License-Identifier: Apache-2.0 -->
# Translation evidence

- `translation.png`: native production view rendered offscreen with synthetic
  `good morning` → `좋은 아침` output supplied through the translation-service seam.
- `download.png`: the same native view with a synthetic missing-language state.
- `availability.json`: actual Apple `LanguageAvailability` response for English
  to Korean on the capture machine; this does not establish model execution.
- `offline.json`: installed-language seam exercised with network access denied;
  the in-process socket probe requires EPERM/EACCES and the service must receive
  `download=false`. This is a routing/presentation check with synthetic output.

PNGs were captured with AppKit `cacheDisplay` in an unordered fixture window on
macOS 27.0.1. No application was launched, no personal text was used, and no
physical input or network-disconnected Apple model result is claimed. The native
macOS CI job regenerates and uploads these files as `launcher-evidence`.
Physical acceptance is tracked on #116. See [the provider record](../../research/45-translation.md)
for commands and behavioral coverage.
