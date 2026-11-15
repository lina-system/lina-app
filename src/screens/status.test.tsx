import { render, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Machine, PersonDevice, RunnerCell, Settings, StatusChecks } from "../api/client";
import { App } from "../app";
import { SyntheticSource } from "../data/synthetic-source";
import { Store } from "../data/store";

// lina-app#144: the status tab on the hub's real shapes (/api/lina/devices and /api/lina/status/checks, 11-14).
// Names are invented; the fields, their nulls and the check's line are the hub's own.

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function open(source: SyntheticSource) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", "/app/#/status");
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return view;
}

const fresh = () => new SyntheticSource({ now: Math.floor(Date.now() / 1000) });

const runner = (name: string, fields: Partial<RunnerCell> = {}): RunnerCell => ({ name, type: "command", fleet: null, installed: null, signIn: null, signingIn: false, ready: null, why: null, ...fields });

/** A node as the hub served it: no metrics source, so cpu, memory and disk are null with metricsWhy. */
const node = (name: string, fields: Partial<Machine> & { metricsWhy?: string | null } = {}): Machine =>
  ({
    name,
    state: "ok",
    why: null,
    cpu: null,
    memory: null,
    disk: null,
    temp: null,
    metricsAt: null,
    metricsWhy: "no_source",
    load: 0.35,
    cores: 24,
    running: 0,
    cap: 9,
    freeGb: 603,
    role: "work",
    reachable: true,
    runners: [runner("omo", { type: "omo", fleet: "5.1.69", installed: "5.1.69", signIn: "magpie" as RunnerCell["signIn"], ready: true })],
    ...fields,
  }) as Machine;

/** An owner's Mac as the hub served it: unreachable, every tool null, omo listed twice. */
const mac = (name: string, reachable: boolean | null, installed: string | null = null): PersonDevice =>
  ({
    name,
    role: "person",
    reachable,
    checkedAt: 1794600173.8,
    tools: ["omo", "codex", "claude", "dsh", "grok", "cursor-agent", "agy", "omo"].map((tool) => ({ name: tool, fleet: "1.0", installed })),
  }) as PersonDevice;

const rowOf = (view: Awaited<ReturnType<typeof open>>, name: string) => {
  const row = [...view.getByRole("list", { name: "기기" }).querySelectorAll(".machine-row")].find((item) => item.querySelector(".title")?.textContent === name);
  expect(row).toBeTruthy();
  return row as HTMLElement;
};

/** A node's runner cells in the hub's order: the cells name runners by display name, never by id (lina-app#150). */
const cellsOf = (row: HTMLElement) => [...row.querySelectorAll("[data-testid=runner-cell]")] as HTMLElement[];

const RUNNER_SYNC =
  'hold: dsh on hub 0.2.2-rc.1 (trial): trial: ACP error: Internal error: turn failed: llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service (the web Mo';

/** Product names and short abbreviations a Korean line may keep (lina-app#178). */
const KEPT = /DeepSeek|OCX|API|PR|QA/g;

/** A check row shows its Korean line, state word and age only: no 자세히, and none of the engine's English (lina-app#178). */
function expectKoreanOnly(row: HTMLElement) {
  expect(row.querySelector("details")).toBeNull();
  expect(row.textContent).not.toContain("자세히");
  expect((row.textContent ?? "").replace(KEPT, "")).not.toMatch(/[A-Za-z]/);
}
/** One Korean line for it: the check, the tool it names and why, all from the glossary (lina-app#160). */
const RUNNER_SYNC_TITLE = "실행기 업데이트 보류 · DeepSeek · API 키 없음";

