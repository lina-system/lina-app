import { expect, test } from "vitest";
import type { ItemDetail, RecordRound, RecordRow, RunRecord, WorkCardDetail } from "../api/client";
import { cardCommentLines } from "../screens/details";
import { W } from "../words";
import { commentHistory, goalHistory, timelineBlocks } from "./timeline";

// lina-app#236: a bot's comment is drawn whole or not at all, never a part of it. The shapes are the hub's long cards'
// (QA round 23), field by field as /work/cards/<id> serves them (id, author, body, createdAt) and as a worker run's record
// serves its rounds and comment rows, the words invented: one to six sentences; lists marked `(1)`, `1)`, `1.` and `①`,
// mixed marks and numbers going down; lead-ins with and without a colon and `아직 안 한 것:` lead-ins; quoted and bracketed
// passages; parts `1 부분 -`; one item a line; an English sentence among Korean ones.
const PROSE = ["가짜 첫 화면 문구를 새 문체로 맞췄다.", "다시 시도 버튼을 아래로 옮겼다.", "가짜 금액 줄을 다시 확인했다.", "살펴보니 고칠 곳이 셋이다.", "그 줄은 뒤에서 바로잡음.", "까닭은 셋, 모두 시안 쪽 탓."];
const QUOTED = ['가짜 담당자가 "검사가 실패했다. 다시 시도하자."라고 말했다.', "가짜 결과(검사 통과. 배포 대기)를 적었다."];
const ITEMS = ["목록을 연다.", "금액 칸을 누른다.", "영수증을 내려받는다.", "환불 문구 확인."];
const LEADS = ["가짜 남은 일:", "가짜 남은 일은 다음과 같다", "아직 안 한 것:", "차례:"];
const MARKS: readonly ((n: number) => string)[] = [(n) => `(${n})`, (n) => `${n})`, (n) => `${n}.`, (n) => String.fromCodePoint(0x245f + n)];

/** A small seeded generator (mulberry32): the same comments on every run. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function comment(next: () => number): string {
  const pick = <T,>(of: readonly T[]) => of[Math.floor(next() * of.length)];
  const pieces: string[] = [];
  for (let at = 0, size = 1 + Math.floor(next() * 6); at < size; at += 1) {
    const shape = next();
    if (shape < 0.35) pieces.push(pick(PROSE));
    else if (shape < 0.45) pieces.push(pick(QUOTED));
    else if (shape < 0.55) pieces.push(`${1 + Math.floor(next() * 3)} 부분 - ${pick(PROSE)}`);
    else if (shape < 0.62) pieces.push("Not run on the merged dev build.");
    else {
      // A list: one mark style or two, its numbers going up from 1, from 2, or down.
      const count = 1 + Math.floor(next() * 3);
      const order = next() < 0.6 ? Array.from({ length: count }, (_, index) => index + 1) : next() < 0.5 ? Array.from({ length: count }, (_, index) => index + 2) : Array.from({ length: count }, (_, index) => count - index);
      const first = pick(MARKS);
      const second = next() < 0.3 ? pick(MARKS) : first;
      const items = order.map((n, index) => `${(index > 0 ? second : first)(n)} ${pick(ITEMS)}`);
      const lead = next() < 0.6 ? `${pick(LEADS)} ` : "";
      pieces.push(next() < 0.3 ? `${lead}${items.join("\n")}` : `${lead}${items.join(" ")}`);
    }
  }
  return pieces.join(next() < 0.2 ? "\n" : " ");
}

const STATES = new Set<string>(Object.values(W.outcome));
/** A drawn line without its `×n`: a whole comment's text (trimmed) or a state word. */
const bare = (text: string) => text.replace(/ ×\d+$/, "");

test("every comment line a card draws is a whole comment or a state word, never a part (lina-app#236)", () => {
  const next = random(236);
  let drawn = 0;
  for (let run = 0; run < 300; run += 1) {
    const comments: WorkCardDetail["comments"] = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, index) => ({ id: index + 1, author: "fake-agent", body: comment(next), createdAt: 1000 + index * 60 }));
    const records: RecordRow[] = comments.map((one, index) => ({ at: 5000 + index, kind: "comment", text: `${one.body} 가짜 덧붙임.`.split(/\s+/).join(" ").slice(0, 300), count: 1 }));
    const wholes = new Set([...comments.map((one) => one.body.trim()), ...records.map((row) => row.text!.trim())]);
    for (const line of cardCommentLines(comments, records, "fake-owner")) {
      if (line.text === null) continue;
      drawn += 1;
      expect(wholes.has(bare(line.text)) || STATES.has(bare(line.text)), JSON.stringify(comments.map((one) => one.body))).toBe(true);
    }
    for (const line of commentHistory(comments.map((one) => ({ at: one.createdAt, author: one.author, body: one.body })))) if (line.text !== null) expect(wholes.has(line.text) || STATES.has(line.text), line.text).toBe(true);
  }
  // Short whole comments are drawn: the rule folds what is not whole, not every comment.
  expect(drawn).toBeGreaterThan(30);
});

