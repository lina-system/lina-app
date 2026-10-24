# Local launcher calculator

The native result list evaluates arithmetic as the input changes. Return (or
activating the selected row) copies the answer with the current macOS number
locale. Option-Command-C copies without grouping, with a decimal point. Plain
Command-C continues to copy the selected input text. Bare numeric literals,
invalid/incomplete expressions and non-finite results show no calculator row.
An IME composition cannot copy an answer. Clearing the field shows copied-result
history; selecting a history row copies that answer again.

## Evaluator and syntax

The evaluator is original repository code under **Apache-2.0**, with no imported
implementation or new dependency. This is the small in-repository parser option:
it avoids embedding JavaScript/math.js or a Rust/fend bridge just to serve the
native result list. No third-party notice or dependency inventory entry is
needed. Foundation-only parsing and formatting live in `Calculator.swift`;
XCTest exercises them in the existing macOS native CI job, alongside AppKit
integration. There is no additional Linux Swift toolchain requirement.

Supported expressions include:

| Input | Answer |
| --- | --- |
| `(3+4)*12%` | `0.84` |
| `2^10` | `1024` |
| `sin(pi/2)` | `1` |
| `0xff + 0b1` | `256` |
| `255 in hex` | `ff` |
| `(three plus four) times twelve percent` | `0.84` |
| `one hundred and five divided by five` | `21` |

Operators are `+ - * / ^` and postfix `%` (divide by 100); `× ÷ −` also work.
Powers associate right-to-left and bind more tightly than a leading sign:
`2^3^2 = 512`, `-2^2 = -4`. Parentheses group expressions. Scientific notation
uses `e`, as in `1e3`. Functions require parentheses: `sin`, `cos`, `tan`, `asin`,
`acos`, `atan` (radians), `sqrt`, `abs`, `ln` and base-ten `log`. Constants are
`pi`/`π`, `tau`, and `e`.

Base literals use `0x`, `0b`, or `0o`. A terminal `in hex`, `in binary`,
`in octal`, or `in decimal` converts an integral answer; base integers/conversions
are limited to the exact Double integer range (absolute value ≤ 2^53−1).
English operators include `plus`, `minus`, `times`, `multiplied by`, `divided by`,
`to the power of`, and `percent`. English numbers zero through nine hundred
ninety nine use space-separated words, with optional `and` after `hundred`.
This is an explicit arithmetic grammar, not a general natural-language service.

The evaluator uses IEEE-754 Double and displays/copies up to 15 significant
digits. It is not an exact-decimal financial calculator. Input is bounded to
1,024 UTF-8 bytes, 256 tokens and 64 recursive parser levels. There is no eval,
script execution, variable assignment, unit conversion or network access.

## Local data and Core boundary

Only a successful explicit copy records history: at most 50 distinct expressions
and answers in the app's local UserDefaults key `launcher.calculator.history.v1`.
No ubiquitous/cloud preferences API or Core message carries that history.
Typing alone does not persist expressions. Test mode uses in-memory history and
an isolated pasteboard, preserving the user's clipboard and preferences.

The conversation engine still owns its existing single connection. The opt-in
`LINA_LOG_CORE_REQUESTS=1` log records only envelope kinds at the actual transport
write, never payloads or calculator input. `scripts/calculator.mjs` starts the
signed release app against a synthetic loopback Core, waits for the handshake,
then types each expression prefix and exercises Return/raw copy through the
production content layer. It asserts the app log and independent socket log
contain only the initial `hello`, with **zero requests in the calculation
interval**. It also requires correct answers, clipboard strings, bare-number
suppression, stale-result clearing and three copied history entries. The fixture
terminates the app and closes all sockets.

## Verification

```sh
swift test --package-path packages/lina_app/macos -j 2 --filter 'Calculator|ContentTests|EditingTests'
dv heavy -- node scripts/foundation.mjs
dv heavy -- node scripts/build.mjs macos
dv heavy -- node scripts/calculator.mjs
```

[Captures and request-log evidence](../captures/40/README.md) distinguish native
view rendering and automated delegate actions from physical interaction. The
fixture does not unlock the console, manipulate another application's windows,
change login settings or claim physical key/VoiceOver acceptance. Remaining
physical checks belong to #116. `LauncherPanel.swift` is unchanged.
