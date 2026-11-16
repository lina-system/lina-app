import { expect, test } from "vitest";
import type { RunRecord } from "../api/client";
import { stopReasonText } from ".";
import { commentHistory, timelineBlocks } from "./timeline";

// lina-app#241: one rule for every text a bot writes. A text is a unit: it is drawn as its own line whole, or it folds
// and the fold holds it, whole, to be opened. Never a part of it. Invented texts of the shapes the hub's long card holds
// (one to twelve sentences, lists on every mark style, numbers going down, quoted and bracketed passages, cut-off ends,
// English words, refs), made by a seeded generator so every run reads the same texts.

const WHOLE = ["가짜 화면을 다시 확인했다.", "가짜 목록의 줄 간격을 처음 시안대로 되돌렸다.", "남은 일은 내일 아침에 다시 본다.", "결정할 것은 둘째 갈래를 먼저 할지이다.", "가짜 시험이 모두 통과했다."];
const LIST = ["(1) 가짜 문구를 고쳤다.", "1) 가짜 버튼을 옮겼다.", "1. 가짜 칸을 넓혔다.", "① 가짜 줄을 붙였다.", "3. 가짜 표를 고쳤다. 2. 가짜 칸을 비웠다."];
const QUOTED = ['담당자가 "가짜 검사가 실패했다. 다시 하자."라고 말했다.', "가짜 화면(좁은 폭과 넓은 폭)을 다시 읽었다."];
const CUT = ["그리고 그 뒤에 세부를", "가짜 문구를 아직 고치는 중이", "가짜 줄은 '…'로", ".5초 뒤 첫 줄이 선다.", "~26초 걸리던 가짜 화면이 빨라졌다."];
const LATIN = ["가짜 deploy를 다시 돌렸다.", "가짜 고침은 fake#124에 묶었다.", "가짜 카드 t_ab12cd34가 기다린다.", "가짜 커밋 a1b2c3d를 올렸다.", "9 · 가짜 시작 / 22:08 · 가짜 검토"];

/** A seeded generator (mulberry32): the same texts on every run. */
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function texts(count: number): string[] {
  const random = seeded(241);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  return Array.from({ length: count }, () => {
    const sentences = 1 + Math.floor(random() * 12);
    const parts = Array.from({ length: sentences }, () => pick([WHOLE, WHOLE, LIST, QUOTED, CUT, LATIN]));
    return parts.map((kind) => pick(kind)).join(random() < 0.3 ? "\n" : " ");
  });
}

const TEXTS = [...texts(400), ...WHOLE, ...LIST, ...QUOTED, ...CUT, ...LATIN, "진행 중"];
const STATE = new Set(["진행 중"]);

/** What no drawn line holds, read off the line itself: a Latin letter, a slash, the hub's cut, an opening inside a sentence or an end before its verb. */
function drawable(line: string): boolean {
  return !/[A-Za-z/…]/.test(line) && !/^[.,:;~)\]]/.test(line) && !/(?:을|를|에서|으로)$/.test(line.trim());
}

test("a bot's comment is drawn whole or folds into a line that holds it whole", () => {
  const comments = TEXTS.map((body, index) => ({ id: String(index), at: 1000 + index * 60, author: "ag-2", body }));
  const lines = commentHistory(comments);
  const reachable: string[] = [];
  for (const line of lines) {
    if (line.text === null) reachable.push(...line.held.map((held) => held.body));
    else {
      expect(line.text === line.body.trim() || STATE.has(line.text)).toBe(true);
      expect(drawable(line.text)).toBe(true);
      reachable.push(line.body);
    }
  }
  for (const body of TEXTS) expect(reachable).toContain(body);
});

test("a record's said row is drawn whole or folds into its round's folded line, never a fragment or joined events", () => {
  // Ended rounds, one said row and one report line each, and the going round with every text as a said row.
  const ended: RunRecord["rounds"] = TEXTS.map((text, index) => ({ run: index + 1, startedAt: 1000 + index * 600, endedAt: 1300 + index * 600, endKnown: true, startUnknown: false, result: text, verdict: "accepted", stopped: false, rows: [{ at: 1200 + index * 600, kind: "said", text, count: 1 }] }));
  const start = 1000 + TEXTS.length * 600;
  const going: RunRecord["rounds"][number] = { run: TEXTS.length + 1, startedAt: start, endedAt: null, endKnown: false, startUnknown: false, result: null, verdict: null, stopped: false, rows: TEXTS.map((text, index) => ({ at: start + 1 + index, kind: "said", text, count: 1 })) };
  const record: RunRecord = { id: "r1", at: 0, cardId: "k-1", model: null, settingsRevision: null, rounds: [going, ...ended.reverse()], comments: [], errors: [] } as RunRecord;
  const blocks = timelineBlocks([{ id: "r1", record }], () => true, start + TEXTS.length + 10);
  for (const block of blocks) if (block.type === "round" && block.result) expect(drawable(block.result)).toBe(true);
  const reachable: string[] = [];
  for (const block of blocks) {
    for (const row of block.rows) {
      if (row.text === null) reachable.push(row.source ?? "");
      else {
        expect(row.text).toBe(row.source?.trim());
        expect(drawable(row.text)).toBe(true);
        reachable.push(row.source ?? "");
      }
    }
  }
  for (const text of TEXTS) expect(reachable).toContain(text);
});

test("a stop reason is never cut: whole, or one folded line that opens to all of it", () => {
  for (const text of TEXTS) {
    const reason = stopReasonText(text);
    expect(reason?.text).toBe(text.trim());
    if (reason && !reason.folded) expect(drawable(reason.text.replace(/\n/g, " "))).toBe(true);
  }
  // A reason that is one of the core's internal start words is no sentence a bot wrote for the owner.
  expect(stopReasonText("initial_status")).toBeNull();
  expect(stopReasonText("가짜 시안 두 장을 올렸어요. 어느 쪽이 더 읽기 쉬운지 알려 주세요.")).toEqual({ text: "가짜 시안 두 장을 올렸어요. 어느 쪽이 더 읽기 쉬운지 알려 주세요.", folded: false });
  expect(stopReasonText("가짜 판 · fake-mac 상태 확인\n결정할 것: 오늘 바꿀지 정해 주세요.")).toEqual({ text: "가짜 판 · fake-mac 상태 확인\n결정할 것: 오늘 바꿀지 정해 주세요.", folded: true });
});