describe("status tab on the hub's real shapes (lina-app#144)", () => {
  test("a check whose line is not Korean reads one Korean line, with no 자세히 and none of the line (lina-app#178)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const at = now - 20 * 60;
    const checks: StatusChecks = {
      version: 1,
      at,
      checks: [
        { name: "runner-sync", ok: false, line: RUNNER_SYNC, at, staleAfter: 172800, stale: false, state: "failing", file: "runner-sync.json" },
        { name: "night-probe", ok: false, line: "fail: probe timed out", at, staleAfter: 3600, stale: false, state: "failing", file: "night-probe.json" },
      ],
    };
    const view = await open(new SyntheticSource({ now, scene: { ...fresh().scene, checks } }));
    const rows = [...view.getByRole("list", { name: "점검" }).querySelectorAll(".status-check-row")] as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.querySelector(".title")?.textContent)).toEqual([RUNNER_SYNC_TITLE, "점검 실패 · 시간 초과"]);
    for (const row of rows) expectKoreanOnly(row);
  });

  test("an unreachable node and the owner's Macs read 연결 끊김 and nothing else, and each block counts itself", async () => {
    const source = fresh();
    source.scene.devices.machines = [
      node("모래톱"),
      node("솔방울", { reachable: false, state: "down", why: "unreachable", metricsWhy: "down", runners: [runner("omo", { why: "unreachable", fleet: "5.1.69" })] }),
    ];
    source.scene.devices.person = [mac("먹물", false), mac("벼루", false)];
    const view = await open(source);
    const down = rowOf(view, "솔방울");
    expect(down.querySelectorAll("[data-testid=runner-cell]")).toHaveLength(0);
    expect(down.textContent).not.toContain("—");
    expect(down.querySelector(".mini-meters")).toBeNull();
    expect(down.textContent).toBe("솔방울꺼짐 · 연결 끊김");
    const people = [...view.getByRole("list", { name: "내 기기" }).querySelectorAll(".person-row")];
    expect(people.map((row) => row.textContent)).toEqual(["먹물연결 끊김", "벼루연결 끊김"]);
    expect(view.getByTestId("section-machines").querySelector(".section-head")?.textContent).toBe("작업 기기 2 · 정상 1 · 꺼짐 1");
    expect(view.getByTestId("section-person").querySelector(".section-head")?.textContent).toBe("내 기기 2 · 연결 끊김 2");
  });

  test("a reachable Mac lists each tool once, and a tool with no version shows no dash", async () => {
    const source = fresh();
    source.scene.devices.person = [mac("먹물", true, "1.0"), mac("벼루", true)];
    const view = await open(source);
    const [first, second] = [...view.getByRole("list", { name: "내 기기" }).querySelectorAll(".person-row")];
    expect([...first.querySelectorAll(".person-tool")].map((tool) => tool.textContent)).toEqual(["OMO 1.0", "Codex 1.0", "Claude 1.0", "DeepSeek 1.0", "Grok 1.0", "Cursor 1.0", "Antigravity 1.0"]);
    expect(second.textContent).not.toContain("—");
    expect(view.getByTestId("section-person").querySelector(".section-head")?.textContent).toBe("내 기기 2 · 연결됨 2");
  });

  test("no runner stays on 확인 중: no sign-in answer shows the version only, an update shows installed → fleet", async () => {
    const source = fresh();
    source.scene.devices.machines = [
      node("모래톱", {
        runners: [
          runner("dsh", { type: "acp", fleet: "0.2.1-rc.5", installed: "0.2.1-rc.5", signIn: "unknown", ready: null }),
          runner("dsh-command"),
          runner("cursor", { why: "unknown", installed: "2026.11.11" }),
          runner("omo", { type: "omo", fleet: "5.1.69", installed: "5.1.60", signIn: "magpie" as RunnerCell["signIn"], ready: false, why: "update" }),
        ],
      }),
      node("물레방아", {
        role: "files",
        runners: [runner("omo", { type: "omo", fleet: "5.1.69", installed: "omo 5.1.51 (engine: senpi 2026.10.27-1)", signIn: "magpie" as RunnerCell["signIn"], ready: false, why: "update" })],
      }),
    ];
    const view = await open(source);
    expect(view.getByTestId("section-machines").textContent).not.toContain("확인 중");
    // Each runner reads by its tool's display name; the command runner of a tool another runner names says so (lina-app#156).
    const [dsh, dshCommand, cursor, omo] = cellsOf(rowOf(view, "모래톱"));
    expect(dsh.textContent).toBe("DeepSeek0.2.1-rc.5");
    expect(dshCommand.textContent).toBe("DeepSeek 명령확인 안 됨");
    expect(cursor.textContent).toBe("Cursor2026.11.11");
    expect(omo.textContent).toBe("OMO업데이트 필요5.1.60 → 5.1.69");
    expect(cellsOf(rowOf(view, "물레방아"))[0].textContent).toBe("OMO업데이트 필요5.1.51 → 5.1.69");
  });

  test("a node without readings says why once, after a dash for each reading it lacks (lina-app#150)", async () => {
    const source = fresh();
    source.scene.devices.machines = [
      node("모래톱", { metricsWhy: "no_source" }),
      node("솔방울", { metricsWhy: "unknown" }),
      node("물레방아", { metricsWhy: "down" }),
      node("바람개비", { cpu: 22, memory: 41, disk: 37, metricsWhy: null }),
      node("징검다리", { cpu: 22, memory: null, disk: 37, metricsWhy: "unknown" }),
    ];
    const view = await open(source);
    const readings = (name: string) => rowOf(view, name).querySelector(".mini-meters") as HTMLElement;
    for (const [name, line] of [
      ["모래톱", "측정 원본 없음"],
      ["솔방울", "측정 기록 없음"],
      ["물레방아", "기기 응답 없음"],
    ] as const) {
      expect(readings(name).textContent).toBe(`CPU—메모리—디스크—${line}`);
      expect(readings(name).querySelectorAll(".meter")).toHaveLength(0);
      expect(rowOf(view, name).querySelector(".row-body")?.getAttribute("aria-label")).toContain(line);
    }
    expect(readings("바람개비").querySelectorAll(".meter")).toHaveLength(3);
    expect(readings("바람개비").textContent).toBe("CPU22%메모리41%디스크37%");
    expect(readings("징검다리").querySelectorAll(".meter")).toHaveLength(2);
    expect(readings("징검다리").textContent).toBe("CPU22%메모리—디스크37%측정 기록 없음");
  });

  test("다시 시작 says what it restarts, and is gone while the node is down", async () => {
    const source = fresh();
    source.scene.devices.machines = [node("모래톱"), node("솔방울", { reachable: false, state: "down", why: "unreachable", metricsWhy: "down" })];
    const view = await open(source);
    const button = within(rowOf(view, "모래톱")).getByRole("button", { name: "모래톱 서비스 다시 시작" });
    expect(button.textContent).toBe("서비스 다시 시작");
    expect(within(rowOf(view, "솔방울")).queryByRole("button")).toBeNull();
  });
});

