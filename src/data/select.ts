import { bootstrapOptions, HttpSource } from "./http-source";
import { browserPushHost, type PushHost } from "../push";
import type { SettingsModel, SettingsPatch } from "../api/client";
import type { Source } from "./source";
import { SyntheticSource, type SettingsScript, type StreamScript, type TalkRefusal } from "./synthetic-source";

const TALK_REFUSALS: readonly string[] = ["busy", "down", "none"] satisfies TalkRefusal[];
const STREAM_SCRIPTS: readonly string[] = ["down", "drop", "resync", "token"] satisfies StreamScript[];
const SETTINGS_SCRIPTS: readonly string[] = ["readonly", "empty", "stale", "race", "ocx-down", "many-warnings"] satisfies SettingsScript[];

/**
 * The core by default. `?source=synthetic` or the build flag `VITE_LINA_SOURCE=synthetic` selects the synthetic
 * scene (tests, captures, verify.mjs); `&error=quota|checks` adds the failed-source variant for quota or the hub's checks,
 * `&running=none` one with no running card, `&writer=stopped` one whose writer of checked lines stopped, `&runs=ended`
 * one with ended runs and a card waiting on the owner (lina-app#116),
 * `&talk=busy|down|none` one whose talk turns are refused (429, 503, 409), `&live=down|drop|resync|token` a change stream
 * that refuses every connection, drops once while another device writes, sends one resync, or restarts the core with a
 * new session token, `&push=off` a core without push, `&settings=readonly|empty|stale|race|ocx-down` work settings this
 * device only reads, that were never written, that another device writes just before this page's first write (412) or
 * just after it lands (the changes queued behind it are dropped), whose models OCX did not answer for (the last
 * good list, with an error), or that leave four models warned about.
 */
export function chooseSource(location: Pick<Location, "search"> = window.location, flag: string | undefined = import.meta.env.VITE_LINA_SOURCE): Source {
  const params = new URLSearchParams(location.search);
  const source = params.get("source") ?? flag;
  if (source === "synthetic") {
    const talk = params.get("talk");
    const live = params.get("live");
    const settings = params.get("settings");
    const synthetic = new SyntheticSource({
      sourceError: params.get("error") === "quota",
      checksError: params.get("error") === "checks",
      noRunning: params.get("running") === "none",
      writerStopped: params.get("writer") === "stopped",
      endedRuns: params.get("runs") === "ended",
      talk: talk && TALK_REFUSALS.includes(talk) ? (talk as TalkRefusal) : null,
      live: live && STREAM_SCRIPTS.includes(live) ? (live as StreamScript) : "ok",
      pushOff: params.get("push") === "off",
      settings: settings && SETTINGS_SCRIPTS.includes(settings) ? (settings as SettingsScript) : null,
    });
    // verify.mjs reads the synthetic copy after a write to check the record changed, not only the screen.
    if (typeof window !== "undefined") {
      Object.defineProperty(window, "__linaScene", { configurable: true, get: () => structuredClone(synthetic.scene) });
      // verify.mjs reads which connections the stream had and how many snapshot reads the page made.
      // verify.mjs reads the synthetic core's push subscriptions after the row turns push on or off.
      Object.defineProperty(window, "__linaPush", { configurable: true, get: () => ({ enabled: synthetic.push.enabled, subscriptions: [...synthetic.push.subscriptions.values()].map((body) => structuredClone(body)), saves: synthetic.push.saves, removes: synthetic.push.removes }) });
      // verify.mjs reads the settings writes the page sent and the If-Match each carried.
      Object.defineProperty(window, "__linaSettingsWrites", { configurable: true, get: () => structuredClone(synthetic.settingsWrites) });
      // verify.mjs changes the settings or a model's state as another device or OCX would, with the settings event that follows.
      Object.defineProperty(window, "__linaSettingsElsewhere", {
        configurable: true,
        value: {
          write: (patch: SettingsPatch) => synthetic.settingsPatchedElsewhere(patch),
          model: (id: string, changes: Partial<Pick<SettingsModel, "state" | "left" | "resetAt">>) => synthetic.modelChangedElsewhere(id, changes),
        },
      });
      Object.defineProperty(window, "__linaStream", { configurable: true, get: () => ({ connections: structuredClone(synthetic.stream), reads: synthetic.reads, renewals: synthetic.renewals }) });
    }
    return synthetic;
  }
  return new HttpSource(bootstrapOptions());
}

/** The page's browser for push; the synthetic scene swaps in its own push service, since headless Chromium has none. */
export function choosePushHost(source: Source): PushHost {
  return browserPushHost(window as never, source instanceof SyntheticSource ? source.pushManager : undefined);
}
