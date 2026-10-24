#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Pure model tests: no app launch, permissions, key posting or screen access.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
xcrun swiftc "$here/../RecorderModel.swift" "$here/main.swift" -o "$work/model-tests"
"$work/model-tests"
