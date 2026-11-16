import { expect, test } from "vitest";
import type { BoardSnapshot, ItemList, WorkCardList } from "../api/client";
import { W } from "../words";
import { buildModel, cardCount, type CardSummary } from "./index";

// lina-app#231 (QA round 22, the real hub): 완료 drew finished titles with a hole where a Latin word or a ref was cut
// (`… (추가)`, a particle left at the start, a dangling `·`, `… (포함)로`, an `@` token, a number left in a bracket). A
// finished title is drawn exactly as written, less only a bracket that holds nothing but refs; one that needs any other
// cut is counted in the grey line. The rows have the hub's finished row shape field by field; every title is made up.

const NOW = 1_794_800_000;
const HOUR = 3_600;

type HubRow = CardSummary & { readonly readOnly: boolean; readonly detail?: boolean };

/** A finished card as the hub's cards list serves it: no checked lines, read-only, its history not kept. */
function finished(id: string, title: string, endedAt: number, extra: Partial<HubRow> = {}): HubRow {
  return {
    id,
    title,
    goalTitle: null,
    agent: "ag-a",
    state: "done",
    reason: null,
    waitingOn: null,
    retry: null,
    ask: null,
    elapsedSeconds: 5_400,
    todoProgress: { done: 0, total: 0 },
    now: null,
    endedAt,
    lastHeartbeatAt: null,
    plain: { title: null, now: null, result: null },
    readOnly: true,
    detail: false,
    ...extra,
  };
}

const items = { version: 1, at: NOW, errors: [], owner: { id: "owner", name: "가상주인" }, agents: [{ id: "ag-a", name: "가온" }], items: [] } as unknown as ItemList;
const board = { version: 1, at: NOW, errors: [], cards: [], counts: { unread: 0 }, due: { overdue: [], today: [], week: [], later: [] }, inbox: { decide: [], mine: [] }, machines: [], notices: [], quota: [], writer: { state: "ok", lastSuccessAt: NOW } } as unknown as BoardSnapshot;

const model = (rows: readonly HubRow[]) => buildModel({ board, items, cards: { cards: [...rows] } as WorkCardList, cardsAt: NOW, cardDetails: {}, failed: [] }, NOW);

/** Titles whose only drawable form is a cut, each leaving the hole shape the hub showed. */
const HOLES: readonly [string, string, Partial<HubRow>?][] = [
  ["a bracket left after a cut word", "가상 허브를 FakeBoard (추가)"],
  ["a bracket glued to a particle after a cut", "가상 허브 앱을 v2.4 (포함)로 올리기"],
  ["a particle left at the start", "fakeproxy 용 호출자 키 발급·배포"],
  ["a dangling ·", "가상 서버 끊김에도 fakegate·보조 살아 있게"],
  ["an @ token", "가상 서버 fakeuser@1000 재시작 정리"],
  ["a number left in a bracket", "가상 검사 대기 결함 고치기 (PR 667)"],
  ["a hash cut out of the middle", "가상 앱 반영: 묶음을 a1b2c3d4e5로 (가상 22회차 앞)"],
  ["a ref cut out of the middle", "가상 기억 층 lina#49 정리 마치기"],
  ["a goal title with a Latin word over an own title with one", "fakeproxy 묶음 정리 마치기", { goalTitle: "가상 FakeHub 옮기기" }],
];

/** Titles drawn as written, or less a bracket that holds only refs. */
const WHOLE: readonly [string, string, string][] = [
  ["as written", "가상 목록 다듬기", "가상 목록 다듬기"],
  ["a ref-only bracket gone", "가상 회차 정리 (lina#12·#13)", "가상 회차 정리"],
  ["a bracket of words kept", "가상 앱 반영 (가상 22회차 앞)", "가상 앱 반영 (가상 22회차 앞)"],
];

test("a finished title is drawn exactly as written, less a ref-only bracket; one that needs any other cut is counted in the grey line (lina-app#231)", () => {
  const rows = [
    ...WHOLE.map(([, title], index) => finished(`w${index}`, title, NOW - (index + 1) * HOUR)),
    ...HOLES.map(([, title, extra], index) => finished(`h${index}`, title, NOW - (index + 10) * HOUR, extra)),
  ];
  const built = model(rows);
  WHOLE.forEach(([shape, , drawn], index) => expect(built.cards.get(`w${index}`)?.title, shape).toBe(drawn));
  HOLES.forEach(([shape], index) => expect(built.cards.get(`h${index}`)?.title ?? null, shape).toBeNull());
  // The grey line stands for every card with a hole and the head counts the cards (lina-app#221: one unit, cards).
  const lines = built.home.finished.rows;
  const grey = lines.filter((line) => line.title === null);
  expect(grey).toHaveLength(1);
  expect((grey[0].fold ?? [grey[0]]).map((card) => card.id).sort()).toEqual(HOLES.map((_, index) => `h${index}`).sort());
  expect(built.home.finished.count).toBe(rows.length);
  expect(cardCount(lines)).toBe(rows.length);
  expect(lines.some((line) => line.name === W.untitled)).toBe(false);
});