// lina-app#150: QA round 4 on the hub's /api/lina/devices and /api/lina/status/checks (11-14). Invented names; the
// values, the runners with every field null and metricsWhy are the hub's own shapes.
describe("status tab, QA round 4 (lina-app#150)", () => {
  test("each reading draws its percent beside its bar, the hub's fractions rounded", async () => {
    const source = fresh();
    source.scene.devices.machines = [node("모래톱", { cpu: 0.68, memory: 12.55, disk: 32.7, metricsWhy: null })];
    const view = await open(source);
    const meters = [...rowOf(view, "모래톱").querySelectorAll("[data-testid=machine-meter]")] as HTMLElement[];
    expect(meters.map((meter) => meter.textContent)).toEqual(["CPU1%", "메모리13%", "디스크33%"]);
    expect(meters.map((meter) => meter.querySelectorAll(".meter").length)).toEqual([1, 1, 1]);
    expect(rowOf(view, "모래톱").querySelector(".mini-none")).toBeNull();
  });

  test("a runner with no version and no state reads 확인 안 됨, never a bare name", async () => {
    const source = fresh();
    source.scene.devices.machines = [node("모래톱", { cpu: 11.8, memory: 34.79, disk: 19.07, metricsWhy: null, runners: [runner("omo", { type: "omo", fleet: "5.1.69", installed: "5.1.69", signIn: "magpie" as RunnerCell["signIn"], ready: true }), runner("dsh-command"), runner("aside"), runner("cursor")] })];
    const view = await open(source);
    const cells = cellsOf(rowOf(view, "모래톱"));
    expect(cells).toHaveLength(4);
    for (const cell of cells.slice(1)) expect(cell.querySelector(".runner-detail")?.textContent).toBe("확인 안 됨");
  });

  test("runners read by their tool's display name, whether or not the settings list them; never one name for every runner (lina-app#152, #156)", async () => {
    const source = fresh();
    const ids = ["omo", "codex-command", "dsh-command", "claude-command", "omo-astra"];
    const settings = source.scene.settings.revisions.at(-1) as Settings;
    settings.worker = { ...settings.worker, runners: Object.fromEntries(ids.slice(1).map((id) => [id, { type: "command" }])) };
    source.scene.devices.machines = [node("모래톱", { cpu: 11.8, memory: 34.79, disk: 19.07, metricsWhy: null, runners: [...ids.map((id) => runner(id, { fleet: "1.0", installed: "1.0", ready: true })), runner("aside")] })];
    const view = await open(source);
    const names = cellsOf(rowOf(view, "모래톱")).map((cell) => cell.querySelector(".runner-name")?.textContent);
    expect(names).toEqual(["OMO", "Codex", "DeepSeek", "Claude", "OMO Astra", "Aside"]);
    expect(view.getByTestId("section-machines").textContent).not.toContain("실행기");
  });

  test("a check cut by the hub mid-word reads a neutral summary, and none of the cut line shows", async () => {
    const now = Math.floor(Date.now() / 1000);
    const at = now - 2 * 60 * 60;
    const checks: StatusChecks = { version: 1, at, checks: [{ name: "runner-sync", ok: false, line: RUNNER_SYNC, at, staleAfter: 172800, stale: false, state: "failing", file: "runner-sync.json" }] };
    const view = await open(new SyntheticSource({ now, scene: { ...fresh().scene, checks } }));
    const row = view.getByRole("list", { name: "점검" }).querySelector(".status-check-row") as HTMLElement;
    expect(row.querySelector(".title")?.textContent).toBe(RUNNER_SYNC_TITLE);
    expect(row.querySelector(".check-state")?.textContent).toBe("실패");
    expectKoreanOnly(row);
  });

  test("요약 중단됨 stays out of the header and shows in 점검 only", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
    window.history.replaceState(null, "", "/app/#/status");
    const view = render(<App store={new Store(new SyntheticSource({ writerStopped: true }))} />);
    await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
    expect(view.getByTestId("freshness").textContent).toBe("");
    expect(view.queryByTestId("summaries-stopped")).toBeNull();
    const row = view.getByTestId("summaries-check");
    expect(view.getByRole("list", { name: "점검" }).contains(row)).toBe(true);
    expect(row.textContent).toBe("요약 중단됨");
  });
});

