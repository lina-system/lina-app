import { act, fireEvent, render, waitFor, within } from "@testing-library/preact";
import { render as renderPreact } from "preact";
import { useEffect, useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RouteName, RunnerCell, WorkCardSummary } from "./api/client";
import { App } from "./app";
import { AGENT_REPLY_DELTAS, STREAM_TICK_MS, SYNTHETIC_REPLY_AFTER, SyntheticSource, TALK_FRAME_MS, TALK_REPLY_DELTAS } from "./data/synthetic-source";
import type { ReadResult, Source } from "./data/source";
import { BACKOFF_MAX_MS } from "./data/live";
import { Store } from "./data/store";
import { SCENE_COUNTS, SYNTHETIC_OWNER } from "./fixtures/synthetic";
import { buildModel } from "./model";
import { containsText } from "./text-match";
import { TOAST_MS } from "./ui/actions";
import { BANNED_WORDS } from "./words";

const SCREENS = [
  "#/",
  "#/inbox",
  "#/running",
  "#/due",
  "#/done",
  "#/agents/ag-1",
  "#/agents/ag-2",
  "#/agents/ag-3",
  "#/goals",
  "#/goals/G2",
  "#/goals/G4",
  "#/items/T2",
  "#/items/T4",
  "#/cards/k-101",
  "#/cards/k-103",
  "#/runs/r6",
  "#/status",
  "#/today",
  "#/talk",
  "#/talk/ag-1",
] as const;

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function open(hash: string, options: { wide: boolean; source?: Source }) {
  setWide(options.wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const source = options.source ?? new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("실시간"));
  if (/^#\/(goals|items|cards|runs)\//.test(hash)) {
    await waitFor(() => expect(view.container.querySelector("article.detail")).not.toBeNull());
    // A card opens on its list row and fills in when its detail answers.
    await waitFor(() => expect(view.container.querySelector("[data-testid=detail-loading]")).toBeNull());
  }
  return view;
}

function screenText(root: Element): string {
  const version = root.querySelector("[data-testid=version]");
  const texts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!version?.contains(node)) texts.push(node.textContent ?? "");
  }
  const labels = [...root.querySelectorAll("[aria-label]")].map((element) => element.getAttribute("aria-label"));
  return [...texts, ...labels].join("\n");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// The shared term table, written out here so a change to src/words.ts cannot widen it unnoticed.
const STATES = ["예정", "진행 중", "대기", "중단됨", "완료"];
const REASONS = ["결정 필요", "피드백", "검토 필요", "보류", "진행 대기", "응답 없음", "실패", "결과 누락"];
// Latin words the term table allows on screen: the app name, CPU and the services' display names.
const LATIN_WORDS = ["LINA", "CPU", "Claude", "ChatGPT", "Gemini", "Grok", "Cursor"];
const STATE_LINE = new RegExp(`^(?:${STATES.join("|")})(?: · (?:${REASONS.join("|")}))?$`);

describe.each([
  ["1280", true],
  ["390", false],
])("at %s", (_width, wide) => {
  test.each(SCREENS)("%s shows only the five states and their reason words", async (hash) => {
    const view = await open(hash, { wide });
    const labels = [...view.container.querySelectorAll("[data-testid=state]")].map((element) => element.textContent ?? "");
    for (const label of labels) expect(label).toMatch(STATE_LINE);
    expect(screenText(view.container)).not.toMatch(/\b(?:planned|in_progress|waiting|stopped|done|unresponsive|no_response|blocked_by_item|result_missing|review|decision|feedback|hold|failed|rejected|cancelled|gate|budget)\b/);
  });

  test.each(SCREENS)("%s shows no ids, paths, numbers of record, tool names or banned words", async (hash) => {
    const view = await open(hash, { wide });
    const text = screenText(view.container);
    expect(text).not.toMatch(/\b[GT]\d+\b/);
    expect(text).not.toMatch(/\bt_\w+|\bOT-\w+|\b(?:ag|kg|k|acct|check)-\w+|\br\d+\b/);
    expect(text).not.toMatch(/#\d+/);
    expect(text).not.toMatch(/(?:^|[\s(])\/[\w.-]+\/[\w./-]*/);
    expect(text).not.toMatch(/\b[0-9a-f]{7,40}\b/);
    expect(text).not.toMatch(/\b(?:ulw|research|mass|omo|quick-issue|lina-worker|kanban|worker|session)\b/i);
    expect(text).not.toMatch(/\b\d+\s*(?:h|m|s|min)\b|\d+시간(?![째 전후])/);
    for (const word of BANNED_WORDS) expect(text).not.toContain(word);
    const scene = new SyntheticSource().scene;
    // Data the screen shows may be Latin: the agents' invented names, the model ids a run used (named as 설정 names
    // them) and the model and machine names usage lists.
    const modelIds = [...scene.runs.flatMap((run) => (run.model?.id ? [run.model.id] : [])), ...Object.values(scene.records).flatMap((record) => (record.model?.id ? [record.model.id] : []))];
    const names = new Set([...scene.items.agents.map((agent) => agent.name), ...modelIds, ...scene.usage.today.byModel.map((row) => row.model ?? ""), ...scene.usage.today.byMachine.map((row) => row.machine ?? "")]);
    const latinData = new Set([...names].flatMap((name) => name.match(/[A-Za-z]{2,}/g) ?? []));
    const latin = (text.match(/[A-Za-z]{2,}/g) ?? []).filter((word) => !latinData.has(word) && !LATIN_WORDS.includes(word));
    expect(latin).toEqual([]);
  });
});

// lina-app#125: every route, in the default scene and in `&runs=ended`, read as a person reads it. No phrase the owner's
// table rules out, no internal name (a runner, a rule, a machine id, the proxy, a revision, the owner's id), and no
// Latin word but the allowed ones and the names the data gives (agents, models, usage rows).
const SETTINGS_SCREENS = ["#/settings", "#/settings/default-runner", "#/settings/fallback", "#/settings/runner/omo", "#/settings/runner/codex", "#/settings/runner/codex/model", "#/settings/rule-new", "#/settings/models", "#/settings/history"];
const DENIED = [
  /\d+\s*(?:분|시간|일)째/,
  /끝남|끝난 것|작업 마침|소식이 끊김|오래됨|검토 반려/,
  /설정 r\d+/,
  /\bOCX\b/,
  /\b(?:omo|codex|dsh|quick|docs)\b/,
  /\b(?:machine|files|laptop|phone)-[a-z]\b/,
  /\b(?:owner|local)\b/,
  /(?:^|\n)카드(?: · |\n|$)/,
  /(?:^|\n| )나 확인 필요/,
];
const ALLOWED_LATIN = ["LINA", "CPU", "CLI", "Claude", "ChatGPT", "Gemini", "Grok", "Cursor"];

describe.each([
  ["default", false],
  ["&runs=ended", true],
])("in the %s scene", (_scene, endedRuns) => {
  const scene = new SyntheticSource({ endedRuns }).scene;
  const settings = scene.settings.revisions.at(-1);
  const device = Object.keys(settings?.devices?.workers ?? {})[0];
  const routes = [...SCREENS, "#/goals/G5", ...SETTINGS_SCREENS, `#/settings/device/${encodeURIComponent(device)}`];
  const dataNames = [
    ...scene.items.agents.map((agent) => agent.name),
    ...scene.settings.models.map((model) => model.name ?? model.id),
    ...scene.runs.flatMap((run) => (run.model?.id ? [run.model.id] : [])),
    ...Object.values(scene.records).flatMap((record) => (record.model?.id ? [record.model.id] : [])),
    ...scene.usage.today.byModel.map((row) => row.model ?? ""),
    ...scene.usage.today.byMachine.map((row) => row.machine ?? ""),
    ...Object.values(settings?.worker?.runners ?? {}).flatMap((runner) => [runner.model ?? "", runner.fallback_model ?? ""].map((value) => value.split("/").at(-1)?.split(":")[0] ?? "")),
  ];
  const latinData = new Set(dataNames.flatMap((name) => name.match(/[A-Za-z]{2,}/g) ?? []));

  test.each(routes.flatMap((route) => [[route, true] as const, [route, false] as const]))("%s (wide %s) reads only table words and no internal name", async (hash, wide) => {
    const view = await open(hash, { wide, source: new SyntheticSource({ now: Math.floor(Date.now() / 1000), endedRuns }) });
    if (hash.startsWith("#/settings")) await waitFor(() => expect(view.container.querySelector("[data-testid=screen-settings], [data-testid=setting-page]")).not.toBeNull());
    await waitFor(() => expect(view.container.textContent).not.toContain("불러오는 중"));
    const text = screenText(view.container);
    expect(DENIED.filter((pattern) => pattern.test(text)).map((pattern) => `${pattern} → ${text.match(pattern)?.[0]}`)).toEqual([]);
    expect(BANNED_WORDS.filter((word) => text.includes(word))).toEqual([]);
    const latin = (text.match(/[A-Za-z]{2,}/g) ?? []).filter((word) => !latinData.has(word) && !ALLOWED_LATIN.includes(word));
    expect([...new Set(latin)]).toEqual([]);
  });
});

function count(element: Element | null): number {
  return Number(element?.textContent ?? "0");
}

function stoppedRows(root: Element | null): number {
  return root ? root.querySelectorAll("[data-testid=row].is-stopped").length : 0;
}

function rowsIn(root: Element | null): number {
  return root ? root.querySelectorAll("[data-testid=row]").length : 0;
}

describe("machines, quota and checks", () => {
  test("each machine row reads name, state, the one reason word, three meters and its load", async () => {
    const view = await open("#/status", { wide: true });
    const rows = [...view.getByRole("list", { name: "기기" }).querySelectorAll(".row-body")].map((row) => row.getAttribute("aria-label"));
    expect(rows).toHaveLength(4);
    expect(rows.some((label) => /^\S+ · 정상 · CPU \d+% · 메모리 \d+% · 디스크 \d+% · 작업 \d+\/\d+$/.test(label ?? ""))).toBe(true);
    expect(rows.some((label) => /^\S+ · 경고 · 디스크 · CPU \d+% · 메모리 \d+% · 디스크 \d+% · 작업 \d+\/\d+$/.test(label ?? ""))).toBe(true);
    // An unreachable node reads 연결 끊김 and nothing else (lina-app#144).
    expect(rows.some((label) => /^\S+ · 꺼짐 · 연결 끊김$/.test(label ?? ""))).toBe(true);
    const down = view.container.querySelector(".machine-row.is-down") as HTMLElement;
    expect(down.querySelector(".mini-meters")).toBeNull();
    expect(down.querySelectorAll(".meter")).toHaveLength(0);
    expect(view.container.querySelectorAll(".machine-row.is-ok .meter")).toHaveLength(6);
  });

  test("each node shows its runners, and 내 기기 shows tools without buttons", async () => {
    const view = await open("#/status", { wide: true });
    const list = view.getByRole("list", { name: "기기" });
    const rows = [...list.querySelectorAll(".machine-row")];
    expect(rows).toHaveLength(4);
    expect(rows.slice(0, -1).every((row) => row.getAttribute("data-role") === "work")).toBe(true);
    expect(rows.at(-1)?.getAttribute("data-role")).toBe("files");
    expect(view.getByText("업데이트 필요")).toBeTruthy();
    expect(view.getByText("로그인 필요")).toBeTruthy();
    // The unreachable node lists no runners: its row says 연결 끊김 once (lina-app#144).
    expect(view.container.querySelectorAll(".machine-row.is-down [data-testid=runner-cell]")).toHaveLength(0);
    const filesCell = rows.at(-1)?.querySelector("[data-testid=runner-cell]") as HTMLElement;
    expect(filesCell.textContent).toContain("2.0");
    expect(within(filesCell).getByRole("img", { name: "로그인됨" })).toBeTruthy();
    expect(filesCell.textContent).not.toMatch(/업데이트 필요|준비 필요|로그인 필요|연결 끊김|확인 중/);
    const people = view.getByRole("list", { name: "내 기기" });
    expect(people.querySelectorAll(".person-row")).toHaveLength(2);
    expect(people.textContent).toContain("연결됨");
    expect(people.textContent).toContain("연결 끊김");
    expect(people.querySelector("button")).toBeNull();
    expect(view.getByTestId("section-machines").contains(people)).toBe(false);
  });

  test("a signed-out runner shows the sign-in button only when it has no reason of its own", async () => {
    const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
    const machine = source.scene.devices.machines.find((item) => item.role === "work" && item.state === "ok");
    const base = machine?.runners[0];
    expect(base).toBeTruthy();
    const cell = (name: string, why: NonNullable<typeof base>["why"]) => ({ ...base!, name, signIn: "signed_out" as const, signingIn: false, why, ready: false });
    machine!.runners = [cell("고침", "update"), cell("마련", "prepare"), cell("단절", "unreachable"), cell("빈칸", null)];
    const view = await open("#/status", { wide: true, source });
    const row = view.container.querySelector(".machine-row.is-ok[data-role=work]") as HTMLElement;
    const find = (name: string) => {
      const found = [...row.querySelectorAll("[data-testid=runner-cell]")].find((item) => item.querySelector(".runner-name")?.textContent === name) as HTMLElement;
      expect(found).toBeTruthy();
      return found;
    };
    for (const [name, reason] of [
      ["고침", "업데이트 필요"],
      ["마련", "준비 필요"],
      ["단절", "연결 끊김"],
    ] as const) {
      const node = find(name);
      expect(node.textContent).toContain(reason);
      expect(within(node).queryByRole("button", { name: "로그인" })).toBeNull();
    }
    const openCell = find("빈칸");
    expect(openCell.textContent).toContain("로그인 필요");
    expect(within(openCell).getByRole("button", { name: "로그인" })).toBeTruthy();
  });

  test("a runner the core reports ready shows its version and the mark, whatever its sign-in value", async () => {
    const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
    const [work, other] = source.scene.devices.machines.filter((item) => item.role === "work" && item.reachable);
    // The real hub's /api/lina/devices: omo and claude sign in through magpie, grok signed_in, dsh unknown, and an
    // omo that is not ready. magpie is outside the schema's enum, which is how the core serves it today.
    const real = (name: string, installed: string, signIn: string | null, ready: boolean | null, why: RunnerCell["why"] = null): RunnerCell =>
      ({ name, type: null, fleet: installed, installed, signIn: signIn as RunnerCell["signIn"], signingIn: false, ready, why });
    work.runners = [real("omo", "5.1.69", "magpie", true), real("claude", "2.1.4", "magpie", true), real("grok", "1.0.77", "signed_in", true), real("dsh", "0.9.2", "unknown", true)];
    other.runners = [real("omo", "5.1.60", "magpie", false, "update"), real("dsh", "0.9.2", "magpie", false)];
    const view = await open("#/status", { wide: true, source });
    const cellOf = (machine: string, name: string) => {
      const row = view.getByRole("group", { name: `${machine} 실행기` });
      return [...row.querySelectorAll("[data-testid=runner-cell]")].find((item) => item.querySelector(".runner-name")?.textContent === name) as HTMLElement;
    };
    for (const [name, version] of [["omo", "5.1.69"], ["claude", "2.1.4"], ["grok", "1.0.77"], ["dsh", "0.9.2"]]) {
      const cell = cellOf(work.name, name);
      expect(cell.textContent).toContain(version);
      expect(within(cell).getByRole("img", { name: "로그인됨" })).toBeTruthy();
      expect(cell.textContent).not.toContain("확인 중");
    }
    expect(cellOf(other.name, "omo").textContent).toBe("omo업데이트 필요");
    // Not ready with no reason of its own is not ready, never 확인 중.
    expect(cellOf(other.name, "dsh").textContent).toBe("dsh준비 필요");
  });

  test("the sign-in button reads 로그인 중 and then the signed-in mark", async () => {
    const view = await open("#/status", { wide: true });
    const before = view.getAllByRole("img", { name: "로그인됨" }).length;
    const button = view.getByRole("button", { name: "로그인" });
    const cell = button.closest("[data-testid=runner-cell]") as HTMLElement;
    fireEvent.click(button);
    await waitFor(() => expect(within(cell).getByText("로그인 중")).toBeTruthy());
    expect(within(cell).queryByRole("button")).toBeNull();
    await waitFor(() => expect(within(cell).getByRole("img", { name: "로그인됨" })).toBeTruthy());
    expect(view.queryByRole("button", { name: "로그인" })).toBeNull();
    expect(view.getAllByRole("img", { name: "로그인됨" })).toHaveLength(before + 1);
  });

  test("다시 시작 asks once, then restarts the worker and shows nothing new", async () => {
    const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
    const view = await open("#/status", { wide: true, source });
    const machine = source.scene.devices.machines.find((item) => item.role === "work" && item.state === "ok");
    expect(machine).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: `${machine?.name} 서비스 다시 시작` }));
    const dialog = view.getByRole("dialog", { name: "다시 시작" });
    expect(source.deviceWrites).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "작업 실행기" }));
    expect(source.deviceWrites).toEqual([]);
    fireEvent.click(view.getByRole("button", { name: "다시 시작" }));
    expect(source.deviceWrites).toEqual([{ device: machine?.name, action: "restart", service: "worker" }]);
    expect(view.queryByRole("dialog", { name: "다시 시작" })).toBeNull();
    expect(view.queryByTestId("write-error")).toBeNull();
  });

  test("a refused restart shows the core's line on the row", async () => {
    const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
    source.restartDevice = async () => ({ ok: false as const, status: 502, detail: "the node refused" });
    const view = await open("#/status", { wide: true, source });
    const machine = source.scene.devices.machines[0];
    fireEvent.click(view.getByRole("button", { name: `${machine.name} 서비스 다시 시작` }));
    fireEvent.click(view.getByRole("button", { name: "작업 실행기" }));
    fireEvent.click(view.getByRole("button", { name: "다시 시작" }));
    await waitFor(() => expect(view.getByTestId("write-error").textContent).toBe("기기가 거절함"));
    expect(view.queryByRole("dialog", { name: "다시 시작" })).toBeNull();
  });

  test("one quota row per service with its accounts folded under it, known services by their display names", async () => {
    const view = await open("#/status", { wide: true });
    const list = view.getByRole("list", { name: "쿼터" });
    const services = [...list.querySelectorAll(":scope > .quota-row")];
    expect(services.map((row) => row.querySelector("summary .title")?.textContent)).toEqual(["Claude", "ChatGPT", "가온셈"]);
    const labels = services.map((row) => row.querySelector("summary")?.getAttribute("aria-label") ?? "");
    expect(labels).toEqual(["Claude · 72% · 시간당 +1% · 3일 후 · 주의", "ChatGPT · 31% · 시간당 +1% · 2일 후", "가온셈 · 5% · 12일 후"]);
    expect(services.map((row) => row.querySelector("summary .sub")?.textContent)).toEqual(["72% · 시간당 +1% · 3일 후", "31% · 시간당 +1% · 2일 후", "5% · 12일 후"]);
    expect(services.map((row) => (row.querySelector("details") as HTMLDetailsElement).open)).toEqual([false, false, false]);
    expect(services.map((row) => row.querySelectorAll("[data-testid=account]").length)).toEqual([2, 1, 2]);
    // One convention, the service row's: the percent used, never "left".
    expect(services[0].querySelector("[data-testid=account]")?.getAttribute("aria-label")).toBe("계정 1 · 72% · 시간당 +1% · 3일 후 · 주의");
    expect(services[2].querySelector("[data-testid=account]")?.getAttribute("aria-label")).toBe("계정 1 · 5% · 12일 후");
    expect(services[0].querySelector(".rate")?.getAttribute("title")).toBe("최근 5시간 평균");
    expect(services.filter((row) => row.querySelector("summary .warn-mark"))).toHaveLength(1);
  });

  test("the third panel keeps failing and stale checks open and folds the passing ones", async () => {
    const view = await open("#/status", { wide: true });
    const list = view.getByRole("list", { name: "점검" });
    const rows = [...list.querySelectorAll(".status-check-row")];
    expect(rows.map((row) => row.querySelector(".row-body")?.getAttribute("aria-label"))).toEqual(["백업 회선 · 응답 없음 · 실패 · 12분 전", "대기 봇 · 연결 끊김 · 갱신 지연 · 3시간 전"]);
    expect(rows.map((row) => row.querySelector(".check-state")?.textContent)).toEqual(["실패", "갱신 지연"]);
    expect(rows.map((row) => row.className)).toEqual(["row status-check-row is-failing", "row status-check-row is-stale"]);
    // `check-row` is the to-do row with a check box: it indents past the box and lets the title size the row, so a
    // 점검 row must not carry it (the trail would no longer sit at the row's right edge).
    for (const row of rows) expect(row.classList.contains("check-row")).toBe(false);
    const fold = list.querySelectorAll(".status-check-fold");
    expect(fold).toHaveLength(1);
    expect(fold[0].textContent).toBe("정상 3");
    expect(view.queryByTestId("checks-empty")).toBeNull();
  });

  test("a checks read that failed says so and the panel reads 점검 없음", async () => {
    const view = await open("#/status", { wide: true, source: new SyntheticSource({ checksError: true }) });
    expect(view.getByTestId("checks-empty").textContent).toBe("점검 없음");
    expect(view.queryByRole("list", { name: "점검" })).toBeNull();
    await waitFor(() => expect(view.getByTestId("read-failed").textContent).toBe(" · 읽기 실패: 점검"));
    expect(view.getByRole("list", { name: "쿼터" })).toBeTruthy();
  });
});

