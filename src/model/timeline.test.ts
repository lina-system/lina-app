import { expect, test } from "vitest";
import type { RecordRound, RunRecord } from "../api/client";
import type { ItemDetail } from "../api/client";
import { wholeText } from "./fold";
import { commentHistory, goalHistory, historyLines, isMachineNotice, outcomeOf, timelineBlocks } from "./timeline";

const round = (fields: Partial<RecordRound>): RecordRound => ({ run: 1, startedAt: 100, endedAt: null, endKnown: false, startUnknown: false, result: null, verdict: null, stopped: false, rows: [], ...fields });

test("a round's word: the verdict, then its own end, then going only while it holds now, else no end on record", () => {
  expect(outcomeOf(round({ verdict: "accepted", endKnown: true, endedAt: 200 }), false, false, 300)).toBe("accepted");
  expect(outcomeOf(round({ verdict: "rejected", endKnown: true, endedAt: 200 }), false, false, 300)).toBe("rejected");
  expect(outcomeOf(round({ stopped: true, endKnown: true, endedAt: 200 }), true, true, 300)).toBe("stopped");
  expect(outcomeOf(round({ endKnown: true, endedAt: 200 }), true, true, 300)).toBe("ended");
  expect(outcomeOf(round({}), true, true, 300)).toBe("going");
  // Not the newest round, or its run no longer goes, or now is before its start: its end is not on record.
  expect(outcomeOf(round({}), false, true, 300)).toBe("unknown");
  expect(outcomeOf(round({}), true, false, 300)).toBe("unknown");
  expect(outcomeOf(round({}), true, true, 50)).toBe("unknown");
});

test("a history line is a bot's whole text or none: no id, path or command is cut out, no sentence is drawn alone (lina-app#226, #236)", () => {
  expect(wholeText("커밋 3f2a1c9 반영했어요. 다음은 표로 바꿉니다")).toBeNull();
  expect(wholeText("lina-app#128 기준으로 src/app.tsx 정리함\n둘째 줄")).toBeNull();
  expect(wholeText("`npm test` 돌려서 통과함! 이어서 배포")).toBeNull();
  const long = "가".repeat(80);
  expect(wholeText(long)).toBe(long);
  // Longer than a whole line may be (WHOLE_LETTERS, WHOLE_SENTENCES): folded, never shortened (lina-app#236).
  expect(wholeText("가".repeat(121))).toBeNull();
  expect(wholeText("가짜 정리를 마쳤다. 가짜 시험을 마쳤다. 가짜 판을 올렸다.")).toBeNull();
  expect(wholeText("가짜 정리를 마쳤다. 가짜 시험을 마쳤다.")).toBe("가짜 정리를 마쳤다. 가짜 시험을 마쳤다.");
  expect(wholeText("https://example.com/a/b deploy.sh --force")).toBeNull();
  // A quoted passage of two sentences is one sentence (lina-app#224 review).
  expect(wholeText("담당자가 \"검사가 실패했다. 다시 시도하자.\"라고 말했다.")).toBe("담당자가 \"검사가 실패했다. 다시 시도하자.\"라고 말했다.");
  // A count's `0.` is no end of a sentence and no list's mark: the text is drawn whole (lina-app#241).
  expect(wholeText("실패 건수는 0. 검사는 대기 중.")).toBe("실패 건수는 0. 검사는 대기 중.");
  expect(wholeText(null)).toBeNull();
});