// lina-app#152: QA round 5 on the hub's real responses (11-14). Invented names and text; the length and the cut are the hub's.
describe("status tab, QA round 5 (lina-app#152)", () => {
  test("an English check line the hub cut at 200 characters mid-word reads one Korean line, and none of the line shows", async () => {
    const now = Math.floor(Date.now() / 1000);
    const full = "fail: night probe could not reach the backup line within the window and gave up after several attempts; ".repeat(4);
    const line = full.slice(0, 200);
    // The hub's cut ends inside a word, with no bracket or quote left open.
    expect(/[A-Za-z]$/.test(line) && /[A-Za-z]/.test(full[200])).toBe(true);
    const checks: StatusChecks = { version: 1, at: now, checks: [{ name: "night-probe", ok: false, line, at: now - 60, staleAfter: 3600, stale: false, state: "failing", file: "night-probe.json" }] };
    const view = await open(new SyntheticSource({ now, scene: { ...fresh().scene, checks } }));
    const row = view.getByRole("list", { name: "점검" }).querySelector(".status-check-row") as HTMLElement;
    expect(row.querySelector(".title")?.textContent).toBe("점검 실패");
    expectKoreanOnly(row);
  });

  test("a phone's 상태 says how many machines once: the machines head, no second line above it", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    window.history.replaceState(null, "", "/app/#/status");
    const view = render(<App store={new Store(fresh())} />);
    await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
    await waitFor(() => expect(view.getByTestId("section-machines").querySelector(".section-head")?.textContent).toBe("작업 기기 4 · 정상 2 · 경고 1 · 꺼짐 1"));
    const lines = [...view.container.querySelectorAll("*")].filter((element) => element.children.length === 0 || element.matches("[data-testid=device-line]")).map((element) => element.textContent ?? "");
    expect(lines.filter((text) => /^(작업 )?기기 \d+/.test(text))).toEqual(["작업 기기 4 · 정상 2 · 경고 1 · 꺼짐 1"]);
  });
});

