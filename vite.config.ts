import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { readVersion } from "./scripts/version.ts";

const version = readVersion();

// The core serves the build under /app/ on its own origin (lina-system/lina#168).
export const BASE = "/app/";

export default defineConfig({
  base: BASE,
  plugins: [preact()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
