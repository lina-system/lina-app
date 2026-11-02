import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";
import { readVersion } from "./scripts/version.ts";

export default defineConfig({
  plugins: [preact()],
  define: {
    __APP_VERSION__: JSON.stringify(readVersion()),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    setupFiles: ["src/test-setup.ts"],
  },
});