describe("usage, OCX and the accounts' quota", () => {
  test("the 사용량 panel sits between 쿼터 and 점검 and reads today's totals and the costliest rows", async () => {
    const view = await open("#/status", { wide: true });
    const sections = [...view.getByTestId("screen-status").querySelectorAll(".list-section")].map((section) => section.getAttribute("data-testid"));
    expect(sections).toEqual(["section-machines", "section-person", "section-power", "section-quota", "section-usage", "section-checks"]);
    expect(view.getByTestId("usage-total").textContent).toBe("$3.42 · 토큰 1.2만");
    const rows = (name: string) => [...view.getByRole("list", { name }).querySelectorAll(".usage-row")].map((row) => row.textContent);
    expect(rows("모델별")).toEqual(["haru · $1.85 · 토큰 6,200", "saeol · $1.12 · 토큰 4,200", "moru · $0.45 · 토큰 2,080"]);
    // 기기별 names the machines exactly as the 기기 panel above it does.
    expect(rows("기기별")).toEqual(["모래톱 · $2.05 · 토큰 7,000", "솔방울 · $1.01 · 토큰 3,800", "물레방아 · $0.36 · 토큰 1,680"]);
    const controls = [...view.container.querySelectorAll(".usage-range .choice")].map((button) => [button.textContent, button.getAttribute("aria-pressed")]);
    expect(controls).toEqual([["오늘", "true"], ["7일", "false"], ["30일", "false"]]);
  });

  test("the range control reads that range's own route: 7일, then 30일, then back to 오늘", async () => {
    const view = await open("#/status", { wide: true });
    fireEvent.click(view.getByRole("button", { name: "7일" }));
    expect(view.getByTestId("usage-total").textContent).toBe("$18.40 · 토큰 8.6만");
    const rows = (name: string) => [...view.getByRole("list", { name }).querySelectorAll(".usage-row")].map((row) => row.textContent);
    expect(rows("기기별")).toEqual(["모래톱 · $11.20 · 토큰 4.9만", "솔방울 · $5.40 · 토큰 2.6만", "물레방아 · $1.80 · 토큰 1.1만"]);
    fireEvent.click(view.getByRole("button", { name: "30일" }));
    expect(view.getByTestId("usage-total").textContent).toBe("$63.10 · 토큰 42만");
    expect(rows("모델별")).toEqual(["haru · $34.20 · 토큰 19만", "saeol · $19.90 · 토큰 14.8만", "moru · $9.00 · 토큰 8.2만"]);
    fireEvent.click(view.getByRole("button", { name: "오늘" }));
    expect(view.getByTestId("usage-total").textContent).toBe("$3.42 · 토큰 1.2만");
  });

  test("a service with no account and the model proxy are rows in the quota list, not lines under it", async () => {
    const view = await open("#/status", { wide: true });
    const list = view.getByRole("list", { name: "쿼터" });
    const rows = [...list.querySelectorAll(":scope > li")].map((row) => row.querySelector(".row-body")?.getAttribute("aria-label") ?? row.querySelector("summary")?.getAttribute("aria-label"));
    expect(rows).toEqual(["Claude · 72% · 시간당 +1% · 3일 후 · 주의", "ChatGPT · 31% · 시간당 +1% · 2일 후", "가온셈 · 5% · 12일 후", "Cursor · 계정 없음", "모델 3개 켜짐 · 연결 끊김: 물레방아"]);
    // Every one of them is a row of the list, with the row look: a title line and a 44 px minimum height.
    for (const row of list.querySelectorAll(":scope > li")) expect(row.querySelector(".title")).not.toBeNull();
    expect(view.getByTestId("quota-missing").textContent).toBe("Cursor · 계정 없음");
    expect(view.getByTestId("ocx-line").textContent).toBe("모델 3개 켜짐 · 연결 끊김: 물레방아");
  });

  test("an account that needs signing in again reads only that, with no rate, reset or bar; a paused one keeps its reset", async () => {
    const view = await open("#/status", { wide: true });
    const accounts = [...view.getByRole("list", { name: "쿼터" }).querySelectorAll("[data-testid=account]")];
    const labels = accounts.map((row) => row.getAttribute("aria-label"));
    expect(labels).toContain("계정 2 · 다시 로그인 필요");
    expect(labels).toContain("계정 2 · 일시 중지 · 26일 후");
    const reauth = accounts.find((row) => row.getAttribute("aria-label") === "계정 2 · 다시 로그인 필요") as HTMLElement;
    expect(reauth.querySelector(".sub .warn-mark")?.textContent).toBe("다시 로그인 필요");
    expect(reauth.querySelector(".meter")).toBeNull();
    expect(reauth.textContent).not.toMatch(/시간당|후$/);
    const paused = accounts.find((row) => row.getAttribute("aria-label") === "계정 2 · 일시 중지 · 26일 후") as HTMLElement;
    expect(paused.textContent).toContain("일시 중지");
    expect(paused.textContent).toContain("26일 후");
    expect(paused.textContent).not.toContain("시간당");
  });

  test("the quota list does not draw at all when the quota read failed, and usage still does", async () => {
    const view = await open("#/status", { wide: true, source: new SyntheticSource({ sourceError: true }) });
    expect(view.queryByRole("list", { name: "쿼터" })).toBeNull();
    await waitFor(() => expect(view.getByTestId("read-failed").textContent).toContain("읽기 실패: 쿼터"));
    expect(view.getByTestId("usage-total").textContent).toBe("$3.42 · 토큰 1.2만");
  });

  test("the model proxy's row, never named, names the machine whose link is down, and leaves links out when all are fine", async () => {
    const view = await open("#/status", { wide: true });
    expect(view.getByTestId("ocx-line").textContent).toBe("모델 3개 켜짐 · 연결 끊김: 물레방아");
    view.unmount();
    const base = new SyntheticSource().scene;
    const allOk = { ...base, modelsState: { ...base.modelsState, machines: base.modelsState.machines.map((link) => ({ ...link, ok: true, state: "connected" })) } };
    const other = await open("#/status", { wide: true, source: new SyntheticSource({ scene: allOk }) });
    expect(other.getByTestId("ocx-line").textContent).toBe("모델 3개 켜짐");
  });
});

describe("the power card (lina-app#82)", () => {
  const stations = (view: ReturnType<typeof render>) => [...view.getByTestId("section-power").querySelectorAll("[data-testid=power-station]")];
  const labelOf = (row: Element) => row.querySelector(".row-body")?.getAttribute("aria-label");

  test("one card reads each station's level, in and out, temperature and charge, the hub's line and the alerts", async () => {
    const view = await open("#/status", { wide: true });
    expect(view.getAllByTestId("section-power")).toHaveLength(1);
    expect(view.getByTestId("power-head").textContent).toBe("갱신 방금");
    expect(stations(view).map(labelOf)).toEqual(["큰 축전지 · 87% · 입력 0W · 출력 64W · 41°C · 배터리 사용 · 3시간 후 방전", "작은 축전지 · 100% · 입력 12W · 출력 4W · 30°C · 완충 · 20분 전", "보조 충전기 · 연결 끊김"]);
    expect(stations(view).map((row) => row.className)).toEqual(["row power-row is-warn", "row power-row is-ok is-stale", "row power-row is-down"]);
    // A value older than 15 minutes keeps its numbers and shows its age; a fresh one shows none.
    expect(stations(view)[1].querySelector(".trail")?.textContent).toBe("20분 전");
    expect(stations(view)[0].querySelector(".trail")).toBeNull();
    expect(labelOf(view.getByTestId("power-hub"))).toBe("허브 · 벽 전원 끊김 · 배터리 95% · 핫스팟");
    expect(view.getByTestId("power-alerts").textContent).toBe("경고: 정전 · 큰 축전지 온도");
    expect(view.getByTestId("section-power").querySelector("button, input, select, textarea, a")).toBeNull();
  });

  test("a stopped watch dims every row and the hub's line, each with its age and its numbers kept", async () => {
    const view = await open("#/status", { wide: true, source: new SyntheticSource({ now: Math.floor(Date.now() / 1000), power: "stopped" }) });
    expect(view.getByTestId("power-head").textContent).toBe("감시 끊김 · 25분 전");
    expect(stations(view).every((row) => row.classList.contains("is-stale"))).toBe(true);
    expect(stations(view).map((row) => row.querySelector(".trail")?.textContent)).toEqual(["25분 전", "45분 전", "33분 전"]);
    expect(labelOf(stations(view)[0])).toBe("큰 축전지 · 87% · 입력 0W · 출력 64W · 41°C · 배터리 사용 · 3시간 후 방전 · 25분 전");
    expect(view.getByTestId("power-hub").classList.contains("is-stale")).toBe(true);
  });

  test("a failed cloud read says so with its age; a station with no known age reads — instead of a time", async () => {
    const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
    const power = source.scene.devices.power!;
    Object.assign(power, { state: "stale", why: "cloud", age: 5 * 60, alerts: ["watch:cloud", "offline:ps-3", "watch:mqtt:ps-1", "fan:ps-2"] });
    power.stations = power.stations.map((station) => ({ ...station, stale: true, age: station.key === "ps-1" ? null : station.age }));
    const view = await open("#/status", { wide: true, source });
    expect(view.getByTestId("power-head").textContent).toBe("클라우드 읽기 실패 · 5분 전");
    expect(stations(view)[0].querySelector(".trail")?.textContent).toBe("—");
    expect(view.getByTestId("power-alerts").textContent).toBe("경고: 클라우드 읽기 실패 · 보조 충전기 연결 끊김 · 큰 축전지 실시간 연결 끊김 · 기타 경고");
  });

  test("a missing record draws no numbers, never zeros", async () => {
    const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
    Object.assign(source.scene.devices, { power: { state: "missing", at: null, age: null, why: null, alerts: [], stations: [], hub: null } });
    const view = await open("#/status", { wide: true, source });
    expect(view.getByTestId("power-head").textContent).toBe("전원 기록 없음");
    expect(view.getByTestId("section-power").textContent).not.toMatch(/\d/);
    expect(view.queryByTestId("power-station")).toBeNull();
    expect(view.queryByTestId("power-alerts")).toBeNull();
  });

  test("no power section, no card", async () => {
    const view = await open("#/status", { wide: true, source: new SyntheticSource({ now: Math.floor(Date.now() / 1000), power: "none" }) });
    expect(view.queryByTestId("section-power")).toBeNull();
    expect(view.getByRole("list", { name: "기기" }).querySelectorAll(".machine-row")).toHaveLength(4);
  });
});

describe("every count equals the length of the list it labels", () => {
  test("sidebar rows and their screens", async () => {
    const pairs: [string, string][] = [
      ["nav-inbox", "#/inbox"],
      ["nav-running", "#/running"],
      ["nav-due", "#/due"],
      ["nav-done", "#/done"],
      ["nav-goals", "#/goals"],
    ];
    for (const [nav, hash] of pairs) {
      const view = await open(hash, { wide: true });
      const shown = count(view.getByTestId(nav).querySelector("[data-testid=nav-count]"));
      const red = count(view.getByTestId(nav).querySelector("[data-testid=nav-stopped]"));
      // The home lists the running cards and the stopped ones in their own lists; waiting and finished cards follow.
      const list = nav === "nav-running" ? view.container.querySelector('.list-pane [aria-label="진행 중인 작업"]') : view.container.querySelector(".list-pane .list");
      const stopped = nav === "nav-running" ? view.container.querySelector('.list-pane [aria-label="중단됨"]') : list;
      expect(shown).toBeGreaterThan(0);
      expect(red).toBe(stoppedRows(stopped));
      expect(rowsIn(list) - stoppedRows(list)).toBe(shown);
      view.unmount();
    }
  });

  test("agent rows count their running cards, hidden at 0", async () => {
    for (const index of [0, 1, 2]) {
      const view = await open(`#/agents/ag-${index + 1}`, { wide: true });
      const nav = view.getByTestId(`nav-agent-${index}`);
      const running = view.queryByTestId("section-running");
      expect(rowsIn(running) - stoppedRows(running)).toBe(count(nav.querySelector("[data-testid=nav-count]")));
      expect(stoppedRows(running)).toBe(count(nav.querySelector("[data-testid=nav-stopped]")));
      for (const id of ["running", "review", "goals"]) {
        const head = view.getByTestId(`agent-count-${id}`);
        const section = view.queryByTestId(`section-${id}`);
        expect(rowsIn(section) - stoppedRows(section)).toBe(count(head.querySelector(".count")));
        expect(stoppedRows(section)).toBe(count(head.querySelector("[data-testid=stopped-count]")));
      }
      view.unmount();
    }
  });

  test("group headers count their rows", async () => {
    for (const hash of ["#/inbox", "#/due", "#/agents/ag-2"]) {
      const view = await open(hash, { wide: true });
      const sections = view.container.querySelectorAll(".list-pane [data-testid^=section-]");
      expect(sections.length).toBeGreaterThan(0);
      for (const section of sections) {
        const head = section.querySelector("[data-testid=count]");
        if (!head) continue;
        expect(rowsIn(section) - stoppedRows(section)).toBe(count(head));
        expect(stoppedRows(section)).toBe(count(section.querySelector("[data-testid=stopped-count]")));
      }
      view.unmount();
    }
  });

  test("the device line counts machine rows and the bell counts unread notices", async () => {
    const view = await open("#/status", { wide: true });
    const line = view.getByTestId("device-line").textContent ?? "";
    expect(line).toBe("기기 4 · 정상 2 · 경고 1 · 꺼짐 1");
    const [all, ok, warn, down] = (line.match(/\d+/g) ?? []).map(Number);
    expect(ok + warn + down).toBe(all);
    const machines = view.getByTestId("section-machines");
    expect(rowsIn(machines)).toBe(all);
    expect(machines.querySelectorAll(".machine-row.is-ok").length).toBe(ok);
    expect(machines.querySelectorAll(".machine-row.is-warn").length).toBe(warn);
    expect(machines.querySelectorAll(".machine-row.is-down").length).toBe(down);
    const bell = count(view.getByTestId("bell-count"));
    fireEvent.click(view.getByTestId("bell"));
    const notices = view.getByTestId("notices");
    expect(rowsIn(notices)).toBe(SCENE_COUNTS.notices);
    expect(notices.querySelectorAll("[data-testid=row]:not(.is-read)").length).toBe(bell);
    expect(within(notices).getByTestId("unread-count").textContent).toBe(`안 읽음 ${bell}`);
    expect(bell).toBe(SCENE_COUNTS.unread);
  });
});

/** The synthetic scene with some reads failing; its writes are the synthetic source's own. */
class FailingSource extends SyntheticSource {
  constructor(
    private readonly failing: (name: RouteName) => "offline" | "failed" | null,
    options: ConstructorParameters<typeof SyntheticSource>[0] = {},
  ) {
    super(options);
  }
  override async read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<import("./api/client").Routes[N]>> {
    const failure = this.failing(name);
    if (failure) return { kind: "failed", offline: failure === "offline", at: Date.now() / 1000 };
    return super.read(name, id);
  }
}

describe("freshness", () => {
  beforeEach(() => setWide(true));

  test("a failed route shows its error line and the rest still draws", async () => {
    const view = await open("#/inbox", { wide: true, source: new FailingSource((name) => (name === "devices" ? "failed" : null)) });
    await waitFor(() => expect(view.getByTestId("read-failed").textContent).toBe(" · 읽기 실패: 기기"));
    expect(rowsIn(view.getByTestId("screen-inbox"))).toBe(SCENE_COUNTS.inbox);
  });

  test("a source listed in errors[] shows 읽기 실패 with its word", async () => {
    const view = await open("#/inbox", { wide: true, source: new SyntheticSource({ sourceError: true }) });
    expect(view.getByTestId("read-failed").textContent).toBe(" · 읽기 실패: 쿼터");
  });

  test("an unreachable core reads 연결 끊김", async () => {
    setWide(true);
    window.history.replaceState(null, "", "/app/#/inbox");
    const view = render(<App store={new Store(new FailingSource(() => "offline"))} />);
    await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("연결 끊김"));
  });

  test("with the stream open the line reads 실시간; down, it reads 갱신 지연 until a reconnect", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SyntheticSource();
      const view = await open("#/inbox", { wide: true, source });
      source.setStreamDown(true);
      await act(async () => source.dropStreams());
      expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS * 2);
      });
      expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연");
      source.setStreamDown(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
      });
      expect(view.getByTestId("freshness-line").textContent).toBe("실시간");
    } finally {
      vi.useRealTimers();
    }
  });

  test("a stream that never opens reads 갱신 지연, not 실시간", async () => {
    setWide(true);
    window.history.replaceState(null, "", "/app/#/inbox");
    const view = render(<App store={new Store(new SyntheticSource({ live: "down" }))} />);
    await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연"));
    expect(rowsIn(view.getByTestId("screen-inbox"))).toBe(SCENE_COUNTS.inbox);
  });
});

