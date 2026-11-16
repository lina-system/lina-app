import { expect, test } from "vitest";
import { foldedText, sentencesOf, withoutCutEnd, withoutRefs } from "./fold";
import { wholeTitle } from "./index";
import { firstSentence } from "./timeline";

// lina-app#226: whole or nothing. Invented sentences in every shape the real hub's long cards hold, each with what the
// screens may draw of it: the sentence as written, less a bracket that holds only refs, ids or hashes; or nothing.
// `last` marks a sentence with no end mark: it can only end its line, or the next sentence would be part of it.
type Shape = { readonly source: string; readonly drawn: string | null; readonly last?: boolean };

const SHAPES: readonly Shape[] = [
  // Drawn as written: a dot inside a number or a version, a quote of several sentences, a state word.
  { source: "가짜 지연이 0.5초 늘었다.", drawn: "가짜 지연이 0.5초 늘었다." },
  { source: "가짜 판 1.2.3을 깔았다.", drawn: "가짜 판 1.2.3을 깔았다." },
  { source: '가짜 담당자가 "검사가 실패했다. 다시 시도하자."라고 말했다.', drawn: '가짜 담당자가 "검사가 실패했다. 다시 시도하자."라고 말했다.' },
  { source: "완료", drawn: "완료", last: true },
  { source: "가짜 결과: 배포에 성공했다.", drawn: "가짜 결과: 배포에 성공했다." },
  { source: "가짜 화면 (두 번째 판) 정리를 마침.", drawn: "가짜 화면 (두 번째 판) 정리를 마침." },
  { source: "그 일은 오늘 가 볼 예정이다.", drawn: "그 일은 오늘 가 볼 예정이다." },
  // A bracket of refs only goes whole, with the space before it.
  { source: "가짜 관문을 옮겼다 (lina#12).", drawn: "가짜 관문을 옮겼다." },
  { source: "가짜 묶음을 닫았다 (#123·#124).", drawn: "가짜 묶음을 닫았다." },
  { source: "가짜 사본을 지웠다 (t_ab12cd34).", drawn: "가짜 사본을 지웠다." },
  { source: "가짜 판을 다시 올렸다 (a1b2c3d).", drawn: "가짜 판을 다시 올렸다." },
  { source: "가짜 관문(lina#12)을 옮겼다.", drawn: "가짜 관문을 옮겼다." },
  // Not drawn: a file name, a path, a command, a code name, a key with its value.
  { source: "가짜 설정 notes.md를 고쳤다.", drawn: null },
  { source: "가짜 파일 src/fake/a.ts를 고쳤다.", drawn: null },
  { source: "`npm test`를 돌려서 통과했다.", drawn: null },
  { source: "가짜 fake_lines 요약을 바꿨다.", drawn: null },
  { source: "가짜 fakeKeyHelper 값을 지웠다.", drawn: null },
  { source: "가짜 값을 fake=1로 바꿨다.", drawn: null },
  // Not drawn: a code-like token, an English word or verb phrase, a ref or an id outside a bracket.
  { source: "가짜 S2는 뒤에 얹는다.", drawn: null },
  { source: "가짜 검사가 rc 0으로 끝났다.", drawn: null },
  { source: "가짜 묶음 N1·N2를 닫았다.", drawn: null },
  { source: "가짜 수정이 merged and deployed 되었다.", drawn: null },
  { source: "가짜 수정이 merged 되었다.", drawn: null },
  { source: "#12를 먼저 닫았다.", drawn: null },
  { source: "G2 가짜 묶음을 먼저 본다.", drawn: null },
  { source: "가짜 관문을 옮겼다 (lina#12 뒷일).", drawn: null },
  // Not drawn: an arrow or a slash list.
  { source: "가짜 대기가 3 → 5로 늘었다.", drawn: null },
  { source: "가짜 앱/코어를 올렸다.", drawn: null },
  { source: "가짜 수치 12/14를 맞췄다.", drawn: null },
  // Not drawn: no Hangul, a lead-in, a bare label, a fragment with no predicate, a continuation, the hub's own cut.
  { source: "done.", drawn: null },
  { source: "12:30", drawn: null, last: true },
  { source: "직접 확인한 가짜 것:", drawn: null, last: true },
  { source: "직접 확인한 것", drawn: null, last: true },
  { source: "원인 둘.", drawn: null },
  { source: "반영 단계.", drawn: null },
  { source: "앱, 코어.", drawn: null },
  { source: "그러나 가짜 화면은 그대로다.", drawn: null },
  { source: "가짜 문구를 고치는 중인데…", drawn: null, last: true },
  // Not drawn: a time of day, which reads against the row's own time (lina-app#153).
  { source: "22:45 기준으로 가짜 문구를 다시 확인함.", drawn: null },
  // Not drawn: what a split inside a number or a list leaves.
  { source: ".5초 무렵 다시 봤다.", drawn: null },
  { source: "5초.", drawn: null },
];

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

