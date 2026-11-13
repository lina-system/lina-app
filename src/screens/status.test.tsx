import { render, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Machine, PersonDevice, RunnerCell, StatusChecks } from "../api/client";
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
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("실시간"));
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

const cellOf = (row: HTMLElement, name: string) => {
  const cell = [...row.querySelectorAll("[data-testid=runner-cell]")].find((item) => item.querySelector(".runner-name")?.textContent === name);
  expect(cell).toBeTruthy();
  return cell as HTMLElement;
};

const RUNNER_SYNC =
  'hold: dsh on hub 0.2.2-rc.1 (trial): trial: ACP error: Internal error: turn failed: llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service (the web Mo';

describe("status tab on the hub's real shapes (lina-app#144)", () => {
  test("a check whose line is not Korean reads one Korean line, with the original folded behind 자세히", async () => {
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
    expect(rows.map((row) => row.querySelector(".title")?.textContent)).toEqual(["실행기 업데이트 보류", "점검 실패"]);
    for (const [row, line] of [
      [rows[0], RUNNER_SYNC],
      [rows[1], "fail: probe timed out"],
    ] as const) {
      const fold = row.querySelector("details") as HTMLDetailsElement;
      expect(fold.open).toBe(false);
      expect(fold.querySelector("summary")?.textContent).toBe("자세히");
      const original = fold.querySelector(".check-original") as HTMLElement;
      expect(original.textContent).toBe(line);
      // Wrapped, never cut by the width.
      expect(original.classList.contains("one-line")).toBe(false);
      expect(row.querySelector(".title")?.textContent).not.toMatch(/[A-Za-z]/);
    }
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
    expect([...first.querySelectorAll(".person-tool")].map((tool) => tool.textContent)).toEqual(["omo 1.0", "codex 1.0", "claude 1.0", "dsh 1.0", "grok 1.0", "cursor-agent 1.0", "agy 1.0"]);
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
    const row = rowOf(view, "모래톱");
    expect(cellOf(row, "dsh").textContent).toBe("dsh0.2.1-rc.5");
    expect(cellOf(row, "dsh-command").textContent).toBe("dsh-command");
    expect(cellOf(row, "cursor").textContent).toBe("cursor2026.11.11");
    expect(cellOf(row, "omo").textContent).toBe("omo업데이트 필요5.1.60 → 5.1.69");
    expect(cellOf(rowOf(view, "물레방아"), "omo").textContent).toBe("omo업데이트 필요5.1.51 → 5.1.69");
  });

  test("a node without readings says why once; numbers still draw as bars", async () => {
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
      expect(readings(name).textContent).toBe(line);
      expect(readings(name).querySelectorAll(".meter")).toHaveLength(0);
      expect(rowOf(view, name).querySelector(".row-body")?.getAttribute("aria-label")).toContain(line);
    }
    expect(readings("바람개비").querySelectorAll(".meter")).toHaveLength(3);
    expect(readings("바람개비").textContent).toBe("CPU메모리디스크");
    expect(readings("징검다리").querySelectorAll(".meter")).toHaveLength(2);
    expect(readings("징검다리").textContent).toBe("CPU디스크측정 기록 없음");
    expect(view.getByTestId("section-machines").textContent).not.toContain("—");
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