// lina-app#197, #226, #236: the shapes the hub's history and comment lines took (round 13, input/ of the brief), the words
// made up. Each text is drawn whole or not at all; no sentence of it is drawn alone.
test.each([
  // A leading clause fragment: the quoted name before it was code, or the line opens on a particle.
  ["fake_option' 값은 꺼져 있고 이유 문구가 붙어 있다. 다음 판에서 다시 확인함.", null],
  ["는 꺼져 있고 이유가 붙어 있다. 가상 정리를 마침.", null],
  // A dangling bracket and lone punctuation where a link and a hash were.
  ["실행: [정리 기록](https://fake.example.test/a) (정리 커밋 포함), a1b2c3d4. 남은 일은 없음.", null],
  ["실행: [정리 기록](https://fake.example.test/a) (정리 커밋 포함), a1b2c3d4.", null],
  // A subject that was only a link and a hash.
  ["PR: [링크](https://fake.example.test/pull/1) (a1b2c3d4),.", null],
  // A value cut by the hub inside its bracket.
  ["주소: https://fake.example.test:1 (허브는 가상 호스트·포트 다…", null],
  // Only a fragment, with the hub's `…` or a table's `|` after it.
  ["범위 라 …", null],
  ["가상 문서 정리 |", null],
  // A list's mark is no rule of its own: the whole text is drawn (lina-app#241).
  ["1) 가상 설정이 긴 답에서 돌았다. 둘째 문장.", "1) 가상 설정이 긴 답에서 돌았다. 둘째 문장."],
  // A long sentence is drawn whole: nothing shortens it (lina-app#226).
  ["완료 조건이 모두 체크됨(가상 일지 두 번, 가상 주간 한 장, 나눠야 할 곳은 나누고 나누면 안 될 곳은 안 나눔)", "완료 조건이 모두 체크됨(가상 일지 두 번, 가상 주간 한 장, 나눠야 할 곳은 나누고 나누면 안 될 곳은 안 나눔)"],
  // A time of day reads against the row's own time and cannot be cut out: no line (lina-app#153, #226).
  ["22:45 기준으로 문구를 다시 확인함.", null],
  // A product name is a Latin word too (lina-app#222): no line.
  ["iPhone에서 다시 확인함.", null],
  ["가상 화면 (두 번째 판) 정리를 마침.", "가상 화면 (두 번째 판) 정리를 마침."],
])("a history line %j reads %j: the whole text or none (lina-app#197, #236)", (text, shown) => {
  expect(wholeText(text)).toBe(shown);
});

// lina-app#207, #226: a name inside a sentence left its particle standing alone once it was cut (round 15); a kind word
// stood in for it since, which changed the sentence. Now the sentence is not drawn at all; the names here are made up.
test.each([
  ["그 뒤 디스패처가 152번 `fake_field` 로 막았다.", null],
  ["허브가 앱 번들 `dist/` 를 서빙.", null],
  ["허브가 앱 번들 a1b2c3d4e5 를 서빙.", null],
  ["허브가 앱 번들 fake/index.html 을 서빙.", null],
  ["그 뒤 디스패처가 152번 r3 로 막았다.", null],
  ["`fake_field` 로 막았다.", null],
])("a history line %j reads %j: a name inside it is never cut out or stood in for (lina-app#207, #226)", (text, shown) => {
  expect(wholeText(text)).toBe(shown);
});

// lina-app#218, #226, #236: the round 17 shapes, words made up: a lead-in is no line, no item of it is drawn alone, and a
// sentence holding a ref folds its whole text.
test.each([
  ["확인할 가짜 결과:\n- 가짜 빌드 통과.\n- 가짜 시험 통과.", null],
  ["확인할 가짜 결과:\n- 가짜 빌드를 마쳤다.", null],
  ["확인할 가짜 결과:", null],
  ["가짜 끝 조건은 더 새 a1b2c3d4e5로 충족됨. 가짜 시험을 마친 뒤 닫아도 된다.", null],
  ["가짜 끝 조건은 새 lina#12로 충족됨.", null],
  ["가짜 끝 조건(가짜 값 a1b2c3d4e5)은 더 새 0aa65fe53a로 충족됨. 가짜 시험을 마침.", null],
])("a history line %j reads %j: no lead-in alone and no cut hole (lina-app#218)", (text, shown) => {
  expect(wholeText(text)).toBe(shown);
});

