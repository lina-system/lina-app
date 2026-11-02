#!/usr/bin/env node
// Launch, check, drive and tear down a disposable LINA web app for verification.
//
//   verify.mjs launch [--no-build]
//   verify.mjs doctor
//   verify.mjs drive <feature-id>... | --all
//   verify.mjs map
//   verify.mjs cleanup
//
// Every command works on one run directory, verify-runs/<VERIFY_RUN_ID> (default
// "local"), under the repository root. Evidence lands in <run>/evidence/ and survives
// cleanup. See ../SKILL.md for the full recipe.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(skillDir, "..", "..", "..");
const featuresDir = path.join(skillDir, "features");
const runId = process.env.VERIFY_RUN_ID || "local";
if (!/^[\w.-]+$/.test(runId)) fail(`VERIFY_RUN_ID must be letters, digits, '.', '_' or '-', got ${runId}`);
const runDir = path.join(repo, "verify-runs", runId);
const statePath = path.join(runDir, "state.json");
const evidenceRoot = path.join(runDir, "evidence");
const viteBin = path.join(repo, "node_modules", "vite", "bin", "vite.js");

// The synthetic fixture the build renders (src/fixtures/synthetic.ts). Doctor and the
// home driver compare against it, so a page showing anything else is not this instance.
const FIXTURE = { goals: "2", todos: "3", runs: "1" };
const WIDTHS = [1280, 390];
const H2S = [
  "Platforms",
  "Intended behavior",
  "Sub-features",
  "How to get to it (user POV)",
  "Driving it with verify.mjs",
  "Gotchas",
  "Not goals",
];

function fail(message) {
  console.error(`verify: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(message);
}

function packageVersion() {
  return JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")).version;
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function readState() {
  if (!existsSync(statePath)) fail(`no instance for run ${runId}; run launch first (${statePath} is missing)`);
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function loadChromium() {
  const { chromium } = await import(path.join(repo, "node_modules", "@playwright", "test", "index.mjs"));
  return chromium;
}

function waitForLogLine(logPath, pattern, pid, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const text = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
      if (pattern.test(text)) return resolve();
      if (!alive(pid)) return reject(new Error(`preview exited before it was ready:\n${text}`));
      if (Date.now() > deadline) return reject(new Error(`preview not ready after ${timeoutMs} ms:\n${text}`));
      setTimeout(check, 200);
    };
    check();
  });
}

async function launch(args) {
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (alive(state.pid)) fail(`run ${runId} already has an instance at ${state.url} (pid ${state.pid}); run cleanup or pick another VERIFY_RUN_ID`);
  }
  mkdirSync(runDir, { recursive: true });
  const distDir = path.join(runDir, "dist");
  if (!args.includes("--no-build")) {
    log("build: generating the client and building into the run directory");
    for (const [cmd, cmdArgs] of [
      ["npm", ["run", "generate"]],
      [process.execPath, [viteBin, "build", "--outDir", distDir, "--emptyOutDir"]],
    ]) {
      const result = spawnSync(cmd, cmdArgs, { cwd: repo, stdio: "inherit" });
      if (result.status !== 0) fail(`build step failed: ${cmd} ${cmdArgs.join(" ")}`);
    }
  }
  if (!existsSync(path.join(distDir, "index.html"))) fail(`no build at ${distDir}; run launch without --no-build`);

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const logPath = path.join(runDir, "preview.log");
  const out = openSync(logPath, "w");
  const child = spawn(
    process.execPath,
    [viteBin, "preview", "--outDir", distDir, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: repo, detached: true, stdio: ["ignore", out, out] },
  );
  child.unref();
  const state = { runId, pid: child.pid, port, url, version: packageVersion(), revision: gitHead(), startedAt: new Date().toISOString() };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  try {
    await waitForLogLine(logPath, new RegExp(`127\\.0\\.0\\.1:${port}`), child.pid, 30_000);
    const problems = await checkInstance(state);
    if (problems.length) throw new Error(problems.join("\n"));
  } catch (error) {
    stopInstance(state);
    rmSync(statePath, { force: true });
    fail(`launch failed: ${error.message}`);
  }
  log(`ready: ${url} (pid ${child.pid}, run ${runId}, version ${state.version})`);
}

async function checkInstance(state) {
  const problems = [];
  if (!alive(state.pid)) problems.push(`process ${state.pid} is not running`);
  let response;
  try {
    response = await fetch(state.url);
  } catch (error) {
    problems.push(`GET ${state.url} failed: ${error.message}`);
    return problems;
  }
  if (response.status !== 200) problems.push(`GET ${state.url} returned ${response.status}`);
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(state.url);
    const version = (await page.getByTestId("version").textContent({ timeout: 10_000 }))?.trim();
    if (version !== packageVersion()) problems.push(`page shows version ${version}, package.json has ${packageVersion()}`);
    const counts = {
      goals: (await page.getByTestId("goal-count").textContent())?.trim(),
      todos: (await page.getByTestId("todo-count").textContent())?.trim(),
      runs: (await page.getByTestId("run-count").textContent())?.trim(),
    };
    if (JSON.stringify(counts) !== JSON.stringify(FIXTURE)) {
      problems.push(`page counts ${JSON.stringify(counts)} are not the fixture's ${JSON.stringify(FIXTURE)}; this is not the disposable fixture instance`);
    }
  } finally {
    await browser.close();
  }
  return problems;
}

