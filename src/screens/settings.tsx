import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { SETTINGS_HISTORY, type Settings, type SettingsAuditLine, type SettingsModel, type SettingsPatch, type SettingsRule, type SettingsRunner } from "../api/client";
import { KoreanInput } from "../korean-input";
import {
  ACCESS,
  bidCap,
  BUILTIN_RUNNER,
  CAP_MAX,
  CAP_MIN,
  defaultRunner,
  devicesOf,
  effortOf,
  effortWord,
  findModel,
  historyLine,
  modelGroups,
  modelLabel,
  modelName,
  modelValue,
  namedCap,
  newRule,
  parseModel,
  pickModel,
  quotaWord,
  RULE_SIZES,
  ruleLabel,
  rulesOf,
  runnerLine,
  runnerOn,
  runnerTable,
  type DeviceRow,
  type RuleSize,
} from "../model/settings";
import { back, href, type Route } from "../router";
import { until } from "../time";
import { CheckIcon } from "../ui/icons";
import { Disclosure, ErrorLine, Link, useApp } from "../ui/parts";
import { ROLLBACK_KEY, useSettingsEdits } from "../ui/settings-edits";
import { SEP, W } from "../words";

/** At most this many warning lines at the top; the rest fold into `외 n개`. */
const WARNINGS_SHOWN = 3;

function pageHref(page: string): string {
  return href({ name: "setting", page });
}

/** The title of a list the settings push, for the page itself and for the phone's back control. */
export function settingTitle(page: string): string {
  const [kind, name, field] = page.split("/");
  switch (kind) {
    case "default-runner":
      return W.defaultRunner;
    case "fallback":
      return W.fallbackModel;
    case "runner":
      if (field === "model") return W.model;
      if (field === "effort") return W.effort;
      if (field === "access") return W.access;
      if (field === "fallback") return W.fallbackModel;
      return name ?? W.runners;
    case "device":
      return name ?? W.devices;
    case "rule-new":
      return W.ruleAdd;
    case "models":
      return W.modelsOcx;
    case "history":
      return W.allHistory;
    default:
      return W.settings;
  }
}

/** Where back goes from a pushed list: a runner's pickers go back to the runner, everything else to the settings. */
export function settingParent(page: string): Route {
  const parts = page.split("/");
  return parts.length > 2 ? { name: "setting", page: parts.slice(0, 2).join("/") } : { name: "settings" };
}

function useSettings() {
  const app = useApp();
  const edits = useSettingsEdits();
  const modelsView = app.store.get("settingsModels");
  return { ...app, edits, settings: edits.settings(), models: modelsView?.models ?? [], modelsView, locked: !edits.writable };
}

/** A runner's patch; omo is there without being listed, so writing it first gives it its type. */
function runnerPatch(settings: Settings, name: string, fields: Partial<Record<keyof SettingsRunner, unknown>>): SettingsPatch {
  const listed = Boolean(settings.worker?.runners?.[name]);
  return { worker: { runners: { [name]: !listed && name === BUILTIN_RUNNER ? { type: BUILTIN_RUNNER, ...fields } : fields } } };
}

function Group({ title, label, head, foot, error, testid, children }: { title?: string; label?: string; head?: ComponentChildren; foot?: string; error?: string; testid?: string; children: ComponentChildren }) {
  return (
    <section class="settings-group" data-testid={testid}>
      {title ? (
        <h2 class="section-head settings-head">
          <span>{title}</span>
          {head}
        </h2>
      ) : null}
      <ul class="rows" aria-label={label ?? title}>
        {children}
      </ul>
      <ErrorLine line={error} />
      {foot ? <p class="settings-foot">{foot}</p> : null}
    </section>
  );
}

function Lines({ title, sub }: { title: string; sub?: string | null }) {
  return (
    <span class="lines">
      <span class="title one-line">{title}</span>
      {sub ? <span class="sub one-line">{sub}</span> : null}
    </span>
  );
}

