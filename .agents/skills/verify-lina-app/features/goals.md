# 목표

목표 lists every goal across agents; a goal opens its detail in the one detail frame with the done condition, the owner's words, its to-dos, its work cards and its history (`기록`), the evidence that closed it included.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The list shows one line per goal: progress dial (a round check box instead once all its to-dos are closed), agent mark, name, done condition and `진행 중 n` when to-dos run.
- A goal opens in the one detail frame (lina-app#142), wherever it is chosen: the right-hand pane beside the list at desktop width, a sheet rising from the bottom over the list at phone width. The pane scrolls on its own, so the detail opens where the owner is looking however far down the list they chose it; the window, the toolbar and the menu never scroll away. The tab, the header and the list stay as they were: a goal chosen on an agent's card under `대화` opens beside that agent's window and `대화` stays the tab. Back closes the frame; the list is at the scroll it had and the chosen row stays highlighted.
- The detail shows the title, state and time, a `결정 필요` box on top when a decision is pending on the goal (with the place to answer it: its choices, or `답 달기` and `보내기`), `완료 조건`, the owner's words folded under `내 말`, `할 일` as checklist rows with round check boxes, a check box in the head for the goal itself, `작업` with each card's state and time, `기록`, and `댓글` with the goal's thread and the same `댓글 달기` field and `보내기` as a to-do (see item-detail), then `대화` (talk.md).
- `기록` is the goal's history, oldest first, one line per event in the form `<time> · <one sentence>` (lina-app#123): each comment and reply by its first sentence (ids, hashes, paths and commands left out, cut at 60 characters with `…`), its question (`질문: <sentence>` or `요청: <sentence>`), how each of its runs ended (`완료`, `중단됨 · 실패`), each finished work card's merge line (its evidence sentence) and its close (`완료`, or `완료로 표시함` when the owner closed it).
- Only boxes with something in them are drawn; `댓글` is always drawn for its field.
- Opening a work card from `작업` shows its to-dos and its dimmed worker runs (see card-detail).

## Sub-features

- `goals-list` lists all goals
- `goals-detail` opens a goal with its boxes
- `goals-history` lists the goal's history one line per event, the evidence that closed it included
- `goals-comment` comments on a goal

## How to get to it (user POV)

- Choose `목표` in the sidebar or on the phone's first screen.
- Address `/app/#/goals` or `/app/#/goals/<id>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`, the synthetic scene; the drive opens it fresh for each width.

- **Open the list.** Choose `목표`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive goals`. The list `목표` has 5 links.
- **Open a goal.** Choose `결제 화면 개편`. It opens in the frame (`detail-frame`, `data-frame` `panel` at 1280 and `sheet` at 390) and the header still reads `목표`. Boxes `완료 조건`, `내 말` (closed), `할 일`, `작업`; 4 check boxes, none `aria-disabled`: the goal's own in its head (`결제 화면 개편 완료로 표시`) and one per to-do in `할 일` (3, each `<title> 완료로 표시`); 3 work cards; a `댓글 달기` field.
- **Done goal.** Open `/app/?source=synthetic#/goals/G4`. Its `기록` box (`goal-history`) reads, one line each, `<time> · 새 가이드를 문서 사이트에 올리고 첫 화면에 연결함` (the closing sentence) and `<time> · 완료`.
- **Frame and back.** A browser spec (`tests/detail-frame.spec.ts`) opens each kind of detail from a row far down its list at 1280 and 390 and checks the frame, its place in the viewport and the list's scroll after back; `src/detail-frame.test.tsx` checks the tab, the header and the list stay, and the goal's history rows.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/goals/goals-1280.{png,aria.yml,json}` and `goals-390.{png,aria.yml,json}`.

## Gotchas

- The done-goal step loads the address directly; a person reaches it by choosing `온보딩 문서 갱신` in the list.

## Not goals

- Ticking, the 'with open to-dos' question and undo are driven in actions.md.
- Sending a goal comment is driven on a to-do (item-detail); the field is the same.