async function doctor() {
  const state = readState();
  const problems = await checkInstance(state);
  const head = gitHead();
  const notes = head === state.revision ? [] : [`built at ${state.revision}, checkout is now ${head}; relaunch to drive the current code`];
  log(JSON.stringify({ run: runId, url: state.url, pid: state.pid, version: state.version, revision: state.revision, healthy: problems.length === 0, problems, notes }, null, 2));
  if (problems.length) process.exit(1);
}

function stopInstance(state) {
  if (!alive(state.pid)) return;
  try {
    process.kill(-state.pid, "SIGTERM");
  } catch {
    process.kill(state.pid, "SIGTERM");
  }
}

async function cleanup() {
  const state = readState();
  stopInstance(state);
  const deadline = Date.now() + 10_000;
  while (alive(state.pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  if (alive(state.pid)) fail(`process ${state.pid} did not stop; it is still ours to stop (kill -TERM -${state.pid})`);
  if (!(await portFree(state.port))) fail(`port ${state.port} is still in use after pid ${state.pid} stopped`);
  rmSync(path.join(runDir, "dist"), { recursive: true, force: true });
  rmSync(statePath, { force: true });
  log(`stopped pid ${state.pid}, port ${state.port} is free; evidence kept in ${evidenceRoot}`);
}

// Feature drivers. Each one drives the page the way a person does and records every
// action with the state it produced. A failed check is a defect against the feature
// file's Intended behavior.

class Defect extends Error {}

function check(condition, message) {
  if (!condition) throw new Defect(message);
}

async function text(locator) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  return (await locator.innerText()).trim();
}

const drivers = {
  async home(page, step) {
    await step("open the app", async () => {
      await page.goto("/");
      return `title "${await page.title()}"`;
    });
    await step("read the version", async () => {
      const version = await text(page.getByTestId("version"));
      check(version === packageVersion(), `version reads ${version}, expected ${packageVersion()}`);
      return version;
    });
    await step("read the summary", async () => {
      const summary = page.getByRole("list", { name: "Summary" });
      const counts = {
        goals: await text(summary.getByTestId("goal-count")),
        todos: await text(summary.getByTestId("todo-count")),
        runs: await text(summary.getByTestId("run-count")),
      };
      check(JSON.stringify(counts) === JSON.stringify(FIXTURE), `summary ${JSON.stringify(counts)}, expected ${JSON.stringify(FIXTURE)}`);
      return `Goals ${counts.goals}, To-dos ${counts.todos}, Runs ${counts.runs}`;
    });
    await step("read the agents and their work", async () => {
      for (const name of ["River", "Harbor"]) {
        check(await page.getByRole("heading", { level: 2, name }).isVisible(), `agent heading ${name} is not visible`);
      }
      check(await page.getByText("샘플 목표").isVisible(), "goal 샘플 목표 is not visible");
      const todo = await text(page.getByRole("listitem").filter({ hasText: /^Write the fixture ·/ }));
      check(todo.includes("in progress · working · River"), `to-do line reads "${todo}"`);
      const waiting = await text(page.getByRole("listitem").filter({ hasText: /^Note a line ·/ }));
      check(waiting.includes("waiting · input · Harbor"), `to-do line reads "${waiting}"`);
      return `River, Harbor; "${todo}"; "${waiting}"`;
    });
    await step("check the page fits the width", async () => {
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      check(fits, "the page scrolls sideways");
      return "no sideways scroll";
    });
  },

  async "note-input"(page, step) {
    await step("open the app", async () => {
      await page.goto("/");
      return "opened";
    });
    const note = page.getByRole("textbox", { name: "Note" });
    await step("type Latin text into Note at a person's pace", async () => {
      await note.click();
      await page.keyboard.type("hello", { delay: 50 });
      const value = await note.inputValue();
      check(value === "hello", `Note holds "${value}"`);
      await note.fill("");
      return value;
    });
    await step("compose 한 with an IME into Note", async () => {
      await note.click();
      await note.evaluate((element) => {
        element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        for (const value of ["ㅎ", "하", "한"]) {
          element.value = value;
          element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertCompositionText", isComposing: true }));
        }
        element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" }));
        element.dispatchEvent(new InputEvent("input", { bubbles: true, data: "한", inputType: "insertText", isComposing: false }));
      });
      const value = await note.inputValue();
      check(value === "한", `Note holds "${value}" after composition`);
      return value;
    });
  },

  async install(page, step) {
    await step("open the app", async () => {
      await page.goto("/");
      return "opened";
    });
    await step("read the web app manifest", async () => {
      const href = await page.locator('link[rel="manifest"]').getAttribute("href");
      check(Boolean(href), "the page links no manifest");
      const manifest = await (await page.request.get(href)).json();
      check(manifest.display === "standalone", `manifest display is ${manifest.display}`);
      for (const icon of manifest.icons) {
        const status = (await page.request.get(icon.src)).status();
        check(status === 200, `icon ${icon.src} returned ${status}`);
      }
      return `${manifest.name}, display ${manifest.display}, ${manifest.icons.length} icons`;
    });
    await step("read the Home Screen icon", async () => {
      const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
      const status = (await page.request.get(href ?? "/icons/apple-touch-icon.png")).status();
      check(status === 200, `apple-touch-icon returned ${status}`);
      return `${href} 200`;
    });
    await step("reload and wait for the service worker", async () => {
      await page.reload();
      await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active), null, { timeout: 15_000 });
      return "service worker active";
    });
  },
};

