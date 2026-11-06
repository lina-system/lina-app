import type { RunCard, Settings, SettingsAuditLine, SettingsChange, SettingsDevice, SettingsModel, SettingsModels, SettingsRule, SettingsRunner } from "../api/client";
import { serviceName, SEP, W } from "../words";

/** The runner `lina worker` uses when the settings name none, and that is there even when not listed. */
export const BUILTIN_RUNNER = "omo";
/** A device's caps start at 1; the stepper stops at this many runs. */
export const CAP_MIN = 1;
export const CAP_MAX = 16;
export const RULE_SIZES = ["S", "M", "L"] as const;
export type RuleSize = (typeof RULE_SIZES)[number];
export const ACCESS = ["read-only", "workspace-write", "full"] as const;
export type Access = (typeof ACCESS)[number];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** RFC 7396: an object merges key by key, null removes a key, anything else (an array too) replaces what is there. */
export function mergePatch<T>(target: T, patch: unknown): T {
  if (!isObject(patch)) return structuredClone(patch) as T;
  const result: Record<string, unknown> = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result as T;
}

/** What changed between two settings, as the core's audit line names it: a path per leaf, a list as one value. */
export function diffSettings(before: unknown, after: unknown, path = ""): SettingsChange[] {
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((key) => diffSettings(before[key], after[key], path ? `${path}.${key}` : key));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ path, from: before ?? null, to: after ?? null }];
}

/** The runners as `lina worker` sees them: omo first, there even when not listed. */
export function runnerTable(settings: Settings): [string, SettingsRunner][] {
  const table = new Map<string, SettingsRunner>([[BUILTIN_RUNNER, { type: BUILTIN_RUNNER }]]);
  for (const [name, runner] of Object.entries(settings.worker?.runners ?? {})) table.set(name, runner);
  return [...table];
}

export function defaultRunner(settings: Settings): string {
  return settings.worker?.default_runner || BUILTIN_RUNNER;
}

export function runnerOn(runner: SettingsRunner | undefined): boolean {
  return runner?.on !== false;
}

export type DeviceRole = "work" | "files" | "person";

export interface DeviceRow {
  readonly name: string;
  readonly device: SettingsDevice;
  readonly role: DeviceRole;
}

export function devicesOf(settings: Settings): DeviceRow[] {
  return Object.entries(settings.devices?.workers ?? {}).map(([name, device]) => ({ name, device, role: device.role ?? "work" }));
}

/** Runs a device takes from the bids; `cap` is 1 when the settings leave it out. */
export function bidCap(device: SettingsDevice): number {
  return device.cap ?? CAP_MIN;
}

/** Runs a device takes when a run names it (`--host`): its own cap, else the bid cap. */
export function namedCap(device: SettingsDevice): number {
  return device.named_cap ?? bidCap(device);
}

export interface ModelRef {
  readonly provider: string;
  readonly id: string;
  readonly effort: string | null;
}

/** A model value: an alias of the settings, or `<provider>/<id>[:<effort>]`; anything else names no OCX model. */
export function parseModel(value: string | undefined | null, settings: Settings): ModelRef | null {
  if (!value) return null;
  const alias = Object.entries(settings.worker?.models?.aliases ?? {}).find(([name]) => name.toLowerCase() === value.trim().toLowerCase())?.[1];
  if (alias) return alias.provider && alias.id ? { provider: alias.provider, id: alias.id, effort: alias.thinking ?? null } : null;
  const slash = value.indexOf("/");
  if (slash <= 0) return null;
  const [id, effort] = value.slice(slash + 1).split(":");
  return id ? { provider: value.slice(0, slash), id, effort: effort || null } : null;
}

export function modelValue(model: Pick<SettingsModel, "provider" | "id">, effort: string | null): string {
  return `${model.provider}/${model.id}${effort ? `:${effort}` : ""}`;
}

