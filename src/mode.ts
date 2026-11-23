import { stampManifest } from "../scripts/stamp-manifest.ts";

/**
 * Build-time product mode. Vite replaces `__LINA_WORK_ONLY__` from `VITE_LINA_MODE=work`.
 * Playwright loads `src/` without Vite, so the identifier is absent and this is the full app.
 */
export const WORK_ONLY: boolean = typeof __LINA_WORK_ONLY__ !== "undefined" && __LINA_WORK_ONLY__;

/** Home-screen and PWA name: the work-only install must be distinguishable. */
export const APP_NAME = WORK_ONLY ? "LINA 작업" : "LINA";

export { stampManifest };