describe("phone navigation", () => {
  test("a row pushes the next screen and back names the screen it returns to; a detail rises as a sheet over its list", async () => {
    const view = await open("#/", { wide: false });
    fireEvent.click(view.getByRole("button", { name: "메뉴" }));
    expect(within(view.getByTestId("sidebar")).getByText("수신함")).toBeTruthy();
    fireEvent.click(view.getByTestId("nav-running").querySelector("a") as HTMLElement);
    await waitFor(() => expect(view.getByTestId("screen-title").textContent).toBe("작업"));
    expect(window.location.hash).toBe("#/running");
    expect(view.getByTestId("back").textContent).toBe("작업");
    const row = view.getByTestId("screen-running").querySelector("[data-testid=row] a") as HTMLElement;
    fireEvent.click(row);
    await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] :is([data-testid=screen-card], [data-testid=screen-run])")).not.toBeNull());
    // The list it came from stays under the sheet with its own title and back (lina-app#142).
    expect(view.getByTestId("detail-frame").getAttribute("data-frame")).toBe("sheet");
    expect(view.getByTestId("screen-title").textContent).toBe("작업");
    // While the sheet is open, back reads the screen it returns to: the list under it, by the one name 작업 (lina-app#148).
    expect(view.getByTestId("back").textContent).toBe("작업");
    expect((window.history.state as { stack: string[] }).stack).toEqual(["#/", "#/running", window.location.hash]);
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    });
    await waitFor(() => expect(view.queryByTestId("detail-frame")).toBeNull());
    expect(view.getByTestId("screen-title").textContent).toBe("작업");
  });
});

describe("wide split view", () => {
  test.each(["#/inbox", "#/running", "#/due", "#/done", "#/goals"])("%s with nothing selected folds the detail pane", async (hash) => {
    const view = await open(hash, { wide: true });
    expect(view.getByTestId("panes").classList.contains("is-folded")).toBe(true);
    expect(view.queryByTestId("detail-pane")).toBeNull();
  });

  test("opening a row brings the detail pane back", async () => {
    const view = await open("#/running", { wide: true });
    fireEvent.click(view.getByTestId("screen-running").querySelector("[data-testid=row] a") as HTMLElement);
    await waitFor(() => expect(view.getByTestId("detail-pane")).toBeTruthy());
    expect(view.getByTestId("panes").classList.contains("is-folded")).toBe(false);
  });
});

describe("decisions", () => {
  test("each 결정 필요 row opens the record it is aimed at, and that record shows the decision", async () => {
    const inbox = await open("#/inbox", { wide: true });
    const list = inbox.getByRole("list", { name: "결정 필요" });
    // A press opens the record in the detail frame at once (lina-app#142): each row is a link to it.
    const rows = [...list.querySelectorAll(":scope > li")].map((row) => ({
      href: row.querySelector(":scope > a")?.getAttribute("href") ?? "",
      text: row.querySelector(":scope > a .title")?.textContent ?? "",
      context: row.querySelector(":scope > a .context")?.textContent ?? "",
    }));
    inbox.unmount();
    expect(rows.filter((row) => /^#\/(items|goals)\//.test(row.href)).length).toBeGreaterThanOrEqual(1);
    expect(rows.filter((row) => row.href.startsWith("#/cards/")).length).toBe(1);
    expect(rows.every((row) => /^#\/(items|goals|cards)\//.test(row.href))).toBe(true);
    for (const row of rows) {
      const view = await open(row.href, { wide: true });
      await waitFor(() => expect(view.getByTestId("decision").textContent).toContain(row.text));
      // A card with no checked title has no title in its head, and its question names only its goal.
      const title = view.container.querySelector(".detail-title")?.textContent ?? "";
      expect(title ? row.context === title || row.context.endsWith(` › ${title}`) : !row.context.includes(" › ")).toBe(true);
      if (row.href.startsWith("#/cards/")) expect(view.container.querySelector(".detail .box")?.getAttribute("data-testid")).toBe("decision");
      view.unmount();
    }
  });
});

describe("counts", () => {
  test("the sidebar, section headings and the agent head draw counts with one component", async () => {
    const view = await open("#/agents/ag-2", { wide: true });
    const counts = [...view.container.querySelectorAll("[data-testid=nav-count], [data-testid=nav-stopped], [data-testid=count], [data-testid=stopped-count], .agent-counts .count")];
    expect(counts.length).toBeGreaterThan(0);
    for (const element of counts) expect(element.closest(".count-pair")).not.toBeNull();
    expect(view.getByTestId("agent-counts").querySelectorAll(".count-pair .is-stopped-count")).toHaveLength(1);
  });
});

class RefusingSource extends SyntheticSource {
  sent: string[] = [];
  override async comment(id: string, body: { text: string }) {
    this.sent.push(`${id}:${body.text}`);
    return { ok: false as const, status: 409, detail: "no open decision" };
  }
}

describe("comments", () => {
  test("a sent comment shows at once with its pending line, then the record's copy, then the agent's reply", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      const source = new SyntheticSource();
      const agent = source.scene.items.agents.find((person) => person.id === source.scene.itemDetails.T4.agent)?.name;
      const view = await open("#/items/T4", { wide: true, source });
      const field = view.getByRole("textbox", { name: "댓글 달기" }) as HTMLInputElement;
      const send = within(view.getByTestId("comments")).getByRole("button", { name: "보내기" }) as HTMLButtonElement;
      expect(send.disabled).toBe(true);
      field.value = "가로 폭도 봐 주세요";
      fireEvent.input(field);
      expect(send.disabled).toBe(false);
      fireEvent.submit(field.form as HTMLFormElement);
      expect(view.getByTestId("comment-pending").textContent).toBe(`${agent}에게 보냄 · 방금`);
      expect((within(view.getByTestId("comments")).getByRole("button", { name: "보내기" }) as HTMLButtonElement).disabled).toBe(true);
      expect(field.value).toBe("");
      await waitFor(() => expect(source.scene.itemDetails.T4.comments.at(-1)?.text).toBe("가로 폭도 봐 주세요"));
      await waitFor(() => expect(view.getAllByTestId("comment-pending")).toHaveLength(1));
      expect(SYNTHETIC_REPLY_AFTER).toBeLessThan(10);
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      await waitFor(() => expect(view.queryByTestId("comment-pending")).toBeNull());
      expect(view.getAllByTestId("reply").at(-1)?.querySelector(".sub")?.textContent).toMatch(/ · 반영함$/);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a refused comment comes back into the field with the core's line under it", async () => {
    const source = new RefusingSource();
    const view = await open("#/items/T4", { wide: true, source });
    const field = view.getByRole("textbox", { name: "댓글 달기" }) as HTMLInputElement;
    field.value = "다시";
    fireEvent.input(field);
    fireEvent.submit(field.form as HTMLFormElement);
    await waitFor(() => expect(view.getByTestId("write-error").textContent).toBe("no open decision"));
    expect(source.sent).toEqual(["T4:다시"]);
    expect(field.value).toBe("다시");
    expect(view.queryByTestId("comment-pending")).toBeNull();
    expect(view.getAllByTestId("comment")).toHaveLength(2);
  });

  test("a resolved thread folds to one line with its first words", async () => {
    const view = await open("#/items/T4", { wide: true });
    const resolved = view.getByTestId("resolved") as HTMLDetailsElement;
    expect(resolved.open).toBe(false);
    expect(resolved.querySelector("summary")?.textContent).toBe("해결됨 · 오류가 나면 입력한 값은…");
  });
});

/** The synthetic source with every write recorded; `refuse` makes chosen writes answer 409. */
class SpySource extends SyntheticSource {
  calls: string[] = [];
  refuse = new Set<string>();
  private async spy<T>(name: string, args: unknown[], run: () => Promise<T>): Promise<T> {
    this.calls.push(`${name} ${JSON.stringify(args)}`);
    if (this.refuse.has(name)) return { ok: false, status: 409, detail: "refused" } as T;
    return run();
  }
  override comment(...args: Parameters<SyntheticSource["comment"]>) {
    return this.spy("comment", args, () => super.comment(...args));
  }
  override done(...args: Parameters<SyntheticSource["done"]>) {
    return this.spy("done", args, () => super.done(...args));
  }
  override undo(...args: Parameters<SyntheticSource["undo"]>) {
    return this.spy("undo", args, () => super.undo(...args));
  }
  override retry(...args: Parameters<SyntheticSource["retry"]>) {
    return this.spy("retry", args, () => super.retry(...args));
  }
  override answerCard(...args: Parameters<SyntheticSource["answerCard"]>) {
    return this.spy("answerCard", args, () => super.answerCard(...args));
  }
}

const TIMERS: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] };

/** A 결정 필요 row in 수신함: a link that opens its record in the detail frame (lina-app#142). */
function decisionButton(view: ReturnType<typeof render>, text: string): HTMLElement {
  return view.getByRole("link", { name: containsText(text) });
}

describe("answers", () => {
  test("a choice hides the row at once and is sent only when the toast ends", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/inbox", { wide: true, source });
      const row = decisionButton(view, "배포를 금요일 오후에 할지 결정 필요");
      fireEvent.click(row);
      // The decision opens in the frame at once, with its answers there.
      await waitFor(() => expect(view.getByTestId("detail-frame").querySelector("[data-testid=decision]")?.textContent).toContain("배포를 금요일 오후에 할지 결정 필요"));
      await waitFor(() => expect(view.getByRole("button", { name: "금요일 오후 · 추천" })).toBeTruthy());
      expect(view.getByRole("button", { name: "월요일 오전" })).toBeTruthy();
      fireEvent.click(view.getByRole("button", { name: "금요일 오후 · 추천" }));
      expect(view.getByTestId("toast").textContent).toBe("답함되돌리기");
      expect(view.queryByRole("link", { name: /배포를 금요일/ })).toBeNull();
      expect(view.getByTestId("detail-frame").querySelector("[data-testid=decision]")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS - 100);
      });
      expect(source.calls).toEqual([]);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      await waitFor(() => expect(source.calls).toEqual(['comment ["T2",{"text":"금요일 오후","answer":true}]']));
      expect(view.queryByTestId("toast")).toBeNull();
      expect(view.queryByRole("link", { name: /배포를 금요일/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("되돌리기 in the toast brings the row back and sends nothing", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/inbox", { wide: true, source });
      fireEvent.click(decisionButton(view, "자주 쓰는 검색어 열 개"));
      const field = (await waitFor(() => view.getByRole("textbox", { name: "답 달기" }))) as HTMLInputElement;
      field.value = "결제, 환불, 배송";
      fireEvent.input(field);
      fireEvent.submit(field.form as HTMLFormElement);
      expect(view.queryByRole("link", { name: /자주 쓰는 검색어/ })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "되돌리기" }));
      expect(view.getByRole("link", { name: /자주 쓰는 검색어/ })).toBeTruthy();
      expect(view.getByTestId("detail-frame").querySelector("[data-testid=decision]")?.textContent).toContain("자주 쓰는 검색어");
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS * 2);
      });
      expect(source.calls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a card question is answered on the work card route; a refused answer returns with its line", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/inbox", { wide: true, source });
      fireEvent.click(decisionButton(view, "카드 번호를 앞 여섯 자리까지"));
      const field = (await waitFor(() => view.getByRole("textbox", { name: "답 달기" }))) as HTMLInputElement;
      field.value = "네";
      fireEvent.input(field);
      fireEvent.submit(field.form as HTMLFormElement);
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS);
      });
      await waitFor(() => expect(source.calls).toEqual(['answerCard ["k-102",{"text":"네"}]']));
      await waitFor(() => expect(view.queryByRole("link", { name: /카드 번호를/ })).toBeNull());

      source.refuse.add("comment");
      fireEvent.click(decisionButton(view, "복구 연습에 쓸 두 시간"));
      await waitFor(() => expect(view.getByTestId("detail-frame").querySelector("[data-testid=decision]")?.textContent).toContain("복구 연습에 쓸 두 시간"));
      const act2 = view.getByRole("textbox", { name: "답 달기" }) as HTMLInputElement;
      act2.value = "목요일 오후";
      fireEvent.input(act2);
      fireEvent.submit(act2.form as HTMLFormElement);
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS);
      });
      await waitFor(() => expect(view.getByTestId("write-error").textContent).toBe("열린 결정 없음"));
      expect((view.getByRole("textbox", { name: "답 달기" }) as HTMLInputElement).value).toBe("목요일 오후");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("done marks", () => {
  test("a tap strikes the row and sends done at once; 되돌리기 in the toast calls undo", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/goals/G2", { wide: true, source });
      const box = view.getByRole("checkbox", { name: "결제 실패 화면 검토 완료로 표시" });
      expect(box.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(box);
      expect(source.calls).toEqual(['done ["T6",{}]']);
      const done = view.getByRole("checkbox", { name: "결제 실패 화면 검토 완료됨" });
      expect(done.getAttribute("aria-checked")).toBe("true");
      expect(done.closest("li")?.classList.contains("is-checked")).toBe(true);
      expect(view.getByTestId("toast").textContent).toBe("완료로 표시함되돌리기");
      await waitFor(() => expect(source.scene.itemDetails.T6.state).toBe("done"));
      fireEvent.click(view.getByRole("button", { name: "되돌리기" }));
      await waitFor(() => expect(source.calls).toEqual(['done ["T6",{}]', 'undo ["T6"]']));
      await waitFor(() => expect(view.getByRole("checkbox", { name: "결제 실패 화면 검토 완료로 표시" }).getAttribute("aria-checked")).toBe("false"));
      expect(source.scene.itemDetails.T6.state).toBe("waiting");
    } finally {
      vi.useRealTimers();
    }
  });

  test("after the toast the to-do page offers 되돌리기 until the undo window closes", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const page = await open("#/items/T3", { wide: true, source });
      const view = within(page.getByTestId("detail-pane"));
      fireEvent.click(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }));
      await waitFor(() => expect(source.scene.itemDetails.T3.state).toBe("done"));
      expect(page.container.querySelector(".head-undo")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS);
      });
      await waitFor(() => expect(page.container.querySelector(".head-undo")?.textContent).toBe("되돌리기"));
      await act(async () => {
        vi.advanceTimersByTime(600_000);
      });
      expect(page.container.querySelector(".head-undo")).toBeNull();
      expect(view.getByRole("checkbox", { name: "공지 문구 확인 완료됨" }).getAttribute("aria-disabled")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  test("a goal with open to-dos asks once, then sends withOpen; one undo reopens all", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const page = await open("#/goals/G1", { wide: true, source });
      const view = within(page.getByTestId("detail-pane"));
      fireEvent.click(view.getByRole("checkbox", { name: "릴리스 노트 정리 완료로 표시" }));
      expect(source.calls).toEqual([]);
      expect(view.getByTestId("with-open").textContent).toContain("열린 할 일 3개도 함께 완료할까요?");
      fireEvent.click(view.getByRole("button", { name: "취소" }));
      expect(view.queryByTestId("with-open")).toBeNull();
      fireEvent.click(view.getByRole("checkbox", { name: "릴리스 노트 정리 완료로 표시" }));
      fireEvent.click(view.getByRole("button", { name: "함께 완료" }));
      expect(source.calls).toEqual(['done ["G1",{"withOpen":true}]']);
      expect(view.getAllByRole("checkbox", { checked: true })).toHaveLength(4);
      await waitFor(() => expect(source.scene.itemDetails.T3.state).toBe("done"));
      fireEvent.click(within(page.getByTestId("toast")).getByRole("button", { name: "되돌리기" }));
      await waitFor(() => expect(source.calls.at(-1)).toBe('undo ["G1"]'));
      await waitFor(() => expect(view.queryAllByRole("checkbox", { checked: true })).toHaveLength(0));
      expect(["G1", "T1", "T2", "T3"].map((id) => source.scene.itemDetails[id].state)).toEqual(["in_progress", "in_progress", "waiting", "planned"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a refused done reverts the row and shows the known line under it", async () => {
    const source = new SpySource();
    source.refuse.add("done");
    const view = await open("#/inbox", { wide: true, source });
    fireEvent.click(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }));
    await waitFor(() => expect(view.getByTestId("write-error").textContent).toBe("열린 할 일 있음"));
    expect(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }).getAttribute("aria-checked")).toBe("false");
    expect(view.queryByTestId("toast")).toBeNull();
  });
});

