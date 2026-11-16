import { expect, test } from "vitest";
import { drawnSentences, foldedText } from "./fold";
import { firstSentence } from "./timeline";

// lina-app#230: a comment that holds a numbered list is drawn whole, its lead-in and every item with its mark and every
// sentence of each item, or not at all. The shapes are the real hub's long cards' (QA round 22), the words invented: items
// of one sentence and of several, marks `(1)`, `1)` and `①`, a lead-in with and without its colon, the list on its lead-in's
// line or one item a line, a list that starts at 2 (the hub cut its head), and two lists in one comment.
const ITEM_SENTENCES = ["첫 화면 문구를 새 문체로 맞췄다.", "다시 시도 버튼을 아래로 옮겼다.", "가짜 시안도 함께 고쳤다.", "영수증 금액 줄을 다시 본다.", "환불 안내 문구를 고친다.", "카드사 이름을 굵게 바꿨다."];
const PROSE = ["가짜 검토는 여기까지 했다.", "다음 판에서 다시 확인한다."];
const MARKS: readonly ((n: number) => string)[] = [(n) => `(${n})`, (n) => `${n})`, (n) => String.fromCodePoint(0x245f + n)];

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

interface List {
  readonly lines: string[];
  /** What the screens draw of it: the whole list as one entry, or nothing. */
  readonly drawn: string | null;
  readonly items: string[][];
}

function list(next: () => number): List {
  const pick = <T,>(of: readonly T[]) => of[Math.floor(next() * of.length)];
  const mark = pick(MARKS);
  const start = next() < 0.2 ? 2 : 1;
  const items = Array.from({ length: 1 + Math.floor(next() * 3) }, () => Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick(ITEM_SENTENCES)));
  const marked = items.map((sentences, index) => `${mark(start + index)} ${sentences.join(" ")}`);
  const colon = next() < 0.5;
  const oneLine = next() < 0.5;
  // A lead-in without its colon reads only on the list's own line: on a line of its own it is a sentence of its own.
  const lead = colon ? "가짜 남은 일:" : "가짜 남은 일은 다음과 같다";
  const lines = oneLine || !colon ? [`${lead} ${marked.join(" ")}`] : [lead, ...marked];
  return { lines, drawn: start === 1 ? lines.join(" ") : null, items };
}

function comment(next: () => number): { text: string; drawn: string[]; items: string[][] } {
  const parts: { lines: string[]; drawn: string[]; items: string[][] }[] = [];
  for (let at = 0, count = 1 + Math.floor(next() * 2); at < count; at += 1) {
    if (at > 0 || next() < 0.3) {
      const prose = PROSE[Math.floor(next() * PROSE.length)];
      parts.push({ lines: [prose], drawn: [prose], items: [] });
    }
    const one = list(next);
    parts.push({ lines: one.lines, drawn: one.drawn === null ? [] : [one.drawn], items: one.items });
  }
  return { text: parts.flatMap((part) => part.lines).join("\n"), drawn: parts.flatMap((part) => part.drawn), items: parts.flatMap((part) => part.items) };
}

test("a numbered list is drawn whole with its lead-in, every mark and every sentence of each item, or not at all (lina-app#230)", () => {
  const next = random(230);
  for (let run = 0; run < 500; run += 1) {
    const { text, drawn, items } = comment(next);
    const shown = drawnSentences(text);
    expect(shown, text).toEqual(drawn);
    expect(firstSentence(text), text).toBe(drawn[0] ?? null);
    // No item's sentence, and no second line of a list, is ever drawn alone.
    for (const sentence of items.flat()) expect(shown, text).not.toContain(sentence);
    expect(foldedText(text).split("\n").filter(Boolean), text).toEqual(drawn);
  }
});

test.each([
  // The round 22 shape: the second sentence of an item is no sentence of its own.
  ["가짜 읽은 뜻: (1) 첫 화면을 실시간으로 채운다. 기준 7에 넣는다. (2) 상태 탭은 그다음이다.", ["가짜 읽은 뜻: (1) 첫 화면을 실시간으로 채운다. 기준 7에 넣는다. (2) 상태 탭은 그다음이다."]],
  ["가짜 읽은 뜻: (1) 대화 탭이 먼저다.\n(2) 상태 탭은 그다음이다.", ["가짜 읽은 뜻: (1) 대화 탭이 먼저다. (2) 상태 탭은 그다음이다."]],
  // One item that may not show takes the whole list with it, its other items and lead-in too.
  ["가짜 읽은 뜻: (1) 대화 탭이 먼저다. fake_tab 값은 둔다. (2) 상태 탭은 그다음이다.", []],
  ["가짜 읽은 뜻: (1) 대화 탭이 먼저다.\n(2) 상태 탭은 12/14로 그다음이다.", []],
  // The hub cut its head: a list that starts at 2 is not drawn, its second line neither.
  ["(2) 상태 탭은 그다음이다. 기준 7에 넣는다.\n(3) 설정 탭은 마지막이다.", []],
  // A bracket closed after a number is no `6)` mark: the sentence and the one after it are drawn as any.
  ["가짜 화면을 두 폭(넓은 폭 각 6) 기준으로 맞췄다. 가짜 표를 다시 고쳤다.", ["가짜 화면을 두 폭(넓은 폭 각 6) 기준으로 맞췄다.", "가짜 표를 다시 고쳤다."]],
  // A list's lead-in alone on its line before an item that may not show is not drawn either; the prose after it is.
  ["가짜 남은 일:\n1) fake 화면을 본다.\n가짜 검토는 여기까지 했다.", ["가짜 검토는 여기까지 했다."]],
])("drawnSentences(%j) is %j: a list is one unit (lina-app#230)", (text, drawn) => {
  expect(drawnSentences(text)).toEqual(drawn);
});
