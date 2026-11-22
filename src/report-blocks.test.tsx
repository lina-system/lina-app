import { render, waitFor } from "@testing-library/preact";
import { beforeEach, expect, test, vi } from "vitest";
import { parseBlock } from "./report/blocks";
import { ReportBody } from "./report/body";

// lina-app#83: charts, diagrams, callouts and folds drawn from the report body; a block that does not parse shows its
// source and one line saying why, never nothing. Mermaid itself draws in a browser only: here it stands in at its
// module boundary, and the test holds what the viewer asks of it and does with its answer.

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: mermaid }));

beforeEach(() => {
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
});

function body(text: string) {
  return render(<ReportBody reportId="rep_5e1f0a7c2b90" body={text} imageUrl={(n) => `/i/${n}`} />);
}

const TABLE = ["| 기기 | 사용 | 남음 |", "| --- | ---: | ---: |", "| 가-1 | 412 | 88 |", "| 가-2 | 1,230 | 270 |"];

test("a chart reads its kind, title and series from the info string and the table", () => {
  expect(parseBlock("lina:chart bar 디스크 사용", TABLE)).toEqual({ kind: "chart", data: { kind: "bar", title: "디스크 사용", labels: ["가-1", "가-2"], series: [{ name: "사용", values: [412, 1230] }, { name: "남음", values: [88, 270] }] } });
  expect(parseBlock("lina:chart", ["type: line", "title: 추이", ...TABLE])).toMatchObject({ kind: "chart", data: { kind: "line", title: "추이" } });
  expect(parseBlock("lina:chart 제목만", TABLE)).toMatchObject({ kind: "chart", data: { kind: "bar", title: "제목만" } });
  expect(parseBlock("lina:chart share", ["| 종류 | 건수 |", "| --- | --- |", "| 가 | 18 |", "| 나 | 9 |"])).toMatchObject({ data: { kind: "donut" } });
  expect(parseBlock("lina:chart share", TABLE)).toMatchObject({ data: { kind: "stacked" } });
});

test("a chart that does not parse says why in one line", () => {
  expect(parseBlock("lina:chart bar", ["| 기기 | 사용 |", "| --- | --- |", "| 가 | 많음 |"])).toEqual({ kind: "broken", name: "차트", error: '숫자가 아닌 칸 "많음"' });
  expect(parseBlock("lina:chart", ["표 없음"])).toEqual({ kind: "broken", name: "차트", error: "표가 없음" });
  expect(parseBlock("lina:chart bar", ["| a | b | c | d | e | f |", "|---|---|---|---|---|---|", "| x | 1 | 2 | 3 | 4 | 5 |"])).toMatchObject({ kind: "broken", error: "계열이 5개: 4개까지 그림" });
  expect(parseBlock("lina:chart", ["type: pyramid", ...TABLE])).toMatchObject({ kind: "broken", error: '모르는 차트 종류 "pyramid"' });
});

test("plain code stays code; an unknown lina block, an empty diagram, a fold without a title and an unknown callout kind are broken", () => {
  expect(parseBlock("ts", ["const a = 1;"])).toBeNull();
  expect(parseBlock("", ["plain"])).toBeNull();
  expect(parseBlock("lina:map", ["x"])).toMatchObject({ kind: "broken", error: "모르는 블록 lina:map" });
  expect(parseBlock("mermaid", ["  "])).toMatchObject({ kind: "broken", error: "내용이 없음" });
  expect(parseBlock("lina:fold", ["본문"])).toMatchObject({ kind: "broken", error: "제목이 없음" });
  expect(parseBlock("lina:callout shout", ["본문"])).toMatchObject({ kind: "broken", error: '모르는 상자 종류 "shout"' });
});