function LinkRow({ to, title, value, sub, error, testid = "row" }: { to: string; title: string; value?: string; sub?: string; error?: string; testid?: string }) {
  const { selected } = useApp();
  return (
    <li class="row settings-row" data-testid={testid}>
      <Link href={to} label={[title, sub, value].filter(Boolean).join(SEP)} current={selected === to}>
        <Lines title={title} sub={sub} />
        {value ? <span class="settings-value one-line">{value}</span> : null}
        <Disclosure />
      </Link>
      <ErrorLine line={error} />
    </li>
  );
}

function Switch({ label, on, disabled, onChange }: { label: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" class="settings-switch" aria-label={label} aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}>
      <span class="switch" aria-hidden="true" />
    </button>
  );
}

function SwitchRow({ title, label, on, disabled, onChange, error }: { title: string; label?: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void; error?: string }) {
  return (
    <li class="row settings-row has-control" data-testid="row">
      <span class="row-body">
        <Lines title={title} />
      </span>
      <Switch label={label ?? title} on={on} disabled={disabled} onChange={onChange} />
      <ErrorLine line={error} />
    </li>
  );
}

/** A runner or a device: the row opens its page, the switch beside it turns it on or off. */
function LinkSwitchRow({ to, title, sub, on, disabled, onChange, error }: { to: string; title: string; sub: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void; error?: string }) {
  const { selected } = useApp();
  return (
    <li class="row settings-row has-control" data-testid="row">
      <Link href={to} label={[title, sub].join(SEP)} current={selected === to}>
        <Lines title={title} sub={sub} />
      </Link>
      <Switch label={`${title} ${W.turnOn}`} on={on} disabled={disabled} onChange={onChange} />
      <ErrorLine line={error} />
    </li>
  );
}

/** One choice of a picker: the check mark on the one chosen; choosing saves at once. */
function ChoiceRow({ title, detail, tone = "", chosen, disabled, onChoose }: { title: string; detail?: string; tone?: string; chosen: boolean; disabled: boolean; onChoose: () => void }) {
  return (
    <li class="row settings-row" data-testid="choice">
      <button type="button" role="radio" class="row-button settings-choice" aria-checked={chosen} aria-label={[title, detail].filter(Boolean).join(SEP)} disabled={disabled} onClick={() => (chosen ? undefined : onChoose())}>
        <Lines title={title} />
        {detail ? <span class={`settings-value ${tone}`}>{detail}</span> : null}
        <span class="settings-check" aria-hidden="true">
          {chosen ? <CheckIcon /> : null}
        </span>
      </button>
    </li>
  );
}

function StepperRow({ title, value, disabled, onChange, error }: { title: string; value: number; disabled: boolean; onChange: (value: number) => void; error?: string }) {
  return (
    <li class="row settings-row has-control" data-testid="row">
      <span class="row-body">
        <Lines title={title} />
        <span class="settings-value" data-testid="stepper-value">
          {value}
        </span>
      </span>
      <span class="stepper" role="group" aria-label={title}>
        <button type="button" aria-label={W.fewer(title)} disabled={disabled || value <= CAP_MIN} onClick={() => onChange(value - 1)}>
          −
        </button>
        <button type="button" aria-label={W.moreOf(title)} disabled={disabled || value >= CAP_MAX} onClick={() => onChange(value + 1)}>
          +
        </button>
      </span>
      <ErrorLine line={error} />
    </li>
  );
}

function PlainRow({ title, sub, testid = "row" }: { title: string; sub?: string; testid?: string }) {
  return (
    <li class="row settings-row" data-testid={testid}>
      <span class="row-body" aria-label={[title, sub].filter(Boolean).join(SEP)}>
        <Lines title={title} sub={sub} />
      </span>
    </li>
  );
}

function ReadOnlyLine() {
  const { locked } = useSettings();
  return locked ? (
    <p class="settings-note" data-testid="read-only">
      {W.settingsReadOnly}
    </p>
  ) : null;
}

