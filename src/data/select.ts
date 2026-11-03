import { bootstrapOptions, HttpSource } from "./http-source";
import type { Source } from "./source";
import { SyntheticSource, type StreamScript, type TalkRefusal } from "./synthetic-source";

const TALK_REFUSALS: readonly string[] = ["busy", "down", "none"] satisfies TalkRefusal[];
const STREAM_SCRIPTS: readonly string[] = ["down", "drop", "resync"] satisfies StreamScript[];

/**
 * The core by default. `?source=synthetic` or the build flag `VITE_LINA_SOURCE=synthetic` selects the synthetic
 * scene (tests, captures, verify.mjs); `&error=quota` adds the failed-source variant, `&running=none` one with no running card,
 * `&talk=busy|down|none` one whose talk turns are refused (429, 503, 409), `&live=down|drop|resync` a change stream that
 * refuses every connection, drops once while another device writes, or sends one resync.
 */
export function chooseSource(location: Pick<Location, "search"> = window.location, flag: string | undefined = import.meta.env.VITE_LINA_SOURCE): Source {
  const params = new URLSearchParams(location.search);
  const source = params.get("source") ?? flag;
  if (source === "synthetic") {
    const talk = params.get("talk");
    const live = params.get("live");
    const synthetic = new SyntheticSource({
      sourceError: params.get("error") === "quota",
      noRunning: params.get("running") === "none",
      talk: talk && TALK_REFUSALS.includes(talk) ? (talk as TalkRefusal) : null,
      live: live && STREAM_SCRIPTS.includes(live) ? (live as StreamScript) : "ok",
    });
    // verify.mjs reads the synthetic copy after a write to check the record changed, not only the screen.
    if (typeof window !== "undefined") {
      Object.defineProperty(window, "__linaScene", { configurable: true, get: () => structuredClone(synthetic.scene) });
      // verify.mjs reads which connections the stream had and how many snapshot reads the page made.
      Object.defineProperty(window, "__linaStream", { configurable: true, get: () => ({ connections: structuredClone(synthetic.stream), reads: synthetic.reads }) });
    }
    return synthetic;
  }
  return new HttpSource(bootstrapOptions());
}
