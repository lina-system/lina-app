import { render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { commentHistory, goalHistory } from "./model/timeline";
import type { ItemDetail } from "./api/client";

// lina-app#226: the owner's own comment is drawn as saved, wherever it shows: the card's 댓글 lines, a to-do's thread and
// a goal's 기록. The author says whose it is (`owner` on a card comment made in the app, the owner's id elsewhere); the
// words never do. Only a bot's comment goes through the sentence rule. Invented words of the shapes QA round 20 wrote.
const OWN = ["G2 먼저 보고 T3는 내일 본다", "Vercel", "a1b2c3d 커밋 기준으로 다시 봐 줘", "#12 먼저 봐 주세요", "[중요] 배포 전에 검토해 주세요.", "**배포 순서**를 정해 주세요."];
const MIN = 60;

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

const lineText = (row: Element) => (row.textContent ?? "").replace(/^(?:어제 |\d+월 \d+일 )?\d\d:\d\d · /, "");

test.each(OWN)("the owner's comment %j is its own history line, unchanged, by the author `owner` or the owner's id", (body) => {
  for (const [author, owner] of [
    ["owner", null],
    ["own-7", "own-7"],
  ] as const) {
    const lines = commentHistory([{ id: 1, at: 100, author, body }], owner);
    expect(lines.map((line) => line.text)).toEqual([body]);
  }
  // A bot's comment with the same words goes through the rule: never a cut of it.
  const bot = commentHistory([{ id: 1, at: 100, author: "ag-2", body }]);
  expect([body, null]).toContain(bot[0]?.text ?? null);
});

test("a goal's 기록 draws the owner's comments and replies as saved, a bot's through the rule", () => {
  const detail = {
    state: "in_progress",
    stateSince: null,
    ownerDone: null,
    comments: [{ cid: "c1", by: "own-7", at: 200, text: OWN[0], status: "open", kind: "comment", replies: [{ by: "own-7", at: 300, text: OWN[2], result: null }] }],
    decision: null,
    runs: [],
  } as unknown as ItemDetail;
  expect(goalHistory(detail, [], "own-7").map((row) => row.text)).toEqual([OWN[2], OWN[0]]);
});

test.each(OWN)("a card's 댓글 line of the owner's comment %j reads it as saved", async (body) => {
  const scene = new SyntheticSource({ now: Math.floor(Date.now() / 1000) }).scene;
  const k103 = scene.cardDetails["k-103"];
  const comments = [{ id: 800, author: "owner", body, createdAt: scene.now - 10 * MIN }];
  const view = await open("#/cards/k-103", new SyntheticSource({ now: scene.now, scene: { ...scene, cardDetails: { ...scene.cardDetails, "k-103": { ...k103, comments } } } }));
  const rows = within(view.getByTestId("card-comments")).getAllByTestId("history-row").map(lineText);
  expect(rows).toEqual([body]);
});

test.each(OWN)("a to-do's thread shows the owner's comment %j as saved", async (text) => {
  const scene = new SyntheticSource({ now: Math.floor(Date.now() / 1000) }).scene;
  const T4 = scene.itemDetails.T4;
  const added = { cid: "own", by: "owner", at: scene.now - 5 * MIN, text, status: "open" as const, kind: "comment" as const, replies: [] };
  const view = await open("#/items/T4", new SyntheticSource({ now: scene.now, scene: { ...scene, itemDetails: { ...scene.itemDetails, T4: { ...T4, comments: [...T4.comments, added] } } } }));
  const texts = [...within(view.getByTestId("detail-frame")).getByTestId("comments").querySelectorAll(".comment-text")].map((node) => node.textContent);
  expect(texts).toContain(text);
});