/** What the core says the settings or the models get wrong now: one orange line each, the first three. */
function Warnings() {
  const { edits, modelsView } = useSettings();
  const lines = [...(modelsView?.warnings ?? []), ...(edits.view?.warnings ?? []).map((warning) => (warning.path ? `${warning.path}: ${warning.message}` : warning.message))];
  if (!lines.length) return null;
  return (
    <ul class="settings-warnings" data-testid="settings-warnings">
      {lines.slice(0, WARNINGS_SHOWN).map((line) => (
        <li key={line} class="settings-warning" data-testid="settings-warning">
          {line}
        </li>
      ))}
      {lines.length > WARNINGS_SHOWN ? (
        <li class="settings-warning" data-testid="settings-warning-more">
          {W.more(lines.length - WARNINGS_SHOWN)}
        </li>
      ) : null}
    </ul>
  );
}

function DefaultsGroup() {
  const { edits, settings, models } = useSettings();
  const fallback = settings.worker?.models?.fallback;
  return (
    <Group title={W.defaults} testid="settings-defaults">
      <LinkRow to={pageHref("default-runner")} title={W.defaultRunner} value={defaultRunner(settings)} error={edits.error("default-runner")} />
      <LinkRow to={pageHref("fallback")} title={W.fallbackModel} value={fallback ? modelLabel(fallback, settings, models) : W.empty} error={edits.error("fallback")} />
    </Group>
  );
}

function RunnersGroup() {
  const { edits, settings, models, locked } = useSettings();
  return (
    <Group title={W.runners} testid="settings-runners">
      {runnerTable(settings).map(([name, runner]) => (
        <LinkSwitchRow
          key={name}
          to={pageHref(`runner/${name}`)}
          title={name}
          sub={runnerLine(runner, settings, models)}
          on={runnerOn(runner)}
          disabled={locked}
          onChange={(on) => edits.change(`runner:${name}:on`, runnerPatch(settings, name, { on }))}
          error={edits.error(`runner:${name}:on`)}
        />
      ))}
    </Group>
  );
}

function moved(rules: readonly SettingsRule[], index: number, by: number): SettingsRule[] {
  const next = [...rules];
  const [rule] = next.splice(index, 1);
  next.splice(index + by, 0, rule);
  return next;
}

/** The rules in the order they are tried, then where everything else goes; 편집 reorders, deletes and adds. */
function RulesGroup() {
  const { edits, settings, locked } = useSettings();
  const [editing, setEditing] = useState(false);
  const rules = rulesOf(settings);
  const save = (next: SettingsRule[]) => edits.change("rules", { worker: { routing: next } });
  const on = editing && !locked;
  const head = locked ? null : (
    <button type="button" class="text-button settings-edit" aria-pressed={editing} onClick={() => setEditing(!editing)} data-testid="rules-edit">
      {editing ? W.editDone : W.edit}
    </button>
  );
  return (
    <Group title={W.rules} head={head} error={edits.error("rules")} testid="settings-rules">
      {rules.map((rule, index) => {
        const line = W.ruleTo(ruleLabel(rule), rule.runner);
        return (
          <li key={rule.name} class="row settings-row has-control" data-testid="rule">
            {on ? (
              <button type="button" class="settings-remove" aria-label={W.remove(line)} onClick={() => save(rules.filter((_, at) => at !== index))}>
                <span aria-hidden="true">−</span>
              </button>
            ) : null}
            <span class="row-body" aria-label={line}>
              <Lines title={line} />
            </span>
            {on ? (
              <span class="settings-moves">
                <button type="button" class="settings-move" aria-label={W.moveUp(line)} disabled={index === 0} onClick={() => save(moved(rules, index, -1))}>
                  ↑
                </button>
                <button type="button" class="settings-move" aria-label={W.moveDown(line)} disabled={index === rules.length - 1} onClick={() => save(moved(rules, index, 1))}>
                  ↓
                </button>
              </span>
            ) : null}
          </li>
        );
      })}
      <PlainRow title={W.ruleTo(W.ruleOther, defaultRunner(settings))} testid="rule-other" />
      {on ? <LinkRow to={pageHref("rule-new")} title={W.ruleAdd} testid="rule-add" /> : null}
    </Group>
  );
}

