import { expect, test } from "vitest";
import { withTurns, type Sent, type ThreadLine } from "./screens/talk";

// lina-app#209: which history read may take a turn this page sent for held by the core, and drop it from the outbox.

const line = (key: string, mine: boolean, text: string): ThreadLine => ({ key, mine, text, at: null, state: "kept" });

function turn(over: Partial<Sent>): Sent {
  return { key: "t1", message: "어디까지 왔어요?", reply: "배포 순서는 답을 기다려요.", state: "done", id: null, after: null, prior: null, base: null, from: null, at: 100, replyAt: 101, told: false, ...over };
}

// Another device added the same words after this page's last read (base 2), and the core's reply to it is in that read.
const remote = [line("a", true, "어디까지 왔어요?"), line("b", false, "앞 답"), line("c", true, "어디까지 왔어요?"), line("d", false, "다른 기기 답")];

test("a read that began before the core took the turn does not hold it, base known or not (the other device's exchange is not it)", () => {
  for (const base of [null, 2]) {
    const shown = withTurns(remote, 3, [turn({ base, from: 5 })]);
    expect(shown.confirmed).toEqual([]);
    expect(shown.lines.filter((each) => each.mine).map((each) => each.text)).toEqual(["어디까지 왔어요?", "어디까지 왔어요?", "어디까지 왔어요?"]);
    expect(shown.lines.filter((each) => !each.mine).map((each) => each.text)).toEqual(["앞 답", "다른 기기 답", "배포 순서는 답을 기다려요."]);
  }
});

test("a read that began after the core took the turn holds it, and the outbox drops it", () => {
  for (const base of [null, 2]) {
    const shown = withTurns(remote, 5, [turn({ base, from: 5 })]);
    expect(shown.confirmed).toHaveLength(1);
    expect(shown.lines.map((each) => each.key)).toEqual(["a", "b", "c", "d"]);
  }
});
