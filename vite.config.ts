import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { readVersion } from "./scripts/version.ts";

const version = readVersion();

export default defineConfig({
  plugins: [preact()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
