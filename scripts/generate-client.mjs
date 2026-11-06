import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The core's own schema files, copied from lina-system/lina (see the comment at the top of each).
// Each one generates its own TypeScript module under src/api/.
export const SCHEMAS = [
  { source: path.join(root, "openapi", "board-client.yaml"), output: path.join(root, "src", "api", "board.generated.ts") },
  { source: path.join(root, "openapi", "work-client.yaml"), output: path.join(root, "src", "api", "work.generated.ts") },
  { source: path.join(root, "openapi", "talk-client.yaml"), output: path.join(root, "src", "api", "talk.generated.ts") },
  { source: path.join(root, "openapi", "push-client.yaml"), output: path.join(root, "src", "api", "push.generated.ts") },
];

const cli = path.join(root, "node_modules", "openapi-typescript", "bin", "cli.js");

for (const { source, output } of SCHEMAS) {
  const result = spawnSync(
    process.execPath,
    [cli, source, "--output", output, "--alphabetize", "--empty-objects-unknown"],
    { cwd: root, stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