export function findModel(ref: ModelRef | null, models: readonly SettingsModel[]): SettingsModel | undefined {
  return ref ? models.find((model) => model.provider === ref.provider && model.id === ref.id) : undefined;
}

export function modelName(model: SettingsModel): string {
  return model.name || model.id;
}

/** How a model value reads: the OCX model's name, else the id it names, else the value itself (an alias). */
export function modelLabel(value: string | undefined | null, settings: Settings, models: readonly SettingsModel[]): string {
  if (!value) return W.defaultValue;
  const ref = parseModel(value, settings);
  const model = findModel(ref, models);
  return model ? modelName(model) : (ref?.id ?? value);
}

/**
 * The core's warning lines, each model value its checks name read as modelLabel reads it, so a warning names a model
 * the way the rows and the picker do.
 */
export function warningLines(view: SettingsModels, settings: Settings): string[] {
  const checks = [...view.runners, ...view.modes, view.fallback];
  const values = [...new Set(checks.flatMap((check) => [check.model, check.fallback]).filter((value): value is string => Boolean(value)))].sort((a, b) => b.length - a.length);
  return view.warnings.map((line) => values.reduce((text, value) => text.split(value).join(modelLabel(value, settings, view.models)), line));
}

/** The effort a model value runs at: its own, else the OCX model's default. */
export function effortOf(value: string | undefined | null, settings: Settings, models: readonly SettingsModel[]): string | null {
  const ref = parseModel(value, settings);
  return ref?.effort ?? findModel(ref, models)?.defaultEffort ?? null;
}

export function effortWord(effort: string): string {
  return Object.hasOwn(W.effortWord, effort) ? W.effortWord[effort] : effort;
}

/** A runner's line under its name: `<모델> · <생각 깊이>`. */
export function runnerLine(runner: SettingsRunner, settings: Settings, models: readonly SettingsModel[]): string {
  const effort = effortOf(runner.model, settings, models);
  return [modelLabel(runner.model, settings, models), effort ? effortWord(effort) : null].filter(Boolean).join(SEP);
}

/**
 * The model a run used, named as the settings screen names one (`modelLabel`, which reads `modelName`): `<모델> ·
 * <생각 깊이>`. A run that started on the fallback (`source` `fallback:…`) ends with `대체 모델`. No model draws nothing.
 * The settings revision is never part of the line.
 */
export function runModelLine(model: RunCard["model"], settings: Settings, models: readonly SettingsModel[]): string | null {
  if (!model?.id) return null;
  const value = model.provider ? modelValue({ provider: model.provider, id: model.id }, model.thinking) : model.id;
  const effort = model.thinking ? effortWord(model.thinking) : null;
  const fallback = model.source.startsWith("fallback:") ? W.fallbackModel : null;
  return [modelLabel(value, settings, models), effort, fallback].filter(Boolean).join(SEP);
}

/** Choosing a model keeps the effort when the new model offers it. */
export function pickModel(model: SettingsModel, current: string | undefined | null, settings: Settings): string {
  const effort = parseModel(current, settings)?.effort ?? null;
  return modelValue(model, effort && model.efforts.includes(effort) ? effort : null);
}

/**
 * A model's quota on the right of its row: what is left and when it resets, or the one word in its place. A list the
 * core served from its last good read (`stale`) says 확인 못 함 for every model.
 */
export function quotaWord(model: SettingsModel, now: number, until: (seconds: number) => string, stale = false): { text: string; tone: "" | "is-red" | "is-grey" } {
  if (stale) return { text: W.quotaUnknown, tone: "is-grey" };
  if (model.state === "out_of_quota") return { text: W.usedUp, tone: "is-red" };
  if (model.state === "no_account") return { text: W.noAccount, tone: "is-grey" };
  if (model.state !== "ok" || model.left === null) return { text: W.quotaUnknown, tone: "is-grey" };
  return { text: W.quotaLeft(model.left, model.resetAt === null ? null : until(model.resetAt - now)), tone: "" };
}

