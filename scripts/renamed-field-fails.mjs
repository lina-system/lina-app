import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "openapi", "lina-client.yaml");
const generatedPath = path.join(root, "src", "api", "generated.ts");

const field = "        goalCount:\n          type: integer";
const renamedField = "        objectiveCount:\n          type: integer";
const required = "required:\n        - goalCount";
const renamedRequired = "required:\n        - objectiveCount";

const originalSchema = readFileSync(schemaPath, "utf8");
const originalGenerated = readFileSync(generatedPath, "utf8");

if (!originalSchema.includes(field) || !originalSchema.includes(required)) {
  throw new Error("schema is missing the goalCount field the app reads");
}

const renamedSchema = originalSchema.replace(field, renamedField).replace(required, renamedRequired);

let output = "";
let status = 0;
try {
  writeFileSync(schemaPath, renamedSchema);
  const build = spawnSync("npm", ["run", "build"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  status = build.status ?? 1;
  output = `${build.stdout ?? ""}\n${build.stderr ?? ""}`;
  if (status === 0 || !output.includes("goalCount")) {
    throw new Error(
      `renaming goalCount should fail the app build because the screen reads that field\n${output}`,
    );
  }
} finally {
  writeFileSync(schemaPath, originalSchema);
  writeFileSync(generatedPath, originalGenerated);
}

console.log("renamed field failed the app build");
