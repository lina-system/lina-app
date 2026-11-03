# 목표

목표 lists every goal across agents; a goal opens its detail with the done condition, the owner's words, its to-dos, its work cards and, when done, the evidence that closed it.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The list shows one line per goal: progress dial, agent mark, name, done condition and `진행 중 n` when to-dos run.
- The detail shows the title, state and time, `완료 조건`, the owner's words folded under `내 말`, `할 일` as checklist rows with round boxes (drawn, inert), `작업` with each card's state and time, and `완료 근거` when the goal is done.
- Only boxes with something in them are drawn.

## Sub-features

- `goals-list` lists all goals
- `goals-detail` opens a goal with its boxes
- `goals-evidence` shows what closed a done goal

## How to get to it (user POV)

- Choose `목표` in the sidebar or on the phone's first screen.
- Address `/app/#/goals` or `/app/#/goals/<id>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open the list.** Choose `목표`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive goals`. The list `목표` has 5 links.
- **Open a goal.** Choose `결제 화면 개편`. Boxes `완료 조건`, `내 말` (closed), `할 일`, `작업`; 3 check boxes named `<title> 완료로 표시`, each `aria-disabled`; 3 work cards.
- **Done goal.** Open `/app/?source=synthetic#/goals/G4`. The `완료 근거` box shows the closing sentence.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/goals/goals-1280.{png,aria.yml,json}` and `goals-390.{png,aria.yml,json}`.

## Gotchas

- The done-goal step loads the address directly; a person reaches it by choosing `온보딩 문서 갱신` in the list.

## Not goals

- The check boxes do not mark anything yet (lina-app#4).
- No comments on goals in this pull request.
