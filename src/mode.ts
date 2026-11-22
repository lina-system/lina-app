import { stampManifest } from "../scripts/stamp-manifest.ts";

/**
 * Build-time product mode. `VITE_LINA_MODE=work` is the owner's goals / to-do app
 * (no talk, status, or agent-ops). Anything else is the full LINA app, identical to today.
 */
export const WORK_ONLY: boolean = import.meta.env.VITE_LINA_MODE === "work";

/** Home-screen and PWA name: the work-only install must be distinguishable. */
export const APP_NAME = WORK_ONLY ? "LINA 작업" : "LINA";

export { stampManifest };
