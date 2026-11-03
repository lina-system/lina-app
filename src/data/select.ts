import { bootstrapOptions, HttpSource } from "./http-source";
import type { Source } from "./source";
import { SyntheticSource } from "./synthetic-source";

/**
 * The core by default. `?source=synthetic` or the build flag `VITE_LINA_SOURCE=synthetic` selects the synthetic
 * scene (tests, captures, verify.mjs); `&error=quota` adds the failed-source variant.
 */
export function chooseSource(location: Pick<Location, "search"> = window.location, flag: string | undefined = import.meta.env.VITE_LINA_SOURCE): Source {
  const params = new URLSearchParams(location.search);
  const source = params.get("source") ?? flag;
  if (source === "synthetic") {
    const synthetic = new SyntheticSource({ sourceError: params.get("error") === "quota" });
    // verify.mjs reads the synthetic copy after a write to check the record changed, not only the screen.
    if (typeof window !== "undefined") Object.defineProperty(window, "__linaScene", { configurable: true, get: () => structuredClone(synthetic.scene) });
    return synthetic;
  }
  return new HttpSource(bootstrapOptions());
}
