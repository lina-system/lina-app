# 기기·쿼터

기기·쿼터 shows each work machine with its state, reason, usage and load, the quota per service with its burn rate and reset time, and the hub's own checks in a `점검` panel, read from the core (`/api/lina/devices`, `/api/lina/quota` and `/api/lina/status/checks`) on the same refresh trigger as the rest, at most once a minute while the page is visible, so the screen matches the core within one minute.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The sidebar line adds up: `기기 n · 정상 n · 경고 n · 꺼짐 n`. `경고` (orange) and `꺼짐` (red) show only when not 0.
- One row per machine: name, state word `정상` / `경고` (orange) / `꺼짐` (red), the one reason word (`연결 끊김`, `디스크`, `메모리`, `CPU`, `온도`, `실행기`, `작업 초과`, `응답 없음`), thin CPU, 메모리 and 디스크 bars (`—` when the core has no reading), and `작업 n/상한` (`작업 —/상한` when unknown).
- One row per quota service, named as the core gives it except Claude, ChatGPT, Gemini and Grok for the known ones: percent bar, percent, `시간당 +n%` (its title reads `최근 5시간 평균`), the reset as `n시간 후` under a day and `n일 후` at or over a day, and a red `주의` when an account warns: the core's `warn`, set when the rate reaches 100% before the reset. A service without a rate shows only its percent and reset.
- A service row unfolds to its accounts, each `계정 n` with the same line, folded by default.
- The `점검` panel sits under `쿼터` and shows the hub's checks: a failing, stale or unreadable check takes one open row, `<name> · <line>`, with `실패` (red), `오래됨` (orange) or `읽기 오류` (red) and how long ago as `n분 전` / `n시간 전` / `n일 전`, the state word over the time at the row's right edge, inset like the `기기` and `쿼터` rows; a check that passes says nothing. Passing checks fold into one line `정상 n`, so a panel whose checks all pass shows only that, and a panel with no checks reads `점검 없음`. The sidebar line still counts machines only.

## Sub-features

- `status-line` sums the machines in the sidebar
- `status-machines` lists machines with state and load
- `status-meters` draws CPU, memory and disk as thin bars
- `status-quota` lists quota per service with rate, reset and warning
- `status-accounts` unfolds a service to its accounts
- `status-checks` keeps failing, stale and unreadable checks open and folds passing ones into `정상 n`

## How to get to it (user POV)

- Choose the `기기` line under `기기·쿼터` in the sidebar or on the phone's first screen.
- Address `/app/#/status`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open the screen.** Choose the device line. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive status`. The line reads `기기 3 · 정상 1 · 경고 1 · 꺼짐 1`, with `경고 1` orange and `꺼짐 1` red.
- **Machines.** Read the list `기기`. 3 rows: `정상` with its three meters, `경고 · 디스크` with `경고` orange, `꺼짐 · 연결 끊김` with `꺼짐` red and `CPU — · 메모리 — · 디스크 —`; 6 thin bars in all; loads read `작업 n/n` or `작업 —/n`.
- **Quota.** Read the list `쿼터`. 3 rows named `Claude`, `ChatGPT` and `가온셈`, reading `72% · 시간당 +10% · 2시간 후` with a red `주의`, `31% · 시간당 +1% · 2일 후` and `5% · 12일 후`; the rate's title reads `최근 5시간 평균`.
- **Warning rule and wording.** For each service, `주의` shows exactly when one of its windows reaches 100% at its rate before it resets (checked against the scene); the reset reads `n시간 후` under a day and `n일 후` from a day on; no line has an empty part.
- **Accounts.** Accounts are hidden; click the `Claude` row. 2 rows `계정 n · n% · 시간당 +n% · n시간 후`, one ending `주의`.
- **Checks.** Read the list `점검`. 2 open rows, `백업 회선 · 응답 없음` with `실패` red and `12분 전`, then `대기 봇 · 소식이 끊김` with `오래됨` orange and `3시간 전`; a single `정상 3` follows them, and no passing check has a row of its own. Each open row's trail ends within 2px of the `기기` rows' trails, so the checks share their layout, not the to-do rows'.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/status/status-1280.{png,aria.yml,json}` and `status-390.{png,aria.yml,json}`.

## Gotchas

- With `&error=quota` the quota list is gone and the toolbar reads `읽기 실패: 쿼터`; that variant belongs to freshness.
- With `&error=checks` the checks list is gone, the panel reads `점검 없음` and the toolbar reads `읽기 실패: 점검`; the machines and quota still draw. That variant belongs to freshness.
- Hours round up and days round to the nearest day, so the scene's readings hold for the whole drive.
- The minute-long refresh of machines, quota and checks is held by a unit test (`src/data/data.test.ts`); a drive is too short to see it.

## Not goals

- No machine controls and no quota history chart.