describe("retry", () => {
  test("다시 시도 on a stopped card asks its to-do's agent and says so for as long as a toast", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/running", { wide: true, source });
      const buttons = view.getAllByRole("button", { name: /다시 시도$/ });
      expect(buttons).toHaveLength(1);
      fireEvent.click(buttons[0]);
      // The board does not list the worker runs a card started (as the core), so the card's to-do is not known and
      // 다시 시도 asks the card itself.
      await waitFor(() => expect(source.calls).toEqual(['answerCard ["k-103",{"text":"다시 시도해 주세요."}]']));
      await waitFor(() => expect(view.getByTestId("retry-requested").textContent).toMatch(/^\S+에게 요청함$/));
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      await waitFor(() => expect(view.queryByTestId("retry-requested")).toBeNull());
      expect(view.getAllByRole("button", { name: /다시 시도$/ })).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("bell", () => {
  test("a notice chosen on a wide 대화 with no agent opens its record in the detail frame, and back returns to the bare 대화 (lina-app#142)", async () => {
    const view = await open("#/talk", { wide: true });
    expect(view.getByTestId("pick-agent")).toBeTruthy();
    fireEvent.click(view.getByTestId("bell"));
    const dialog = view.getByRole("dialog", { name: "알림" });
    const first = within(dialog).getAllByRole("link")[0];
    const target = first.getAttribute("href");
    fireEvent.click(first);
    expect(window.location.hash).toBe(target);
    await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] article.detail")).not.toBeNull());
    expect(view.getByTestId("pick-agent")).toBeTruthy();
    fireEvent.click(view.getByTestId("back"));
    await waitFor(() => expect(window.location.hash).toBe("#/talk"));
    expect(view.container.querySelector("[data-testid=detail-frame]")).toBeNull();
  });

  test("choosing a notice opens its item and marks it read on the core; 모두 읽음 marks all", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const source = new SpySource();
    const reads: unknown[] = [];
    const readNotices = source.readNotices.bind(source);
    source.readNotices = async (body) => {
      reads.push(body);
      return readNotices(body);
    };
    const view = await open("#/inbox", { wide: true, source });
    expect(view.getByRole("button", { name: "알림 5" })).toBeTruthy();
    fireEvent.click(view.getByTestId("bell"));
    const dialog = view.getByRole("dialog", { name: "알림" });
    expect(dialog.querySelectorAll(".is-read")).toHaveLength(2);
    expect(within(dialog).getByTestId("unread-count").textContent).toBe("안 읽음 5");
    const first = within(dialog).getAllByRole("link")[0];
    const target = first.getAttribute("href");
    fireEvent.click(first);
    expect(window.location.hash).toBe(target);
    expect(view.getByRole("button", { name: "알림 4" })).toBeTruthy();
    await waitFor(() => expect(source.scene.board.notices.filter((notice) => !notice.read)).toHaveLength(4));
    fireEvent.click(view.getByTestId("bell"));
    const again = view.getByRole("dialog", { name: "알림" });
    expect(again.querySelectorAll("[data-testid=row]:not(.is-read)")).toHaveLength(4);
    expect(within(again).getByTestId("unread-count").textContent).toBe("안 읽음 4");
    fireEvent.click(view.getByRole("button", { name: "닫기" }));
    expect(reads).toEqual([{ keys: [source.scene.board.notices[0].key] }]);
    fireEvent.click(view.getByTestId("bell"));
    fireEvent.click(view.getByRole("button", { name: "모두 읽음" }));
    expect(view.getByRole("button", { name: "알림" })).toBeTruthy();
    expect(view.queryByTestId("bell-count")).toBeNull();
    await waitFor(() => expect(source.scene.board.counts.unread).toBe(0));
    expect(reads.at(-1)).toEqual({ all: true });
    expect(view.getByRole("dialog", { name: "알림" }).querySelectorAll("[data-testid=row]:not(.is-read)")).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "닫기" }));
    expect(view.queryByTestId("notices")).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  test("a read on one device is the count on the other within 2 s, both ways", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const core = new SyntheticSource();
      const desktopStore = new Store(new SyntheticSource({ scene: core.scene }));
      await desktopStore.refresh();
      expect(buildModelCount(desktopStore)).toBe(5);
      const phone = await open("#/inbox", { wide: false, source: core });
      expect(phone.getByRole("button", { name: "알림 5" })).toBeTruthy();
      const key = core.scene.board.notices.find((notice) => !notice.read)?.key ?? "";
      expect(await desktopStore.write((source) => source.readNotices({ keys: [key] }))).toMatchObject({ ok: true });
      expect(buildModelCount(desktopStore)).toBe(4);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      await waitFor(() => expect(phone.getByRole("button", { name: "알림 4" })).toBeTruthy());
      fireEvent.click(phone.getByTestId("bell"));
      fireEvent.click(phone.getByRole("button", { name: "모두 읽음" }));
      await waitFor(() => expect(core.scene.board.counts.unread).toBe(0));
      await desktopStore.refresh();
      expect(buildModelCount(desktopStore)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a refused read mark puts the notice back as unread with its line", async () => {
    const source = new SpySource();
    source.readNotices = async () => ({ ok: false, status: 429, detail: "too many writes" });
    const view = await open("#/inbox", { wide: true, source });
    fireEvent.click(view.getByTestId("bell"));
    fireEvent.click(view.getByRole("button", { name: "모두 읽음" }));
    await waitFor(() => expect(view.getByTestId("write-error").textContent).toBe("쓰기가 너무 많음"));
    expect(view.getByRole("button", { name: "알림 5" })).toBeTruthy();
  });
});

function buildModelCount(store: Store): number {
  return buildModel(store.input(), Date.now() / 1000).counts.unread;
}

function inboxCounts(view: ReturnType<typeof render>) {
  const sidebar = Number(view.getByTestId("nav-inbox").querySelector("[data-testid=nav-count]")?.textContent ?? "0");
  const heads: Record<string, number> = {};
  for (const id of ["decide", "mine"]) heads[id] = Number(view.queryByTestId(`head-${id}`)?.querySelector("[data-testid=count]")?.textContent ?? "0");
  const rows = view.container.querySelectorAll(".list-pane [data-testid=screen-inbox] [data-testid=row]").length;
  return { sidebar, decide: heads.decide, mine: heads.mine, rows };
}

describe("lists while a write is in flight", () => {
  test("a ticked 내 할 일 row stays, struck and checked, for the toast; then it leaves and every count follows", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/inbox", { wide: true, source });
      fireEvent.click(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }));
      await waitFor(() => expect(source.scene.itemDetails.T3.state).toBe("done"));
      await waitFor(() => expect(source.scene.board.inbox.mine.map((row) => row.id)).toEqual(["T9"]));
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      const box = view.getByRole("checkbox", { name: "공지 문구 확인 완료됨" });
      expect(box.getAttribute("aria-checked")).toBe("true");
      expect(box.closest("li")?.classList.contains("is-checked")).toBe(true);
      expect(inboxCounts(view)).toEqual({ sidebar: 7, decide: 4, mine: 2, rows: 7 });
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS);
      });
      // The screens draw the record once the write's own read has landed.
      await waitFor(() => expect(view.queryByRole("checkbox", { name: /^공지 문구 확인/ })).toBeNull());
      expect(inboxCounts(view)).toEqual({ sidebar: 6, decide: 4, mine: 1, rows: 6 });
    } finally {
      vi.useRealTimers();
    }
  });

  test("되돌리기 on a held row puts it back unchecked", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SpySource();
      const view = await open("#/inbox", { wide: true, source });
      fireEvent.click(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }));
      await waitFor(() => expect(source.scene.itemDetails.T3.state).toBe("done"));
      fireEvent.click(within(view.getByTestId("toast")).getByRole("button", { name: "되돌리기" }));
      await waitFor(() => expect(source.scene.itemDetails.T3.state).toBe("planned"));
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS * 2);
      });
      expect(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }).getAttribute("aria-checked")).toBe("false");
      expect(inboxCounts(view)).toEqual({ sidebar: 7, decide: 4, mine: 2, rows: 7 });
    } finally {
      vi.useRealTimers();
    }
  });

  test("a row hidden for its answer's toast is out of every count, and undo puts it back", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const view = await open("#/inbox", { wide: true, source: new SpySource() });
      fireEvent.click(decisionButton(view, "배포를 금요일 오후에 할지 결정 필요"));
      await waitFor(() => expect(view.getByRole("button", { name: "금요일 오후 · 추천" })).toBeTruthy());
      fireEvent.click(view.getByRole("button", { name: "금요일 오후 · 추천" }));
      expect(inboxCounts(view)).toEqual({ sidebar: 6, decide: 3, mine: 2, rows: 6 });
      fireEvent.click(within(view.getByTestId("toast")).getByRole("button", { name: "되돌리기" }));
      expect(inboxCounts(view)).toEqual({ sidebar: 7, decide: 4, mine: 2, rows: 7 });
    } finally {
      vi.useRealTimers();
    }
  });

  test("with no running card the 진행 중 group is its head alone, 0: the stopped one is under 중단됨 with one number, with 다시 시도", async () => {
    const view = await open("#/running", { wide: true, source: new SyntheticSource({ noRunning: true }) });
    expect(view.queryByText("없음")).toBeNull();
    // Something is stopped, so 진행 중 0 says the tab is alive (lina-app#148); it has no rows.
    expect(view.getByTestId("head-active").textContent).toBe("진행 중0");
    expect(view.getByTestId("section-active").querySelectorAll("[data-testid=row]")).toHaveLength(0);
    expect(view.queryByRole("list", { name: "진행 중인 작업" })).toBeNull();
    const head = view.getByTestId("head-stopped");
    expect(head.querySelector("span")?.textContent).toBe("중단됨");
    expect(head.querySelector("[data-testid=count]")).toBeNull();
    expect(head.querySelector("[data-testid=stopped-count]")?.textContent).toBe("1");
    const rows = view.getByRole("list", { name: "중단됨" }).querySelectorAll("[data-testid=row]");
    expect(rows).toHaveLength(1);
    expect(rows[0].classList.contains("is-stopped")).toBe(true);
    expect(view.getByRole("button", { name: /다시 시도$/ })).toBeTruthy();
    expect(view.getByTestId("nav-running").querySelector("[data-testid=nav-stopped]")?.textContent).toBe("1");
  });
});

describe("tabs", () => {
  test("대화 · 작업 · 상태 sit at the top on both widths; each opens its own screens and sidebar", async () => {
    for (const wide of [true, false]) {
      for (const [hash, tab] of [["#/talk", "talk"], ["#/", "work"], ["#/status", "status"]] as const) {
        const view = await open(hash, { wide });
        const tabs = view.getByTestId("tabs");
        expect([...tabs.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
          ["대화", "#/talk"],
          ["작업", "#/"],
          ["상태", "#/status"],
        ]);
        expect(tabs.querySelector("[aria-current=page]")?.getAttribute("data-testid")).toBe(`tab-${tab}`);
        if (!wide) expect(view.queryByTestId("back")).toBeNull();
        if (tab === "talk") expect(view.container.querySelectorAll(wide ? "[data-testid^=nav-talk-]" : "[data-testid^=talk-agent-]")).toHaveLength(3);
        if (tab === "work") {
          // On a phone the first screen is the lines; the menu opens from the header (lina-app#124).
          if (!wide) fireEvent.click(view.getByRole("button", { name: "메뉴" }));
          const rows = [...view.getByTestId("sidebar").querySelectorAll("li[data-testid^=nav-]")].map((row) => row.getAttribute("data-testid"));
          expect(rows.slice(0, 5)).toEqual(["nav-today", "nav-inbox", "nav-running", "nav-due", "nav-done"]);
          expect(rows).not.toContain("nav-status");
        }
        if (tab === "status") {
          expect(view.getByTestId("screen-status")).toBeTruthy();
          expect(view.getByTestId("nav-settings")).toBeTruthy();
        }
        view.unmount();
      }
    }
  });

  test("choosing a tab opens its first screen", async () => {
    const view = await open("#/inbox", { wide: true });
    fireEvent.click(view.getByTestId("tab-talk"));
    await waitFor(() => expect(view.getByTestId("pick-agent")).toBeTruthy());
    expect(window.location.hash).toBe("#/talk");
    fireEvent.click(view.getByTestId("tab-status"));
    await waitFor(() => expect(view.getByTestId("screen-status")).toBeTruthy());
    expect(window.location.hash).toBe("#/status");
  });

  test("오늘 under 작업 reads the counts of the lists it links to", async () => {
    const view = await open("#/today", { wide: true });
    const screen = view.getByTestId("screen-today");
    expect(within(screen).getByTestId("today-decide").querySelector("a")?.getAttribute("href")).toBe("#/inbox");
    expect(within(screen).getByTestId("today-running").textContent).toBe(`진행 중 ${count(view.getByTestId("nav-running").querySelector("[data-testid=nav-count]"))} · 중단됨 ${count(view.getByTestId("nav-running").querySelector("[data-testid=nav-stopped]"))}`);
    expect(within(screen).getByTestId("today-decide").textContent).toMatch(/^결정 필요 [1-9]/);
  });
});

