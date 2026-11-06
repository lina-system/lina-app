import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource, type SettingsScript } from "./data/synthetic-source";
import { W } from "./words";

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

function source(settings: SettingsScript | null = null) {
  return new SyntheticSource({ now: Math.floor(Date.now() / 1000), settings });
}

async function open(hash: string, options: { wide?: boolean; source?: SyntheticSource } = {}) {
  setWide(options.wide ?? false);
  window.history.replaceState(null, "", `/app/${hash}`);
  const synthetic = options.source ?? source();
  const view = render(<App store={new Store(synthetic)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("실시간"));
  await waitFor(() => expect(view.container.querySelector("[data-testid=screen-settings], [data-testid=setting-page] .rows")).not.toBeNull());
  return { view, synthetic };
}

/** Another page on the same core: a source that has served nothing yet, over the same scene. */
function again(synthetic: SyntheticSource) {
  return new SyntheticSource({ scene: synthetic.scene });
}

function switchOf(view: ReturnType<typeof render>, label: string): HTMLElement {
  return view.getByRole("switch", { name: label });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the settings screen", () => {
  test("설정 is one line right under 기기·쿼터 in the sidebar and on the phone's first screen", async () => {
    for (const wide of [true, false]) {
      setWide(wide);
      window.history.replaceState(null, "", wide ? "/app/#/running" : "/app/#/");
      const view = render(<App store={new Store(source())} />);
      await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("실시간"));
      const rows = [...view.getByTestId("sidebar").querySelectorAll("li[data-testid^=nav-]")].map((row) => row.getAttribute("data-testid"));
      expect(rows.slice(-2)).toEqual(["nav-status", "nav-settings"]);
      expect(view.getByTestId("nav-settings").querySelector("a")?.getAttribute("href")).toBe("#/settings");
      expect(view.getByTestId("nav-settings").textContent).toContain(W.settings);
      view.unmount();
    }
  });

  test("the groups come in order: warnings, 기본값, 실행기, 배정 규칙, 기기, 모델 (OCX), 기록, then the revision", async () => {
    const { view } = await open("#/settings");
    const screen = view.getByTestId("screen-settings");
    const order = [...screen.children].map((child) => child.getAttribute("data-testid")).filter(Boolean);
    expect(order).toEqual(["settings-warnings", "settings-defaults", "settings-runners", "settings-rules", "settings-devices", "settings-models", "settings-history", "settings-rev"]);
    const warnings = view.getAllByTestId("settings-warning").map((line) => line.textContent);
    expect(warnings).toEqual(["codex 모델의 쿼터가 다 찼습니다 · 다음 실행은 anthropic/model-b로 갑니다", "dsh 모델이 꺼져 있습니다 · 다음 실행은 anthropic/model-b로 갑니다"]);
    const runners = within(view.getByTestId("settings-runners")).getAllByTestId("row").map((row) => row.querySelector(".lines")?.textContent);
    expect(runners).toEqual(["omomodel-a · 높음", "codexmodel-c · 보통", "dshmodel-d"]);
    const rules = [...view.getByTestId("settings-rules").querySelectorAll("[data-testid=rule], [data-testid=rule-other]")].map((row) => row.textContent);
    expect(rules).toEqual(["docs → codex", "quick · S → dsh", "그 외 → omo"]);
    expect(within(view.getByTestId("devices-work")).getAllByTestId("row").map((row) => row.textContent)).toEqual(["machine-a입찰 2 · 지정 2", "machine-b입찰 1 · 지정 1"]);
    expect(within(view.getByTestId("devices-files")).getByTestId("row").textContent).toBe("files-a지정 1");
    expect(view.getByTestId("settings-models").textContent).toContain("켜진 모델 3개");
    expect(view.getByTestId("settings-models").textContent).toContain(W.modelsFoot);
    const history = view.getAllByTestId("history-row").map((row) => row.querySelector(".title")?.textContent ?? "");
    expect(history).toHaveLength(3);
    expect(history[0]).toMatch(/^\d\d-\d\d \d\d:\d\d · 바깥 편집 · /);
    expect(history[1]).toMatch(/ · 앱 · codex 모델 model-c$/);
    expect(history[2]).toMatch(/ · CLI · /);
    expect(view.getByTestId("settings-rev").textContent).toBe("설정 r3");
  });

  test("more than three warnings show the first three, then 외 n개", async () => {
    const synthetic = source();
    const runners = synthetic.scene.settings.revisions[3].worker!.runners!;
    runners.omo.model = "openai/model-d";
    runners.codex.fallback_model = "openai/model-c";
    synthetic.scene.settings.revisions[3].worker!.models!.fallback = "openai/model-d";
    const { view } = await open("#/settings", { source: synthetic });
    expect(view.getAllByTestId("settings-warning")).toHaveLength(3);
    expect(view.getByTestId("settings-warning-more").textContent).toBe("외 1개");
  });

  test("a toggle saves at once: one merge patch with the If-Match of the settings read last, then the new revision", async () => {
    const { view, synthetic } = await open("#/settings");
    const patch = vi.spyOn(synthetic, "patchSettings");
    fireEvent.click(switchOf(view, "machine-b 켜기"));
    expect(switchOf(view, "machine-b 켜기").getAttribute("aria-checked")).toBe("false");
    await waitFor(() => expect(view.getByTestId("settings-rev").textContent).toBe("설정 r4"));
    expect(patch).toHaveBeenCalledExactlyOnceWith({ devices: { workers: { "machine-b": { off: true } } } });
    expect(synthetic.settingsWrites).toEqual([{ kind: "patch", ifMatch: "r3", status: 200 }]);
    expect(synthetic.scene.settings.revisions[4].devices?.workers?.["machine-b"].off).toBe(true);
    expect(switchOf(view, "machine-b 켜기").getAttribute("aria-checked")).toBe("false");
    await waitFor(() => expect(view.getAllByTestId("history-row")[0].querySelector(".title")?.textContent).toMatch(/ · 앱 · machine-b 끔$/));

    fireEvent.click(switchOf(view, "machine-b 켜기"));
    await waitFor(() => expect(view.getByTestId("settings-rev").textContent).toBe("설정 r5"));
    expect(patch).toHaveBeenLastCalledWith({ devices: { workers: { "machine-b": { off: null } } } });
    expect(synthetic.settingsWrites.at(-1)).toEqual({ kind: "patch", ifMatch: "r4", status: 200 });
    expect(synthetic.scene.settings.revisions[5].devices?.workers?.["machine-b"]).not.toHaveProperty("off");
  });

  test("a stepper saves each step; the device's line follows", async () => {
    const { view, synthetic } = await open("#/settings/device/machine-a");
    const patch = vi.spyOn(synthetic, "patchSettings");
    fireEvent.click(view.getByRole("button", { name: "동시 작업 (입찰) 늘리기" }));
    expect(view.getAllByTestId("stepper-value")[0].textContent).toBe("3");
    await waitFor(() => expect(synthetic.scene.settings.revisions).toHaveLength(5));
    expect(patch).toHaveBeenCalledWith({ devices: { workers: { "machine-a": { cap: 3 } } } });
    fireEvent.click(view.getByRole("button", { name: "동시 작업 (지정) 줄이기" }));
    await waitFor(() => expect(synthetic.scene.settings.revisions).toHaveLength(6));
    expect(patch).toHaveBeenLastCalledWith({ devices: { workers: { "machine-a": { named_cap: 1 } } } });
    expect(view.getByRole("button", { name: "동시 작업 (지정) 줄이기" })).toHaveProperty("disabled", true);
    fireEvent.click(switchOf(view, W.repoWork));
    await waitFor(() => expect(synthetic.scene.settings.revisions).toHaveLength(7));
    expect(patch).toHaveBeenLastCalledWith({ devices: { workers: { "machine-a": { no_repo: true } } } });
    fireEvent.click(switchOf(view, W.fastDevice));
    await waitFor(() => expect(synthetic.scene.settings.revisions).toHaveLength(8));
    expect(patch).toHaveBeenLastCalledWith({ devices: { workers: { "machine-a": { fast: null } } } });
    expect(synthetic.settingsWrites.map((write) => write.ifMatch)).toEqual(["r3", "r4", "r5", "r6"]);
  });

  test("a file machine has no bid cap", async () => {
    const { view } = await open("#/settings/device/files-a");
    expect(view.queryByRole("group", { name: W.bidCap })).toBeNull();
    expect(view.getByRole("group", { name: W.namedCap })).toBeTruthy();
  });

  test("a person's device is a read-only row: no switch, no page, no cap", async () => {
    const { view, synthetic } = await open("#/settings");
    const mine = view.getByTestId("devices-mine");
    expect(within(mine).getByTestId("row").textContent).toBe("laptop-a상태만 봅니다");
    expect(mine.querySelector("a, button, [role=switch]")).toBeNull();
    view.unmount();
    const page = await open("#/settings/device/laptop-a", { source: again(synthetic) });
    expect(page.view.getByTestId("setting-page").querySelector("button, [role=switch]")).toBeNull();
    expect(page.view.getByTestId("setting-page").textContent).toContain(W.statusOnly);
  });

  test("the model picker lists only what the models view serves, by service, with what is left; choosing saves", async () => {
    const { view, synthetic } = await open("#/settings/runner/codex/model");
    const groups = view.getAllByTestId("model-group");
    expect(groups.map((group) => group.querySelector("h2")?.textContent)).toEqual(["Claude", "ChatGPT"]);
    const choices = view.getAllByRole("radio");
    expect(choices.map((choice) => choice.getAttribute("aria-label"))).toEqual(["model-a · 남은 양 72% · 3시간 후", "model-b · 남은 양 40% · 2일 후", "model-c · 다 씀"]);
    expect(view.container.textContent).not.toContain("model-d");
    expect(choices[2].getAttribute("aria-checked")).toBe("true");
    expect(choices[2].querySelector(".is-red")?.textContent).toBe(W.usedUp);
    const patch = vi.spyOn(synthetic, "patchSettings");
    fireEvent.click(choices[0]);
    await waitFor(() => expect(view.getAllByRole("radio")[0].getAttribute("aria-checked")).toBe("true"));
    expect(patch).toHaveBeenCalledExactlyOnceWith({ worker: { runners: { codex: { model: "anthropic/model-a:medium" } } } });
    fireEvent.click(view.getAllByRole("radio")[1]);
    await waitFor(() => expect(synthetic.scene.settings.revisions).toHaveLength(6));
    expect(patch).toHaveBeenLastCalledWith({ worker: { runners: { codex: { model: "anthropic/model-b" } } } });
  });

  test("생각 깊이 offers only the model's own efforts; 접근 권한 and 대체 모델 save the same way", async () => {
    const { view, synthetic } = await open("#/settings/runner/omo/effort");
    expect(view.getAllByRole("radio").map((choice) => choice.textContent)).toEqual(["낮음", "보통", "높음"]);
    const patch = vi.spyOn(synthetic, "patchSettings");
    fireEvent.click(view.getByRole("radio", { name: "낮음" }));
    await waitFor(() => expect(synthetic.scene.settings.revisions).toHaveLength(5));
    expect(patch).toHaveBeenLastCalledWith({ worker: { runners: { omo: { model: "anthropic/model-a:low" } } } });
    view.unmount();

    const access = await open("#/settings/runner/dsh/access", { source: again(synthetic) });
    expect(access.view.getAllByRole("radio").map((choice) => choice.textContent)).toEqual(["읽기만", "작업 폴더 쓰기", "전체"]);
    fireEvent.click(access.view.getByRole("radio", { name: "작업 폴더 쓰기" }));
    await waitFor(() => expect(synthetic.scene.settings.revisions).toHaveLength(6));
    expect(synthetic.scene.settings.revisions[5].worker?.runners?.dsh.access).toBe("workspace-write");
    access.view.unmount();

    const fallback = await open("#/settings/runner/codex/fallback", { source: again(synthetic) });
    fireEvent.click(fallback.view.getByRole("radio", { name: W.followDefault }));
    await waitFor(() => expect(synthetic.scene.settings.revisions).toHaveLength(7));
    expect(synthetic.scene.settings.revisions[6].worker?.runners?.codex).not.toHaveProperty("fallback_model");
  });

  test("기본 실행기 offers only runners that are on", async () => {
    const synthetic = source();
    synthetic.scene.settings.revisions[3].worker!.runners!.dsh.on = false;
    const { view } = await open("#/settings/default-runner", { source: synthetic });
    expect(view.getAllByRole("radio").map((choice) => choice.textContent)).toEqual(["omo", "codex"]);
    const patch = vi.spyOn(synthetic, "patchSettings");
    fireEvent.click(view.getByRole("radio", { name: "codex" }));
    await waitFor(() => expect(view.getByRole("radio", { name: "codex" }).getAttribute("aria-checked")).toBe("true"));
    expect(patch).toHaveBeenCalledWith({ worker: { default_runner: "codex" } });
  });

  test("a runner's page shows its command read-only", async () => {
    const { view } = await open("#/settings/runner/codex");
    expect(view.getByTestId("argv").textContent).toBe("codex exec -");
    expect(view.getByTestId("argv").querySelector("input, button")).toBeNull();
  });

  test("a stale write (412) drops the change, reads the settings again and says so in a toast", async () => {
    const { view, synthetic } = await open("#/settings", { source: source("stale") });
    fireEvent.click(switchOf(view, "machine-a 켜기"));
    await waitFor(() => expect(view.getByTestId("toast").textContent).toBe(W.settingsStale));
    expect(view.getByTestId("toast").querySelector("button")).toBeNull();
    expect(synthetic.settingsWrites).toEqual([{ kind: "patch", ifMatch: "r3", status: 412 }]);
    await waitFor(() => expect(view.getByTestId("settings-rev").textContent).toBe("설정 r4"));
    expect(switchOf(view, "machine-a 켜기").getAttribute("aria-checked")).toBe("true");
    expect(within(view.getByTestId("devices-work")).getAllByTestId("row")[1].textContent).toBe("machine-b입찰 2 · 지정 2");
    expect(view.queryByTestId("write-error")).toBeNull();
    fireEvent.click(switchOf(view, "machine-a 켜기"));
    await waitFor(() => expect(view.getByTestId("settings-rev").textContent).toBe("설정 r5"));
    expect(synthetic.settingsWrites.at(-1)).toEqual({ kind: "patch", ifMatch: "r4", status: 200 });
  });

  test("a refused write (422) puts the control back and shows the core's detail under its row", async () => {
    const { view, synthetic } = await open("#/settings");
    fireEvent.click(switchOf(view, "omo 켜기"));
    expect(switchOf(view, "omo 켜기").getAttribute("aria-checked")).toBe("false");
    await waitFor(() => expect(view.getByTestId("write-error").textContent).toBe("worker.default_runner: runner 'omo' is off"));
    expect(switchOf(view, "omo 켜기").getAttribute("aria-checked")).toBe("true");
    expect(view.getByTestId("write-error").closest("li")?.contains(switchOf(view, "omo 켜기"))).toBe(true);
    expect(synthetic.settingsWrites).toEqual([{ kind: "patch", ifMatch: "r3", status: 422 }]);
    expect(synthetic.scene.settings.revisions).toHaveLength(4);
    expect(view.getByTestId("settings-rev").textContent).toBe("설정 r3");
  });

  test("rules: 편집 deletes and reorders, 규칙 추가 adds one last; each saves the whole list", async () => {
    const { view, synthetic } = await open("#/settings");
    const patch = vi.spyOn(synthetic, "patchSettings");
    expect(view.queryByRole("button", { name: "docs → codex 삭제" })).toBeNull();
    fireEvent.click(view.getByTestId("rules-edit"));
    expect(view.getByRole("button", { name: "docs → codex 위로" })).toHaveProperty("disabled", true);
    fireEvent.click(view.getByRole("button", { name: "docs → codex 아래로" }));
    await waitFor(() => expect(synthetic.scene.settings.revisions).toHaveLength(5));
    expect(patch).toHaveBeenLastCalledWith({ worker: { routing: [expect.objectContaining({ name: "quick" }), expect.objectContaining({ name: "docs" })] } });
    fireEvent.click(view.getByRole("button", { name: "quick · S → dsh 삭제" }));
    await waitFor(() => expect(synthetic.scene.settings.revisions).toHaveLength(6));
    expect(synthetic.scene.settings.revisions[5].worker?.routing).toEqual([{ name: "docs", when: { labels_any: ["docs"] }, runner: "codex" }]);
    expect(view.getByTestId("rule-add").querySelector("a")?.getAttribute("href")).toBe("#/settings/rule-new");
    view.unmount();

    const page = await open("#/settings/rule-new", { source: again(synthetic) });
    const add = page.view.getByTestId("rule-save");
    expect(add).toHaveProperty("disabled", true);
    fireEvent.input(page.view.getByRole("textbox", { name: W.ruleLabel }), { target: { value: "review" } });
    fireEvent.click(page.view.getByRole("button", { name: "M" }));
    fireEvent.click(page.view.getByRole("radio", { name: "dsh" }));
    fireEvent.click(page.view.getByTestId("rule-save"));
    await waitFor(() => expect(synthetic.scene.settings.revisions).toHaveLength(7));
    expect(synthetic.scene.settings.revisions[6].worker?.routing?.at(-1)).toEqual({ name: "review", when: { labels_any: ["review"], size: ["M"] }, runner: "dsh" });
  });

  test("한 단계 되돌리기 asks once in a sheet; 취소 sends nothing, 되돌리기 writes the revision before as a new one", async () => {
    const { view, synthetic } = await open("#/settings");
    const rollback = vi.spyOn(synthetic, "rollbackSettings");
    fireEvent.click(view.getByTestId("rollback"));
    const sheet = view.getByTestId("rollback-sheet");
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.textContent).toContain(W.rollbackQuestion);
    fireEvent.click(view.getByTestId("rollback-cancel"));
    expect(view.queryByTestId("rollback-sheet")).toBeNull();
    expect(rollback).not.toHaveBeenCalled();

    fireEvent.click(view.getByTestId("rollback"));
    fireEvent.click(view.getByTestId("rollback-confirm"));
    expect(view.queryByTestId("rollback-sheet")).toBeNull();
    await waitFor(() => expect(view.getByTestId("settings-rev").textContent).toBe("설정 r4"));
    expect(rollback).toHaveBeenCalledOnce();
    expect(synthetic.settingsWrites).toEqual([{ kind: "rollback", ifMatch: "r3", status: 200 }]);
    expect(synthetic.scene.settings.revisions[4]).toEqual(synthetic.scene.settings.revisions[2]);
    expect(synthetic.scene.settings.history[3]).toMatchObject({ rev: "r4", base: "r3", rollback_of: "r3", by: { kind: "rollback" } });
    await waitFor(() => expect(view.getAllByTestId("history-row")[0].querySelector(".title")?.textContent).toMatch(/ · 되돌리기 · /));
    expect(view.getAllByTestId("history-row")).toHaveLength(4);
  });

  test("on a device that may only read: every control is off, one grey line says so, and nothing is sent", async () => {
    const { view, synthetic } = await open("#/settings", { source: source("readonly") });
    expect(view.getByTestId("read-only").textContent).toBe(W.settingsReadOnly);
    const controls = [...view.getByTestId("screen-settings").querySelectorAll("button")];
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((control) => control.disabled)).toBe(true);
    expect(view.queryByTestId("rules-edit")).toBeNull();
    fireEvent.click(switchOf(view, "machine-a 켜기"));
    expect(switchOf(view, "machine-a 켜기").getAttribute("aria-checked")).toBe("true");
    view.unmount();
    expect(synthetic.settingsWrites).toEqual([]);
    for (const page of ["#/settings/device/machine-a", "#/settings/runner/codex/model", "#/settings/rule-new"]) {
      const pushed = await open(page, { source: again(synthetic) });
      expect(pushed.view.getByTestId("read-only").textContent).toBe(W.settingsReadOnly);
      const controls = [...pushed.view.getByTestId("setting-page").querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")];
      expect(controls.length).toBeGreaterThan(0);
      expect(controls.every((control) => control.matches(":disabled"))).toBe(true);
      pushed.view.unmount();
    }
    expect(synthetic.scene.settings.revisions).toHaveLength(4);
  });

  test("settings never written: the groups show the defaults and there is nothing to roll back", async () => {
    const { view } = await open("#/settings", { source: source("empty") });
    expect(view.getByTestId("settings-rev").textContent).toBe("설정 r0");
    expect(view.getByTestId("settings-defaults").textContent).toContain("기본 실행기omo");
    expect(within(view.getByTestId("settings-runners")).getAllByTestId("row").map((row) => row.textContent)).toEqual(["omo기본값"]);
    expect(view.getByTestId("rule-other").textContent).toBe("그 외 → omo");
    expect(view.queryAllByTestId("history-row")).toHaveLength(0);
    expect(view.getByTestId("rollback")).toHaveProperty("disabled", true);
  });

  test("turning on the built-in runner when the settings never listed it writes its type with it", async () => {
    const synthetic = source("empty");
    const { view } = await open("#/settings", { source: synthetic });
    const patch = vi.spyOn(synthetic, "patchSettings");
    fireEvent.click(switchOf(view, "omo 켜기"));
    await waitFor(() => expect(view.getByTestId("write-error")).toBeTruthy());
    expect(patch).toHaveBeenCalledWith({ worker: { runners: { omo: { type: "omo", on: false } } } });
  });

  test("a settings event from another device redraws the screen without a reload", async () => {
    const { view, synthetic } = await open("#/settings");
    new SyntheticSource({ scene: synthetic.scene }).settingsWrittenElsewhere("machine-a");
    await waitFor(() => expect(view.getByTestId("settings-rev").textContent).toBe("설정 r4"));
    expect(within(view.getByTestId("devices-work")).getAllByTestId("row")[0].textContent).toBe("machine-a입찰 3 · 지정 2");
  });

  test("the wide window keeps the settings beside a pushed list, with a way back to its runner", async () => {
    const { view } = await open("#/settings/runner/codex/model", { wide: true });
    expect(view.getByTestId("screen-settings")).toBeTruthy();
    expect(view.getByTestId("setting-page").querySelector(".settings-crumb")?.getAttribute("href")).toBe("#/settings/runner/codex");
  });

  test("모든 기록 lists every revision", async () => {
    const { view } = await open("#/settings/history");
    await waitFor(() => expect(view.getAllByTestId("history-row")).toHaveLength(3));
  });
});
