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
| Signature | `LINA Probe Local Signing`, a self-signed code-signing certificate kept in `~/Library/Application Support/LINA Probe/signing/` |

TCC records the app's designated requirement (bundle ID plus certificate), so a
rebuilt app keeps its grants as long as the same certificate signs it. Do not
delete that signing folder or switch to ad-hoc signing (`LINA_PROBE_SIGN=adhoc`
is for CI build checks only): either change makes macOS treat the rebuild as a
new app that must be switched on again.

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