describe("agent talk", () => {
  function parts(view: ReturnType<typeof render>) {
    const box = within(view.getByTestId("agent-talk"));
    return { box, field: box.getByRole("textbox", { name: "메시지" }) as HTMLInputElement, send: box.getByRole("button", { name: "보내기" }) as HTMLButtonElement };
  }

  test("choosing an agent shows its earlier turns in the middle and its goals on the right; a sent message streams the reply and is kept", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SyntheticSource();
      const view = await open("#/talk/ag-1", { wide: true, source });
      const { box, field, send } = parts(view);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(box.getByTestId("agent-talk-name").textContent).toBe(source.scene.items.agents[0].name);
      expect(box.getAllByTestId("talk-mine").map((line) => line.textContent)).toEqual(["어디까지 왔어요?"]);
      expect(box.getAllByTestId("talk-reply")).toHaveLength(1);
      const card = view.getByTestId("card-pane");
      const goals = [...card.querySelectorAll("[data-testid=section-goals] [data-testid=row] .title")].map((title) => title.textContent);
      expect(goals).toContain("릴리스 노트 정리");
      expect(goals).not.toContain("결제 화면 개편");
      field.value = "오늘 어디까지 했어요?";
      fireEvent.input(field);
      fireEvent.keyDown(field, { key: "Enter" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TALK_FRAME_MS * 4);
      });
      expect(box.getAllByTestId("talk-mine").at(-1)?.textContent).toBe("오늘 어디까지 했어요?");
      expect(box.getByTestId("talk-live")).toBeTruthy();
      expect(send.disabled).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TALK_FRAME_MS * 10);
      });
      expect(box.getAllByTestId("talk-reply").at(-1)?.querySelector(".talk-bubble")?.textContent).toBe(AGENT_REPLY_DELTAS.join(""));
      expect(box.queryByTestId("talk-live")).toBeNull();
      expect(source.agentTalks.get("ag-1")?.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
      expect(source.agentTalks.get("ag-1")?.[2].content).toBe("[LINA app]\n오늘 어디까지 했어요?");
    } finally {
      vi.useRealTimers();
    }
  });

  test("on a phone the card sits folded above a window with no turns yet, and opens to the goals", async () => {
    const view = await open("#/talk/ag-2", { wide: false });
    await waitFor(() => expect(view.getByTestId("no-turns").textContent).toBe("아직 나눈 대화 없음"));
    expect(view.getByTestId("back").textContent).toBe("대화");
    // The phone's window has a screen title like every other screen: the agent's name.
    expect(view.getAllByTestId("screen-title").map((title) => title.textContent)).toEqual([view.getByTestId("agent-talk-name").textContent]);
    const card = view.getByTestId("agent-card");
    expect(card.querySelector("[data-testid=section-goals]")).toBeNull();
    fireEvent.click(within(card).getByRole("button"));
    await waitFor(() => expect(card.querySelector("[data-testid=section-goals]")).not.toBeNull());
    expect([...card.querySelectorAll("[data-testid=section-goals] [data-testid=row] .title")].map((title) => title.textContent)).toContain("결제 화면 개편");
  });

  test("a goal chosen on the card opens in the one detail frame in the right column under 대화, beside the window, and back returns to the card (lina-app#142, #143)", async () => {
    const view = await open("#/talk", { wide: true });
    fireEvent.click(view.getByTestId("nav-talk-0").querySelector("a") as HTMLElement);
    await waitFor(() => expect(view.getByTestId("card-pane")).toBeTruthy());
    const title = view.getByTestId("screen-title").textContent;
    fireEvent.click(view.getByTestId("card-pane").querySelector("[data-testid=section-goals] [data-testid=row] a") as HTMLElement);
    await waitFor(() => expect(view.getByTestId("card-pane").querySelector("article.detail")).not.toBeNull());
    expect(window.location.hash).toBe("#/talk/ag-1?goal=G1");
    // The same frame every detail opens in (lina-app#142); the header and the window stay.
    expect(view.getByTestId("card-pane").querySelector("[data-testid=detail-frame]")?.getAttribute("data-frame")).toBe("panel");
    expect(view.container.querySelector("[data-testid=screen-goals]")).toBeNull();
    expect(view.getByTestId("screen-title").textContent).toBe(title);
    expect(view.getByTestId("tabs").querySelector("[aria-current=page]")?.getAttribute("data-testid")).toBe("tab-talk");
    expect(view.getByTestId("agent-talk")).toBeTruthy();
    expect(view.getByTestId("card-pane").querySelector(".detail-title")?.textContent).toBe("릴리스 노트 정리");
    const back = within(view.getByTestId("card-pane")).getByTestId("back");
    expect(back.textContent).toBe("에이전트");
    fireEvent.click(back);
    await waitFor(() => expect(window.location.hash).toBe("#/talk/ag-1"));
    await waitFor(() => expect(view.getByTestId("agent-card")).toBeTruthy());
  });

  test("on a phone a goal chosen on the folded card opens one step deeper under 대화, and back reads the agent (lina-app#143)", async () => {
    const source = new SyntheticSource();
    const view = await open("#/talk/ag-1", { wide: false, source });
    const card = view.getByTestId("agent-card");
    fireEvent.click(within(card).getByRole("button"));
    await waitFor(() => expect(card.querySelector("[data-testid=section-goals]")).not.toBeNull());
    fireEvent.click(card.querySelector("[data-testid=section-goals] [data-testid=row] a") as HTMLElement);
    await waitFor(() => expect(view.container.querySelector("article.detail")).not.toBeNull());
    expect(window.location.hash).toBe("#/talk/ag-1?goal=G1");
    expect(view.getByTestId("back").textContent).toBe(source.scene.items.agents[0].name);
    expect(view.queryByTestId("agent-talk")).toBeNull();
    // It rises as the phone's one detail frame, over the card it was chosen on (lina-app#142).
    expect(view.getByTestId("detail-frame").getAttribute("data-frame")).toBe("sheet");
    expect(within(view.getByTestId("detail-frame")).getByTestId("screen-goal")).toBeTruthy();
    fireEvent.click(view.getByTestId("back"));
    await waitFor(() => expect(window.location.hash).toBe("#/talk/ag-1"));
    await waitFor(() => expect(view.getByTestId("agent-talk")).toBeTruthy());
  });

  test("each agent row shows the first line of its last message, or one plain line when there is none (lina-app#143)", async () => {
    class Multiline extends SyntheticSource {
      override async agentTalkHistory(agent: string) {
        const result = await super.agentTalkHistory(agent);
        if (agent !== "ag-3" || result.kind !== "data") return result;
        return { ...result, data: { ...result.data, messages: [{ role: "user" as const, content: "[LINA app] web\n배포 전에 확인\n둘째 줄", timestamp: 1 }] } };
      }
    }
    for (const wide of [true, false]) {
      const view = await open("#/talk", { wide, source: new Multiline() });
      const row = (index: number) => view.getByTestId(wide ? `nav-talk-${index}` : `talk-agent-${index}`);
      await waitFor(() => expect(row(0).querySelector("[data-testid=talk-preview]")?.textContent).toBe("변경 목록을 모으는 중이에요. 배포 순서는 답을 기다려요."));
      await waitFor(() => expect(row(1).querySelector("[data-testid=talk-preview]")?.textContent).toBe("아직 나눈 대화 없음"));
      await waitFor(() => expect(row(2).querySelector("[data-testid=talk-preview]")?.textContent).toBe("배포 전에 확인"));
      view.unmount();
    }
  });

  test("on a phone each agent row shows its stopped count with the same red marker as the wide sidebar (lina-app#143)", async () => {
    const wide = await open("#/talk", { wide: true });
    const marker = (root: Element) => [...root.querySelectorAll(".count.is-stopped-count")].map((count) => [count.textContent, count.getAttribute("aria-label")]);
    const sidebar = [0, 1, 2].map((index) => marker(wide.getByTestId(`nav-talk-${index}`)));
    expect(sidebar.flat()).toContainEqual(["1", "중단됨 1"]);
    wide.unmount();
    const phone = await open("#/talk", { wide: false });
    expect([0, 1, 2].map((index) => marker(phone.getByTestId(`talk-agent-${index}`)))).toEqual(sidebar);
  });

  test("every number on the agent's card has its word, and red marks only 중단됨 (lina-app#143)", async () => {
    const view = await open("#/talk/ag-2", { wide: true });
    const counts = view.getByTestId("agent-card-counts");
    expect(counts.textContent).toBe("진행 중 1 · 중단됨 1 · 검토 필요 1 · 목표 2");
    // No number stands alone: each one follows its word inside the same part.
    for (const part of counts.querySelectorAll("[data-testid=agent-count]")) expect(part.textContent).toMatch(/^[가-힣 ]+ \d+$/);
    expect([...counts.querySelectorAll(".is-red")].map((red) => red.textContent)).toEqual(["중단됨 1"]);
  });

  test("a message sent before the earlier turns arrive shows once, even when they already hold it", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      let release = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      class SlowHistory extends SyntheticSource {
        override async agentTalkHistory(agent: string) {
          await gate;
          return super.agentTalkHistory(agent);
        }
      }
      const source = new SlowHistory();
      const view = await open("#/talk/ag-2", { wide: true, source });
      const { box, field } = parts(view);
      field.value = "오늘 어디까지 했어요?";
      fireEvent.input(field);
      fireEvent.keyDown(field, { key: "Enter" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TALK_FRAME_MS * 12);
      });
      release();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TALK_FRAME_MS * 12);
      });
      expect(box.getAllByTestId("talk-mine").map((line) => line.textContent)).toEqual(["오늘 어디까지 했어요?"]);
      expect(box.getAllByTestId("talk-reply").map((line) => line.querySelector(".talk-bubble")?.textContent)).toEqual([AGENT_REPLY_DELTAS.join("")]);
    } finally {
      vi.useRealTimers();
    }
  });

  async function leaveAndReturn(view: ReturnType<typeof render>, message: string) {
    const { field } = parts(view);
    const first = view.getByTestId("agent-talk-name").textContent;
    field.value = message;
    fireEvent.input(field);
    fireEvent.keyDown(field, { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TALK_FRAME_MS);
    });
    fireEvent.click(view.getByTestId("nav-talk-1").querySelector("a") as HTMLElement);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(view.getByTestId("agent-talk-name").textContent).not.toBe(first);
    fireEvent.click(view.getByTestId("nav-talk-0").querySelector("a") as HTMLElement);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(view.getByTestId("agent-talk-name").textContent).toBe(first);
    return within(view.getByTestId("agent-talk"));
  }

  test("a message sent just before choosing another agent stays in its window, and the reply joins it there", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SyntheticSource();
      const view = await open("#/talk/ag-1", { wide: true, source });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const box = await leaveAndReturn(view, "오늘 어디까지 했어요?");
      expect(box.getAllByTestId("talk-mine").map((line) => line.textContent)).toEqual(["어디까지 왔어요?", "오늘 어디까지 했어요?"]);
      expect(box.getByTestId("talk-live")).toBeTruthy();
      expect(parts(view).send.disabled).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TALK_FRAME_MS * 10);
      });
      expect(box.getAllByTestId("talk-mine").map((line) => line.textContent)).toEqual(["어디까지 왔어요?", "오늘 어디까지 했어요?"]);
      expect(box.getAllByTestId("talk-reply").at(-1)?.querySelector(".talk-bubble")?.textContent).toBe(AGENT_REPLY_DELTAS.join(""));
      expect(box.queryByTestId("talk-live")).toBeNull();
      expect(source.agentTalks.get("ag-1")?.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
      // Once the reply is kept, opening the window again reads it back once.
      fireEvent.click(view.getByTestId("nav-talk-1").querySelector("a") as HTMLElement);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(view.getByTestId("nav-talk-0").querySelector("a") as HTMLElement);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const again = within(view.getByTestId("agent-talk"));
      expect(again.getAllByTestId("talk-mine").map((line) => line.textContent)).toEqual(["어디까지 왔어요?", "오늘 어디까지 했어요?"]);
      expect(again.getAllByTestId("talk-reply")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("reopening a chat while its reply completes shows each exchange once, whichever of the history read and the completion comes first", async () => {
    const reply = AGENT_REPLY_DELTAS.join("");
    for (const order of ["history after the completion", "history holds the whole turn before the completion"] as const) {
      vi.useFakeTimers(TIMERS);
      try {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        class Overlap extends SyntheticSource {
          reads = 0;
          override async agentTalkHistory(agent: string) {
            const result = await super.agentTalkHistory(agent);
            if (agent !== "ag-1" || ++this.reads < 2 || result.kind !== "data") return result;
            if (order === "history after the completion") {
              await gate;
              return await super.agentTalkHistory(agent);
            }
            const messages = [...result.data.messages, { role: "user" as const, content: "[LINA app]\n오늘 어디까지 했어요?", timestamp: null }, { role: "assistant" as const, content: reply, timestamp: null }];
            return { ...result, data: { ...result.data, messages } };
          }
        }
        const view = await open("#/talk/ag-1", { wide: true, source: new Overlap() });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        const box = await leaveAndReturn(view, "오늘 어디까지 했어요?");
        await act(async () => {
          await vi.advanceTimersByTimeAsync(TALK_FRAME_MS * 12);
        });
        release();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(box.getAllByTestId("talk-mine").map((line) => line.textContent), order).toEqual(["어디까지 왔어요?", "오늘 어디까지 했어요?"]);
        expect(box.getAllByTestId("talk-reply"), order).toHaveLength(2);
        expect(box.getAllByTestId("talk-reply").at(-1)?.querySelector(".talk-bubble")?.textContent, order).toBe(reply);
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  });

  test("the same message sent twice with the same reply is two exchanges, each shown once", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const view = await open("#/talk/ag-1", { wide: true, source: new SyntheticSource() });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const { field } = parts(view);
      for (let n = 0; n < 2; n++) {
        field.value = "오늘 어디까지 했어요?";
        fireEvent.input(field);
        fireEvent.keyDown(field, { key: "Enter" });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(TALK_FRAME_MS * 12);
        });
      }
      const box = within(view.getByTestId("agent-talk"));
      expect(box.getAllByTestId("talk-mine").map((line) => line.textContent)).toEqual(["어디까지 왔어요?", "오늘 어디까지 했어요?", "오늘 어디까지 했어요?"]);
      expect(box.getAllByTestId("talk-reply")).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a turn the core has not accepted yet blocks a second send from a reopened chat, and its refusal shows there", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      let refuse: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (refuse = resolve));
      let posts = 0;
      class Refusing extends SyntheticSource {
        override async agentTalk(_agent: string, _body: { message: string }, _signal?: AbortSignal) {
          posts += 1;
          await gate;
          return { ok: false as const, status: 503, code: null };
        }
      }
      const view = await open("#/talk/ag-1", { wide: true, source: new Refusing() });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const box = await leaveAndReturn(view, "오늘 어디까지 했어요?");
      expect(parts(view).send.disabled).toBe(true);
      const { field } = parts(view);
      field.value = "또 보냅니다";
      fireEvent.input(field);
      fireEvent.keyDown(field, { key: "Enter" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(posts).toBe(1);
      refuse();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(view.getByTestId("agent-talk").textContent).toContain("에이전트 연결 안 됨");
      expect(box.getAllByTestId("talk-mine").map((line) => line.textContent)).toEqual(["어디까지 왔어요?"]);
      // Nothing is going any more: the second message typed meanwhile can be sent.
      expect(parts(view).send.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a reply that breaks off while the owner is in another window shows as not received when they come back", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      class BreaksOff extends SyntheticSource {
        override async agentTalk(agent: string, body: { message: string }, signal?: AbortSignal) {
          const result = await super.agentTalk(agent, body, signal);
          if (!result.ok) return result;
          const events = result.events;
          async function* broken() {
            let count = 0;
            for await (const event of events) {
              if (++count > 4) throw new Error("stream cut");
              yield event;
            }
          }
          return { ok: true as const, events: broken() };
        }
      }
      const view = await open("#/talk/ag-1", { wide: true, source: new BreaksOff() });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const box = await leaveAndReturn(view, "오늘 어디까지 했어요?");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TALK_FRAME_MS * 10);
      });
      expect(box.getAllByTestId("talk-mine").map((line) => line.textContent)).toEqual(["어디까지 왔어요?", "오늘 어디까지 했어요?"]);
      expect(box.queryByTestId("talk-live")).toBeNull();
      expect(box.getByTestId("write-error").textContent).toBe("답을 받지 못함");
    } finally {
      vi.useRealTimers();
    }
  });

  test("a refused turn shows one line and keeps the message in the field", async () => {
    const view = await open("#/talk/ag-1", { wide: true, source: new SyntheticSource({ talk: "busy" }) });
    const { field, send } = parts(view);
    field.value = "오늘 어디까지 했어요?";
    fireEvent.input(field);
    fireEvent.click(send);
    await waitFor(() => expect(within(view.getByTestId("agent-talk")).getByTestId("write-error").textContent).toBe("에이전트가 바쁨"));
    expect(field.value).toBe("오늘 어디까지 했어요?");
  });

  test("a refused turn puts the agent row's preview back to what it showed before the send (lina-app#143)", async () => {
    let refuse: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (refuse = resolve));
    // Once the rows have read their history, no later read answers: only the refusal itself can put the preview back.
    let reading = true;
    class Refusing extends SyntheticSource {
      override async agentTalk(_agent: string, _body: { message: string }, _signal?: AbortSignal) {
        await gate;
        return { ok: false as const, status: 503, code: null };
      }
      override async agentTalkHistory(agent: string) {
        return reading ? super.agentTalkHistory(agent) : new Promise<never>(() => undefined);
      }
    }
    const view = await open("#/talk/ag-1", { wide: true, source: new Refusing() });
    const preview = () => view.getByTestId("nav-talk-0").querySelector("[data-testid=talk-preview]")?.textContent;
    const before = "변경 목록을 모으는 중이에요. 배포 순서는 답을 기다려요.";
    await waitFor(() => expect(preview()).toBe(before));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    reading = false;
    const { field, send } = parts(view);
    field.value = "오늘 어디까지 했어요?";
    fireEvent.input(field);
    fireEvent.click(send);
    await waitFor(() => expect(preview()).toBe("오늘 어디까지 했어요?"));
    refuse();
    await waitFor(() => expect(within(view.getByTestId("agent-talk")).getByTestId("write-error")).toBeTruthy());
    expect(preview()).toBe(before);
  });
  test("a preview read that began before a send does not overwrite the sent message when it answers late (lina-app#143)", async () => {
    let release: () => void = () => undefined;
    const late = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;
    class Slow extends SyntheticSource {
      override async agentTalk(_agent: string, _body: { message: string }, _signal?: AbortSignal) {
        return new Promise<never>(() => undefined);
      }
      override async agentTalkHistory(agent: string) {
        const result = await super.agentTalkHistory(agent);
        // The agent list asks first; its answer is the snapshot from before the send.
        if (agent === "ag-1" && (reads += 1) === 1) await late;
        return result;
      }
    }
    const view = await open("#/talk/ag-1", { wide: true, source: new Slow() });
    const preview = () => view.getByTestId("nav-talk-0").querySelector("[data-testid=talk-preview]")?.textContent;
    const { field, send } = parts(view);
    await waitFor(() => expect(send).toBeTruthy());
    field.value = "오늘 어디까지 했어요?";
    fireEvent.input(field);
    fireEvent.click(send);
    await waitFor(() => expect(preview()).toBe("오늘 어디까지 했어요?"));
    release();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(preview()).toBe("오늘 어디까지 했어요?");
  });
});

describe("talk", () => {
  function talkParts(view: ReturnType<typeof render>) {
    const box = within(view.getByTestId("talk"));
    return { box, field: box.getByRole("textbox", { name: "메시지" }) as HTMLInputElement, send: box.getByRole("button", { name: "보내기" }) as HTMLButtonElement };
  }

  function type(field: HTMLInputElement, text: string) {
    field.value = text;
    fireEvent.input(field);
  }

  test("대화 sits under 댓글; Enter sends, the reply streams with a live mark, then one line says the agent keeps it", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SyntheticSource();
      const agent = source.scene.items.agents.find((person) => person.id === source.scene.itemDetails.T4.agent)?.name;
      const comments = source.scene.itemDetails.T4.comments.length;
      const view = await open("#/items/T4", { wide: true, source });
      const heads = [...view.container.querySelectorAll(".detail .box-head")].map((head) => head.textContent);
      expect(heads.slice(-2)).toEqual(["댓글", "대화"]);
      const { box, field, send } = talkParts(view);
      expect(send.disabled).toBe(true);
      type(field, "입력 폼 간격 봐 주세요");
      fireEvent.keyDown(field, { key: "Enter" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(box.getByTestId("talk-mine").textContent).toBe("입력 폼 간격 봐 주세요");
      expect(field.value).toBe("");
      expect(send.disabled).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TALK_FRAME_MS * 5);
      });
      const reply = box.getByTestId("talk-reply");
      expect(reply.querySelector(".talk-bubble")?.textContent).toBe(`${TALK_REPLY_DELTAS[0]}${TALK_REPLY_DELTAS[1]}답하는 중`);
      expect(box.getByTestId("talk-live")).toBeTruthy();
      expect(reply.querySelector(".mark")?.textContent).toBe(Array.from(agent ?? "")[0]);
      expect(box.queryByTestId("talk-carried")).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TALK_FRAME_MS * 10);
      });
      expect(reply.querySelector(".talk-bubble")?.textContent).toBe(TALK_REPLY_DELTAS.join(""));
      expect(box.queryByTestId("talk-live")).toBeNull();
      expect(box.getAllByTestId("talk-carried").map((line) => line.textContent)).toEqual([`${agent} 대화에 남음`]);
      expect(view.queryByTestId("write-error")).toBeNull();
      expect(source.scene.itemDetails.T4.comments).toHaveLength(comments);
      type(field, "고마워요");
      fireEvent.click(send);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(box.queryByTestId("talk-carried")).toBeNull();
      expect(box.getAllByTestId("talk-mine")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("an Enter that ends a Hangul composition does not send", async () => {
    const source = new SyntheticSource();
    const talk = vi.spyOn(source, "talk");
    const view = await open("#/items/T4", { wide: true, source });
    const { field } = talkParts(view);
    fireEvent.compositionStart(field);
    field.value = "안녕";
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229, isComposing: true });
    fireEvent.compositionEnd(field, { data: "안녕" });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    expect(talk).not.toHaveBeenCalled();
    expect(field.value).toBe("안녕");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(talk).toHaveBeenCalledWith("T4", { message: "안녕" }, expect.any(AbortSignal));
  });

  test.each([
    ["busy", "에이전트가 바쁨"],
    ["down", "에이전트 연결 안 됨"],
    ["none", "맡은 에이전트 없음"],
  ] as const)("a %s refusal shows one line and keeps the message in the field", async (talk, line) => {
    const view = await open("#/goals/G2", { wide: true, source: new SyntheticSource({ talk }) });
    const { box, field, send } = talkParts(view);
    type(field, "오늘 어디까지 했어요?");
    fireEvent.click(send);
    await waitFor(() => expect(box.getByTestId("write-error").textContent).toBe(line));
    expect(field.value).toBe("오늘 어디까지 했어요?");
    expect(send.disabled).toBe(false);
    expect(box.queryByTestId("talk-mine")).toBeNull();
  });
});

describe("live updates", () => {
  test("a write on another device shows here within 2 s; a resync, a drop and a reconnect keep the open row and the screen", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const core = new SyntheticSource();
      const view = await open("#/inbox", { wide: true, source: core });
      const screen = view.getByTestId("screen-inbox");
      const row = decisionButton(view, "배포를 금요일 오후에 할지 결정 필요");
      fireEvent.click(row);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // The decision is open in the frame and its row is the selected one.
      expect(row.getAttribute("aria-current")).toBe("page");
      expect(view.getByTestId("detail-frame").querySelector("[data-testid=screen-item]")).not.toBeNull();
      const read = vi.spyOn(core, "read");

      const otherDevice = new Store(new SyntheticSource({ scene: core.scene }));
      expect(await otherDevice.write((source) => source.done("T3", {}))).toMatchObject({ ok: true });
      expect(view.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" })).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(view.queryByRole("checkbox", { name: /^공지 문구 확인/ })).toBeNull();
      expect(view.getByTestId("nav-inbox").textContent).toContain(String(SCENE_COUNTS.inbox - 1));
      // Only the routes a done mark touches were read, not every snapshot.
      expect([...new Set(read.mock.calls.map(([name, id]) => (id ? `${name}:${id}` : name)))].sort()).toEqual(["board", "items"]);
      read.mockRestore();

      core.resyncStreams();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STREAM_TICK_MS);
      });
      await act(async () => core.dropStreams());
      expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연");
      await otherDevice.write((source) => source.readNotices({ keys: [core.scene.board.notices.find((notice) => !notice.read)?.key ?? ""] }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
      });
      expect(core.stream.at(-1)).toMatchObject({ first: "missed", missed: 1, open: true });
      await waitFor(() => expect(view.getByRole("button", { name: "알림 4" })).toBeTruthy());
      expect(view.getByTestId("freshness-line").textContent).toBe("실시간");

      expect(view.getByTestId("screen-inbox")).toBe(screen);
      expect(decisionButton(view, "배포를 금요일 오후에 할지 결정 필요")).toBe(row);
      expect(row.getAttribute("aria-current")).toBe("page");
      expect(view.getByTestId("detail-frame").querySelector("[data-testid=decision]")?.textContent).toContain("배포를 금요일 오후에 할지 결정 필요");
      expect(core.stream.filter((connection) => connection.open)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
test("a core restarted with a new token: the page reads it once and resumes, without a reload", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const core = new SyntheticSource();
      const view = await open("#/inbox", { wide: true, source: core });
      const screen = view.getByTestId("screen-inbox");
      await act(async () => core.restartCore());
      expect(view.getByTestId("freshness-line").textContent).toBe("갱신 지연");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
      });
      expect(core.renewals).toBe(1);
      // Whichever the new token refused first, a read or the reconnect, the page resumed from its cursor.
      expect(core.stream[0].first).toBe("tail");
      expect(core.stream.at(-1)).toMatchObject({ since: expect.stringMatching(/^s\./), first: "missed", missed: 1, open: true });
      expect(core.stream.filter((connection) => connection.open)).toHaveLength(1);
      await waitFor(() => expect(view.getByRole("button", { name: "알림 4" })).toBeTruthy());
      expect(view.getByTestId("freshness-line").textContent).toBe("실시간");
      expect(view.getByTestId("screen-inbox")).toBe(screen);
    } finally {
      vi.useRealTimers();
    }
  });

  test("refused again after one renewal, the line turns red 연결 끊김 and the page asks nothing more", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      class StuckSource extends SyntheticSource {
        override async renewCredential() {
          this.renewals += 1;
          return "same" as const;
        }
      }
      const core = new StuckSource();
      const view = await open("#/inbox", { wide: true, source: core });
      await act(async () => core.restartCore());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);
      });
      const line = view.getByTestId("freshness-line");
      expect(line.textContent).toBe("연결 끊김");
      expect(line.classList.contains("is-red")).toBe(true);
      const tries = core.stream.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS * 4);
      });
      expect(core.stream).toHaveLength(tries);
      expect(core.renewals).toBe(1);
      expect(rowsIn(view.getByTestId("screen-inbox"))).toBe(SCENE_COUNTS.inbox);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** The synthetic core with one more hand: the agent behind a card writes its checked lines, as lina#151's writer does. */