test("a broken block shows its source and one error line, and the text after it still shows", () => {
  const view = body(["```lina:chart bar", "| 기기 | 사용 |", "| --- | --- |", "| 가 | 많음 |", "```", "", "뒤의 문단"].join("\n"));
  const broken = view.getByTestId("report-block-broken");
  expect(broken.querySelector(".report-block-error")?.textContent).toBe('차트 블록을 그리지 못함: 숫자가 아닌 칸 "많음"');
  expect(broken.querySelector("pre")?.textContent).toBe("```lina:chart bar\n| 기기 | 사용 |\n| --- | --- |\n| 가 | 많음 |\n```");
  expect(view.getByText("뒤의 문단")).toBeTruthy();
});

test("a chart draws its series; one row of values is a stat row, not a chart", () => {
  const view = body(["```lina:chart bar 사용", ...TABLE, "```", "", "```lina:chart 합계", "| 항목 | 값 |", "| --- | --- |", "| 변경 | 42 |", "```"].join("\n"));
  const chart = view.container.querySelector('.chart[data-kind="bar"]');
  expect(chart?.querySelectorAll("rect.chart-mark")).toHaveLength(4);
  expect(chart?.querySelector("svg")?.getAttribute("aria-label")).toBe("사용: 막대 차트: 가-1 412/88, 가-2 1,230/270");
  const stat = view.container.querySelector('.chart[data-kind="stat"]');
  expect(stat?.querySelector("dt")?.textContent).toBe("변경");
  expect(stat?.querySelector("dd")?.textContent).toBe("42");
});

test("a callout written inside a fold stays inside it, and the fold's closed line carries its mark", () => {
  const view = body(["````lina:fold 확인 기록", "안의 문단", "", "```lina:callout decision 정할 것", "넣을지 정해 주세요.", "```", "````", "", "```lina:callout", "조용한 참고", "```"].join("\n"));
  const fold = view.container.querySelector("details.report-fold");
  expect(fold?.hasAttribute("open")).toBe(false);
  expect(fold?.querySelector("summary")?.textContent).toBe("확인 기록안에 결정 필요");
  const inside = fold?.querySelector('.report-callout[data-tone="decision"]');
  expect(inside?.textContent).toContain("넣을지 정해 주세요.");
  const outside = [...view.container.querySelectorAll(".report-callout")].filter((box) => !fold?.contains(box));
  expect(outside.map((box) => box.getAttribute("data-tone"))).toEqual(["note"]);
});

test("a diagram is drawn by Mermaid at securityLevel strict in the app's colours, inside its zoom box", async () => {
  mermaid.render.mockResolvedValue({ svg: '<svg viewBox="0 0 1200 300"><g class="node"></g></svg>' });
  const view = body(["```mermaid", "flowchart LR", "  A --> B", "```"].join("\n"));
  await waitFor(() => expect(view.container.querySelector(".report-diagram-svg svg")).not.toBeNull());
  const config = mermaid.initialize.mock.calls[0][0];
  expect(config).toMatchObject({ startOnLoad: false, securityLevel: "strict", theme: "base" });
  expect(Object.keys(config.themeVariables)).toEqual(expect.arrayContaining(["primaryColor", "primaryTextColor", "lineColor", "background"]));
  expect(mermaid.render.mock.calls[0][1]).toBe("flowchart LR\n  A --> B");
  expect(view.getByRole("button", { name: "확대" })).toBeTruthy();
});

test("a diagram Mermaid refuses shows its source and the first line of the reason", async () => {
  mermaid.render.mockRejectedValue(new Error("Parse error on line 2:\n...A --> \n----^"));
  const view = body(["```mermaid", "flowchart LR", "  A --> ", "```"].join("\n"));
  await waitFor(() => expect(view.queryByTestId("report-block-broken")).not.toBeNull());
  const broken = view.getByTestId("report-block-broken");
  expect(broken.querySelector(".report-block-error")?.textContent).toBe("다이어그램 블록을 그리지 못함: Parse error on line 2:");
  expect(broken.querySelector("pre")?.textContent).toBe("flowchart LR\n  A --> ");
});