function featureFiles() {
  return readdirSync(featuresDir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => name.slice(0, -3))
    .sort();
}

function mapDrift() {
  const drift = [];
  const files = featureFiles();
  const index = readFileSync(path.join(featuresDir, "README.md"), "utf8");
  const linked = [...index.matchAll(/\]\(\.\/([\w-]+)\.md\)/g)].map((match) => match[1]);
  for (const id of files) {
    if (!linked.includes(id)) drift.push(`${id}.md is not listed in features/README.md`);
    if (!drivers[id]) drift.push(`${id}.md has no driver in scripts/verify.mjs`);
    const body = readFileSync(path.join(featuresDir, `${id}.md`), "utf8");
    const h2s = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim());
    if (JSON.stringify(h2s) !== JSON.stringify(H2S)) drift.push(`${id}.md sections are [${h2s.join(", ")}], expected [${H2S.join(", ")}]`);
  }
  for (const id of linked) if (!files.includes(id)) drift.push(`features/README.md links ${id}.md, which does not exist`);
  for (const id of Object.keys(drivers)) if (!files.includes(id)) drift.push(`driver ${id} has no feature file`);
  return drift;
}

function map() {
  const drift = mapDrift();
  for (const line of drift) log(`map drift: ${line}`);
  log(drift.length ? `${drift.length} map drift finding(s)` : `map ok: ${featureFiles().join(", ")}`);
  if (drift.length) process.exit(1);
}

async function drive(args) {
  const state = readState();
  const ids = args.includes("--all") ? featureFiles() : args.filter((arg) => !arg.startsWith("--"));
  if (!ids.length) fail("name one or more feature ids, or --all");
  for (const id of ids) if (!drivers[id]) fail(`no driver for feature "${id}"; known: ${Object.keys(drivers).join(", ")}`);

  const chromium = await loadChromium();
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const id of ids) {
      for (const width of WIDTHS) {
        const dir = path.join(evidenceRoot, id);
        mkdirSync(dir, { recursive: true });
        const context = await browser.newContext({ baseURL: state.url, viewport: { width, height: width > 600 ? 800 : 844 }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const steps = [];
        let defect = null;
        const step = async (action, run) => {
          if (defect) return;
          try {
            steps.push({ action, result: await run(), ok: true });
          } catch (error) {
            defect = `${action}: ${error.message}`;
            steps.push({ action, result: error.message, ok: false });
          }
        };
        await drivers[id](page, step);
        const stem = path.join(dir, `${id}-${width}`);
        await page.screenshot({ path: `${stem}.png`, fullPage: true });
        writeFileSync(`${stem}.aria.yml`, `${await page.locator("body").ariaSnapshot()}\n`);
        const result = { feature: id, width, url: state.url, version: state.version, revision: state.revision, at: new Date().toISOString(), ok: !defect, defect, steps };
        writeFileSync(`${stem}.json`, `${JSON.stringify(result, null, 2)}\n`);
        results.push(result);
        await context.close();
        log(`${defect ? "DEFECT" : "ok"} ${id} @${width}: ${defect ?? `${steps.length} steps`} -> ${path.relative(repo, stem)}.{png,aria.yml,json}`);
      }
    }
  } finally {
    await browser.close();
  }

  const drift = mapDrift();
  for (const line of drift) log(`map drift: ${line}`);
  const defects = results.filter((result) => !result.ok);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ["## Browser QA (scripted part)", "", `Run ${runId}, ${state.url}, revision ${state.revision}.`, "", "### Defects", ""];
    lines.push(...(defects.length ? defects.map((result) => `- \`${result.feature}\` at ${result.width}: ${result.defect}`) : ["- none"]));
    lines.push("", "### Map drift", "", ...(drift.length ? drift.map((line) => `- ${line}`) : ["- none"]), "");
    lines.push("Confirmed Done when items and suggestions come from the agent's QA run (see .agents/skills/verify-lina-app/SKILL.md).", "");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  }
  if (defects.length) process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const commands = { launch, doctor, drive, map, cleanup };
if (!commands[command]) fail(`usage: verify.mjs launch [--no-build] | doctor | drive <feature-id>... | drive --all | map | cleanup`);
await commands[command](rest);