class WritingSource extends SyntheticSource {
  writeLines(cardId: string, lines: { title?: string | null; now?: string | null }) {
    const summary = this.scene.cards.cards.find((card) => card.id === cardId);
    for (const target of [summary, this.scene.cardDetails[cardId]]) if (target) target.plain = { ...target.plain, ...lines };
    this.changed({ source: "kanban", kind: "plain_written", id: cardId });
  }
}

describe("work cards", () => {
  beforeEach(() => setWide(true));

  test("the home reads: decisions in one line, review, stopped then running, the owner's to-dos, the last 24 hours, then older", async () => {
    const view = await open("#/running", { wide: true });
    const screen = view.getByTestId("screen-running");
    const lists = [...screen.querySelectorAll("ul.rows")].map((list) => list.getAttribute("aria-label"));
    // The waiting card waits on review, so 대기 does not repeat it; r7 and r8 are worker runs, so nothing is older. The
    // planned card is its own 예정 group under 진행 중 (lina-app#148).
    expect(lists).toEqual(["수신함", "검토 필요", "중단됨", "진행 중인 작업", "예정", "내 할 일", "최근 완료"]);
    expect(view.getByTestId("home-decisions").textContent).toContain(String(SCENE_COUNTS.decisions));
    const names = (label: string) => [...(screen.querySelector(`[aria-label="${label}"]`)?.querySelectorAll(":scope > li > a") ?? [])].map((link) => link.getAttribute("aria-label") ?? "");
    expect(names("진행 중인 작업").every((name) => / · 진행 중( · 할 일 \d+\/\d+)?$/.test(name))).toBe(true);
    expect(names("중단됨")).toHaveLength(1);
    expect(names("중단됨")[0]).toMatch(/중단됨 · 응답 없음$/);
    // k-105 is never opened here: its list row's own end (lina#577) places it.
    expect(names("최근 완료")).toHaveLength(1);
    expect(names("완료")).toHaveLength(0);
    for (const id of ["review", "recent"]) {
      const section = view.getByTestId(`section-${id}`);
      expect(rowsIn(section)).toBe(count(section.querySelector("[data-testid=count]")));
    }
    expect(names("최근 완료").length + names("완료").length).toBe(count(view.getByTestId("nav-done").querySelector("[data-testid=nav-count]")));
  });

  test("a work card with no checked title is named by its own title on its detail, and by its goal on the home and its agent", async () => {
    const source = new SyntheticSource();
    const raw = [
      ...source.scene.cards.cards.filter((card) => card.plain.title !== null).map((card) => card.title),
      ...source.scene.board.cards.flatMap((run) => [run.title, run.now ?? ""]),
      ...source.scene.cards.cards.map((card) => card.now ?? ""),
    ].filter(Boolean);
    for (const hash of ["#/running", "#/done", "#/inbox", "#/cards/k-102", "#/cards/k-101", "#/agents/ag-2"]) {
      const view = await open(hash, { wide: true, source: new SyntheticSource({ scene: source.scene }) });
      const text = screenText(view.container);
      for (const line of raw) expect(text).not.toContain(line);
      if (hash === "#/cards/k-102") {
        // Its worker run opens from the card, which tells the run's page whose run it is.
        window.location.hash = "#/runs/r2";
        await waitFor(() => expect(view.queryByTestId("screen-run")).not.toBeNull());
        const runText = screenText(view.container);
        for (const line of raw) expect(runText).not.toContain(line);
      }
      view.unmount();
    }
    const view = await open("#/cards/k-102", { wide: true });
    const detail = view.getByTestId("screen-card");
    const head = detail.querySelector(".detail-title");
    expect(head?.textContent).toBe("위키: 결제 화면 문서 정리");
    expect(head?.classList.contains("is-kind")).toBe(false);
    expect(within(detail).getByTestId("kind").textContent).toBe("문서");
    expect(within(detail).queryByTestId("card-now")).toBeNull();
    // A row is titled by its goal first (lina-app#122).
    const row = within(view.getByTestId("screen-running")).getAllByTestId("row").find((item) => item.querySelector("a")?.getAttribute("href") === "#/cards/k-102");
    expect(row?.querySelector(".title")?.textContent).toBe("결제 화면 개편");
    expect(row?.querySelector(".title")?.classList.contains("is-kind")).toBe(false);
    expect(row?.querySelector("a")?.getAttribute("aria-label")).toMatch(/ · 결제 화면 개편 · 진행 중/);
    expect(row?.querySelector(".state")?.textContent).toBe("진행 중");
    view.unmount();
    const agent = await open("#/agents/ag-2", { wide: true });
    const agentRow = agent.container.querySelector('.list-pane li:has(> a[href="#/cards/k-102"]) .title');
    expect(agentRow?.textContent).toBe("결제 화면 개편");
    expect(agentRow?.classList.contains("is-kind")).toBe(false);
  });

  test("a work card whose own title would show raw text is named by its goal on the home, and keeps its kind word on its detail", async () => {
    const source = new SyntheticSource();
    const ownTitle = "LINA-41 release notes / CHANGES.md";
    const scene = {
      ...source.scene,
      cards: { cards: source.scene.cards.cards.map((card) => (card.id === "k-102" ? { ...card, title: ownTitle } : card)) },
      cardDetails: { ...source.scene.cardDetails, "k-102": { ...source.scene.cardDetails["k-102"], title: ownTitle } },
    };
    const view = await open("#/running", { wide: true, source: new SyntheticSource({ scene }) });
    // The own title fails the raw-text rule, so nothing of it is drawn: the row is named by its goal (lina-app#116), the
    // kind of work is the icon only.
    expect(screenText(view.container)).not.toContain(ownTitle);
    const row = within(view.getByTestId("screen-running")).getAllByTestId("row").find((item) => item.querySelector("a")?.getAttribute("href") === "#/cards/k-102");
    expect(row?.querySelector(".title")?.textContent).toBe("결제 화면 개편");
    expect(row?.querySelector(".title")?.classList.contains("is-kind")).toBe(false);
    expect(row?.querySelector("a")?.getAttribute("aria-label")).toMatch(/ · 결제 화면 개편 · 진행 중/);
    view.unmount();
    const detail = await open("#/cards/k-102", { wide: true, source: new SyntheticSource({ scene }) });
    expect(screenText(detail.container)).not.toContain(ownTitle);
    const head = detail.getByTestId("screen-card").querySelector(".detail-title");
    expect(head?.textContent).toBe("코드 작업");
    expect(head?.classList.contains("is-kind")).toBe(true);
    expect(within(detail.getByTestId("screen-card")).getByTestId("kind").textContent).toBe("코드");
  });

  test("ended runs do not pile up as stopped: the stopped rows say who they wait on, or are one grey line", async () => {
    const view = await open("#/running", { wide: true, source: new SyntheticSource({ endedRuns: true }) });
    const list = within(view.getByTestId("screen-running")).getByRole("list", { name: "중단됨" });
    const stopped = [...list.querySelectorAll("[data-testid=row].is-stopped")];
    expect(within(view.getByTestId("screen-running")).getByRole("list", { name: "진행 중인 작업" }).querySelectorAll("[data-testid=row].is-stopped")).toHaveLength(0);
    const hrefs = stopped.map((row) => row.querySelector("a")?.getAttribute("href"));
    // Only the stopped cards: no worker run is a row (lina-app#141), nothing is listed by its kind and no line counts
    // what nothing names. The rows waiting on the owner come first.
    expect(new Set(hrefs)).toEqual(new Set(["#/cards/k-103", "#/cards/k-107", "#/cards/k-108", "#/cards/k-109", "#/cards/k-110", "#/cards/k-111", "#/cards/k-112"]));
    expect(hrefs.slice(0, 3)).toEqual(["#/cards/k-108", "#/cards/k-107", "#/cards/k-112"]);
    expect(view.getByTestId("nav-running").querySelector("[data-testid=nav-stopped]")?.textContent).toBe("7");
    expect(view.queryByTestId("home-untitled")).toBeNull();
    const row = (href: string) => stopped.find((each) => each.querySelector("a")?.getAttribute("href") === href) as Element;
    const state = (href: string) => row(href).querySelector("[data-testid=state]") as Element;
    expect(state("#/cards/k-107").textContent).toBe(`중단됨 · ${SYNTHETIC_OWNER.name} 확인 필요`);
    expect(state("#/cards/k-107").classList.contains("is-plain")).toBe(false);
    // The core does not say who an unresponsive stop waits on: the line stays grey.
    expect(state("#/cards/k-103").textContent).toBe("중단됨 · 응답 없음");
    expect(state("#/cards/k-103").classList.contains("is-plain")).toBe(true);
    // Who waits, from waitingOn and retry (lina#629), in red; the card whose runs carry its to-do is named by it.
    expect(row("#/cards/k-108").querySelector(".title")?.textContent).toBe("야간 보고서 정리하기");
    expect(state("#/cards/k-108").textContent).toBe(`중단됨 · ${SYNTHETIC_OWNER.name} 확인 필요`);
    expect(state("#/cards/k-109").textContent).toMatch(/^중단됨 · \S+ 검토 대기$/);
    expect(state("#/cards/k-110").textContent).toBe("중단됨 · 응답 없음 · 다시 시도 안 함");
    expect(state("#/cards/k-110").classList.contains("is-plain")).toBe(false);
    expect(stopped.filter((each) => each.querySelector(".title")?.textContent === "제목 없음")).toHaveLength(0);
    expect(screenText(view.container)).not.toMatch(/코드 작업|문서 작업|기기 작업/);
  });

  test("a stopped card is drawn by its own title with a Latin word in it; a finished one with such a title is not listed", async () => {
    const source = new SyntheticSource({ endedRuns: true });
    const stoppedCard = source.scene.cards.cards.find((card) => card.id === "k-112") as WorkCardSummary;
    const finished: WorkCardSummary = { ...stoppedCard, id: "k-113", title: "AAS 회차 점검 마무리", state: "done", reason: null, waitingOn: null, endedAt: Math.floor(Date.now() / 1000) - 3600 };
    const scene = { ...source.scene, cards: { cards: [...source.scene.cards.cards, finished] } };
    const view = await open("#/", { wide: true, source: new SyntheticSource({ scene }) });
    const screen = view.getByTestId("screen-running");
    const row = within(screen).getAllByTestId("row").find((item) => item.querySelector("a")?.getAttribute("href") === "#/cards/k-112");
    expect(row?.classList.contains("is-stopped")).toBe(true);
    expect(row?.querySelector(".title")?.textContent).toBe("CLI 배포 순서 정하기");
    expect(row?.querySelector("[data-testid=state]")?.textContent).toBe(`중단됨 · ${SYNTHETIC_OWNER.name} 확인 필요`);
    // The finished card keeps the Latin-word rule: not drawn, and no line counts it (lina-app#141).
    expect(screen.querySelector('a[href="#/cards/k-113"]')).toBeNull();
    expect(screenText(view.container)).not.toContain("AAS");
    expect(view.queryByTestId("home-untitled")).toBeNull();
    expect(view.getByTestId("nav-running").querySelector("[data-testid=nav-stopped]")?.textContent).toBe("7");
  });

  test("a stopped card's detail keeps the own title with a Latin word that its list row shows", async () => {
    const view = await open("#/cards/k-112", { wide: true, source: new SyntheticSource({ endedRuns: true, now: Math.floor(Date.now() / 1000) }) });
    await waitFor(() => expect(view.getByTestId("screen-card").querySelector(".detail-title")?.textContent).toBe("CLI 배포 순서 정하기"));
    expect(screenText(view.container)).not.toMatch(/제목 없음|코드 작업|문서 작업|기기 작업/);
  });

  test("다시 시도 sits only on the stopped rows running again can clear; a row waiting on an answer or a review has none", async () => {
    const view = await open("#/running", { wide: true, source: new SyntheticSource({ endedRuns: true }) });
    const rows = [...view.getByRole("list", { name: "중단됨" }).querySelectorAll("[data-testid=row]")];
    const withRetry = rows.filter((row) => row.querySelector("[data-testid=retry]")).map((row) => row.querySelector("a")?.getAttribute("href"));
    expect(new Set(withRetry)).toEqual(new Set(["#/cards/k-103", "#/cards/k-110", "#/cards/k-111"]));
    for (const row of rows.filter((each) => /확인 필요|검토 대기/.test(each.querySelector("[data-testid=state]")?.textContent ?? ""))) {
      expect(row.querySelector("[data-testid=retry]")).toBeNull();
      expect(row.classList.contains("has-action")).toBe(false);
    }
  });

  test("a lone stopped run named only in Latin is no row, and its page shows no internal name", async () => {
    const source = new SyntheticSource({ endedRuns: true, now: Math.floor(Date.now() / 1000) });
    const scene = { ...source.scene, board: { ...source.scene.board, cards: source.scene.board.cards.map((run) => (run.id === "r20" ? { ...run, title: "device smoke node-a", todo: null } : run)) } };
    const home = await open("#/running", { wide: true, source: new SyntheticSource({ scene }) });
    expect(home.container.querySelector('a[href="#/runs/r20"]')).toBeNull();
    expect(screenText(home.container)).not.toMatch(/device smoke|이름 없는 실행/);
    home.unmount();
    const view = await open("#/runs/r20", { wide: true, source: new SyntheticSource({ scene }) });
    await waitFor(() => expect(view.getByTestId("screen-run").querySelector(".detail-title")).not.toBeNull());
    expect(screenText(view.container)).not.toContain("device smoke");
  });

  test("a finished worker run is no row in 완료; three rounds of one card stay one card", async () => {
    const view = await open("#/done", { wide: true });
    expect(view.getByTestId("screen-done").querySelectorAll('a[href^="#/runs/"]')).toHaveLength(0);
    view.unmount();
    const home = await open("#/running", { wide: true });
    expect(within(home.getByTestId("screen-running")).getAllByRole("link", { name: /릴리스 노트 정리/ })).toHaveLength(1);
    expect(home.container.querySelectorAll('a[href="#/runs/r9"], a[href="#/runs/r10"]')).toHaveLength(0);
  });

  test("a card's detail: now, its to-dos, then its worker runs by round; no box repeats the to-do list", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const detail = view.getByTestId("screen-card");
    const boxes = [...detail.querySelectorAll(":scope > .box > .box-head")].map((head) => head.textContent);
    // One round list: the record's blocks; 실행 does not stand beside them.
    expect(boxes).toEqual(["지금", "할 일", "기록", "댓글"]);
    expect([...detail.querySelectorAll(".checklist .title")].map((title) => title.textContent)).toEqual(["변경 목록 모으기", "모은 변경 확인", "공지 문구 확인"]);
    expect(within(detail).getByTestId("card-now").textContent).toContain("변경마다 한 줄 요약을 붙이는 중");
    expect(within(detail).queryByTestId("card-done-so-far")).toBeNull();
    expect(within(detail).queryByTestId("card-next")).toBeNull();
    expect(within(detail).queryByTestId("worker-runs")).toBeNull();
    // Each round's head is the link to its worker run.
    const links = within(detail).getAllByTestId("timeline-link");
    // No round number: each head is one line, its time and what happened (lina-app#61, #142).
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringMatching(/^(어제 )?\d\d:\d\d · 진행 중$/),
      expect.stringMatching(/^(어제 )?\d\d:\d\d · 검토 필요 · 문서만 바뀐 변경을 따로 묶음$/),
      expect.stringMatching(/^(어제 )?\d\d:\d\d · 완료 · 병합된 변경 41개를 모음$/),
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["#/runs/r1", "#/runs/r10", "#/runs/r9"]);
    view.unmount();
    const waiting = await open("#/cards/k-104", { wide: true });
    expect(waiting.getByTestId("card-done-so-far").textContent).toBe("완료된 것실패 화면 세 곳의 문구와 버튼을 비교함");
  });

  test("a stopped writer: one 요약 중단됨 line, and the missing lines still show nothing", async () => {
    const view = await open("#/running", { wide: true, source: new SyntheticSource({ writerStopped: true }) });
    expect(view.getByTestId("summaries-stopped").textContent).toBe(" · 요약 중단됨");
    expect(view.getAllByTestId("summaries-stopped")).toHaveLength(1);
    view.unmount();
    const ok = await open("#/running", { wide: true });
    expect(ok.queryByTestId("summaries-stopped")).toBeNull();
  });

  test("a card's checked lines land in place from its kanban event: only its summary is read while its detail is not open", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new WritingSource();
      const view = await open("#/running", { wide: true, source });
      const row = () => within(view.getByTestId("screen-running")).getAllByTestId("row").find((item) => item.querySelector("a")?.getAttribute("href") === "#/cards/k-102");
      const before = row();
      expect(before?.querySelector(".title")?.textContent).toBe("결제 화면 개편");
      // Let the reads the page started on its own (the first tail, the open screen's wants) finish first.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STREAM_TICK_MS);
      });
      const read = vi.spyOn(source, "read");
      source.writeLines("k-102", { title: "결제: 카드 입력 폼 다듬기", now: "보안 코드 칸을 맞추는 중" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STREAM_TICK_MS * 2);
      });
      await waitFor(() => expect(row()?.querySelector(".now")?.textContent).toBe("보안 코드 칸을 맞추는 중"));
      // Its goal still names the row (lina-app#122); the checked title is what its detail head reads.
      expect(row()?.querySelector(".title")?.textContent).toBe("결제 화면 개편");
      expect(row()).toBe(before);
      const routes = new Set(read.mock.calls.map(([name, id]) => (id ? `${name}:${id}` : name)));
      expect(routes.has("cards")).toBe(true);
      expect([...routes].filter((route) => route.startsWith("card:"))).toEqual([]);
      expect(routes.has("board") || routes.has("items")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("work cards, round 4", () => {
  beforeEach(() => setWide(true));

  test("a comment that would show a path, a hash or a cut-off fragment reads its first sentence with those left out, one line, never folded (lina-app#142)", async () => {
    const view = await open("#/cards/k-103", { wide: true });
    const comments = within(view.getByTestId("card-comments")).getAllByTestId("history-row");
    expect(comments.map((comment) => comment.textContent)).toEqual([
      expect.stringMatching(/^(어제 )?\d\d:\d\d · 오류 문구 초안을 공유했어요\.$/),
      expect.stringMatching(/^(어제 )?\d\d:\d\d · 키 12개를 바꿈$/),
      expect.stringMatching(/^(어제 )?\d\d:\d\d · 결제 실패 문구를 새 문체로 바꾸는 중인데 카드사별로…$/),
    ]);
    // Who wrote it is the line's tooltip, not a second line.
    expect(comments.every((comment) => Boolean(comment.getAttribute("title")))).toBe(true);
    expect(screenText(view.container)).not.toMatch(/errors\.json|3f2a1c9|접힌 댓글/);
  });

  test("완료's agent filter is the address: it survives a reload and a live update, and each count is its list", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const core = new SyntheticSource();
      const view = await open("#/done?agent=ag-3", { wide: true, source: core });
      const listed = () => [...view.getByTestId("screen-done").querySelectorAll('[aria-label="완료"] > li > a')].map((link) => link.getAttribute("href"));
      expect(listed()).toEqual(["#/cards/k-105"]);
      const choices = within(view.getByTestId("done-filter")).getAllByRole("button");
      expect(choices.find((button) => button.getAttribute("aria-pressed") === "true")?.getAttribute("aria-label")).toMatch(/ 1$/);
      for (const button of choices) {
        const id = button.getAttribute("aria-label")?.startsWith("전체") ? "" : null;
        if (id === "") expect(button.getAttribute("aria-label")).toBe(`전체 ${SCENE_COUNTS.done}`);
      }
      const otherDevice = new Store(new SyntheticSource({ scene: core.scene }));
      await otherDevice.write((source) => source.comment("T4", { text: "확인 부탁해요" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STREAM_TICK_MS * 3);
      });
      expect(window.location.hash).toBe("#/done?agent=ag-3");
      expect(listed()).toEqual(["#/cards/k-105"]);
      view.unmount();
      const reloaded = await open("#/done?agent=ag-3", { wide: true, source: new SyntheticSource({ scene: core.scene }) });
      expect([...reloaded.getByTestId("screen-done").querySelectorAll('[aria-label="완료"] > li > a')]).toHaveLength(1);
      fireEvent.click(within(reloaded.getByTestId("done-filter")).getByRole("button", { name: /^전체/ }));
      await waitFor(() => expect(window.location.hash).toBe("#/done"));
      expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("an agent's latest activity reads the same on its screen and on its 완료", async () => {
    const agentScreen = await open("#/agents/ag-2", { wide: true });
    const onAgent = agentScreen.getByTestId("agent-latest").textContent;
    agentScreen.unmount();
    const done = await open("#/done?agent=ag-2", { wide: true });
    expect(onAgent).toMatch(/^최근 활동 /);
    expect(done.getByTestId("done-latest").textContent).toBe(onAgent);
  });

  test("a running card with to-dos shows a thin bar and its count on a wide window; on a phone only in its detail", async () => {
    const wide = await open("#/running", { wide: true });
    const row = wide.container.querySelector('li:has(> a[href="#/cards/k-101"])') as HTMLElement;
    expect(within(row).getByTestId("progress").getAttribute("aria-label")).toBe("할 일 1/3");
    expect(row.querySelector(".progress-count")?.textContent).toBe("1/3");
    expect(wide.container.querySelector('li:has(> a[href="#/runs/r7"]) [data-testid=progress]')).toBeNull();
    wide.unmount();
    const phone = await open("#/running", { wide: false });
    expect(phone.container.querySelectorAll("[data-testid=progress]")).toHaveLength(0);
    phone.unmount();
    const detail = await open("#/cards/k-101", { wide: false });
    expect(detail.container.querySelector(".detail-head [data-testid=progress]")?.getAttribute("aria-label")).toBe("할 일 1/3");
  });

  test("a round with no start on record shows one dim line when it holds content; an end receipt alone shows nothing", async () => {
    const view = await open("#/cards/k-103", { wide: true });
    const heads = view.getAllByTestId("round").map((round) => round.querySelector(".round-head")?.textContent);
    // Round 3 has no end and its run no longer beats: the head says 중단됨, not 진행 중.
    expect(heads).toEqual([expect.stringMatching(/^(어제 )?\d\d:\d\d · 중단됨$/), "시작 기록 없음"]);
    expect(view.getAllByTestId("round")[1].classList.contains("is-no-start")).toBe(true);
    expect(view.getAllByTestId("round")[1].querySelector("li")).toBeNull();
  });
});

describe("work cards, round 5", () => {
  beforeEach(() => setWide(true));

  test("the stopped group and the running group under it each have their heading and their own rows' number", async () => {
    const view = await open("#/running", { wide: true });
    const head = view.getByTestId("head-active");
    expect(head.querySelector("span")?.textContent).toBe("진행 중");
    expect(count(head.querySelector("[data-testid=count]"))).toBe(SCENE_COUNTS.running);
    expect(head.querySelector("[data-testid=stopped-count]")).toBeNull();
    const section = view.getByTestId("section-active");
    expect(rowsIn(section)).toBe(SCENE_COUNTS.running);
    expect(stoppedRows(section)).toBe(0);
    expect(within(section).getByRole("list").getAttribute("aria-label")).toBe("진행 중인 작업");
    const stopped = view.getByTestId("section-stopped");
    expect(view.getByTestId("head-stopped").textContent).toBe(`중단됨${SCENE_COUNTS.stopped}`);
    expect(stoppedRows(stopped)).toBe(SCENE_COUNTS.stopped);
    expect(stopped.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("a finished card says when it ended on the home and the agent screen; how long it took is in its detail", async () => {
    const view = await open("#/running", { wide: true });
    const times = (id: string) => [...view.getByTestId(`section-${id}`).querySelectorAll(".sub")].map((line) => line.textContent);
    // k-105's detail is not read on the home; its list row's own end (lina#577) says when it ended.
    expect(times("recent")).toEqual(["완료 · 2시간 전"]);
    // r7 and r8 are worker runs with no card: no row (lina-app#141).
    expect(view.queryByTestId("section-older")).toBeNull();
    view.unmount();
    const agent = await open("#/done?agent=ag-3", { wide: true });
    expect([...agent.getByTestId("screen-done").querySelectorAll(".sub")].map((line) => line.textContent)).toEqual(["완료 · 2시간 전"]);
    agent.unmount();
    const detail = await open("#/runs/r7", { wide: true });
    expect(detail.container.querySelector(".detail-head .sub")?.textContent).toBe("완료 · 30분 전 · 소요 20분");
  });
});

describe("work cards, round 6", () => {
  beforeEach(() => setWide(true));

  test("a card just created (예정) shows on its agent's screen after 검토 필요, with no time, and in the home's 예정 group", async () => {
    const view = await open("#/agents/ag-3", { wide: true });
    const section = view.getByTestId("section-planned");
    expect(view.getByTestId("head-planned").textContent).toBe("예정1");
    const row = section.querySelector('li:has(> a[href="#/cards/k-106"])') as HTMLElement;
    expect(row.querySelector(".title")?.textContent).toBe("백업: 복구 연습 준비하기");
    expect(row.querySelector(".state")?.textContent).toBe("예정");
    expect(row.querySelector(".time")).toBeNull();
    expect(view.getByTestId("agent-count-planned").textContent).toBe(" · 예정 1");
    const order = [...view.getByTestId("screen-agent").querySelectorAll("[data-testid^=section-]")].map((element) => element.getAttribute("data-testid"));
    expect(order.indexOf("section-planned")).toBeGreaterThan(Math.max(order.indexOf("section-running"), order.indexOf("section-review")));
    expect(order.indexOf("section-planned")).toBeLessThan(order.indexOf("section-goals"));
    view.unmount();
    const home = await open("#/running", { wide: true });
    // The home draws it too, under 진행 중 (lina-app#148): a card that turns planned never leaves the tab.
    expect(home.getByTestId("section-planned").querySelector('a[href="#/cards/k-106"]')).not.toBeNull();
  });

  test("an agent's 완료 · 오늘 line opens 완료 filtered to that agent", async () => {
    const view = await open("#/agents/ag-1", { wide: true });
    expect(view.getByTestId("done-today").querySelector("a")?.getAttribute("href")).toBe("#/done?agent=ag-1");
  });

  test("a round with no start on record draws the line it left, dimmed, under its head", async () => {
    const view = await open("#/cards/k-103", { wide: true });
    const round = view.getAllByTestId("round")[1];
    expect(round.querySelector(".round-head")?.textContent).toBe("시작 기록 없음");
    expect(round.querySelector("[data-testid=round-line]")?.textContent).toBe("오류 문구 초안을 남김");
  });

  test("a running card's detail head reads its to-dos in words: 할 일 1/3", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    expect(view.container.querySelector(".detail-head .progress-count")?.textContent).toBe("할 일 1/3");
    view.unmount();
    const home = await open("#/running", { wide: true });
    expect(home.container.querySelector('li:has(> a[href="#/cards/k-101"]) .progress-count')?.textContent).toBe("1/3");
  });
});

describe("the run's own timeline", () => {
  beforeEach(() => setWide(true));

  test("a card's detail reads its rounds newest first, each headed by its time and what happened, below its boxes", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const heads = [...view.getByTestId("detail-pane").querySelectorAll(".detail > .box > .box-head")].map((head) => head.textContent);
    expect(heads.slice(-2)).toEqual(["기록", "댓글"]);
    const blocks = view.getAllByTestId("timeline-block");
    expect(blocks.map((block) => block.getAttribute("data-outcome"))).toEqual(["going", "comment", "rejected", "comment", "ended"]);
    const titles = blocks.map((block) => block.querySelector(".timeline-head")?.textContent);
    expect(titles[0]).toMatch(/^(어제 )?\d\d:\d\d · 진행 중$/);
    expect(titles[1]).toBe("댓글");
    expect(titles[2]).toMatch(/^(어제 )?\d\d:\d\d · 검토 필요 · 문서만 바뀐 변경을 따로 묶음$/);
    // No start on record: the end alone, no dangling dash; the dim line below says the start is missing.
    expect(titles[3]).toBe("댓글");
    expect(titles[4]).toMatch(/^(어제 )?\d\d:\d\d · 완료 · 병합된 변경 41개를 모음$/);
    expect(titles.join("\n")).not.toMatch(/ –|^–/m);
  });

  test("rows read oldest first: sentences bright, tools one dim line with its count, a repeat once with ×n, raw text left out", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const going = view.getAllByTestId("timeline-block")[0];
    const rows = [...going.querySelectorAll(".timeline-row")].map((row) => [row.getAttribute("data-kind"), row.classList.contains("is-dim"), row.textContent]);
    expect(rows).toEqual([
      ["said", false, expect.stringMatching(/^(어제 )?\d\d:\d\d · 변경마다 한 줄 요약을 붙이는 중$/)],
      ["tools", true, expect.stringMatching(/^(어제 )?\d\d:\d\d · 도구 사용 4번$/)],
      ["said", false, expect.stringMatching(/^(어제 )?\d\d:\d\d · 요약을 표로 옮기는 중 ×3$/)],
    ]);
    expect(going.querySelector("[data-testid=timeline-result]")).toBeNull();
    const text = screenText(view.getByTestId("timeline"));
    expect(text).not.toMatch(/Running|npm|packages|3f2a1c9|run 3/);
    expect(text).not.toContain("가린 문장");
  });

  test("a round with no start on record shows one dim line at its top; the owner's comments read time · sentence, the author as the tooltip", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const blocks = view.getAllByTestId("timeline-block");
    expect(blocks[4].querySelector("[data-testid=timeline-no-start]")?.textContent).toBe("시작 기록 없음");
    // The round's result is its head's sentence: one line, no second result line (lina-app#142).
    expect(blocks[4].querySelector(".timeline-head")?.textContent).toMatch(/^(어제 )?\d\d:\d\d · 완료 · 병합된 변경 41개를 모음$/);
    expect(blocks[4].querySelector("[data-testid=timeline-result]")).toBeNull();
    // The owner asked for the doc-only group between rounds 1 and 2, before round 2 did it.
    expect(blocks[3].querySelector(".timeline-text")?.textContent).toMatch(/^(어제 )?\d\d:\d\d · 문서만 바뀐 변경은 따로 묶어 주세요\.$/);
    expect(blocks[1].querySelector(".timeline-text")?.textContent).toMatch(/^(어제 )?\d\d:\d\d · 변경 목록은 표로 보여 주세요$/);
    // Every comment row carries its own time on its one line; its author is the row's tooltip.
    expect(blocks[1].querySelector(".timeline-row")?.getAttribute("title")).toBe(SYNTHETIC_OWNER.name);
    expect(blocks[2].querySelector(".timeline-row.is-comment")?.getAttribute("title")).toBe(SYNTHETIC_OWNER.name);
    expect(blocks[2].querySelector(".timeline-text")?.textContent).toMatch(/^(어제 )?\d\d:\d\d · 변경마다 한 줄 요약을 붙여 주세요$/);
  });

  /** The scene with plain names on its models: a run's record names a model only by such a name (lina-app#128). */
  const namedModels = () => {
    const { scene } = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
    const names: Record<string, string> = { "model-a": "가온 큰 모델", "model-b": "가온 작은 모델" };
    const models = scene.settings.models.map((model) => ({ ...model, name: names[model.id] ?? model.name }));
    return new SyntheticSource({ now: scene.now, scene: { ...scene, settings: { ...scene.settings, models } } });
  };

  test("a worker run's page names the model it used once under its head, and its rounds draw no model line", async () => {
    const used = await open("#/runs/r1", { wide: true, source: namedModels() });
    await waitFor(() => expect(used.getByTestId("timeline")).toBeTruthy());
    await waitFor(() => expect(used.container.querySelector(".detail-head [data-testid=run-model]")?.textContent).toBe("가온 큰 모델 · 보통"));
    expect(used.container.querySelectorAll("[data-testid=run-model]")).toHaveLength(1);
    expect(used.container.querySelector("[data-testid=timeline-block] [data-testid=run-model]")).toBeNull();
    expect(screenText(used.container)).not.toMatch(/\br\d+\b/);
    used.unmount();
    const fallback = await open("#/runs/r8", { wide: true, source: namedModels() });
    await waitFor(() => expect(fallback.container.querySelector(".detail-head [data-testid=run-model]")?.textContent).toBe("가온 작은 모델 · 높음 · 대체 모델"));
    expect(fallback.container.querySelectorAll("[data-testid=run-model]")).toHaveLength(1);
    expect(fallback.container.querySelector("[data-testid=timeline-block] [data-testid=run-model]")).toBeNull();
    expect(screenText(fallback.container)).not.toMatch(/\br\d+\b/);
    fallback.unmount();
    const none = await open("#/runs/r6", { wide: true, source: namedModels() });
    await waitFor(() => expect(none.getByTestId("timeline")).toBeTruthy());
    expect(none.container.querySelector("[data-testid=run-model]")).toBeNull();
    expect(screenText(none.container)).not.toMatch(/\br\d+\b/);
  });

  test("each round of a card's 기록 names its own run's model, and a round whose run has none shows nothing", async () => {
    const view = await open("#/cards/k-101", { wide: true, source: namedModels() });
    await waitFor(() => expect(view.container.querySelector("[data-testid=timeline-block] [data-testid=run-model]")).not.toBeNull());
    const blocks = view.getAllByTestId("timeline-block");
    // The rounds by their place, oldest 1: the heads carry no number (lina-app#61).
    const rounds = blocks.filter((block) => block.getAttribute("data-outcome") !== "comment").reverse();
    const round = (n: number) => rounds[n - 1];
    // k-101's rounds stay r9, r10, r1. Only r1 (round 3) has a model.
    const third = round(3);
    const line = third?.querySelector("[data-testid=run-model]");
    expect(third?.querySelector("[data-testid=timeline-link]")?.getAttribute("href")).toBe("#/runs/r1");
    expect(line?.textContent).toBe("가온 큰 모델 · 보통");
    expect(line?.classList.contains("timeline-model")).toBe(true);
    expect(third?.querySelector(".timeline-head")?.contains(line ?? null)).toBe(false);
    expect(round(2)?.querySelector("[data-testid=timeline-link]")?.getAttribute("href")).toBe("#/runs/r10");
    expect(round(2)?.querySelector("[data-testid=run-model]")).toBeNull();
    expect(round(1)?.querySelector("[data-testid=timeline-link]")?.getAttribute("href")).toBe("#/runs/r9");
    expect(round(1)?.querySelector("[data-testid=run-model]")).toBeNull();
    for (const comment of blocks.filter((block) => block.getAttribute("data-outcome") === "comment")) {
      expect(comment.querySelector("[data-testid=run-model]")).toBeNull();
    }
    expect(screenText(view.container)).not.toMatch(/\br\d+\b/);
  });

  test("a run's own page shows its timeline; a raw result line is left out and the round keeps its head", async () => {
    const view = await open("#/runs/r6", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const block = view.getByTestId("timeline-block");
    expect(block.getAttribute("data-outcome")).toBe("ended");
    expect(block.querySelector(".timeline-head")?.textContent).toMatch(/^(어제 )?\d\d:\d\d · 완료$/);
    expect(block.querySelector("[data-testid=timeline-result]")).toBeNull();
    expect(block.querySelector(".timeline-rows")).toBeNull();
    const text = screenText(view.getByTestId("timeline"));
    expect(text).not.toMatch(/index-structure|benchmark|3f2a1c9/);
    expect(text).not.toContain("가린 문장");
  });

  test("a worker run a card started opens its own page from the card even though the board does not list it", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const link = view.getByTestId("timeline").querySelector('a[href="#/runs/r1"]') as HTMLAnchorElement;
    expect(link.textContent).toMatch(/^(어제 )?\d\d:\d\d · 진행 중$/);
    fireEvent.click(link);
    await waitFor(() => expect(view.queryByTestId("screen-run")).not.toBeNull());
    await waitFor(() => expect(view.getByTestId("screen-run").querySelector("[data-testid=timeline]")).not.toBeNull());
    expect(view.getByTestId("screen-run").querySelector(".detail-title")?.textContent).toBe("릴리스 변경 목록 정리");
    expect(view.getByTestId("screen-run").querySelector('a[href="#/cards/k-101"]')).not.toBeNull();
    view.unmount();
    // Opened on its own, before its card: the run's record names its card, which the page reads and shows.
    const run = await open("#/runs/r1", { wide: true });
    await waitFor(() => expect(run.getByTestId("timeline")).toBeTruthy());
    expect(run.getByTestId("screen-run").querySelector(".detail-title")?.textContent).toBe("릴리스 변경 목록 정리");
    expect(run.getByTestId("screen-run").querySelector('a[href="#/cards/k-101"]')).not.toBeNull();
  });

  test("a worker change event refetches that run's record in place: the new line shows, the blocks and their open state stay", async () => {
    vi.useFakeTimers(TIMERS);
    try {
      const source = new SyntheticSource();
      const view = await open("#/cards/k-101", { wide: true, source });
      await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
      const blocks = view.getAllByTestId("timeline-block");
      const older = blocks[2] as HTMLDetailsElement;
      older.open = false;
      fireEvent(older, new Event("toggle"));
      const read = vi.spyOn(source, "read");
      source.recordSays("r1", "표 형식으로 바꾸는 중");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STREAM_TICK_MS * 2);
      });
      await waitFor(() => expect(view.getAllByTestId("timeline-block")[0].textContent).toContain("표 형식으로 바꾸는 중"));
      expect(read.mock.calls.some(([name, id]) => name === "record" && id === "r1")).toBe(true);
      expect(view.getAllByTestId("timeline-block")[0]).toBe(blocks[0]);
      expect((view.getAllByTestId("timeline-block")[2] as HTMLDetailsElement).open).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a failed record read shows one error line in the timeline's place; the rest of the detail keeps working", async () => {
    const view = await open("#/cards/k-101", { wide: true, source: new FailingSource((name) => (name === "record" ? "failed" : null)) });
    await waitFor(() => expect(view.getByTestId("timeline-error").textContent).toBe("읽기 실패: 기록"));
    expect(view.queryAllByTestId("timeline-block")).toHaveLength(0);
    // The worker links never disappear: 실행 stands under the error line.
    const boxes = [...view.getByTestId("screen-card").querySelectorAll(":scope > .box > .box-head")].map((head) => head.textContent);
    expect(boxes).toEqual(["지금", "할 일", "기록", "실행", "댓글"]);
    expect([...view.getByTestId("worker-runs").querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["#/runs/r1", "#/runs/r10", "#/runs/r9"]);
    expect(view.getByTestId("card-now").textContent).toContain("변경마다 한 줄 요약을 붙이는 중");
    expect(within(view.getByTestId("card-comments")).getAllByTestId("history-row")).toHaveLength(4);
  });
});

