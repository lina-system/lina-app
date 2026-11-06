import type { Settings, SettingsAuditLine, SettingsHistory, SettingsModelCheck, SettingsModels, SettingsRevision, SettingsView } from "../api/client";
import type { SettingsScene } from "../fixtures/synthetic";
import { ACCESS, diffSettings, findModel, parseModel, RULE_SIZES, runnerTable } from "../model/settings";

/**
 * The core's work settings over a synthetic scene (lina docs/api/settings-client.yaml): the view, the history, the
 * models view with its warnings, and the checks a write must pass. The source decides who writes and when.
 */

export function currentSettings(scene: SettingsScene): Settings {
  return scene.revisions[scene.revisions.length - 1];
}

export function revisionOf(scene: SettingsScene): SettingsRevision {
  const line = scene.history[scene.history.length - 1];
  return line ? { id: line.rev, at: line.at, base: line.base, by: line.by } : { id: "r0", at: null, base: null, by: null };
}

export function settingsView(scene: SettingsScene, at: number): SettingsView {
  const settings = currentSettings(scene);
  return { version: 1, at, errors: [], revision: revisionOf(scene), settings, warnings: validate(settings), writable: scene.writable };
}

export function historyView(scene: SettingsScene, limit: number, at: number): SettingsHistory {
  return { version: 1, at, revisions: scene.history.slice(-Math.max(1, limit)).reverse() };
}

type ModelState = NonNullable<SettingsModelCheck["state"]>;

const WARN: Partial<Record<ModelState, (who: string) => string>> = {
  off: (who) => `${who} 모델이 꺼져 있습니다`,
  out_of_quota: (who) => `${who} 모델의 쿼터가 다 찼습니다`,
  no_account: (who) => `${who} 모델을 쓸 계정이 없습니다`,
};

const FALLBACK_WHO = "대체";

function stateOf(value: string, settings: Settings, scene: SettingsScene): ModelState {
  const ref = parseModel(value, settings);
  if (!ref) return "unknown";
  return findModel(ref, scene.models)?.state ?? "off";
}

function usable(state: ModelState | null): boolean {
  return state === null || state === "ok" || state === "unknown";
}

function check(who: string, value: string | undefined, fallback: string | null, settings: Settings, scene: SettingsScene): SettingsModelCheck {
  if (!value) return { model: null, state: null, usable: true, fallback, warning: null };
  const state = stateOf(value, settings, scene);
  if (usable(state)) return { model: value, state, usable: true, fallback, warning: null };
  const tail = who === FALLBACK_WHO ? " · 다음 실행은 원래 모델로 갑니다" : fallback && usable(stateOf(fallback, settings, scene)) ? ` · 다음 실행은 ${fallback}로 갑니다` : " · 대체 모델이 없습니다";
  return { model: value, state, usable: false, fallback, warning: `${WARN[state]?.(who) ?? who}${tail}` };
}

/** What the core says when OCX does not answer and it serves the last good list. */
const OCX_DOWN = { source: "ocx", message: "ocx did not answer; the models are the last good list" };

/** OCX's models and, for each runner that is on, each mode's default and the fallback, whether it runs now. */
export function modelsView(scene: SettingsScene, at: number): SettingsModels {
  const settings = currentSettings(scene);
  const fallback = settings.worker?.models?.fallback ?? null;
  const runners = runnerTable(settings)
    .filter(([, runner]) => runner.on !== false)
    .map(([name, runner]) => ({ name, ...check(name, runner.model, runner.fallback_model || fallback, settings, scene) }));
  const modes = Object.entries(settings.worker?.models?.defaults ?? {}).map(([mode, value]) => ({ mode, ...check(`${mode} 기본`, value, fallback, settings, scene) }));
  const fallbackCheck = check(FALLBACK_WHO, fallback ?? undefined, null, settings, scene);
  const warnings = [...runners, ...modes, fallbackCheck].map((each) => each.warning).filter((line): line is string => Boolean(line));
  const down = scene.ocxReadAt !== null;
  return { version: 1, at: down ? scene.ocxReadAt : at, errors: down ? [OCX_DOWN] : [], models: structuredClone(scene.models), runners, modes, fallback: fallbackCheck, warnings };
}