// lina-app#156: QA round 6 on the hub's /api/lina/devices and /api/lina/status/checks (11-15). Invented device names;
// the runner keys, their types and the check line's length and cut are the hub's own shapes.
describe("status tab, QA round 6 (lina-app#156)", () => {
  test("a runner reads one display name per tool: no -command suffix, an alias by its tool's name, never twice on one device", async () => {
    const source = fresh();
    const keys: [string, RunnerCell["type"]][] = [["omo", "omo"], ["grok", "acp"], ["dsh", "acp"], ["claude", "acp"], ["grok-command", "command"], ["dsh-command", "command"], ["claude-command", "command"], ["codex-command", "command"], ["aside", "command"], ["agy", "acp"], ["cursor", "command"], ["omo-astra", "omo"]];
    source.scene.devices.machines = [node("모래톱", { cpu: 11.8, memory: 34.79, disk: 19.07, metricsWhy: null, runners: keys.map(([name, type]) => runner(name, { type, fleet: "1.0", installed: "1.0", ready: true })) })];
    const view = await open(source);
    const names = cellsOf(rowOf(view, "모래톱")).map((cell) => cell.querySelector(".runner-name")?.textContent ?? "");
    expect(names).toEqual(["OMO", "Grok", "DeepSeek", "Claude", "Grok 명령", "DeepSeek 명령", "Claude 명령", "Codex", "Aside", "Antigravity", "Cursor", "OMO Astra"]);
    expect(new Set(names).size).toBe(names.length);
    expect(names.join(" ")).not.toMatch(/-command|omo-astra|\bagy\b/);
  });

  test("an owner's Mac lists each tool once by its display name", async () => {
    const source = fresh();
    source.scene.devices.person = [mac("등대", true, "1.0")];
    const view = await open(source);
    const tools = [...view.container.querySelectorAll(".person-tool")].map((tool) => tool.textContent);
    expect(tools).toEqual(["OMO 1.0", "Codex 1.0", "Claude 1.0", "DeepSeek 1.0", "Grok 1.0", "Cursor 1.0", "Antigravity 1.0"]);
  });

  test("an English check line reads one Korean line with its age, and none of the raw text", async () => {
    const now = Math.floor(Date.now() / 1000);
    const line = `hold: tool on node 0.2.2-rc.1 (trial): trial: ACP error: Internal error: turn failed: fake-route: no API key for provider route "fake-official"; store FAKE_API_KEY through the credentials service (the web Mo`;
    const checks: StatusChecks = { version: 1, at: now, checks: [{ name: "runner-sync", ok: false, line, at: now - 3 * 60 * 60, staleAfter: 172800, stale: false, state: "failing", file: "runner-sync.json" }] };
    const view = await open(new SyntheticSource({ now, scene: { ...fresh().scene, checks } }));
    const row = view.getByRole("list", { name: "점검" }).querySelector(".status-check-row") as HTMLElement;
    const body = row.querySelector(".row-body") as HTMLElement;
    // A tool the glossary does not know is not named in the Korean line (lina-app#160).
    expect(body.textContent).toMatch(/^실행기 업데이트 보류 · API 키 없음실패3시간 전$/);
    expect(body.getAttribute("aria-label")).toBe("실행기 업데이트 보류 · API 키 없음 · 실패 · 3시간 전");
    expectKoreanOnly(row);
  });
});

