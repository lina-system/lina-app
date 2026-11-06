# 기기·쿼터

기기·쿼터 shows each work machine with its state, reason, usage and load, the quota per service with its burn rate, reset time and each account's state, what the models cost in tokens and dollars for today, 7 days and 30 days, OCX's own row, and the hub's own checks in a `점검` panel, read from the core (`/api/lina/devices`, `/api/lina/quota`, `/api/lina/usage?range=…`, `/api/lina/models/state` and `/api/lina/status/checks`) on the same refresh trigger as the rest, at most once a minute while the page is visible, so the screen matches the core within one minute.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The sidebar line adds up: `기기 n · 정상 n · 경고 n · 꺼짐 n`. `경고` (orange) and `꺼짐` (red) show only when not 0.
- One row per machine: name, state word `정상` / `경고` (orange) / `꺼짐` (red), the one reason word (`연결 끊김`, `디스크`, `메모리`, `CPU`, `온도`, `실행기`, `작업 초과`, `응답 없음`), thin CPU, 메모리 and 디스크 bars (`—` when the core has no reading), and `작업 n/상한` (`작업 —/상한` when unknown).
- One row per quota service, named as the core gives it except Claude, ChatGPT, Gemini and Grok for the known ones: percent bar, percent, `시간당 +n%` (its title reads `최근 5시간 평균`), the reset as `n시간 후` under a day and `n일 후` at or over a day, and a red `주의` when an account warns: the core's `warn`, set when the rate reaches 100% before the reset. A service without a rate shows only its percent and reset.
- A service row unfolds to its accounts. An account reads `계정 n`, then the same convention the service row uses: the percent used of its main window, the rate and the reset. An account OCX needs signed in again says only `계정 n · 다시 로그인 필요` in the warning colour, with no percent, rate, reset or bar, because none of its numbers is current; a paused account shows `계정 n · 일시 중지` and keeps its reset, without the rate. Accounts are folded by default.
- The last rows of the same 쿼터 list are not services, and take the same row look and inset: one row for each service OCX holds no account for, `<service> · 계정 없음`, then OCX's own row `OCX · 모델 <enabled>개 켜짐`, followed by ` · 연결 끊김: <machine>, <machine>` only when a link is not fine. The machines it names are the ones the `기기` panel names, and the link that is down is that panel's 꺼짐 machine, so one machine never carries two names on one screen.
- The `사용량` panel sits between `쿼터` and `점검`: a segmented control `오늘` / `7일` / `30일`, `오늘` chosen at first; the chosen range's totals as `$<cost> · 토큰 <n>`; then the two short lists `모델별` and `기기별`, each the five costliest rows as `<name> · $<cost> · 토큰 <n>`. The cost keeps two decimals under $100 and none from $100 up; tokens read `1.2만` from ten thousand and `3.4억` from a hundred million. The core serves no split by agent, so the panel says nothing about agents.
- The `점검` panel sits under the `사용량` panel and shows the hub's checks: a failing, stale or unreadable check takes one open row, `<name> · <line>`, with `실패` (red), `오래됨` (orange) or `읽기 오류` (red) and how long ago as `n분 전` / `n시간 전` / `n일 전`, the state word over the time at the row's right edge, inset like the `기기` and `쿼터` rows; a check that passes says nothing. Passing checks fold into one line `정상 n`, so a panel whose checks all pass shows only that, and a panel with no checks reads `점검 없음`. The sidebar line still counts machines only.

## Sub-features

