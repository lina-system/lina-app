import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The core does not serve its schema until lina-system/lina#39.
// Switching this path to the core's schema file is part of that issue.
export const SCHEMA_SOURCE = path.join(root, "openapi", "lina-client.yaml");

const output = path.join(root, "src", "api", "generated.ts");
const cli = path.join(root, "node_modules", "openapi-typescript", "bin", "cli.js");

const result = spawnSync(
  process.execPath,
  [cli, SCHEMA_SOURCE, "--output", output, "--alphabetize", "--empty-objects-unknown"],
  { cwd: root, stdio: "inherit" },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