// lina-app#160: QA round 7 on the hub's /api/lina/devices (11-15). Invented device names; the tool keys, the versions
// with a build hash, the tools with no version and the warning's reason are the hub's own shapes.
describe("status tab, QA round 7 (lina-app#160)", () => {
  test("a tool an owner's Mac read no version for says 확인 안 됨, as the runners do, and a build hash is never shown", async () => {
    const source = fresh();
    source.scene.devices.person = [
      {
        name: "등대",
        role: "person",
        reachable: true,
        checkedAt: 1794600173.8,
        tools: [
          { name: "omo", fleet: "5.1.69", installed: null },
          { name: "dsh", fleet: "0.2.1-rc.5", installed: "0.2.2-rc.1" },
          { name: "cursor-agent", fleet: "2026.11.13-eacade1", installed: "2026.11.05-86047df" },
          { name: "agy", fleet: "1.5.8", installed: null },
          { name: "omo", fleet: "5.1.69", installed: null },
        ],
      } as PersonDevice,
    ];
    const view = await open(source);
    const tools = [...view.container.querySelectorAll(".person-tool")].map((tool) => tool.textContent);
    expect(tools).toEqual(["OMO 확인 안 됨", "DeepSeek 0.2.2-rc.1", "Cursor 2026.11.05", "Antigravity 확인 안 됨"]);
    expect(view.getByTestId("section-person").textContent).not.toMatch(/86047df|\bdsh\b|\bagy\b/);
  });

  test("a fine runner's version shows no build hash, and dsh and aside read by the glossary", async () => {
    const source = fresh();
    source.scene.devices.machines = [
      node("모래톱", {
        cpu: 11.8,
        memory: 34.79,
        disk: 19.07,
        metricsWhy: null,
        runners: [runner("cursor", { fleet: "2026.11.13-eacade1", installed: "2026.11.13-eacade1", ready: true }), runner("dsh", { type: "acp", installed: "0.2.1-rc.5", ready: true }), runner("aside")],
      }),
    ];
    const view = await open(source);
    expect(cellsOf(rowOf(view, "모래톱")).map((cell) => cell.textContent)).toEqual(["Cursor2026.11.13✓", "DeepSeek0.2.1-rc.5✓", "Aside확인 안 됨"]);
  });

  test("a warning always carries its value or 값 없음", async () => {
    const source = fresh();
    source.scene.devices.machines = [
      node("모래톱", { state: "warn", why: "temp", temp: 85, cpu: 7, memory: 13, disk: 23, metricsWhy: null }),
      node("솔방울", { state: "warn", why: "temp", temp: null, cpu: 7, memory: 13, disk: 23, metricsWhy: null }),
      node("물레방아", { state: "warn", why: "disk", disk: null, cpu: 7, memory: 13, metricsWhy: "unknown" }),
      node("바람개비", { state: "warn", why: "disk", disk: 91, cpu: 7, memory: 13, metricsWhy: null }),
    ];
    const view = await open(source);
    const why = (name: string) => rowOf(view, name).querySelector(".sub")?.textContent;
    expect(why("모래톱")).toBe("경고 · 온도 85°C");
    expect(why("솔방울")).toBe("경고 · 온도 값 없음");
    expect(why("물레방아")).toBe("경고 · 디스크 값 없음");
    // A reading with a meter shows its value beside its bar already.
    expect(why("바람개비")).toBe("경고 · 디스크");
    expect(rowOf(view, "바람개비").querySelector(".mini-meters")?.textContent).toContain("디스크91%");
    expect(rowOf(view, "모래톱").querySelector(".row-body")?.getAttribute("aria-label")).toContain("경고 · 온도 85°C");
  });
});

describe("status tab, QA round 8 (lina-app#167)", () => {
  test("a long check line wraps at a word instead of ending in an ellipsis", async () => {
    const now = Math.floor(Date.now() / 1000);
    const at = now - 20 * 60;
    const checks: StatusChecks = {
      version: 1,
      at,
      checks: [{ name: "runner-sync", ok: false, line: RUNNER_SYNC, at, staleAfter: 172800, stale: false, state: "failing", file: "runner-sync.json" }],
    };
    const view = await open(new SyntheticSource({ now, scene: { ...fresh().scene, checks } }));
    const title = view.getByRole("list", { name: "점검" }).querySelector(".status-check-row .title") as HTMLElement;
    expect(title.textContent).toBe(RUNNER_SYNC_TITLE);
    expect(title.classList.contains("one-line")).toBe(false);
  });
});