function DeviceRowView({ row }: { row: DeviceRow }) {
  const { edits, locked } = useSettings();
  if (row.role === "person") return <PlainRow title={row.name} sub={W.statusOnly} />;
  const sub = row.role === "work" ? W.caps(bidCap(row.device), namedCap(row.device)) : W.namedCaps(namedCap(row.device));
  return (
    <LinkSwitchRow
      to={pageHref(`device/${row.name}`)}
      title={row.name}
      sub={sub}
      on={row.device.off !== true}
      disabled={locked}
      onChange={(on) => edits.change(`device:${row.name}:off`, { devices: { workers: { [row.name]: { off: on ? null : true } } } })}
      error={edits.error(`device:${row.name}:off`)}
    />
  );
}

function DevicesGroup() {
  const { settings } = useSettings();
  const rows = devicesOf(settings);
  const groups = [
    { title: W.workDevices, rows: rows.filter((row) => row.role === "work"), testid: "devices-work" },
    { title: W.fileDevices, rows: rows.filter((row) => row.role === "files"), testid: "devices-files" },
    { title: W.myDevices, rows: rows.filter((row) => row.role === "person"), testid: "devices-mine" },
  ].filter((group) => group.rows.length);
  return (
    <section class="settings-group" data-testid="settings-devices">
      <h2 class="section-head settings-head">
        <span>{W.devices}</span>
      </h2>
      {groups.length ? (
        groups.map((group) => (
          <div key={group.title} class="settings-subgroup" data-testid={group.testid}>
            <h3 class="settings-subhead">{group.title}</h3>
            <ul class="rows" aria-label={group.title}>
              {group.rows.map((row) => (
                <DeviceRowView key={row.name} row={row} />
              ))}
            </ul>
          </div>
        ))
      ) : (
        <ul class="rows" aria-label={W.devices}>
          <PlainRow title={W.empty} />
        </ul>
      )}
    </section>
  );
}

function ModelsGroup() {
  const { models } = useSettings();
  return (
    <Group title={W.modelsOcx} foot={W.modelsFoot} testid="settings-models">
      <LinkRow to={pageHref("models")} title={W.modelsOn(models.length)} />
    </Group>
  );
}

function HistoryRow({ line }: { line: SettingsAuditLine }) {
  const { settings, models } = useSettings();
  const { title, who } = historyLine(line, settings, models);
  return <PlainRow title={title} sub={who} testid="history-row" />;
}

/**
 * One question before the rollback: a bottom sheet on a phone, a small dialog on a wide window. It is drawn beside the
 * screens, not in them, so the phone's bars stay under it.
 */
export function RollbackSheet() {
  const edits = useSettingsEdits();
  const open = edits.askingRollback;
  const onClose = () => edits.askRollback(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div class="settings-scrim" aria-hidden="true" onClick={onClose} />
      <div class="settings-sheet" role="dialog" aria-modal="true" aria-label={W.rollbackOne} data-testid="rollback-sheet">
        <p class="settings-sheet-text">{W.rollbackQuestion}</p>
        <button
          type="button"
          class="settings-sheet-button is-red"
          onClick={() => void edits.rollback()}
          data-testid="rollback-confirm"
        >
          {W.undo}
        </button>
        <button type="button" class="settings-sheet-button" onClick={onClose} data-testid="rollback-cancel">
          {W.cancel}
        </button>
      </div>
    </>
  );
}

function HistoryGroup() {
  const { store, edits, locked } = useSettings();
  const lines = store.get("settingsHistory", SETTINGS_HISTORY.recent)?.revisions ?? [];
  const revision = edits.view?.revision.id ?? "";
  return (
    <>
      <Group title={W.history} testid="settings-history">
        {lines.slice(0, Number(SETTINGS_HISTORY.recent)).map((line) => (
          <HistoryRow key={line.rev} line={line} />
        ))}
        <LinkRow to={pageHref("history")} title={W.allHistory} testid="history-all" />
        <li class="row settings-row" data-testid="rollback-row">
          <button type="button" class="row-button settings-danger" disabled={locked || edits.rollingBack || revision === "r0"} onClick={() => edits.askRollback(true)} data-testid="rollback">
            {W.rollbackOne}
          </button>
          <ErrorLine line={edits.error(ROLLBACK_KEY)} />
        </li>
      </Group>
      <p class="settings-foot settings-rev" data-testid="settings-rev">
        {W.settingsRev(revision)}
      </p>
    </>
  );
}

