# 설정

설정 shows the work settings the core keeps (`/api/lina/work/settings`) as grouped rows: the default runner and fallback model, each runner with its model and thinking depth, the routing rules, the work and file machines with their caps, the models OCX has on, and the last changes with a one-step rollback. Each control saves as it changes, against the revision the page read last, and the screen follows changes made anywhere (the CLI, another device, an edit of the file) without a reload.

## Platforms

- `web`: shipped.
- `mac`: planned.
- `iphone`: planned.

## Intended behavior

- `설정` is one line in the sidebar and on the phone's first screen, right under the `기기` line of `기기·쿼터`.
- Top to bottom: the warnings, one orange line each, at most 3 then `외 n개`; `기본값` (`기본 실행기`, `대체 모델`); `실행기`, one row per runner reading `<모델> · <생각 깊이>` with a `켜기` switch; `배정 규칙`, the rules in order as `<라벨> → <실행기>` (with the size when set), then `그 외 → <기본 실행기>`; `기기` with `작업 기기` rows `입찰 n · 지정 n` and a `켜기` switch, `파일 기기` rows `지정 n` and a switch, and `내 기기` rows reading `상태만 봅니다` with no control; `모델 (OCX)` with `켜진 모델 n개` and the line `모델 켜고 끄기는 OCX에서 합니다`; `기록` with the last 5 changes as `<MM-DD HH:mm> · <앱|CLI|바깥 편집|되돌리기> · <what changed>`, `모든 기록` and a red `한 단계 되돌리기`; then `설정 <rev>` small and grey.
- A picker pushes a list and saves on the choice. `기본 실행기` lists only runners that are on. A model picker lists only the models OCX serves, grouped by service (`Claude`, `ChatGPT`, `Gemini`, `Grok`, others as the core names them), each with `남은 양 n% · n시간 후` (`n일 후` from a day on), a red `다 씀`, or a grey `확인 못 함`. `생각 깊이` lists only the chosen model's efforts. `접근 권한` reads `읽기만`, `작업 폴더 쓰기`, `전체`. A runner's own `대체 모델` adds `기본값 따름`. A runner's page shows its command, read-only.
- A work machine's page has the steppers `동시 작업 (입찰)` and `동시 작업 (지정)` and the switches `저장소 작업` and `빠른 기기`; a file machine's has no `동시 작업 (입찰)`.
- `편집` on `배정 규칙` shows a delete button and up and down buttons on each rule and a `규칙 추가` row; a new rule takes a label, an optional size `S`, `M` or `L`, and a runner, and goes last.
- `한 단계 되돌리기` asks once in a sheet (`이전 설정으로 되돌립니다. 되돌리기도 기록에 남습니다.`, `되돌리기`, `취소`): a bottom sheet on a phone, a small dialog on a wide window. The rollback becomes a new revision, so a second one undoes the first.
- A change the core refuses because the settings changed since the page read them puts every control back to the newest settings and shows the toast `다른 곳에서 바뀌어 다시 불러옴`, without `되돌리기`. A change it refuses as invalid puts that control back and shows the core's reason under its row.
- On a device that may only read the settings, every control is disabled and one grey line reads `이 기기에서는 볼 수만 있습니다`. Settings never written show the defaults, and `한 단계 되돌리기` is disabled.

## Sub-features

- `settings-line` puts `설정` under `기기·쿼터` in the sidebar and on the phone's first screen
- `settings-warnings` lists what does not run now, in orange, at most 3 then `외 n개`
- `settings-defaults` picks the default runner and the fallback model
- `settings-runners` turns runners on and off and picks each one's model, thinking depth, access and fallback
- `settings-rules` lists, reorders, deletes and adds routing rules
- `settings-devices` turns machines on and off and steps their caps; a person's device is read-only
- `settings-models` lists OCX's models by service with what is left and when it resets
- `settings-history` lists the last changes and rolls back one step after one question
- `settings-refused` handles a stale write (412) and a refused write (422)
- `settings-readonly` disables every control where the device may only read

## How to get to it (user POV)