/** A comment of 1-4 lines of 1-3 sentences, some lines a bullet (`- `): the shapes and the order they hold. A numbered list is one unit (list-unit.test.ts). */
function comment(next: () => number): { text: string; shapes: Shape[] } {
  const pick = () => SHAPES[Math.floor(next() * SHAPES.length)];
  const shapes: Shape[] = [];
  const lines: string[] = [];
  for (let line = 0, count = 1 + Math.floor(next() * 4); line < count; line += 1) {
    const sentences: Shape[] = [];
    for (let at = 0, size = 1 + Math.floor(next() * 3); at < size; at += 1) {
      const shape = pick();
      sentences.push(shape);
      if (shape.last) break;
    }
    const mark = next() < 0.3 ? "- " : "";
    lines.push(mark + sentences.map((shape) => shape.source).join(" "));
    shapes.push(...sentences);
  }
  return { text: lines.join("\n"), shapes };
}

const drawnOf = (text: string) => foldedText(text).split("\n").filter(Boolean).flatMap((line) => sentencesOf(line));

test.each(SHAPES)("one sentence alone, $source, is drawn as $drawn (lina-app#226)", ({ source, drawn }) => {
  expect(drawnOf(source)).toEqual(drawn === null ? [] : [drawn]);
  expect(firstSentence(source)).toBe(drawn);
});

test("every drawn sentence is its source sentence less ref-only brackets, and every drawable one is drawn (lina-app#226)", () => {
  const next = random(226);
  for (let run = 0; run < 400; run += 1) {
    const { text, shapes } = comment(next);
    const expected = shapes.map((shape) => shape.drawn).filter((drawn): drawn is string => drawn !== null);
    expect(drawnOf(text), text).toEqual(expected);
    expect(firstSentence(text), text).toBe(expected[0] ?? null);
  }
});

test("a bracket that holds Korean words beside a ref is kept, so the whole title is refused (lina-app#233 review)", () => {
  expect(wholeTitle("가상 화면 정리 (가짜를 a1b2c3d로)")).toBeNull();
  expect(wholeTitle("가상 화면 정리 (a1b2c3d)")).toBe("가상 화면 정리");
  expect(wholeTitle("가상 화면 정리 (lina#12·#13)")).toBe("가상 화면 정리");
});

test("a list whose last item the core cut is dropped whole, not left as a shorter list (lina-app#233 review)", () => {
  const cut = "가짜 남은 일: (1) 첫 화면 문구를 고쳤다. 가짜 시안도 함께 고쳤다. (2) 환불 문구를 아직 고치는 중이";
  expect(withoutCutEnd(cut)).toBe("");
  expect(foldedText(withoutCutEnd(cut))).toBe("");
  // a cut last sentence outside any list still goes alone
  expect(withoutCutEnd("가짜 정리를 마쳤다. 가짜 시안을 고치는 중이")).toBe("가짜 정리를 마쳤다.");
  // a list that ends whole stays
  expect(withoutCutEnd("가짜 남은 일: (1) 첫 화면 문구를 고쳤다. (2) 환불 문구를 고쳤다.")).toBe("가짜 남은 일: (1) 첫 화면 문구를 고쳤다. (2) 환불 문구를 고쳤다.");
});

test("a number with its unit is no hash in a whole title, a bare run of digits still is (lina-app#233 review)", () => {
  expect(wholeTitle("가짜 가격은 12345678원으로 정했다.")).toBe("가짜 가격은 12345678원으로 정했다.");
  expect(withoutRefs("가짜 가격은 12345678원으로 정했다.")).toBe("가짜 가격은 12345678원으로 정했다.");
  expect(withoutRefs("가짜 매출은 1234567,890원이다.")).toBe("가짜 매출은 1234567,890원이다.");
  expect(wholeTitle("가짜 판은 아직 4815162342 그대로다.")).toBeNull();
  expect(withoutRefs("가짜 빌드 4815162342 올리기")).toBe("가짜 빌드 올리기");
});

test("a sentence's end is read without its markdown markers (lina-app#233 review)", () => {
  // a closing `**` hides the full stop, and the sentence ends on a noun: it is whole, not cut
  expect(withoutCutEnd("**가짜 금액 줄과 환불 문구 모두 점검 완료.**")).toBe("가짜 금액 줄과 환불 문구 모두 점검 완료.");
  expect(withoutCutEnd("가짜 남은 일: (1) 첫 화면 문구를 고쳤다. (2) **환불 문구 확인.**")).toBe("가짜 남은 일: (1) 첫 화면 문구를 고쳤다. (2) 환불 문구 확인.");
  // a cut sentence is still cut when it carries markers
  expect(withoutCutEnd("가짜 정리를 마쳤다. **가짜 시안을 고치는 중이**")).toBe("가짜 정리를 마쳤다.");
});
