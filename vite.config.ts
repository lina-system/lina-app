import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";
import { stampManifest } from "./scripts/stamp-manifest.ts";
import { readVersion } from "./scripts/version.ts";

const version = readVersion();

// The core serves the build under /app/ on its own origin (lina-system/lina#168).
export const BASE = "/app/";

const WORK_ONLY = process.env.VITE_LINA_MODE === "work";
const APP_NAME = WORK_ONLY ? "LINA 작업" : "LINA";

/** Stamps the work-only install name into index.html and the web manifest. The default build leaves both as "LINA". */
function linaModePlugin(): Plugin {
  let outDir = "dist";
  return {
    name: "lina-mode",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    transformIndexHtml(html) {
      if (!WORK_ONLY) return html;
      return html.replaceAll("<title>LINA</title>", `<title>${APP_NAME}</title>`).replaceAll('apple-mobile-web-app-title" content="LINA"', `apple-mobile-web-app-title" content="${APP_NAME}"`);
    },
    configureServer(server) {
      if (!WORK_ONLY) return;
      server.middlewares.use((req, res, next) => {
        if (!req.url?.includes("manifest.webmanifest")) {
          next();
          return;
        }
        const body = stampManifest(readFileSync("public/manifest.webmanifest", "utf8"), APP_NAME);
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(body);
      });
    },
    closeBundle() {
      if (!WORK_ONLY) return;
      const file = path.resolve(outDir, "manifest.webmanifest");
      if (!existsSync(file)) return;
      writeFileSync(file, stampManifest(readFileSync(file, "utf8"), APP_NAME));
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [preact(), linaModePlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