- Choose `설정` under the `기기` line in the sidebar or on the phone's first screen.
- Address `/app/#/settings`; its pushed lists are `/app/#/settings/<page>` (for example `#/settings/runner/codex/model`).

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene: runners `omo`, `codex` and `dsh`; models `model-a` and `model-b` (Claude) and `model-c` (ChatGPT, out of quota) on, `model-d` off; machines `machine-a`, `machine-b`, `files-a` and the person's `laptop-a`; three revisions. `&settings=stale` makes another device write just before the page's first write; `&settings=readonly` makes this device read-only.

- **Open the screen.** Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive settings`. On the first screen, the `설정` line sits right under the `기기` line; choosing it opens the screen titled `설정`.
- **Read the groups.** Two orange warnings, `codex 모델의 쿼터가 다 찼습니다 · …` and `dsh 모델이 꺼져 있습니다 · …`; runners `omo` (`model-a · 높음`), `codex` (`model-c · 보통`), `dsh` (`model-d`); rules `docs → codex`, `quick · S → dsh`, `그 외 → omo`; `machine-a` `입찰 2 · 지정 2`, `machine-b` `입찰 1 · 지정 1`, `files-a` `지정 1`, `laptop-a` `상태만 봅니다` with no switch; `켜진 모델 3개`; three history rows (`바깥 편집`, `앱`, `CLI`); `설정 r3`.
- **Toggle.** Press `machine-b 켜기`: it turns off at once, `설정 r4` follows, the first history row reads `… · 앱 · machine-b 끔`, and the page's copy of the settings has `machine-b` off, written with If-Match `r3`.
- **Picker.** Open `codex`, then `모델`: the list has `Claude` (`model-a · 남은 양 72% · 3시간 후`, `model-b · 남은 양 40% · 2일 후`) and `ChatGPT` (`model-c` with a red `다 씀`), and no `model-d`. Choose `model-a`: the check moves to it, and `codex` reads `model-a · 보통` back on the settings screen.
- **Stepper.** Open `machine-a`: press `동시 작업 (입찰) 늘리기`; the value reads `3` and the settings copy has cap 3. Press `빠른 기기`: it turns off.
- **Rule edit.** Press `편집`, then `docs → codex 아래로`: the order becomes `quick · S → dsh`, `docs → codex`. Delete `quick · S → dsh`. Open `규칙 추가`, type `review`, press `M` and `dsh`, then `추가`: the list ends with `review · M → dsh`.
- **Refused write (422).** Press `omo 켜기`: the switch comes back on and the line `worker.default_runner: runner 'omo' is off` shows under the row.
- **Rollback.** Press `한 단계 되돌리기`: the sheet asks `이전 설정으로 되돌립니다. 되돌리기도 기록에 남습니다.`; `취소` closes it and writes nothing; press it again and `되돌리기`: the revision goes up by one and the first history row reads `… · 되돌리기 · …`. On a phone the sheet spans the window's width at its bottom edge.
- **Stale write (412).** Open `/app/?source=synthetic&settings=stale#/settings` and press `machine-a 켜기`: the toast reads `다른 곳에서 바뀌어 다시 불러옴` with no `되돌리기`, `machine-a` stays on, `machine-b` reads `입찰 2 · 지정 2` (the other device's write), and the revision reads `설정 r4`.
- **Read-only.** Open `&settings=readonly`: the grey line `이 기기에서는 볼 수만 있습니다` shows, every switch and button is disabled, and pressing a switch writes nothing.
- **Phone rules.** At 390 wide the screen, a machine's page, a model picker and the rollback sheet keep every hit area at least 44x44 and every text at least 13 px.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/settings/settings-1280.{png,aria.yml,json}` and `settings-390.{png,aria.yml,json}`.

## Gotchas

- Writes go to the page's copy of the scene; every step that needs the scene as it started opens the page fresh.
- Turning `omo` off is refused because `omo` is the default runner: choose another default runner first to turn it off.
- The models list is read at most once a minute and again after each write; a drive is too short to see the minute.
- A model the settings name that OCX has off is not in the picker: the runner's row reads its id, and a warning names it.

## Not goals

- No import button and no editing of the settings file as text.
- No turning models on or off: that is OCX's.
- No caps or switches for a person's own device: it only shows its state.
- No undo of a single change from the toast: the one way back is `한 단계 되돌리기`.
