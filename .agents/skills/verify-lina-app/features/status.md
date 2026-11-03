# 기기·쿼터

기기·쿼터 shows each work machine with its state and load, and the quota per service with its burn rate and reset time.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The sidebar line adds up: `기기 n · 정상 n · 경고 n · 꺼짐 n`. `경고` (orange) and `꺼짐` (red) show only when not 0.
- One row per machine: name, state word `정상` / `경고` / `꺼짐`, the one reason word, and `작업 n/상한`.
- One row per quota service: percent, `시간당 +n%`, `n시간 후 초기화`, and a red `주의` when the core warns.

## Sub-features

- `status-line` sums the machines in the sidebar
- `status-machines` lists machines with state and load
- `status-quota` lists quota with rate, reset and warning

## How to get to it (user POV)

- Choose the `기기` line under `기기·쿼터` in the sidebar or on the phone's first screen.
- Address `/app/#/status`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open the screen.** Choose the device line. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive status`. The line reads `기기 3 · 정상 1 · 경고 1 · 꺼짐 1`, with `경고 1` orange and `꺼짐 1` red.
- **Machines.** Read the list `기기`. 3 rows naming `정상`, `경고` and `꺼짐`; loads read `작업 n/n`.
- **Quota.** Read the list `쿼터`. 2 rows with `n% · 시간당 +n% · n시간 후 초기화` (or 일), one ending `주의`.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/status/status-1280.{png,aria.yml,json}` and `status-390.{png,aria.yml,json}`.

## Gotchas

- With `&error=quota` the quota list is gone and the toolbar reads `읽기 실패: 쿼터`; that variant belongs to freshness.

## Not goals

- No machine controls and no quota history chart.
