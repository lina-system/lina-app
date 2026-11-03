import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Renaming a field the home screen reads (ItemSummary.title in board-client.yaml) must
// fail the app build, so a schema change in the core cannot slip past the screens.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "openapi", "board-client.yaml");
const generatedPath = path.join(root, "src", "api", "board.generated.ts");

const originalSchema = readFileSync(schemaPath, "utf8");
const originalGenerated = readFileSync(generatedPath, "utf8");

const start = originalSchema.indexOf("\n    ItemSummary:\n");
const end = originalSchema.indexOf("\n    ItemList:\n", start);
if (start < 0 || end < 0) throw new Error("schema is missing the ItemSummary schema the app reads");
const block = originalSchema.slice(start, end);
const required = "parent, title, agent";
const field = "        title:\n          type: string\n";
if (!block.includes(required) || !block.includes(field)) throw new Error("ItemSummary is missing the title field the app reads");
const renamedBlock = block.replace(required, "parent, heading, agent").replace(field, "        heading:\n          type: string\n");
const renamedSchema = originalSchema.slice(0, start) + renamedBlock + originalSchema.slice(end);

let output = "";
try {
  writeFileSync(schemaPath, renamedSchema);
  const build = spawnSync("npm", ["run", "build"], { cwd: root, encoding: "utf8", env: process.env });
  output = `${build.stdout ?? ""}\n${build.stderr ?? ""}`;
  if (build.status === 0 || !/Property 'title' does not exist|'title'/.test(output)) {
    throw new Error(`renaming ItemSummary.title should fail the app build because the screens read that field\n${output}`);
  }
} finally {
  writeFileSync(schemaPath, originalSchema);
  writeFileSync(generatedPath, originalGenerated);
}

console.log("renamed field failed the app build");
