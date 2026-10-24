#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Run LINA Probe through LaunchServices so the app bundle itself is the
# responsible process TCC checks, even from ssh, a terminal or an agent.
# Never execute Contents/MacOS directly for measured work: TCC would then
# attribute the request to the parent shell, sshd or terminal instead.
#   run.sh status   -> exit 0 when Accessibility and Screen Recording are granted, 3 otherwise
#   run.sh request  -> ask macOS for both grants and add LINA Probe to both Privacy lists
set -euo pipefail
app=${LINA_PROBE_APP:-/Applications/LINA Probe.app}
[ -d "$app" ] || { printf 'run.sh: %s is missing; run scripts/benchmarks/probe/build.sh\n' "$app" >&2; exit 69; }
dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
: > "$dir/out"; : > "$dir/err"
open -n -g -W -a "$app" -o "$dir/out" --stderr "$dir/err" --args --exit-file "$dir/code" "$@"
cat "$dir/out"; cat "$dir/err" >&2
[ -s "$dir/code" ] || { printf 'run.sh: LINA Probe exited without a status; is a GUI login session active?\n' >&2; exit 70; }
exit "$(cat "$dir/code")"