describe("#13 audit, round 7", () => {
  beforeEach(() => setWide(true));

  test("an owner to-do an open decision targets by id shows once, as the decision, in the inbox, the sidebar and the bell", async () => {
    const source = new SyntheticSource();
    const board = source.scene.board;
    // T2 is a decision; the core also lists it as the owner's to-do, with its own notice.
    board.inbox.mine.push({ id: "T2", title: "배포 순서 정하기", waiting: false, due: null, agent: "ag-1" });
    board.notices.push({ key: "todo:T2:1", target: "T2", at: board.at - 60, kind: "todo", line: "배포 순서 정하기: 내 할 일", read: false });
    board.counts.unread = (board.counts.unread ?? 0) + 1;
    // A to-do with similar words but its own id stays.
    const view = await open("#/inbox", { wide: true, source });
    const inbox = view.getByTestId("screen-inbox");
    expect(inbox.querySelectorAll('a[href="#/items/T2"], button[aria-label*="배포를 금요일"]')).toHaveLength(1);
    expect(rowsIn(inbox)).toBe(SCENE_COUNTS.inbox);
    expect(count(view.getByTestId("nav-inbox").querySelector("[data-testid=nav-count]"))).toBe(SCENE_COUNTS.inbox);
    expect(view.getByRole("button", { name: `알림 ${SCENE_COUNTS.unread}` })).toBeTruthy();
  });

  test("an all-agent goal counts all agents' to-dos; an agent's view counts only its own, another agent's goal included", async () => {
    const all = await open("#/goals", { wide: true });
    const allLabel = all.container.querySelector('.list-pane a[href="#/goals/G5"]')?.getAttribute("aria-label");
    expect(allLabel).toMatch(/검색 속도 개선 · 0\/2$/);
    all.unmount();
    const owner = await open("#/agents/ag-2", { wide: true });
    expect(owner.getByTestId("section-goals").querySelector('a[href="#/goals/G5"]')?.getAttribute("aria-label")).toBe("검색 속도 개선 · 0/1");
    owner.unmount();
    const other = await open("#/agents/ag-3", { wide: true });
    const goals = other.getByTestId("section-goals");
    expect(goals.querySelector('a[href="#/goals/G5"]')?.getAttribute("aria-label")).toBe("검색 속도 개선 · 0/1");
    expect(rowsIn(goals)).toBe(count(other.getByTestId("agent-count-goals").querySelector(".count")));
  });

  test("a card's detail head names the goal it serves beside its state and reason", async () => {
    const view = await open("#/cards/k-103", { wide: true });
    expect(view.getByTestId("card-goal").textContent).toBe("목표 · 결제 화면 개편");
    expect(view.container.querySelector(".detail-head [data-testid=state]")?.textContent).toBe("중단됨 · 응답 없음");
  });
});

