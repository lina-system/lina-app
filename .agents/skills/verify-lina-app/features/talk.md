# 대화

On a goal or to-do page the owner talks with the agent that owns it. The message goes to that agent's app conversation, the reply streams in on the page, and the agent keeps the exchange in its own chat.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- A box `대화` sits under `댓글` on every goal and to-do page (`#/goals/<id>`, `#/items/<id>`), and on a goal opened from an agent's card under the `대화` tab (`#/talk/<agent>?goal=<id>`, see talk-tab.md). On a fresh page it holds only the field `메시지` and `보내기`: no earlier turns, because the core has no route to read the conversation back.
- `보내기` is grey while the field is empty, accent once it has text, and on a phone it and the field are at least 44 px tall.
- Enter or `보내기` sends. An Enter that ends a Hangul composition only finishes the syllable; it does not send.
- After sending: the field empties, the owner's message shows on the right, and the agent's reply streams in on the left under the agent's mark, ending in one quiet live dot while it streams. `보내기` stays disabled until the reply ends. With `prefers-reduced-motion` the dot holds still.
- When the reply ends the dot goes and one line under it reads `<agent> 대화에 남음`: the core carries the exchange into the agent's next direct-message turn. The line shows under the latest reply only and goes when the next message is sent.
- In the record nothing changes: a talk is not a comment, and the item's comments stay as they were (`POST /api/lina/work/items/<id>/talk` answers `text/event-stream`).
- A refused turn shows one red line under the field and the message stays in it: `에이전트가 바쁨` (429), `에이전트 연결 안 됨` (503), `맡은 에이전트 없음` (409). A reply that breaks off reads `답을 받지 못함`.

## Sub-features

- `talk-send` sends with Enter or 보내기, and not on a Hangul composition's Enter
- `talk-stream` shows the reply as it streams with a live dot
- `talk-carried` says once, under the latest reply, that the agent keeps the exchange
- `talk-refused` shows one line per refusal and keeps the message in the field

## How to get to it (user POV)

- Open a to-do (from a goal page, a 마감일 row or a 수신함 decision) and scroll to `대화`.
- Open a goal (from 목표, an agent's goals, or the agent's card in the `대화` tab) and scroll to `대화`.
- Address `/app/#/items/<id>`, `/app/#/goals/<id>` or `/app/#/talk/<agent>?goal=<id>`.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The page is `/app/?source=synthetic`; the synthetic agent answers every message with the same reply in four pieces, one frame every 400 ms. `&talk=busy`, `&talk=down` and `&talk=none` make every turn answer 429, 503 and 409.

- **Open it.** On `결제 화면 개편`, choose `카드 입력 폼 다듬기`. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive talk`. The last two boxes are `댓글`, `대화`; no turns; `보내기` grey.
- **Send.** Type `입력 폼 간격 봐 주세요` into `메시지` and press Enter. The field empties, the message sits on the right, the live dot shows, and `네, 확인했어요.` shows on the left under the agent's mark before the reply ends; `보내기` is disabled.
- **Reply.** Within 10 s the reply reads `네, 확인했어요. 입력 폼 간격부터 맞추고 오늘 안에 다시 알려 드릴게요.`, the dot is gone and `<agent> 대화에 남음` shows under it. The synthetic record's comments on `T4` are as many as before.
- **Next message.** Type `고마워요`, choose `보내기`: the carried line goes at once and comes back under the new reply only.
- **Reduced motion.** With `prefers-reduced-motion: reduce` the live dot's animation is `none`.
- **Refusals (a fresh load each).** On `#/items/T4` with `&talk=busy`, `&talk=down`, `&talk=none`, send `오늘 어디까지 했어요?`: the line reads `에이전트가 바쁨`, `에이전트 연결 안 됨`, `맡은 에이전트 없음`, the field still holds the message, no turn shows and `보내기` is enabled.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/talk/talk-1280.{png,aria.yml,json}` and `talk-390.{png,aria.yml,json}`.

## Gotchas

- `댓글` has its own `보내기`; find the talk's inside `getByTestId("talk")`.
- The turns live in the page only: a reload or leaving the page clears them, on a live core too.
- On a live core a talk runs a real turn on the agent's gateway; a read-only pass never sends one.

## Not goals

- No history of earlier app conversations (the core has no read route for it).
- No talking from a work card or a run; only goals and to-dos.
- No stopping a reply mid-stream, no approval prompts and no tool progress on screen.
