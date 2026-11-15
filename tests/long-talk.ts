/**
 * A first agent's app conversation as long as the live hub's (lina-app#206), in the AgentTalkHistory shape GET
 * /api/lina/agents/<agent>/talk serves: dozens of turns, oldest first, the owner's with the app's first line, replies of
 * many lines in markdown. Invented sentences. tests/layout-qa15.spec.ts and verify.mjs's talk-tab drive both serve it.
 */
export const LONG_TALK_TURNS = 24;

/** One reply as the hub's agents write them: a heading, a few paragraphs, a list and now and then a code block. */
function reply(turn: number): string {
  const lines = [`## ${turn}번째 정리`, "", `**진행**은 순서대로 하고 있어요. 지금 단계는 ${turn % 4}번이고, 다음 단계는 검토가 끝나면 시작해요.`, ""];
  for (let step = 1; step <= 3 + (turn % 4); step++) lines.push(`${step}. 단계 ${step}: 목록을 맞춰 보고 빠진 항목을 채워요.`);
  lines.push("", "남은 일은 아래와 같아요. 끝나면 다시 알려 드릴게요.", "", "- 변경 목록 확인", "- 검토 요청", "- 결과 정리");
  if (turn % 3 === 0) lines.push("", "```sh", `npm run build && npm test -- --step ${turn}`, "```");
  return lines.join("\n");
}

export function longTalk(agent: string, now: number) {
  const messages: { role: "user" | "assistant"; content: string; timestamp: number }[] = [];
  for (let turn = 1; turn <= LONG_TALK_TURNS; turn++) {
    const at = now - 2 * 86_400 + turn * 3_000;
    messages.push({ role: "user", content: `[LINA app]\n\n${turn}번째 일은 어디까지 됐어요?`, timestamp: at });
    messages.push({ role: "assistant", content: reply(turn), timestamp: at + 40 });
  }
  return { agent, session_id: `app-${agent}`, messages };
}
