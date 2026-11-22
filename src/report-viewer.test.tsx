import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { expect, test, vi } from "vitest";
import { routePath } from "./api/client";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import { Store } from "./data/store";
import { REPORT_IDS } from "./fixtures/reports";
import { messageParts, referencesAsSummaries, reportOfPage } from "./report/reference";
import { href, isFrame, parse } from "./router";

// lina-app#50: a chat message with a report reference shows one report card, never the report's body; the card opens
// the report beside the conversation on a wide window and in a sheet on a phone, and the open report follows its
// agent's edits with a small mark and its earlier versions one tap away.

async function open(hash: string, wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide && !query.includes("prefers-color-scheme"), media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000), reports: true });
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return { view, source };
}

const stack = () => (window.history.state as { stack?: string[] } | null)?.stack ?? [window.location.hash];

test("a reference line is a card part between the message's words; a page address names its report; a preview reads the summary", () => {
  const text = `보고를 올렸어요.\n[[report:${REPORT_IDS.long}|https://hub.invalid/reports/${REPORT_IDS.long}/page|중간 보고]]\n끝.`;
  expect(messageParts(text)).toEqual([
    { kind: "text", text: "보고를 올렸어요." },
    { kind: "report", reference: { id: REPORT_IDS.long, page: `https://hub.invalid/reports/${REPORT_IDS.long}/page`, summary: "중간 보고" } },
    { kind: "text", text: "끝." },
  ]);
  expect(messageParts("[[report:rep_123|x|y]]")).toEqual([{ kind: "text", text: "[[report:rep_123|x|y]]" }]);
  expect(referencesAsSummaries(text)).toBe("보고를 올렸어요.\n중간 보고\n끝.");
  expect(reportOfPage(`https://hub.invalid/reports/${REPORT_IDS.long}/page`)).toBe(REPORT_IDS.long);
  expect(reportOfPage("https://hub.invalid/r/old-note")).toBeNull();
});

test("a report has its own address, opens in the detail frame and reads one version by query", () => {
  expect(parse(`#/reports/${REPORT_IDS.long}`)).toEqual({ name: "report", id: REPORT_IDS.long });
  expect(parse(`#/reports/${REPORT_IDS.long}?v=2`)).toEqual({ name: "report", id: REPORT_IDS.long, version: 2 });
  expect(href({ name: "report", id: REPORT_IDS.long, version: 2 })).toBe(`#/reports/${REPORT_IDS.long}?v=2`);
  expect(isFrame({ name: "report", id: REPORT_IDS.long })).toBe(true);
  expect(routePath("report", `${REPORT_IDS.long}@2`)).toBe(`/api/lina/reports/${REPORT_IDS.long}?version=2`);
  expect(routePath("reports", "k-101")).toBe("/api/lina/reports?card=k-101");
});

test("the chat shows one card per report with its title and agent, no body; the card opens the inspector beside the usable chat, a second replaces it, close returns", async () => {
  const { view } = await open("#/talk/ag-1", true);
  const talk = within(view.getByTestId("agent-talk"));
  await waitFor(() => expect(talk.getAllByTestId("report-card")).toHaveLength(2));
  const [long, legacy] = talk.getAllByTestId("report-card");
  await waitFor(() => expect(long.textContent).toContain("가상 릴리스 변경 정리 · 중간 보고"));
  expect(long.querySelector(".report-card-meta")?.textContent).toMatch(/· 업데이트 12분 전$/);
  expect(view.getByTestId("agent-talk").textContent).not.toContain("묶음별 변경");
  expect(view.getByTestId("agent-talk").textContent).not.toContain("[[report:");
  const depth = stack().length;
  fireEvent.click(long);
  const inspector = await waitFor(() => view.getByTestId("report-inspector"));
  await waitFor(() => expect(within(inspector).getByRole("heading", { level: 1 }).textContent).toBe("가상 릴리스 변경 정리 · 중간 보고"));
  expect(stack()).toHaveLength(depth + 1);
  expect(view.getByTestId("agent-talk")).toBeTruthy();
  expect(view.getByRole("textbox", { name: "메시지" })).toBeTruthy();
  fireEvent.click(legacy);
  await waitFor(() => expect(within(view.getByTestId("report-inspector")).getByRole("heading", { level: 1 }).textContent).toBe("가상 백업 점검 메모"));
  expect(stack()).toHaveLength(depth + 1);
  fireEvent.click(within(view.getByTestId("report-inspector")).getByTestId("report-close"));
  await waitFor(() => expect(view.queryByTestId("report-inspector")).toBeNull());
  expect(window.location.hash).toBe("#/talk/ag-1");
});