// lina-app#222, #236: the round 18 shapes of the real hub's long cards, words made up. A history line is the whole text
// when every sentence of it passes the rule (sentenceMayShow), else none: never the next clean sentence alone.
test.each([
  // A list's number and a dot inside a number or a version are no sentence end: two sentences, drawn whole (lina-app#241).
  ["가짜 순서는 1. 가짜 빌드를 마친다. 다음 문장.", "가짜 순서는 1. 가짜 빌드를 마친다. 다음 문장."],
  ["가짜 지연이 0.5초 늘었다. 가짜 시험을 마침.", "가짜 지연이 0.5초 늘었다. 가짜 시험을 마침."],
  ["가짜 판 1.2.3을 깔았다. 가짜 시험을 마침.", "가짜 판 1.2.3을 깔았다. 가짜 시험을 마침."],
  // A Latin word, a short code, a round label or a product name in one sentence: the whole text folds.
  ["가짜 PR 검사를 마쳤다. 가짜 시험을 마침.", null],
  ["가짜 S2는 뒤에 얹는다. 가짜 시험을 마침.", null],
  ["가짜 묶음 N1·N2를 닫았다. 가짜 시험을 마침.", null],
  ["가짜 검사가 rc 0으로 끝남. 가짜 시험을 마침.", null],
  ["Codex가 남긴 가짜 지적을 고쳤다. 가짜 시험을 마침.", null],
  // A particle left after a removed number-like token, a quote left open.
  ["가짜 판을 v2.97 로 올렸다. 가짜 시험을 마침.", null],
  ['가짜 댓글의 세 번 끊겼다"는 틀렸다. 가짜 시험을 마침.', null],
  // No clean sentence: no line.
  ["가짜 PR (닫음). 가짜 결함 D1~D7을 모았다.", null],
  // A long sentence is drawn whole, its quote and all (lina-app#226).
  ['가짜 요청은 "가짜 화면을 열 때마다 목록을 통째로 다시 받아 기다리게 하지 말고 지난번 화면을 바로 보여 주기"였다.', '가짜 요청은 "가짜 화면을 열 때마다 목록을 통째로 다시 받아 기다리게 하지 말고 지난번 화면을 바로 보여 주기"였다.'],
])("a history line %j reads %j: the whole text when every sentence passes the rule, else none (lina-app#222, #236)", (text, shown) => {
  expect(wholeText(text)).toBe(shown);
});

test("a comment with no clean sentence draws no line of its own: it is one of the folded run (lina-app#222)", () => {
  const lines = commentHistory([
    { id: 1, at: 300, author: "worker-a", body: "가짜 정리를 마침." },
    { id: 2, at: 200, author: "worker-a", body: "가짜 PR 검사를 마쳤다. 가짜 결함 D1~D7을 모았다." },
    { id: 3, at: 100, author: "worker-a", body: "가짜 판을 v2.97 로 올렸다." },
  ]);
  expect(lines.map((line) => [line.at, line.text, line.folded])).toEqual([
    [300, "가짜 정리를 마침.", 0],
    [200, null, 2],
  ]);
});

/**
 * History lines the real hub's comments produced (lina-app#149, ids in their shape, none real): each one cut inside a
 * word or a number, or a machine notice, or an identifier with nothing around it. Machine notices are no line; every
 * other comment reads one whole sentence or nothing.
 */
const REAL_HISTORY: readonly (readonly [string, string, string | null])[] = [
  ["worker-a", "vs 20 14 my in '—' 24, 14 점검", null],
  ["worker-a", '.5초 무렵 "불러오는 중"이었고…', null],
  ["lina-worker", "[대기 충족] of — 돌렸다.", null],
  ["kanban-dispatcher", "[받음] 1744 대화에 들어감: 21:44 · OT-QAX1113…", null],
  ["worker-a", "장부 G73 / T264.", null],
  ["worker-a", "t_27363156 레스큐 봇", null],
  ["worker-a", "rc=1(없음)", null],
  ["worker-a", "[현황]", null],
  ["worker-a", "[받음] 첫 화면 문구를 짧게 고쳤어요.", null],
  ["lina-worker", "작업을 받아 대화에 들어감", null],
  ["worker-a", "G73 장부를 맞추고 T264 할 일을 닫았어요. 이어서 배포", null],
];

const IDENTIFIER = /[A-Za-z]+[-_:]?\d|\d+[A-Za-z]|#\d|=|_/;

