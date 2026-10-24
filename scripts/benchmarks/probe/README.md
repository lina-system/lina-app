# LINA Probe

The single signed macOS app that holds the Accessibility and Screen Recording
grants for the launcher baseline in [#91](https://github.com/lina-system/lina-app/issues/91).
The [protocol](../../../docs/research/launcher-baseline-protocol.md) requires one
stable executable for those grants; recorder commands are added here instead of
in a new tool.

| Fixed | Value |
| --- | --- |
| App | `/Applications/LINA Probe.app` |
| Bundle ID | `dev.lina.probe` |
| Signature | `local` by default: `LINA Probe Local Signing`, a self-signed code-signing certificate kept in `~/Library/Application Support/LINA Probe/signing/` |

TCC records the app's designated requirement (bundle ID plus certificate), so a
rebuilt app keeps its grants as long as the same identity signs it. Do not
delete that signing folder or switch to ad-hoc signing (`LINA_PROBE_SIGN=adhoc`
is for CI build checks only): either change makes macOS treat the rebuild as a
new app that must be switched on again.

## Signing

`sign.sh APP IDENTITY` is the only place the app is signed; `build.sh` calls it.
`IDENTITY` is `local`, `adhoc`, or any keychain code-signing identity name or
SHA-1. A named identity is signed with the hardened runtime and a secure
timestamp. `build.sh` takes the identity from `LINA_PROBE_SIGN`, else the first
line of `~/Library/Application Support/LINA Probe/sign-identity`, else `local`.

To move to a Developer ID certificate once it is in the login keychain:

```sh
echo 'Developer ID Application: <Name> (<TEAMID>)' > ~/Library/Application\ Support/LINA\ Probe/sign-identity
scripts/benchmarks/probe/build.sh
```

The designated requirement changes with the certificate, so switch LINA Probe
on once more in both Privacy lists afterwards. Later rebuilds keep the grants.

```sh
scripts/benchmarks/probe/build.sh            # build, sign, install, write build.json provenance
scripts/benchmarks/probe/run.sh request      # first run: macOS adds LINA Probe to both Privacy lists
scripts/benchmarks/probe/run.sh status       # exit 0 only when both grants are on, 3 otherwise
```

`run.sh` launches the app through LaunchServices (`open -n -W`) so macOS checks
LINA Probe itself, not the terminal, ssh session or agent that started it. It
needs a logged-in GUI session; it does not unlock the screen.

The status JSON (`accessibility`, `screen_recording`, executable path, PID and
time) and `build.json` (source revision, Swift/SDK versions, executable SHA-256,
cdhash, designated requirement, `codesign --verify --strict`) belong in the
evidence manifest.

## Panel shortcut stimulus

`run.sh panel-shortcut` opens a synthetic foreground window with a **Send panel
shortcut** button for the mac-panel study. Each click posts one fixed
Control+Option+Space chord through the existing authorized probe. It is not a
shell/script bridge and accepts no arbitrary keys or app targets. It refuses
without existing Accessibility/post-event access, while locked, if the panel
app is absent, or after ten sends. It requests no permission. The control quits
after the tenth send (or after three minutes). Use the companion
`node scripts/mac-panel.mjs measure-visible` collector; wait for each
`LINA_VISIBLE_READY` before clicking. The resulting sample must identify the
Carbon global-hotkey route, an external foreground app and a matching displayed
Flutter frame. This is a synthetic OS key stimulus, not a physical key-to-photon
measurement. Rebuild with the same signing identity to retain existing grants.