function Pending() {
  const { store } = useApp();
  return <p class="empty">{store.status("settings") === "pending" ? W.loading : W.empty}</p>;
}

/** 설정: the work settings in grouped rows, each control saving as it changes. */
export function SettingsScreen() {
  const { edits } = useSettings();
  if (!edits.view) return <Pending />;
  return (
    <div class="list settings" data-testid="screen-settings">
      <Warnings />
      <ReadOnlyLine />
      <DefaultsGroup />
      <RunnersGroup />
      <RulesGroup />
      <DevicesGroup />
      <ModelsGroup />
      <HistoryGroup />
    </div>
  );
}

/** OCX's models grouped by service, each with what is left and when it resets; `choose` makes it a picker. */
function ModelList({ value, choose, followDefault }: { value?: string | null; choose?: (model: SettingsModel) => void; followDefault?: () => void }) {
  const { settings, models, now, locked } = useSettings();
  const ref = parseModel(value, settings);
  if (!models.length) return <p class="empty">{W.empty}</p>;
  return (
    <>
      {followDefault ? (
        <Group label={W.fallbackModel}>
          <ChoiceRow title={W.followDefault} chosen={!value} disabled={locked} onChoose={followDefault} />
        </Group>
      ) : null}
      {modelGroups(models).map((group) => (
        <Group key={group.service} title={group.name} testid="model-group">
          {group.models.map((model) => {
            const quota = quotaWord(model, now, until);
            if (!choose) return <ModelRow key={model.id} model={model} quota={quota} />;
            const chosen = ref?.provider === model.provider && ref.id === model.id;
            return <ChoiceRow key={model.id} title={modelName(model)} detail={quota.text} tone={quota.tone} chosen={chosen} disabled={locked} onChoose={() => choose(model)} />;
          })}
        </Group>
      ))}
    </>
  );
}

function ModelRow({ model, quota }: { model: SettingsModel; quota: ReturnType<typeof quotaWord> }) {
  return (
    <li class="row settings-row" data-testid="choice">
      <span class="row-body" aria-label={[modelName(model), quota.text].join(SEP)}>
        <Lines title={modelName(model)} />
        <span class={`settings-value ${quota.tone}`}>{quota.text}</span>
      </span>
    </li>
  );
}

function RunnerPage({ name }: { name: string }) {
  const { edits, settings, models, locked } = useSettings();
  const runner = new Map(runnerTable(settings)).get(name);
  if (!runner) return <p class="empty">{W.notFound}</p>;
  const key = (field: string) => `runner:${name}:${field}`;
  const effort = effortOf(runner.model, settings, models);
  return (
    <>
      <Group label={name}>
        <SwitchRow title={W.turnOn} label={`${name} ${W.turnOn}`} on={runnerOn(runner)} disabled={locked} onChange={(on) => edits.change(key("on"), runnerPatch(settings, name, { on }))} error={edits.error(key("on"))} />
      </Group>
      <Group label={W.model}>
        <LinkRow to={pageHref(`runner/${name}/model`)} title={W.model} value={modelLabel(runner.model, settings, models)} error={edits.error(key("model"))} />
        <LinkRow to={pageHref(`runner/${name}/effort`)} title={W.effort} value={effort ? effortWord(effort) : W.defaultValue} error={edits.error(key("effort"))} />
        <LinkRow to={pageHref(`runner/${name}/access`)} title={W.access} value={runner.access ? W.accessWord[runner.access] : W.defaultValue} error={edits.error(key("access"))} />
        <LinkRow to={pageHref(`runner/${name}/fallback`)} title={W.fallbackModel} value={runner.fallback_model ? modelLabel(runner.fallback_model, settings, models) : W.followDefault} error={edits.error(key("fallback"))} />
      </Group>
      {runner.argv?.length ? (
        <Group title={W.command}>
          <li class="row settings-row" data-testid="argv">
            <span class="row-body">
              <code class="settings-argv">{runner.argv.join(" ")}</code>
            </span>
          </li>
        </Group>
      ) : null}
    </>
  );
}

