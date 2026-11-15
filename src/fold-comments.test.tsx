import { render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";

// lina-app#161 item 6: comment sentences in the hub's real shapes, where withoutRefs cut a ref and left debris around it.
// The thread and a card's comment history show none of it; a comment with nothing left is one folded row. The address
// host is an example name in place of the real one. A ref inside a sentence with its particle written apart reads as
// the kind of thing it names (lina-app#207): that sentence keeps its meaning instead of folding.

const MIN = 60;
const REAL = ["t_e6e0f90a 가 맡는다.", "lina#718 라 카드 완료 금지.", "주소: (lina-system/lina#12), (hermes-ops#277)", "주소: http://hub.example.com:8080/ 되돌릴 커밋: e37e43f"];
const DEBRIS = ["가 맡는다.", "라 카드 완료 금지.", "주소", "되돌릴 커밋"];
/** The same refs inside a sentence (lina-app#207): the kind of thing each names stands in, with its particle. */
const NAMED = [
  ["백업 대체는 t_e6e0f90a 가 맡는다.", "백업 대체는 카드가 맡는다."],
  ["남은 범위 lina#718 라 카드 완료 금지.", "남은 범위 이슈라 카드 완료 금지."],
] as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function open(hash: string, source: SyntheticSource) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] article.detail")).not.toBeNull());
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-loading]")).toBeNull());
  return view;
}

async function thread(texts: readonly string[]) {
  const scene = new SyntheticSource({ now: Math.floor(Date.now() / 1000) }).scene;
  const T4 = scene.itemDetails.T4;
  const added = texts.map((text, index) => ({ cid: `r${index}`, by: "ag-2", at: scene.now - 30 * MIN + index * MIN, text, status: "open" as const, kind: "comment" as const, replies: [] }));
  const view = await open("#/items/T4", new SyntheticSource({ now: scene.now, scene: { ...scene, itemDetails: { ...scene.itemDetails, T4: { ...T4, comments: [...T4.comments, ...added] } } } }));
  const box = within(view.getByTestId("detail-frame")).getByTestId("comments");
  return { texts: [...box.querySelectorAll(".comment-text")].map((node) => node.textContent ?? ""), folded: within(box).queryAllByTestId("folded-records").map((row) => row.textContent) };
}

for (const [index, comment] of REAL.entries()) {
  test(`item 6: a comment that is only ${JSON.stringify(comment)} folds into one 접힌 기록 row, no debris`, async () => {
    const { texts, folded } = await thread([comment]);
    expect(folded).toEqual(["접힌 기록 1건"]);
    for (const text of texts) expect(text).not.toContain(DEBRIS[index]);
  });

  test(`item 6: a card's comment history shows no debris of ${JSON.stringify(comment)}`, async () => {
    const scene = new SyntheticSource({ now: Math.floor(Date.now() / 1000) }).scene;
    const k103 = scene.cardDetails["k-103"];
    const comments = [{ id: 800, author: "ag-2", body: comment, createdAt: scene.now - 10 * MIN }];
    const view = await open("#/cards/k-103", new SyntheticSource({ now: scene.now, scene: { ...scene, cardDetails: { ...scene.cardDetails, "k-103": { ...k103, comments } } } }));
    const rows = within(view.getByTestId("card-comments")).getAllByTestId("history-row").map((row) => (row.textContent ?? "").replace(/^(?:어제 |\d+월 \d+일 )?\d\d:\d\d · /, ""));
    expect(rows).toEqual(["접힌 댓글"]);
  });
}

for (const [comment, shown] of NAMED) {
  test(`a comment ${JSON.stringify(comment)} reads ${JSON.stringify(shown)} in the thread, no particle alone (lina-app#207)`, async () => {
    const { texts, folded } = await thread([comment]);
    expect(texts).toContain(shown);
    expect(folded).toEqual([]);
  });

  test(`a card's comment history reads ${JSON.stringify(comment)} as ${JSON.stringify(shown)} (lina-app#207)`, async () => {
    const scene = new SyntheticSource({ now: Math.floor(Date.now() / 1000) }).scene;
    const k103 = scene.cardDetails["k-103"];
    const comments = [{ id: 800, author: "ag-2", body: comment, createdAt: scene.now - 10 * MIN }];
    const view = await open("#/cards/k-103", new SyntheticSource({ now: scene.now, scene: { ...scene, cardDetails: { ...scene.cardDetails, "k-103": { ...k103, comments } } } }));
    const rows = within(view.getByTestId("card-comments")).getAllByTestId("history-row").map((row) => (row.textContent ?? "").replace(/^(?:어제 |\d+월 \d+일 )?\d\d:\d\d · /, ""));
    expect(rows).toEqual([shown]);
  });
}

test("item 6: a comment keeps each sentence that still reads, a ref inside it as the kind it names (lina-app#207)", async () => {
  const { texts } = await thread(["Codex 리뷰 요청함. 남은 범위 lina#718 라 카드 완료 금지."]);
  expect(texts).toContain("Codex 리뷰 요청함. 남은 범위 이슈라 카드 완료 금지.");
  for (const text of texts) expect(text).not.toContain("범위 라");
});

test("item 6: comments with nothing left in a row are one 접힌 기록 N건 row", async () => {
  const { folded } = await thread(["주소: (lina-system/lina#12), (hermes-ops#277)", "t_e6e0f90a 가 맡는다."]);
  expect(folded).toEqual(["접힌 기록 2건"]);
});
