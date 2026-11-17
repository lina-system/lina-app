import { expect, test } from "vitest";
import { withTurns, type Sent, type ThreadLine } from "./screens/talk";

// lina-app#210: a turn the gateway did not keep stays where it was sent, matched to the history by the core's message
// ids (lina#753), when a later turn of the same window comes back in the history.

const line = (key: string, mine: boolean, text: string, id?: string): ThreadLine => ({ key, mine, text, at: null, state: "kept", ...(id ? { id } : {}) });

function turn(key: string, message: string, over: Partial<Sent>): Sent {
  return { key, message, reply: "", state: "done", id: null, after: null, base: null, from: null, at: 100, replyAt: 101, told: false, ...over };
}

const earlier = [line("a", true, "어디까지 왔어요?", "m_u1"), line("b", false, "변경 목록을 모으는 중이에요.", "m_a1")];
// The first turn broke off before the gateway kept it; the second came back whole, under the id its send gave.
const broken = turn("t1", "배포는 언제예요?", { state: "failed", reply: "배포는", id: "m_u2", after: "m_a1", base: 2, from: 1 });
const answered = turn("t2", "다시 알려 주세요", { reply: "금요일 오후예요.", id: "m_u3", after: "m_a1", base: 2, from: 2 });
const kept = [...earlier, line("c", true, "다시 알려 주세요", "m_u3"), line("d", false, "금요일 오후예요.", "m_a3")];

const said = (lines: readonly ThreadLine[]) => lines.map((each) => `${each.mine ? "me" : "agent"}:${each.text}`);

test("a failed turn the history does not hold is drawn where it was sent, before the later turn the history holds", () => {
  const first = withTurns(kept, 3, [broken, answered]);
  expect(first.confirmed).toEqual([answered]);
  const order = ["me:어디까지 왔어요?", "agent:변경 목록을 모으는 중이에요.", "me:배포는 언제예요?", "agent:배포는", "me:다시 알려 주세요", "agent:금요일 오후예요."];
  expect(said(first.lines)).toEqual(order);
  // The next read, once the answered turn left the outbox: the failed one keeps its place.
  const next = withTurns(kept, 4, [broken]);
  expect(next.confirmed).toEqual([]);
  expect(said(next.lines)).toEqual(order);
});

test("a failed turn whose message the gateway kept, without its reply, is drawn at that message", () => {
  const held = [...earlier, line("x", true, "배포는 언제예요?", "m_u2"), ...kept.slice(2)];
  const shown = withTurns(held, 3, [broken, answered]);
  expect(shown.confirmed).toEqual([answered]);
  expect(said(shown.lines)).toEqual(["me:어디까지 왔어요?", "agent:변경 목록을 모으는 중이에요.", "me:배포는 언제예요?", "agent:배포는", "me:다시 알려 주세요", "agent:금요일 오후예요."]);
  expect(shown.lines.map((each) => each.key)).toEqual(["a", "b", "t1-mine", "t1", "c", "d"]);
});

test("an older core's history and send with no ids: the turns it does not hold stay after it, as before", () => {
  const plain = kept.map(({ key, mine, text }) => line(key, mine, text));
  const old = [{ ...broken, id: null, after: null }, { ...answered, id: null, after: null }];
  const shown = withTurns(plain, 3, old);
  expect(shown.confirmed).toEqual([old[1]]);
  expect(said(shown.lines)).toEqual(["me:어디까지 왔어요?", "agent:변경 목록을 모으는 중이에요.", "me:다시 알려 주세요", "agent:금요일 오후예요.", "me:배포는 언제예요?", "agent:배포는"]);
});

test("every sent message is drawn once: the history's turn leaves the outbox, the one it does not hold stays", () => {
  // Same words twice: the ids, not the words, say which turn the history holds.
  const again = turn("t2", "배포는 언제예요?", { reply: "금요일 오후예요.", id: "m_u3", after: "m_a1", base: 2, from: 2 });
  const history = [...earlier, line("c", true, "배포는 언제예요?", "m_u3"), line("d", false, "금요일 오후예요.", "m_a3")];
  const shown = withTurns(history, 3, [broken, again]);
  expect(shown.confirmed).toEqual([again]);
  expect(shown.lines.map((each) => each.key)).toEqual(["a", "b", "t1-mine", "t1", "c", "d"]);
  expect(new Set(shown.lines.map((each) => each.key)).size).toBe(shown.lines.length);
});