function RunnerPicker({ name, field }: { name: string; field: string }) {
  const { edits, settings, models, locked } = useSettings();
  const runner = new Map(runnerTable(settings)).get(name);
  if (!runner) return <p class="empty">{W.notFound}</p>;
  const key = `runner:${name}:${field}`;
  const save = (fields: Partial<Record<keyof SettingsRunner, unknown>>) => edits.change(key, runnerPatch(settings, name, fields));
  if (field === "model") return <PickerBody error={edits.error(key)}><ModelList value={runner.model} choose={(model) => save({ model: pickModel(model, runner.model, settings) })} /></PickerBody>;
  if (field === "fallback") return <PickerBody error={edits.error(key)}><ModelList value={runner.fallback_model} choose={(model) => save({ fallback_model: modelValue(model, null) })} followDefault={() => save({ fallback_model: null })} /></PickerBody>;
  if (field === "effort") {
    const model = findModel(parseModel(runner.model, settings), models);
    const chosen = effortOf(runner.model, settings, models);
    if (!model?.efforts.length) return <p class="empty">{W.empty}</p>;
    return (
      <PickerBody error={edits.error(key)}>
        <Group label={W.effort}>
          {model.efforts.map((effort) => (
            <ChoiceRow key={effort} title={effortWord(effort)} chosen={effort === chosen} disabled={locked} onChoose={() => save({ model: modelValue(model, effort) })} />
          ))}
        </Group>
      </PickerBody>
    );
  }
  if (field === "access")
    return (
      <PickerBody error={edits.error(key)}>
        <Group label={W.access}>
          {ACCESS.map((access) => (
            <ChoiceRow key={access} title={W.accessWord[access]} chosen={runner.access === access} disabled={locked} onChoose={() => save({ access })} />
          ))}
        </Group>
      </PickerBody>
    );
  return <p class="empty">{W.notFound}</p>;
}

function PickerBody({ error, children }: { error?: string; children: ComponentChildren }) {
  return (
    <>
      {children}
      <ErrorLine line={error} />
    </>
  );
}

function DefaultRunnerPicker() {
  const { edits, settings, locked } = useSettings();
  const chosen = defaultRunner(settings);
  return (
    <PickerBody error={edits.error("default-runner")}>
      <Group label={W.defaultRunner}>
        {runnerTable(settings)
          .filter(([, runner]) => runnerOn(runner))
          .map(([name]) => (
            <ChoiceRow key={name} title={name} chosen={name === chosen} disabled={locked} onChoose={() => edits.change("default-runner", { worker: { default_runner: name } })} />
          ))}
      </Group>
    </PickerBody>
  );
}

function FallbackPicker() {
  const { edits, settings } = useSettings();
  const value = settings.worker?.models?.fallback;
  return (
    <PickerBody error={edits.error("fallback")}>
      <ModelList value={value} choose={(model) => edits.change("fallback", { worker: { models: { fallback: pickModel(model, value, settings) } } })} />
    </PickerBody>
  );
}

function DevicePage({ name }: { name: string }) {
  const { edits, settings, locked } = useSettings();
  const row = devicesOf(settings).find((each) => each.name === name);
  if (!row) return <p class="empty">{W.notFound}</p>;
  if (row.role === "person")
    return (
      <Group label={name}>
        <PlainRow title={name} sub={W.statusOnly} />
      </Group>
    );
  const key = (field: string) => `device:${name}:${field}`;
  const save = (field: string, fields: SettingsPatch) => edits.change(key(field), { devices: { workers: { [name]: fields } } });
  const device = row.device;
  return (
    <>
      <Group label={name}>
        <SwitchRow title={W.turnOn} label={`${name} ${W.turnOn}`} on={device.off !== true} disabled={locked} onChange={(on) => save("off", { off: on ? null : true })} error={edits.error(key("off"))} />
      </Group>
      <Group label={W.devices}>
        {row.role === "work" ? <StepperRow title={W.bidCap} value={bidCap(device)} disabled={locked} onChange={(cap) => save("cap", { cap })} error={edits.error(key("cap"))} /> : null}
        <StepperRow title={W.namedCap} value={namedCap(device)} disabled={locked} onChange={(cap) => save("named_cap", { named_cap: cap })} error={edits.error(key("named_cap"))} />
      </Group>
      <Group label={W.repoWork}>
        <SwitchRow title={W.repoWork} on={device.no_repo !== true} disabled={locked} onChange={(on) => save("no_repo", { no_repo: on ? null : true })} error={edits.error(key("no_repo"))} />
        <SwitchRow title={W.fastDevice} on={device.fast === true} disabled={locked} onChange={(on) => save("fast", { fast: on ? true : null })} error={edits.error(key("fast"))} />
      </Group>
    </>
  );
}