const RULE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;
const PERSON_KEYS = ["cap", "named_cap", "last", "auto", "host"] as const;

function isCap(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) >= 1);
}

/** What the core's validation refuses, the subset the app can write: devices, runners, the default runner, routing. */
export function validate(settings: Settings): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];
  for (const [name, device] of Object.entries(settings.devices?.workers ?? {})) {
    const at = `devices.workers.${name}`;
    const role = device.role ?? "work";
    if (!["work", "files", "person"].includes(role)) errors.push({ path: `${at}.role`, message: "must be work, files or person" });
    if (role === "person") {
      for (const key of PERSON_KEYS) if (device[key] !== undefined) errors.push({ path: `${at}.${key}`, message: "a person device takes no work" });
      continue;
    }
    if (!device.host) errors.push({ path: `${at}.host`, message: "is required" });
    for (const key of ["cap", "named_cap"] as const) if (!isCap(device[key])) errors.push({ path: `${at}.${key}`, message: "must be an integer of 1 or more" });
  }
  const runners = new Map(runnerTable(settings));
  for (const [name, runner] of Object.entries(settings.worker?.runners ?? {})) {
    const at = `worker.runners.${name}`;
    if (!runner.type) errors.push({ path: `${at}.type`, message: "is required" });
    if (runner.access !== undefined && !(ACCESS as readonly string[]).includes(runner.access)) errors.push({ path: `${at}.access`, message: `must be one of ${ACCESS.join(", ")}` });
  }
  const chosen = settings.worker?.default_runner;
  if (chosen !== undefined) {
    const runner = runners.get(chosen);
    if (!runner) errors.push({ path: "worker.default_runner", message: `unknown runner '${chosen}'` });
    else if (runner.on === false) errors.push({ path: "worker.default_runner", message: `runner '${chosen}' is off` });
  } else if (runners.get("omo")?.on === false) errors.push({ path: "worker.default_runner", message: "runner 'omo' is off" });
  const names = new Set<string>();
  (settings.worker?.routing ?? []).forEach((rule, index) => {
    const at = `worker.routing[${index}]`;
    if (!RULE_NAME.test(rule.name ?? "")) errors.push({ path: `${at}.name`, message: "must be letters, digits, - or _" });
    else if (names.has(rule.name)) errors.push({ path: `${at}.name`, message: `'${rule.name}' is used twice` });
    names.add(rule.name);
    if (!runners.has(rule.runner)) errors.push({ path: `${at}.runner`, message: `unknown runner '${rule.runner}'` });
    for (const size of rule.when?.size ?? []) if (!(RULE_SIZES as readonly string[]).includes(size)) errors.push({ path: `${at}.when.size`, message: "must be S, M or L" });
  });
  return errors;
}

/** The 422 `detail`: the first error, and how many more. */
export function invalidDetail(errors: readonly { path: string; message: string }[]): string {
  const [first] = errors;
  return `${first.path}: ${first.message}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`;
}

/** Writes `next` as a new revision when anything changed; the audit line says who and from what. */
export function writeRevision(scene: SettingsScene, next: Settings, by: SettingsAuditLine["by"], at: number, rollbackOf?: string): SettingsAuditLine | null {
  const changes = diffSettings(currentSettings(scene), next);
  if (!changes.length) return null;
  const line: SettingsAuditLine = { rev: `r${scene.revisions.length}`, base: revisionOf(scene).id, at, by, changes, ...(rollbackOf ? { rollback_of: rollbackOf } : {}) };
  scene.revisions.push(structuredClone(next));
  scene.history.push(line);
  return line;
}
