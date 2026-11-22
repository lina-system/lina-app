/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_LINA_SOURCE?: string;
  /** `work` is the goals / to-do install; unset is the full LINA app. */
  readonly VITE_LINA_MODE?: string;
}