/** A new rule: its label, an optional size, and the runner it sends to; 추가 saves it last and goes back. */
function RuleNewPage() {
  const { edits, settings, locked } = useSettings();
  const [label, setLabel] = useState("");
  const [size, setSize] = useState<RuleSize | null>(null);
  const [runner, setRunner] = useState(defaultRunner(settings));
  const rules = rulesOf(settings);
  const text = label.trim();
  return (
    <fieldset class="settings-fieldset" disabled={locked}>
      <Group label={W.ruleLabel}>
        <li class="row settings-row settings-field">
          <KoreanInput label={W.ruleLabel} value={label} onValue={setLabel} inline />
        </li>
      </Group>
      <section class="settings-group">
        <h2 class="section-head settings-head">
          <span>{W.ruleSize}</span>
        </h2>
        <div class="filter settings-sizes" role="group" aria-label={W.ruleSize}>
          {RULE_SIZES.map((each) => (
            <button key={each} type="button" class="choice" aria-pressed={size === each} disabled={locked} onClick={() => setSize(size === each ? null : each)}>
              {each}
            </button>
          ))}
        </div>
      </section>
      <Group title={W.runners}>
        {runnerTable(settings).map(([name]) => (
          <ChoiceRow key={name} title={name} chosen={runner === name} disabled={locked} onChoose={() => setRunner(name)} />
        ))}
      </Group>
      <div class="settings-actions">
        <button
          type="button"
          class="text-button"
          disabled={locked || !text}
          onClick={() => {
            edits.change("rules", { worker: { routing: [...rules, newRule(text, size, runner, rules)] } });
            back();
          }}
          data-testid="rule-save"
        >
          {W.add}
        </button>
      </div>
    </fieldset>
  );
}

function HistoryPage() {
  const { store } = useApp();
  const lines = store.get("settingsHistory", SETTINGS_HISTORY.all)?.revisions;
  if (!lines) return <Pending />;
  if (!lines.length) return <p class="empty">{W.empty}</p>;
  return (
    <Group label={W.allHistory}>
      {lines.map((line) => (
        <HistoryRow key={line.rev} line={line} />
      ))}
    </Group>
  );
}

function PageBody({ page }: { page: string }) {
  const [kind, name, field] = page.split("/");
  switch (kind) {
    case "default-runner":
      return <DefaultRunnerPicker />;
    case "fallback":
      return <FallbackPicker />;
    case "runner":
      return name ? field ? <RunnerPicker name={name} field={field} /> : <RunnerPage name={name} /> : null;
    case "device":
      return name ? <DevicePage name={name} /> : null;
    case "rule-new":
      return <RuleNewPage />;
    case "models":
      return (
        <>
          <ModelList />
          <p class="settings-foot">{W.modelsFoot}</p>
        </>
      );
    case "history":
      return <HistoryPage />;
    default:
      return <p class="empty">{W.notFound}</p>;
  }
}

/** A list the settings push: a runner, a device, a picker, the models, the full history or a new rule. */
export function SettingPage({ page }: { page: string }) {
  const { edits, wide, selected } = useSettings();
  const parent = settingParent(page);
  return (
    <article class="detail settings settings-page" data-testid="setting-page" data-page={page}>
      {wide && parent.name === "setting" ? (
        <Link href={href(parent)} class="crumb settings-crumb">
          {`‹ ${settingTitle(parent.page)}`}
        </Link>
      ) : null}
      <header class="detail-head">
        <h1 class="detail-title">{settingTitle(page)}</h1>
      </header>
      <ReadOnlyLine />
      {edits.view ? <PageBody key={selected} page={page} /> : <Pending />}
    </article>
  );
}
