#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fails when a tracked file contains data that belongs to a person's machine,
 * account or agent rather than to the project.
 *
 * The patterns are about shape: a home directory, a host name, an email address,
 * a profile URL. Names have no reliable shape, so CI passes PERSONAL_DATA_NAMES
 * (comma separated) from a repository secret; a variable would print the list in
 * the logs. A pull request from a fork gets no secrets, so the variable is empty
 * there and only the name rule is skipped, which the run reports. Fixture names
 * come from src/fixtures/synthetic.ts, never from a real home.
 */

export interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly files?: (file: string) => boolean;
  readonly allow?: (match: RegExpMatchArray) => boolean;
}

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly match: string;
}

export interface ScanReport {
  readonly files: number;
  readonly findings: Finding[];
}

// Public project and funding accounts are not personal accounts.
const ALLOWED_GITHUB_ACCOUNTS = new Set(["code-yeongyu", "lina-system", "nousresearch", "sponsors"]);
const ALLOWED_EMAILS = new Set(["git@github.com", "noreply@github.com"]);

const BASE_RULES: Rule[] = [
  {
    name: "home-path",
    pattern: /(?:^|[^A-Za-z0-9._-])\/(?:home|Users)\/[A-Za-z0-9._-]+/,
  },
  {
    name: "windows-home-path",
    pattern: /\b[A-Za-z]:[\\/]+Users[\\/]+[A-Za-z0-9._ -]+/i,
  },
  {
    name: "machine-hostname",
    pattern:
      /\b(?:[a-z0-9][a-z0-9-]{0,62}\.(?:local|lan|internal|home\.arpa)|[a-z0-9][a-z0-9-]*(?:-(?:macbook|imac|mac-mini|mac-studio|thinkpad|surface|laptop|desktop|workstation|server|pc))|DESKTOP-[A-Z0-9]{7}|[a-z0-9][a-z0-9-]*\.[a-z0-9-]+\.ts\.net)\b/i,
  },
  {
    name: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    allow: (match) => !ALLOWED_EMAILS.has(match[0].toLowerCase()),
  },
  {
    name: "github-profile",
    pattern:
      /\bhttps?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/?(?![A-Za-z0-9_/-])/i,
    allow: (match) => !ALLOWED_GITHUB_ACCOUNTS.has((match[1] ?? "").toLowerCase()),
  },
  {
    name: "account-handle",
    pattern: /(?:^|[\s(])@([A-Za-z0-9][A-Za-z0-9_-]{1,38})(?![A-Za-z0-9_/-])/,
    files: (file) => file.endsWith(".md"),
    allow: (match) => !ALLOWED_GITHUB_ACCOUNTS.has((match[1] ?? "").toLowerCase()),
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The names to look for. Empty when the secret is absent, as in a fork pull request. */
export function configuredNames(
  extraNames: string | undefined = process.env.PERSONAL_DATA_NAMES,
): string[] {
  return (extraNames ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length >= 2);
}

/** The base rules plus one whole-word rule for every configured name. */
export function rules(extraNames: string | undefined = process.env.PERSONAL_DATA_NAMES): Rule[] {
  return [
    ...BASE_RULES,
    ...configuredNames(extraNames).map((name) => ({
      name: "personal-name",
      pattern: new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(name)}(?![A-Za-z0-9_])`, "i"),
    })),
  ];
}

/** Scan text line by line. The matched value stays in the report, never in the log. */
export function scanText(text: string, file = "", extraNames?: string): Finding[] {
  const active = rules(extraNames);
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const rule of active) {
      if (rule.files && !rule.files(file)) continue;
      const global = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
      for (const match of line.matchAll(global)) {
        if (rule.allow && !rule.allow(match)) continue;
        findings.push({ file, line: index + 1, rule: rule.name, match: match[0] });
        break;
      }
    }
  }
  return findings;
}

function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

function trackedFiles(cwd: string): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" });
  return output.split("\0").filter((file) => file.length > 0);
}

/** Scan every tracked text file in the checkout. */
export function scanRepository(cwd = process.cwd(), extraNames?: string): ScanReport {
  const files = trackedFiles(cwd);
  const findings: Finding[] = [];
  let scanned = 0;
  for (const file of files) {
    const full = path.join(cwd, file);
    // Git tracks a symlink as its target path, not the target's content: scan that path, never follow it.
    // The skill folders for each agent runner are such links to a directory.
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) {
      scanned += 1;
      findings.push(...scanText(readlinkSync(full), file, extraNames));
      continue;
    }
    if (!stat.isFile()) continue;
    const bytes = readFileSync(full);
    if (isBinary(bytes)) continue;
    scanned += 1;
    findings.push(...scanText(bytes.toString("utf8"), file, extraNames));
  }
  return { files: scanned, findings };
}

/** One line per finding. The matched value is deliberately not printed. */
export function renderFindings(report: ScanReport): string[] {
  return report.findings.map((finding) => `personal-data: ${finding.file}:${finding.line}: ${finding.rule}`);
}

const USAGE = `Usage: node scripts/check-personal-data.ts

Scans tracked text files for home paths, machine host names, email addresses,
personal accounts and the names in PERSONAL_DATA_NAMES (comma separated, from a
secret in CI). Without that value, as in a pull request from a fork, the pattern
rules still run and the name rule is reported as skipped.
`;

export function main(argv: string[] = process.argv.slice(2), cwd = process.cwd()): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length > 0) {
    console.error("check-personal-data: it reads git ls-files and takes no arguments");
    return 2;
  }
  try {
    const names = configuredNames();
    if (names.length === 0) {
      // A fork pull request gets no secrets. Say so, without ever printing a name.
      console.log(
        "check-personal-data: PERSONAL_DATA_NAMES is empty, so the name rule is skipped; " +
          "the pattern rules still run",
      );
    }
    const report = scanRepository(cwd, names.join(","));
    for (const line of renderFindings(report)) console.error(line);
    if (report.findings.length > 0) {
      console.error(
        `check-personal-data: ${report.findings.length} finding(s) in ${report.files} tracked files; ` +
          "remove the personal data and generate fixtures with src/fixtures/synthetic.ts",
      );
      return 1;
    }
    console.log(`check-personal-data: ${report.files} tracked files, no findings`);
    return 0;
  } catch (error) {
    console.error(`check-personal-data: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invoked) process.exitCode = main();