/** The models grouped by service, in the order OCX lists them. */
export function modelGroups(models: readonly SettingsModel[]): { service: string; name: string; models: SettingsModel[] }[] {
  const groups = new Map<string, SettingsModel[]>();
  for (const model of models) groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
  return [...groups].map(([service, list]) => ({ service, name: serviceName(service), models: list }));
}

export function rulesOf(settings: Settings): SettingsRule[] {
  return settings.worker?.routing ?? [];
}

/** A rule as the list reads it: its labels (its name when it has none) and its sizes. */
export function ruleLabel(rule: SettingsRule): string {
  const labels = rule.when?.runner_label ? [rule.when.runner_label] : (rule.when?.labels_any ?? []);
  const sizes = rule.when?.size ?? [];
  return [labels.length ? labels.join(", ") : rule.name, sizes.length ? sizes.join("/") : null].filter(Boolean).join(SEP);
}

const RULE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;

/** A new rule's name: its label when that is a valid unused name, else the first free `rule-<n>`. */
export function newRuleName(label: string, rules: readonly SettingsRule[]): string {
  const taken = new Set(rules.map((rule) => rule.name));
  if (RULE_NAME.test(label) && !taken.has(label)) return label;
  let index = rules.length + 1;
  while (taken.has(`rule-${index}`)) index += 1;
  return `rule-${index}`;
}

export function newRule(label: string, size: RuleSize | null, runner: string, rules: readonly SettingsRule[]): SettingsRule {
  return { name: newRuleName(label, rules), when: { labels_any: [label], ...(size ? { size: [size] } : {}) }, runner };
}

function onOff(on: unknown): string {
  return on === false ? W.turnedOff : W.turnedOn;
}

/** A path that names one thing a person added or removed as a whole: a device, a runner, a model alias. */
function isEntry(parts: readonly string[]): boolean {
  if (parts.length === 3) return (parts[0] === "devices" && parts[1] === "workers") || (parts[0] === "worker" && parts[1] === "runners");
  return parts.length === 4 && parts[0] === "worker" && parts[1] === "models" && parts[2] === "aliases";
}

/**
 * A change split down to the things it is about: a whole section (the first revision writes `devices` and `worker`
 * at once) becomes one change per device, runner, alias and field, and a device or runner added or removed whole
 * stays one change.
 */
function thingChanges(path: string, from: unknown, to: unknown): SettingsChange[] {
  const parts = path.split(".");
  const whole = isEntry(parts) && (!isObject(from) || !isObject(to));
  if (!whole && (isObject(from) || isObject(to))) {
    const before = isObject(from) ? from : {};
    const after = isObject(to) ? to : {};
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((key) => thingChanges(path ? `${path}.${key}` : key, before[key], after[key]));
  }
  if (JSON.stringify(from) === JSON.stringify(to)) return [];
  return [{ path, from: from ?? null, to: to ?? null }];
}

function asRules(value: unknown): SettingsRule[] {
  return Array.isArray(value) ? (value as SettingsRule[]) : [];
}

/** The rules a change of the list touched: each rule added or removed by name, each one changed, or their order. */
function ruleWords(from: unknown, to: unknown): string[] {
  const before = asRules(from);
  const after = asRules(to);
  const was = new Map(before.map((rule) => [rule.name, rule]));
  const is = new Set(after.map((rule) => rule.name));
  const words = [
    ...after.filter((rule) => !was.has(rule.name)).map((rule) => W.added(W.rule(rule.name))),
    ...before.filter((rule) => !is.has(rule.name)).map((rule) => W.remove(W.rule(rule.name))),
    ...after.filter((rule) => was.has(rule.name) && JSON.stringify(was.get(rule.name)) !== JSON.stringify(rule)).map((rule) => W.ruleTo(ruleLabel(rule), rule.runner)),
  ];
  const kept = (rules: SettingsRule[], other: Set<string>) => rules.map((rule) => rule.name).filter((name) => other.has(name));
  if (!words.length && kept(before, is).join("\n") !== kept(after, new Set(was.keys())).join("\n")) words.push(W.ruleOrder);
  return words;
}