test.each(REAL_HISTORY)("a real comment by %s, %j, is a whole sentence with no identifier or tag, or no line at all", (author, body, expected) => {
  const line = isMachineNotice(body, author) ? null : wholeText(body);
  expect(line).toBe(expected);
  if (line === null) return;
  expect(line).not.toMatch(IDENTIFIER);
  expect(line).not.toMatch(/\[[^\]]*\]/);
  // It starts on a letter or a number, and every word in it is a whole word of the comment: nothing cut mid-word.
  expect(line).toMatch(/^[\p{L}\p{N}"'(]/u);
  const words = new Set(body.split(/\s+/).map((word) => word.replace(/[.,!?。:;…]+$/, "")));
  for (const word of line.replace(/…$/, "").split(/\s+/)) expect(words, word).toContain(word.replace(/[.,!?。:;]+$/, ""));
});

test("a long sentence within the whole line's length is drawn whole, never cut (lina-app#226, #236)", () => {
  const body = "배포 전에 바뀐 화면 문구를 하나씩 다시 읽어 보고 어색한 곳을 고쳐서 검토 요청을 올렸고 이어서 남은 화면 두 곳을 맞추는 중";
  expect(wholeText(body)).toBe(body);
});

test("history lines read newest first, and a run of entries with nothing left to read is one line with its count", () => {
  const lines = historyLines([
    { at: 100, text: "첫 문장." },
    { at: 400, text: null },
    { at: 300, text: null },
    { at: 500, text: "마지막 문장." },
    { at: 200, text: null },
    { at: 250, text: "중간 문장." },
  ]);
  expect(lines.map((line) => [line.at, line.text, line.folded])).toEqual([
    [500, "마지막 문장.", 0],
    [400, null, 2],
    [250, "중간 문장.", 0],
    [200, null, 1],
    [100, "첫 문장.", 0],
  ]);
});

test("a goal's history: comments, its question, its runs, the merge and the close, one row each in time order", () => {
  const detail = {
    state: "done",
    stateSince: 900,
    ownerDone: null,
    comments: [
      { cid: "c1", by: "owner", at: 200, text: "첫 화면 문구는 짧게 해 주세요. 자세한 건 docs/guide.md 참고", status: "resolved", kind: "comment", replies: [{ by: "ag-1", at: 300, text: "짧게 고쳤어요.", result: null }] },
    ],
    decision: { text: "가이드를 첫 화면에 걸지 결정 필요", kind: "ask", at: 400, answered: true, choices: [], recommended: null, cid: null },
    runs: [{ id: "r1", title: "guide", state: "done", reason: null, startedAt: 450, endedAt: 600 }],
  } as unknown as ItemDetail;
  const rows = goalHistory(detail, [{ at: 700, text: "새 가이드를 문서 사이트에 올림 (3f2a1c9)" }]);
  // Newest first, as every history (lina-app#149).
  expect(rows.map((row) => [row.at, row.kind, row.text])).toEqual([
    [900, "close", "완료"],
    [700, "merge", "새 가이드를 문서 사이트에 올림"],
    [600, "run", "완료"],
    [400, "question", "질문: 가이드를 첫 화면에 걸지 결정 필요"],
    [300, "comment", "짧게 고쳤어요."],
    // The owner's comment is drawn as saved (lina-app#226).
    [200, "comment", "첫 화면 문구는 짧게 해 주세요. 자세한 건 docs/guide.md 참고"],
  ]);
});

test("the owner's comment that opens with a bracketed word is history, a machine notice with the same tag is not (lina-app#149)", () => {
  expect(isMachineNotice("[중요] 배포 전에 검토해 주세요.", "owner")).toBe(false);
  expect(isMachineNotice("[받음] 대화에 들어감", "ag-1")).toBe(true);
  expect(isMachineNotice("[중요] 배포 전에 검토해 주세요.", "lina-worker")).toBe(true);
  expect(isMachineNotice("[받음] 대화에 들어감")).toBe(true);
});

const STATE_ONLY = new Set(["예정", "진행 중", "대기", "중단됨", "완료", "검토 통과", "검토 필요", "완료 기록 없음"]);

/**
 * Round 5 of the UI QA on the real hub (lina-app#153; roles, times and ids in their shape, none real): comments served
 * out of time order, with a bracket tag holding a role and a time, a whole sentence in brackets, a worker's 완료 again
 * and again, and sentences holding another time than their own.
 */
const NOISY: readonly (readonly [string, readonly (readonly [number, string])[]])[] = [
  ["bracket tags with a role and a time", [[200, "[검토자 02:21 결정] 배포는 금요일 오후로 함."], [100, "[작업자 04:40 코드 반영 끝, 시험 통과]"], [150, "[작업자 02:25 결정, 표로 바꿈] 표 머리는 짧게 함."]]],
  ["the same state word again and again", [[400, "완료"], [400, "완료"], [400, "완료"], [400, "완료"], [300, "진행 중"], [300, "진행 중"]]],
  ["times out of order", [[119, "첫 화면 문구를 고쳤어요."], [118, "둘째 화면도 맞췄어요."], [120, "마지막으로 다시 확인함."], [60, "처음 받은 의견을 정리함."]]],
  ["a time inside the sentence", [[1376, "22:45 기준으로 문구를 다시 확인함."], [1300, "어제 21:10에 받은 의견을 정리함."]]],
  ["dropped comments between kept ones", [[10, "G73 / T264."], [20, "rc=1(없음)"], [30, "문구를 고쳤어요."], [40, "vs 20 14 my in '—' 24"], [50, ".5초 무렵"]]],
];

test.each(NOISY)("a card's history with %s: no line starts with [, a state word again is counted on the line before it, times only go back", (_case, rows) => {
  const lines = commentHistory(rows.map(([at, body], index) => ({ id: index, at, author: "worker-a", body })));
  expect(lines.length).toBeGreaterThan(0);
  lines.forEach((line, index) => {
    const text = line.text ?? "";
    expect(text).not.toMatch(/^\[/);
    // A time of day is drawn only alone in its sentence with its particle glued after it (`21:10에`, lina-app#230).
    expect(text).not.toMatch(/\d{1,2}:\d{2}(?!\d|\p{Script=Hangul})/u);
    if (index === 0) return;
    const previous = lines[index - 1];
    expect(line.at).toBeLessThanOrEqual(previous.at);
    if (STATE_ONLY.has(text)) expect(text).not.toBe(previous.text);
    expect(line.text === null && previous.text === null).toBe(false);
  });
});

test("a bracket tag with a role and a time is cut off the sentence; a receipt's one-word tag still makes it a machine notice", () => {
  expect(wholeText("[검토자 02:21 결정] 배포는 금요일 오후로 함.")).toBe("배포는 금요일 오후로 함.");
  expect(wholeText("[작업자 04:40 코드 반영 끝, 시험 통과]")).toBeNull();
  expect(wholeText("22:45 기준으로 문구를 다시 확인함.")).toBeNull();
  expect(isMachineNotice("[검토자 02:21 결정] 배포는 금요일 오후로 함.", "worker-a")).toBe(false);
  expect(isMachineNotice("[받음] 대화에 들어감", "worker-a")).toBe(true);
});

test("a card's record read through several of its worker runs shows each round and comment once, newest first", () => {
  const record: RunRecord = {
    at: 1000,
    cardId: "k-1",
    id: "w1",
    errors: [],
    model: null,
    settingsRevision: null,
    comments: [{ at: 500, kind: "comment", text: "표로 보여 주세요.", count: 1 }],
    rounds: [round({ run: 2, startedAt: 600, endedAt: 700, endKnown: true }), round({ run: 1, startedAt: 100, endedAt: 400, endKnown: true })],
  } as unknown as RunRecord;
  const blocks = timelineBlocks(
    ["w1", "w2", "w3", "w4"].map((id) => ({ id, record: { ...record, id } })),
    () => false,
    1000,
  );
  expect(blocks.map((block) => [block.type, block.at])).toEqual([
    ["round", 700],
    ["comment", 500],
    ["round", 400],
  ]);
});

// lina-app#230, #236: a record's comment row has no author (a receipt's note, which on the hub an agent writes, cut by
// the core at 300 characters with no mark): in a round and between rounds it reads through the one gate, never as saved,
// and a cut one is longer than a whole line may be, so it folds.
test("a record's comment rows read through the one gate, in a round and between rounds (lina-app#230, #236)", () => {
  const note = "fake diff read, merged via fake PR (fake#12), checked in fake QA rounds".slice(0, 300);
  const cut = `${"가짜 금액 줄을 다시 확인했다. ".repeat(12)}가짜 환불 안내 문구는 아직 고치는 중이었다.`.slice(0, 300);
  const record = {
    at: 1000,
    cardId: "k-1",
    id: "w1",
    errors: [],
    model: null,
    settingsRevision: null,
    comments: [
      { at: 500, kind: "comment", text: note, count: 1 },
      { at: 450, kind: "comment", text: cut, count: 1 },
      { at: 420, kind: "comment", text: "가짜 금액 줄을 다시 확인했다.", count: 1 },
    ],
    rounds: [round({ run: 1, startedAt: 100, endedAt: 400, endKnown: true, rows: [{ at: 200, kind: "comment", text: `가짜 표로 바꿔 주세요. ${note}`, count: 1 }] })],
  } as unknown as RunRecord;
  const blocks = timelineBlocks([{ id: "w1", record }], () => false, 1000);
  expect(blocks.map((block) => block.rows.map((row) => row.text))).toEqual([[null, null, "가짜 금액 줄을 다시 확인했다."], [null]]);
});

// lina-app#230: on the real hub's long card the same note stood in the 댓글 section nine times. A text drawn more than
// once in one card's comments is one line at its newest time with its count; the folded lines around a repeat it took
// away read as one.
test("the same comment line again in one card is one line with its count, at its newest time (lina-app#230)", () => {
  const note = "가짜 변경을 읽고 병합했다.";
  const lines = commentHistory([
    { id: 1, at: 100, author: "worker-a", body: note },
    { id: 2, at: 200, author: "worker-a", body: "fake note" },
    { id: 3, at: 300, author: "worker-a", body: note },
    { id: 4, at: 400, author: "worker-a", body: "fake note again" },
    { id: 5, at: 500, author: "worker-a", body: note },
    { id: 6, at: 600, author: "worker-a", body: "가짜 표를 다시 만들었다." },
  ]);
  expect(lines.map((line) => [line.at, line.text, line.count, line.folded])).toEqual([
    [600, "가짜 표를 다시 만들었다.", 1, 0],
    [500, note, 3, 0],
    [400, null, 1, 2],
  ]);
});

// PR #260 review: a record's note belongs to the worker run whose record holds it. With worker A ending at 1000,
// worker B ending at 1100 and only A noting its result at 1150, the sentence is A's line, never B's, and A's round
// stays a block of its own.
test("a record's note is read only by its own run's round, never by another run's that ended near it", () => {
  const base = { at: 2000, cardId: "k-1", errors: [], model: null, settingsRevision: null };
  const a = { ...base, id: "wa", comments: [{ at: 1150, kind: "comment", text: "가짜 검사를 통과했다.", count: 1 }], rounds: [round({ run: 1, startedAt: 900, endedAt: 1000, endKnown: true })] } as unknown as RunRecord;
  const b = { ...base, id: "wb", comments: [], rounds: [round({ run: 1, startedAt: 1050, endedAt: 1100, endKnown: true })] } as unknown as RunRecord;
  const blocks = timelineBlocks(
    [
      { id: "wa", record: a },
      { id: "wb", record: b },
    ],
    () => false,
    3000,
  );
  expect(blocks.flatMap((block) => (block.type === "round" ? [[block.runId, block.at, block.result, block.count]] : []))).toEqual([
    ["wb", 1100, null, 1],
    ["wa", 1000, "가짜 검사를 통과했다.", 1],
  ]);
});

// PR #260 review: two rounds of one worker run. A note made between them, after the first ended and before the second
// began, is the first rounds: the seconds end-relative window must not take it.
test("a note made before a round began is not read by that round, only by the one it followed (PR #260)", () => {
  const record = {
    at: 2000,
    cardId: "k-1",
    id: "w1",
    errors: [],
    model: null,
    settingsRevision: null,
    comments: [{ at: 1050, kind: "comment", text: "가짜 검사를 통과했다.", count: 1 }],
    rounds: [round({ run: 2, startedAt: 1080, endedAt: 1100, endKnown: true }), round({ run: 1, startedAt: 900, endedAt: 1000, endKnown: true })],
  } as unknown as RunRecord;
  const blocks = timelineBlocks([{ id: "w1", record }], () => false, 3000);
  expect(blocks.flatMap((block) => (block.type === "round" ? [[block.n, block.at, block.result]] : []))).toEqual([
    [2, 1100, null],
    [1, 1000, "가짜 검사를 통과했다."],
  ]);
});