test("every round head and record row a timeline draws is a whole text or an event, never a part (lina-app#236)", () => {
  const next = random(2361);
  for (let run = 0; run < 200; run += 1) {
    const texts = Array.from({ length: 3 }, () => comment(next));
    const round = (n: number, result: string | null, rows: RecordRow[]): RecordRound => ({ run: n, startedAt: n * 100, endedAt: n * 100 + 50, endKnown: true, startUnknown: false, result, verdict: "accepted", stopped: false, rows });
    const record = { id: "w1", at: 0, cardId: "k-1", model: null, settingsRevision: null, rounds: [round(3, texts[0], [{ at: 320, kind: "comment", text: texts[1], count: 1 }]), round(2, null, []), round(1, texts[2], [])], comments: [], errors: [] } as unknown as RunRecord;
    for (const block of timelineBlocks([{ id: "w1", record }], () => false, 10_000)) {
      if (block.type !== "round") continue;
      if (block.result !== null) expect(texts.map((text) => text.trim()), block.result).toContain(block.result);
      for (const row of block.rows) if (row.kind === "comment" && row.text !== null) expect(texts.map((text) => text.trim()), row.text).toContain(row.text);
    }
  }
});

test("every comment line a goal's history draws is a whole comment, an event or a fold, never a part (lina-app#236)", () => {
  const next = random(2362);
  const events = new Set<string>([W.markedDone, ...Object.values(W.outcome)]);
  for (let run = 0; run < 200; run += 1) {
    const texts = Array.from({ length: 3 }, () => comment(next));
    const detail = { id: "G1", state: "in_progress", stateSince: null, ownerDone: null, decision: null, runs: [], comments: texts.map((text, index) => ({ cid: `c${index}`, by: "fake-agent", at: 100 + index, text, status: "open", kind: "comment", replies: [] })) } as unknown as ItemDetail;
    for (const row of goalHistory(detail, [])) {
      const text = bare(row.text);
      expect(texts.map((one) => one.trim()).includes(text) || events.has(text) || /^접힌 댓글/.test(text), text).toBe(true);
    }
  }
});

test("state words that follow each other are one line with the newest time and ×n (lina-app#236)", () => {
  const round = (n: number, verdict: "accepted" | null): RecordRound => ({ run: n, startedAt: n * 100, endedAt: n * 100 + 50, endKnown: true, startUnknown: false, result: "Merged via fake PR.", verdict, stopped: false, rows: [] });
  const record = { id: "w1", at: 0, cardId: "k-1", model: null, settingsRevision: null, rounds: [round(6, "accepted"), round(5, "accepted"), round(4, "accepted"), round(3, null), round(2, "accepted"), round(1, "accepted")], comments: [], errors: [] } as unknown as RunRecord;
  const heads = timelineBlocks([{ id: "w1", record }], () => false, 10_000).map((block) => (block.type === "round" ? [block.at, block.outcome, "count" in block ? block.count : 1] : null));
  expect(heads).toEqual([
    [650, "accepted", 3],
    [350, "ended", 1],
    [250, "accepted", 2],
  ]);
  const lines = commentHistory(["검토 통과", "검토 통과", "검토 통과", "완료"].map((body, index) => ({ at: 100 + index, author: "fake-agent", body })));
  expect(lines.map((line) => [line.at, line.text, line.count])).toEqual([
    [103, "완료", 1],
    [102, "검토 통과", 3],
  ]);
});

test("the owner's comment stays exactly as saved, whatever its shape (lina-app#226, #236)", () => {
  const body = "G2 먼저 보고 (1) 가짜 화면을 본다. 그다음 notes/a.md도 봐 줘\n두 번째 줄";
  const lines = cardCommentLines([{ id: 1, author: "fake-owner", body, createdAt: 100 }], [], "fake-owner");
  expect(lines.map((line) => line.text)).toEqual([body]);
});