- `status-line` sums the machines in the sidebar
- `status-machines` lists machines with state and load
- `status-meters` draws CPU, memory and disk as thin bars
- `status-quota` lists quota per service with rate, reset and warning, then one row per service with no account and OCX's own row
- `status-accounts` unfolds a service to its accounts, each with the percent used, a bare `다시 로그인 필요`, or `일시 중지` and its reset
- `status-usage` totals tokens and cost for the chosen range and lists the costliest models and machines
- `status-ocx` gives OCX the last row of the quota list: how many models are on, and which machines' links are down
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
- **Quota.** Read the list `쿼터`. 3 service rows named `Claude`, `ChatGPT` and `가온셈`, reading `72% · 시간당 +10% · 3시간 후` with a red `주의`, `31% · 시간당 +1% · 2일 후` and `5% · 12일 후`; the rate's title reads `최근 5시간 평균`. A service row is the mean over its accounts that are not paused and have a main window, so Claude's row repeats its one live account's numbers.
- **Warning rule and wording.** For each service, `주의` shows exactly when one of the windows of its live accounts reaches 100% at its rate before it resets (checked against the scene); the reset reads `n시간 후` under a day and `n일 후` from a day on; no line has an empty part.
- **Accounts.** Accounts are hidden; click the `Claude` row. 2 rows: `계정 1 · 72% · 시간당 +10% · 3시간 후 · 주의`, the same percent the service row shows, and `계정 2 · 다시 로그인 필요` alone, red, with no rate, no reset and no bar. Click the `가온셈` row too: `계정 1 · 5% · 12일 후` and `계정 2 · 일시 중지 · 26일 후` (the reset stays, the rate does not).
- **The quota list's last rows.** After the three service rows the same list ends with `Cursor · 계정 없음` and `OCX · 모델 3개 켜짐 · 연결 끊김: 물레방아`, each with a service row's look: the same left and right inset, and at least 44 px tall on a phone. The machine OCX's row names is the one the `기기` panel draws as `꺼짐`; the link that is fine is not named.
- **Usage.** The `사용량` panel reads `$3.42 · 토큰 1.2만` with `오늘` pressed, then `모델별` as `haru · $1.85 · 토큰 6,200`, `saeol · $1.12 · 토큰 4,200`, `moru · $0.45 · 토큰 2,080` and `기기별` as `모래톱 · $2.05 · 토큰 7,000`, `솔방울 · $1.01 · 토큰 3,800`, `물레방아 · $0.36 · 토큰 1,680`, the same three machines the `기기` panel names. Press `7일`: it takes the pressed state, the total becomes `$18.40 · 토큰 8.6만`, and `기기별` becomes `모래톱 · $11.20 · 토큰 4.9만`, `솔방울 · $5.40 · 토큰 2.6만`, `물레방아 · $1.80 · 토큰 1.1만`. Press `30일`: the total becomes `$63.10 · 토큰 42만` and `모델별` becomes `haru · $34.20 · 토큰 19만`, `saeol · $19.90 · 토큰 14.8만`, `moru · $9.00 · 토큰 8.2만`. Press `오늘` again and it reads as at first. At 390 wide each range control is at least 44 px tall and no line draws under 13 px.
- **Checks.** Read the list `점검`. 2 open rows, `백업 회선 · 응답 없음` with `실패` red and `12분 전`, then `대기 봇 · 소식이 끊김` with `오래됨` orange and `3시간 전`; a single `정상 3` follows them, and no passing check has a row of its own. Each open row's trail ends within 2px of the `기기` rows' trails, so the checks share their layout, not the to-do rows'.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/status/status-1280.{png,aria.yml,json}` and `status-390.{png,aria.yml,json}`.

## Gotchas

- With `&error=quota` the quota list is gone and the toolbar reads `읽기 실패: 쿼터`; that variant belongs to freshness.
- With `&error=checks` the checks list is gone, the panel reads `점검 없음` and the toolbar reads `읽기 실패: 점검`; the machines, quota, OCX's row and usage still draw. That variant belongs to freshness.
- The usage numbers are the core's own estimates: a row OCX priced none of sorts after the priced ones and reads `—` for its cost.
- OCX cannot read an account that needs signing in again, so that account's row carries no numbers at all; a service whose every account is signed out or paused would show a row with only its reset, which the scene avoids.
- Hours round up and days round to the nearest day, so the scene's readings hold for the whole drive.
- The minute-long refresh of machines, quota, usage, OCX's models and links and the checks is held by a unit test (`src/data/data.test.ts`); a drive is too short to see it.

## Not goals

- No machine controls, no quota history chart and no split by agent.