describe("the work tab's first screen (lina-app#124)", () => {
  test("at 390 the first screen is the lines: the first running row reads without a tap, and the menu opens from the header", async () => {
    const view = await open("#/", { wide: false });
    const running = within(view.getByTestId("screen-running")).getByRole("list", { name: "진행 중인 작업" });
    expect(running.querySelector("[data-testid=row] .title")?.textContent).toBeTruthy();
    expect(view.queryByTestId("sidebar")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "메뉴" }));
    const menu = view.getByRole("dialog", { name: "메뉴" });
    for (const id of ["nav-today", "nav-inbox", "nav-due", "nav-done", "nav-goals"]) expect(within(menu).getByTestId(id)).toBeTruthy();
    expect(within(menu).getByRole("list", { name: "에이전트" })).toBeTruthy();
    fireEvent.click(within(menu).getByTestId("nav-done").querySelector("a") as HTMLElement);
    await waitFor(() => expect(view.getByTestId("screen-title").textContent).toBe("완료"));
    expect(view.queryByRole("dialog", { name: "메뉴" })).toBeNull();
    expect(view.getByTestId("back").textContent).toBe("작업");
  });

  describe.each([
    ["1280", true],
    ["390", false],
  ])("at %s", (_width, wide) => {
    test("the owner's to-dos and the review items are their own groups beside the decisions line", async () => {
      const view = await open("#/", { wide });
      const screen = view.getByTestId("screen-running");
      expect(view.getByTestId("home-decisions")).toBeTruthy();
      expect(rowsIn(within(screen).getByRole("list", { name: "검토 필요" }))).toBe(1);
      fireEvent.click(within(screen).getByRole("button", { name: "내 할 일 2" }));
      expect(rowsIn(within(screen).getByRole("list", { name: "내 할 일" }))).toBe(2);
      expect(window.location.hash).not.toBe("#/inbox");
    });

    test("no row is untitled, and no line counts the work nothing names (lina-app#141)", async () => {
      for (const hash of ["#/", "#/running"]) {
        const view = await open(hash, { wide, source: new SyntheticSource({ endedRuns: true }) });
        const screen = view.getByTestId("screen-running");
        expect([...screen.querySelectorAll("[data-testid=row] .title")].map((title) => title.textContent)).not.toContain("제목 없음");
        expect(view.queryByTestId("home-untitled")).toBeNull();
        view.unmount();
      }
    });

    test("every group header's number is the rows under it, the finished groups included, and the runs r7 and r8 are no row", async () => {
      for (const source of [new SyntheticSource(), new SyntheticSource({ endedRuns: true })]) {
        const view = await open("#/", { wide, source });
        const sections = view.getByTestId("screen-running").querySelectorAll("[data-testid^=section-]");
        const ids = [...sections].map((section) => section.getAttribute("data-testid"));
        expect(ids).toEqual(expect.arrayContaining(["section-active", "section-recent"]));
        for (const section of sections) {
          expect(rowsIn(section) - stoppedRows(section), section.getAttribute("data-testid") ?? "").toBe(count(section.querySelector("[data-testid=count]")));
          expect(stoppedRows(section)).toBe(count(section.querySelector("[data-testid=stopped-count]")));
        }
        expect(view.container.querySelectorAll('a[href="#/runs/r7"], a[href="#/runs/r8"]')).toHaveLength(0);
        view.unmount();
      }
    });

    test("the add button is not drawn while no write route exists", async () => {
      const view = await open("#/", { wide });
      expect(view.queryByTestId("quick-add")).toBeNull();
      expect(view.container.querySelector("button[disabled][aria-label='할 일 추가']")).toBeNull();
    });
  });
});

describe("the work tab list (lina-app#141)", () => {
  const home = (view: ReturnType<typeof render>) => view.getByTestId("screen-running");

  describe.each([
    ["1280", true],
    ["390", false],
  ])("at %s", (_width, wide) => {
    test("the groups read decisions, stopped, running, then the owner's to-dos folded to one line, then the recently done", async () => {
      const view = await open("#/", { wide });
      const screen = home(view);
      const lists = [...screen.querySelectorAll("ul.rows")].map((list) => list.getAttribute("aria-label"));
      // 검토 필요 holds k-104, a card waiting on the owner's review: it reads with the decisions.
      expect(lists).toEqual(["수신함", "검토 필요", "중단됨", "진행 중인 작업", "예정", "내 할 일", "최근 완료"]);
      // Folded: one line with the count, no to-do row until it is opened.
      const fold = within(screen).getByRole("button", { name: "내 할 일 2" });
      expect(fold.getAttribute("aria-expanded")).toBe("false");
      expect(screen.querySelectorAll(".check-row")).toHaveLength(0);
      fireEvent.click(fold);
      expect(fold.getAttribute("aria-expanded")).toBe("true");
      expect(within(screen).getByTestId("home-mine").querySelectorAll(".check-row")).toHaveLength(2);
    });

    test("no worker run is a row, and no row or line is untitled", async () => {
      const source = new SyntheticSource({ endedRuns: true });
      // r20 named only in Latin with no to-do: it used to read 이름 없는 실행.
      const scene = { ...source.scene, board: { ...source.scene.board, cards: source.scene.board.cards.map((run) => (run.id === "r20" ? { ...run, title: "device smoke node-a", todo: null } : run)) } };
      for (const each of [new SyntheticSource(), new SyntheticSource({ endedRuns: true }), new SyntheticSource({ scene })]) {
        const view = await open("#/", { wide, source: each });
        const screen = home(view);
        fireEvent.click(within(screen).getByRole("button", { name: /^내 할 일 / }));
        expect(screen.querySelectorAll('a[href^="#/runs/"]')).toHaveLength(0);
        expect(screenText(screen)).not.toMatch(/이름 없는 실행|제목 없음|제목 없는 \d+건/);
        expect(view.queryByTestId("home-untitled")).toBeNull();
        view.unmount();
      }
    });

    test("a stopped row shows the core's ask under its title, and nothing when the core has none", async () => {
      const view = await open("#/", { wide, source: new SyntheticSource({ endedRuns: true }) });
      const list = within(home(view)).getByRole("list", { name: "중단됨" });
      const row = (href: string) => list.querySelector(`li:has(> a[href="${href}"])`) as Element;
      const ask = row("#/cards/k-108").querySelector("[data-testid=stop-ask]");
      expect(ask?.textContent).toBe("야간 보고서를 받을 사람 확인 필요");
      expect(ask?.previousElementSibling?.classList.contains("title")).toBe(true);
      expect(ask?.classList.contains("one-line")).toBe(true);
      expect(row("#/cards/k-108").querySelector("a")?.getAttribute("aria-label")).toContain("야간 보고서를 받을 사람 확인 필요");
      expect(list.querySelectorAll("[data-testid=stop-ask]")).toHaveLength(1);
      // k-107 has no ask; another stopped row shares its goal's title, so its own name is its second line (lina-app#148).
      expect(row("#/cards/k-107").querySelector("[data-testid=stop-ask]")).toBeNull();
      expect(row("#/cards/k-107").querySelector("[data-testid=row-sub]")?.textContent).toBe("결제: 영수증 문구 정하기");
    });

    test("a row is titled by the core's goalTitle first, and by its own names when goalTitle is null", async () => {
      const source = new SyntheticSource({ endedRuns: true });
      const scene = { ...source.scene, cards: { cards: source.scene.cards.cards.map((card) => (card.id === "k-112" ? { ...card, goalTitle: "배포 절차 정비" } : card.id === "k-108" ? { ...card, goalTitle: null } : card)) } };
      const view = await open("#/", { wide, source: new SyntheticSource({ scene }) });
      const list = within(home(view)).getByRole("list", { name: "중단됨" });
      const title = (href: string) => list.querySelector(`li:has(> a[href="${href}"]) .title`)?.textContent;
      expect(title("#/cards/k-112")).toBe("배포 절차 정비");
      expect(title("#/cards/k-108")).toBe("야간 보고서 정리하기");
    });
  });
});

describe("test environment teardown", () => {
  test("an effect left pending when the environment is torn down does not throw", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    function Pending() {
      const [ran, setRan] = useState(false);
      useEffect(() => setRan(true), []);
      return <span>{ran ? "ran" : "pending"}</span>;
    }

    // testing-library's render runs inside act, which flushes effects and their
    // after-paint flush. Rendering with preact directly leaves the effect in
    // preact's after-paint queue, as a test that ends mid-update does.
    renderPreact(<Pending />, container);

    // The same flush src/test-setup.ts runs before a file's environment goes.
    // The setup before this fix had no such step, so the effect is still
    // pending below and its fallback timer throws once the globals are gone.
    const { flushAfterPaint } = (await import("./test-setup")) as {
      flushAfterPaint?: () => Promise<void>;
    };
    await flushAfterPaint?.();

    // vitest's jsdom teardown deletes the window globals. A preact fallback
    // timer still pending then calls cancelAnimationFrame and throws, which
    // vitest reports as an unhandled error and fails the run for.
    const cancelAnimationFrame = globalThis.cancelAnimationFrame;
    delete (globalThis as { cancelAnimationFrame?: typeof globalThis.cancelAnimationFrame }).cancelAnimationFrame;
    let text: string | null;
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      text = container.textContent;
    } finally {
      globalThis.cancelAnimationFrame = cancelAnimationFrame;
      renderPreact(null, container);
      container.remove();
    }

    expect(text).toBe("ran");
    expect(flushAfterPaint).toBeTypeOf("function");
  });
});

describe("a card's detail (lina-app#128)", () => {
  beforeEach(() => setWide(true));
  const TIME = "(?:어제 |\\d+월 \\d+일 )?\\d\\d:\\d\\d";
  const EVENT = new RegExp(`^${TIME} · \\S`);

  test("a to-do mark the card cannot change is a plain status mark: no control, no action name", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    const todos = within(view.getByRole("list", { name: "할 일" }));
    expect(todos.queryAllByRole("checkbox")).toEqual([]);
    expect(todos.queryAllByRole("button")).toEqual([]);
    expect(view.getByTestId("screen-card").querySelectorAll('[aria-label$="완료로 표시"], [aria-disabled="true"]')).toHaveLength(0);
    const rows = todos.getAllByTestId("row").map((row) => row.textContent);
    expect(rows).toEqual(["완료변경 목록 모으기", "모은 변경 확인", "공지 문구 확인"]);
  });

  test("a card's worker run reads its work's title and a state word, never 코드 작업, on its page and on the card's lines", async () => {
    const run = await open("#/runs/r1", { wide: true });
    await waitFor(() => expect(run.getByTestId("timeline")).toBeTruthy());
    expect(run.getByTestId("screen-run").querySelector(".detail-title")?.textContent).toBe("릴리스 변경 목록 정리");
    expect(run.getByTestId("run-state").textContent).toBe("진행 중");
    expect(run.getByTestId("detail-pane").getAttribute("aria-label")).toBe("릴리스 변경 목록 정리");
    expect(screenText(run.container)).not.toContain("코드 작업");
    run.unmount();
    // k-104's worker run r4 has no record: 실행 stands, one line per run with its time and state word; the card's
    // title is its head's, never repeated on its runs (lina-app#142).
    const card = await open("#/cards/k-104", { wide: true });
    const lines = within(card.getByTestId("worker-runs")).getAllByRole("link");
    expect(lines.map((line) => line.getAttribute("aria-label"))).toEqual([expect.stringMatching(new RegExp(`^${TIME} · 완료 기록 없음$`))]);
    expect(card.getByTestId("screen-card").querySelector(".detail-title")?.textContent).toBe("결제: 실패 화면 검토");
    expect(screenText(card.container)).not.toContain("코드 작업");
  });

  test("a run's record never shows a model alias; a model with a name reads by its name", async () => {
    for (const hash of ["#/runs/r1", "#/runs/r8", "#/cards/k-101"]) {
      const view = await open(hash, { wide: true });
      await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
      expect(screenText(view.container), hash).not.toMatch(/model-[a-z]/);
      view.unmount();
    }
    const scene = new SyntheticSource({ now: Math.floor(Date.now() / 1000) }).scene;
    const models = scene.settings.models.map((model) => (model.id === "model-a" ? { ...model, name: "가온 큰 모델" } : model));
    const named = await open("#/runs/r1", { wide: true, source: new SyntheticSource({ now: scene.now, scene: { ...scene, settings: { ...scene.settings, models } } }) });
    await waitFor(() => expect(named.container.querySelector(".detail-head [data-testid=run-model]")?.textContent).toBe("가온 큰 모델 · 보통"));
  });

  test("history lists one line per event, time · one sentence, with no round number as a heading", async () => {
    const view = await open("#/cards/k-101", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const timeline = view.getByTestId("timeline");
    expect(screenText(timeline)).not.toContain("라운드");
    const heads = [...timeline.querySelectorAll(".timeline-head")].map((head) => head.textContent);
    expect(heads[0]).toMatch(new RegExp(`^${TIME} · 진행 중$`));
    const rounds = [...timeline.querySelectorAll(".timeline-head")].map((head) => head.textContent ?? "").filter((head) => head !== "댓글");
    const lines = [...rounds, ...[...timeline.querySelectorAll("li.timeline-row")].map((row) => row.textContent ?? "")];
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) expect(line).toMatch(EVENT);
    expect(lines).toContainEqual(expect.stringMatching(new RegExp(`^${TIME} · 완료 · 병합된 변경 41개를 모음$`)));
  });

  test("a finished run outside any card lists its past events: started, then what it left", async () => {
    const view = await open("#/runs/r7", { wide: true });
    await waitFor(() => expect(view.getByTestId("timeline")).toBeTruthy());
    const lines = [...view.getByTestId("timeline").querySelectorAll(".timeline-row")].map((row) => row.textContent ?? "");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(new RegExp(`^${TIME} · 작업 시작$`));
    expect(lines[1]).toMatch(new RegExp(`^${TIME} · 용어 표를 맨 앞으로 옮김$`));
  });
});