/** One change in a few words, naming the thing it is about, then where it went when that fits in a word. */
function changeWords(change: SettingsChange, settings: Settings, models: readonly SettingsModel[]): string[] {
  const parts = change.path.split(".");
  const to = change.to;
  const model = (value: unknown) => (typeof value === "string" ? modelLabel(value, settings, models) : W.followDefault);
  const number = (value: unknown) => (typeof value === "number" ? value : W.defaultValue);
  if (isEntry(parts)) {
    const name = parts.at(-1) ?? change.path;
    const thing = parts[2] === "aliases" ? W.alias(name) : name;
    return [to === null ? W.remove(thing) : change.from === null ? W.added(thing) : thing];
  }
  if (change.path === "worker.routing") return ruleWords(change.from, to);
  if (change.path === "worker.default_runner") return [`${W.defaultRunner} ${typeof to === "string" ? to : W.defaultValue}`];
  if (change.path === "worker.models.fallback") return [`${W.fallbackModel} ${model(to)}`];
  if (parts[0] === "worker" && parts[1] === "models" && parts[2] === "defaults" && parts[3]) return [`${W.modeDefault(parts[3])} ${W.model} ${model(to)}`];
  if (parts[0] === "worker" && parts[1] === "models" && parts[2] === "aliases" && parts[3]) return [W.alias(parts[3])];
  if (parts[0] === "worker" && parts[1] === "runners" && parts[2]) {
    const name = parts[2];
    switch (parts[3]) {
      case "on":
        return [`${name} ${onOff(to)}`];
      case "model":
        return [`${name} ${W.model} ${model(to)}`];
      case "fallback_model":
        return [`${name} ${W.fallbackModel} ${model(to)}`];
      case "access":
        return [`${name} ${W.access} ${typeof to === "string" && Object.hasOwn(W.accessWord, to) ? W.accessWord[to] : W.defaultValue}`];
      case "argv":
        return [`${name} ${W.command}`];
      default:
        return [`${name} ${parts.slice(3).join(".")}`];
    }
  }
  if (parts[0] === "devices" && parts[1] === "workers" && parts[2]) {
    const name = parts[2];
    switch (parts[3]) {
      case "off":
        return [`${name} ${onOff(to !== true)}`];
      case "cap":
        return [`${name} ${W.bid} ${number(to)}`];
      case "named_cap":
        return [`${name} ${W.named} ${number(to)}`];
      case "no_repo":
        return [`${name} ${W.repoWork} ${onOff(to !== true)}`];
      case "fast":
        return [`${name} ${W.fastDevice} ${onOff(to === true)}`];
      default:
        return [`${name} ${parts.slice(3).join(".")}`];
    }
  }
  return [change.path];
}

/** What a revision changed, in a few words: the first thing it changed, named, then how many more. */
export function changesLine(line: SettingsAuditLine, settings: Settings, models: readonly SettingsModel[]): string {
  const words = line.changes.flatMap((change) => thingChanges(change.path, change.from, change.to)).flatMap((change) => changeWords(change, settings, models));
  if (!words.length) return W.noChange;
  return words.length > 1 ? `${words[0]} ${W.more(words.length - 1)}` : words[0];
}

/** `MM-DD HH:mm` in the page's own time zone. */
export function stamp(at: number): string {
  const date = new Date(at * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** One history row: `<MM-DD HH:mm> · <앱|CLI|바깥 편집|되돌리기> · <what changed>`, and who wrote it from where. */
export function historyLine(line: SettingsAuditLine, settings: Settings, models: readonly SettingsModel[]): { title: string; who: string } {
  return {
    title: [stamp(line.at), W.byKind[line.by.kind] ?? line.by.kind, changesLine(line, settings, models)].join(SEP),
    who: [line.by.principal, line.by.device].filter(Boolean).join(SEP),
  };
}
