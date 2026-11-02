// @vitest-environment node
import { expect, test } from "vitest";
import { scanText } from "./check-personal-data.ts";

const joined = (...parts: string[]) => parts.join("");

test("flags home paths, host names, emails and personal accounts", () => {
  const text = [
    joined("/home/", "zzyzx", "/repo"),
    joined("C:\\", "Users\\", "zzyzx", "\\repo"),
    joined("zzyzx", ".local"),
    joined("zzyzx", "@", "example.test"),
    joined("https://github.com/", "zzyzx"),
    joined("@", "zzyzx"),
  ].join("\n");

  expect(scanText(text, "notes.md", "").map((finding) => finding.rule)).toEqual([
    "home-path",
    "windows-home-path",
    "machine-hostname",
    "email",
    "github-profile",
    "account-handle",
  ]);
});

test("flags a machine name with a device suffix", () => {
  expect(scanText(joined("zzyzx", "-laptop"), "notes.ts", "").map((finding) => finding.rule)).toEqual([
    "machine-hostname",
  ]);
});

test("allows public project accounts and service addresses", () => {
  const text = [
    "https://github.com/lina-system",
    "https://github.com/lina-system/lina",
    "https://github.com/code-yeongyu/oh-my-openagent",
    "https://github.com/NousResearch/hermes-agent",
    "https://github.com/sponsors/csstools",
    "git@github.com:lina-system/lina.git",
    "(@lina-system)",
    "~/lina-app",
  ].join("\n");

  expect(scanText(text, "README.md", "")).toEqual([]);
});

test("flags a name configured in PERSONAL_DATA_NAMES", () => {
  const personalName = ["Qzx", "vq Z", "xy"].join("");
  const findings = scanText(`A goal added by ${personalName}`, "notes.md", personalName);

  expect(findings.map((finding) => finding.rule)).toEqual(["personal-name"]);
});

test("accepts the synthetic fixture vocabulary", () => {
  const text = ["Agent 1", "Machine 1", "fixture-model", "goal-1", "todo-1", "run-1", "note-1"].join(
    "\n",
  );

  expect(scanText(text, "fixture.json", "")).toEqual([]);
});
