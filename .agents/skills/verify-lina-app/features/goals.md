# 목표

목표 lists every goal across agents; a goal opens its detail with the done condition, the owner's words, its to-dos, its work cards and, when done, the evidence that closed it.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The list shows one line per goal: progress dial (a round check box instead once all its to-dos are closed), agent mark, name, done condition and `진행 중 n` when to-dos run.
- The detail shows the title, state and time, a `결정 필요` box on top when a decision is pending on the goal, `완료 조건`, the owner's words folded under `내 말`, `할 일` as checklist rows with round check boxes, a check box in the head for the goal itself, `작업` with each card's state and time, `완료 근거` when the goal is done, and `댓글` with the goal's thread and the same `댓글 달기` field and `보내기` as a to-do (see item-detail), then `대화` (talk.md).
- Only boxes with something in them are drawn; `댓글` is always drawn for its field.
- Opening a work card from `작업` shows its to-dos and its dimmed worker runs (see card-detail).

## Sub-features

- `goals-list` lists all goals
- `goals-detail` opens a goal with its boxes
- `goals-evidence` shows what closed a done goal
- `goals-comment` comments on a goal

## How to get to it (user POV)

- Choose `목표` in the sidebar or on the phone's first screen.
- Address `/app/#/goals` or `/app/#/goals/<id>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open the list.** Choose `목표`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive goals`. The list `목표` has 5 links.
- **Open a goal.** Choose `결제 화면 개편`. Boxes `완료 조건`, `내 말` (closed), `할 일`, `작업`; 4 check boxes, none `aria-disabled`: the goal's own in its head (`결제 화면 개편 완료로 표시`) and one per to-do in `할 일` (3, each `<title> 완료로 표시`); 3 work cards; a `댓글 달기` field.
- **Done goal.** Open `/app/?source=synthetic#/goals/G4`. The `완료 근거` box shows the closing sentence.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/goals/goals-1280.{png,aria.yml,json}` and `goals-390.{png,aria.yml,json}`.

## Gotchas

- The done-goal step loads the address directly; a person reaches it by choosing `온보딩 문서 갱신` in the list.

## Not goals

- Ticking, the 'with open to-dos' question and undo are driven in actions.md.
- Sending a goal comment is driven on a to-do (item-detail); the field is the same.
