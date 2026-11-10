// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { configuredNames, main, scanRepository, scanText } from "./check-personal-data.ts";

const joined = (...parts: string[]) => parts.join("");

/** A throwaway repository with one tracked file, so a scan has something to read. */
function trackedRepository(file: string, content: string): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "check-personal-data-"));
  execFileSync("git", ["init", "--quiet"], { cwd });
  writeFileSync(path.join(cwd, file), content);
  execFileSync("git", ["add", file], { cwd });
  return cwd;
}

function restoreConfiguredNames(value: string | undefined): void {
  if (value === undefined) delete process.env.PERSONAL_DATA_NAMES;
  else process.env.PERSONAL_DATA_NAMES = value;
}

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

test("allows public crate names that end like a device, but not a machine with the same suffix", () => {
  const text = [
    'name = "io-surface"',
    'name = "objc2-io-surface"',
    '"winapi-i686-pc-windows-gnu",',
    joined("zzyzx", "-surface"),
  ].join("\n");

  expect(scanText(text, "native/Cargo.lock", "").map((finding) => finding.line)).toEqual([4]);
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

test("still flags personal data that follows an allowed value on the same line", () => {
  const text = [
    joined("git@github.com ", "zzyzx", "@", "example.test"),
    joined("https://github.com/lina-system https://github.com/", "zzyzx"),
  ].join("\n");

  expect(scanText(text, "notes.md", "").map((finding) => finding.rule)).toEqual(["email", "github-profile"]);
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

test("reads the configured names from one comma separated value", () => {
  // Assembled from parts, like the other names here: this file is tracked too and
  // a real configured name must not be spelled out in it.
  const first = joined("Qzx", "vq Z", "xy");
  const second = joined("Wvv", "x Yy");

  expect(configuredNames("")).toEqual([]);
  expect(configuredNames(` ${first} , a ,, ${second} `)).toEqual([first, second]);
});

test("skips only the name rule when no names are configured, as in a fork pull request", () => {
  const cwd = trackedRepository("notes.md", "# Notes\n\nA clean page.\n");
  const previous = process.env.PERSONAL_DATA_NAMES;
  delete process.env.PERSONAL_DATA_NAMES;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(main([], cwd)).toBe(0);
    expect(log.mock.calls.flat().join("\n")).toContain("the name rule is skipped");
    expect(error).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    error.mockRestore();
    restoreConfiguredNames(previous);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("still runs the pattern rules when no names are configured", () => {
  const cwd = trackedRepository(
    "notes.md",
    ["# Notes", "", joined("/home/", "zzyzx", "/repo")].join("\n"),
  );
  const previous = process.env.PERSONAL_DATA_NAMES;
  delete process.env.PERSONAL_DATA_NAMES;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(main([], cwd)).toBe(1);
    expect(log.mock.calls.flat().join("\n")).toContain("the name rule is skipped");
    expect(error.mock.calls.flat().join("\n")).toContain("home-path");
  } finally {
    log.mockRestore();
    error.mockRestore();
    restoreConfiguredNames(previous);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("flags a configured name without printing it", () => {
  const personalName = ["Qzx", "vq Z", "xy"].join("");
  const cwd = trackedRepository("notes.md", `A goal added by ${personalName}\n`);
  const previous = process.env.PERSONAL_DATA_NAMES;
  process.env.PERSONAL_DATA_NAMES = personalName;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(main([], cwd)).toBe(1);
    const output = [...log.mock.calls, ...error.mock.calls].flat().join("\n");
    expect(output).toContain("personal-name");
    expect(output).not.toContain(personalName);
  } finally {
    log.mockRestore();
    error.mockRestore();
    restoreConfiguredNames(previous);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("scans a tracked symlink by its target path and never reads through it", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "check-personal-data-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd });
    mkdirSync(path.join(cwd, ".agents", "skills"), { recursive: true });
    writeFileSync(path.join(cwd, ".agents", "skills", "notes.md"), "clean\n");
    mkdirSync(path.join(cwd, ".claude"));
    symlinkSync("../.agents/skills", path.join(cwd, ".claude", "skills"));
    symlinkSync(joined("/home/", "zzyzx", "/notes.md"), path.join(cwd, "leak"));
    execFileSync("git", ["add", "-A"], { cwd });

    const report = scanRepository(cwd, "");
    expect(report.findings.map((finding) => [finding.file, finding.rule])).toEqual([["leak", "home-path"]]);
    expect(report.files).toBe(3);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
