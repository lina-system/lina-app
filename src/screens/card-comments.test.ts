import { expect, test } from "vitest";
import type { RecordRow, WorkCardDetail } from "../api/client";
import { cardCommentLines } from "./details";

// lina-app#230: the shapes of the real hub's card comments and its worker runs' record comment rows, field by field, the
// words invented. A record row has no author: the core makes it from a receipt's note (a verdict note, a cancel reason),
// its words joined to one line and cut at 300 characters with no mark (hermes_cli/worker/record.py `_line`). On the hub
// an agent writes the verdict notes.
const OWNER = "fake-owner";
const comment = (id: number, author: string, body: string, createdAt: number): WorkCardDetail["comments"][number] => ({ id, author, body, createdAt });
const recordRow = (at: number, text: string): RecordRow => ({ at, kind: "comment", text: text.split(/\s+/).join(" ").slice(0, 300), count: 1 });
const texts = (lines: ReturnType<typeof cardCommentLines>) => lines.map((line) => line.text);

test("a record's comment row is no owner's: an agent's English verdict note, cut by the core, is never drawn raw (lina-app#230)", () => {
  const note = "fake diff read, merged via fake PR (fake#12/#13), checked in fake QA rounds; ".repeat(5);
  const lines = cardCommentLines([], [recordRow(100, note), recordRow(200, note)], OWNER);
  expect(texts(lines)).toEqual([null]);
  expect(lines[0].folded).toBe(2);
});

test("a record row cut inside a word keeps only its whole sentences (lina-app#230)", () => {
  const lines = cardCommentLines([], [recordRow(100, "가짜 금액 줄을 다시 확인했다. 가짜 환불 안내 문구는 아직 고치는 중이")], OWNER);
  expect(texts(lines)).toEqual(["가짜 금액 줄을 다시 확인했다."]);
});

test("a record row that is the core's cut of a comment the card holds is not drawn again (lina-app#230)", () => {
  const body = `가짜 정산 화면은 이렇게 해 주세요.\n${"가짜 금액 줄과 환불 줄을 같은 칸에 맞춰 주세요. ".repeat(12)}`;
  const lines = cardCommentLines([comment(1, OWNER, body, 100)], [recordRow(100, body), recordRow(150, body)], OWNER);
  expect(texts(lines)).toEqual([body]);
});

test("a comment by a profile name or another agent on the owner's card goes through the gate; the owner's stays as saved (lina-app#230)", () => {
  const lines = cardCommentLines(
    [
      comment(1, "fake-main", "가짜 판을 올렸다. deploy done on fake-hub", 100),
      comment(2, "default", "가짜 검토를 마쳤다. 다음은 fake_lines 정리다.", 200),
      comment(3, OWNER, "G2 먼저 보고 T3는 내일 본다", 300),
    ],
    [],
    OWNER,
  );
  expect(texts(lines)).toEqual(["G2 먼저 보고 T3는 내일 본다", "가짜 검토를 마쳤다.", "가짜 판을 올렸다."]);
});