test("a report page address in a message opens the viewer on a plain click; the old dashboard's address stays a link", async () => {
  const { view } = await open("#/talk/ag-1", true);
  const link = await waitFor(() => view.getByRole("link", { name: "오류 예시" }));
  fireEvent.click(link);
  await waitFor(() => expect(window.location.hash).toBe(`#/reports/${REPORT_IDS.broken}`));
  await waitFor(() => expect(within(view.getByTestId("report-inspector")).getAllByTestId("report-block-broken").length).toBeGreaterThan(3));
  const old = view.getByRole("link", { name: "옛 보고서" });
  expect(old.getAttribute("href")).toBe("https://hub.invalid/r/old-note");
  expect(old.getAttribute("target")).toBe("_blank");
});

test("an agent's edit updates the open report in place with a small mark, and its earlier versions open from the viewer", async () => {
  const { view, source } = await open(`#/reports/${REPORT_IDS.long}`, true);
  const report = await waitFor(() => view.getByTestId("report"));
  await waitFor(() => expect(report.dataset.version).toBe("3"));
  expect(view.queryByTestId("report-updated")).toBeNull();
  expect(source.reportEditedElsewhere(REPORT_IDS.long)).toBe(true);
  await waitFor(() => expect(view.getByTestId("report").dataset.version).toBe("4"));
  expect(view.getByTestId("report").textContent).toContain("추가된 문단 1");
  fireEvent.click(view.getByTestId("report-updated"));
  expect(view.queryByTestId("report-updated")).toBeNull();
  fireEvent.click(view.getByTestId("report-history"));
  const versions = within(view.getByTestId("report-versions")).getAllByRole("button");
  expect(versions.map((each) => each.querySelector(".report-version-n")?.textContent)).toEqual(["v4", "v3", "v2", "v1"]);
  fireEvent.click(versions[3]);
  await waitFor(() => expect(view.getByTestId("report-older").textContent).toContain("이전 버전 v1을 보는 중"));
  expect(window.location.hash).toBe(`#/reports/${REPORT_IDS.long}?v=1`);
  expect(view.getByTestId("report").textContent).not.toContain("가상 기기 디스크 사용");
  fireEvent.click(within(view.getByTestId("report-older")).getByRole("button", { name: "최신 보기" }));
  await waitFor(() => expect(view.queryByTestId("report-older")).toBeNull());
});

test("a work card's detail shows the same card for the report that belongs to it", async () => {
  const { view } = await open("#/cards/k-101", true);
  const box = await waitFor(() => view.getByTestId("card-reports"));
  await waitFor(() => expect(within(box).getByTestId("report-card").textContent).toContain("가상 릴리스 변경 정리 · 중간 보고"));
});

test("on a phone the card opens a sheet at half height over the chat; its close returns to the chat", async () => {
  const { view } = await open("#/talk/ag-1", false);
  const card = await waitFor(() => view.getAllByTestId("report-card")[0]);
  fireEvent.click(card);
  const sheet = await waitFor(() => view.getByTestId("detail-frame"));
  expect(sheet.classList.contains("is-report")).toBe(true);
  expect(sheet.dataset.height).toBe("half");
  await waitFor(() => expect(within(sheet).getByRole("heading", { level: 1 }).textContent).toBe("가상 릴리스 변경 정리 · 중간 보고"));
  expect(within(sheet).queryByTestId("report-close")).toBeNull();
  fireEvent.dblClick(view.getByTestId("report-sheet-bar"));
  expect(view.getByTestId("detail-frame").dataset.height).toBe("full");
  fireEvent.click(view.getByTestId("frame-close"));
  await waitFor(() => expect(view.queryByTestId("detail-frame")).toBeNull());
  expect(window.location.hash).toBe("#/talk/ag-1");
});
