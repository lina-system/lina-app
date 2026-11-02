import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const VERSION_PATTERN = /^0\.0\.1-alpha\.\d{8}\.[1-9]\d*$/;

export function readVersion(): string {
  const packagePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const version = JSON.parse(readFileSync(packagePath, "utf8")).version as unknown;
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    throw new Error(`App version must be 0.0.1-alpha.YYYYMMDD.N, got ${String(version)}`);
  }
  return version;
}
