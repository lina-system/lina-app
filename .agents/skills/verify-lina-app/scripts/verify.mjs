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
import { previewReady } from "./preview-log.mjs";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(skillDir, "..", "..", "..");
const featuresDir = path.join(skillDir, "features");
const runId = process.env.VERIFY_RUN_ID || "local";
if (!/^[\w.-]+$/.test(runId)) fail(`VERIFY_RUN_ID must be letters, digits, '.', '_' or '-', got ${runId}`);
const runDir = path.join(repo, "verify-runs", runId);
const statePath = path.join(runDir, "state.json");
const evidenceRoot = path.join(runDir, "evidence");
const viteBin = path.join(repo, "node_modules", "vite", "bin", "vite.js");

// The synthetic scene (src/fixtures/synthetic.ts, SCENE_COUNTS). Doctor compares the sidebar and the bell
// against it, so a page showing anything else is not this run's instance.
const APP_PATH = "/app/?source=synthetic";
const FIXTURE = { inbox: "7", running: "2", stopped: "1", due: "5", done: "1", goals: "5", bell: "알림 5", devices: "기기 3 · 정상 1 · 경고 1 · 꺼짐 1" };
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

function waitForLogLine(logPath, ready, pid, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const text = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
      if (ready(text)) return resolve();
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
    await waitForLogLine(logPath, (text) => previewReady(text, port), child.pid, 30_000);
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
    response = await fetch(state.url + "/app/");
  } catch (error) {
    problems.push(`GET ${state.url} failed: ${error.message}`);
    return problems;
  }
  if (response.status !== 200) problems.push(`GET ${state.url}/app/ returned ${response.status}`);
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(state.url + APP_PATH + "#/inbox");
    const version = (await page.getByTestId("version").textContent({ timeout: 10_000 }))?.trim();
    if (version !== packageVersion()) problems.push(`page shows version ${version}, package.json has ${packageVersion()}`);
    const count = async (id) => (await page.getByTestId(id).getByTestId("nav-count").textContent())?.trim();
    const counts = {
      inbox: await count("nav-inbox"),
      running: await count("nav-running"),
      stopped: (await page.getByTestId("nav-running").getByTestId("nav-stopped").textContent())?.trim(),
      due: await count("nav-due"),
      done: await count("nav-done"),
      goals: await count("nav-goals"),
      bell: await page.getByTestId("bell").getAttribute("aria-label"),
      devices: (await page.getByTestId("device-line").textContent())?.trim(),
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

// The app lives under /app/ on the core's origin; the drive always draws the synthetic scene.
// Always a fresh load: going to the address the page already shows only moves the hash and keeps the scene.
async function openApp(page, hash, query = "") {
  if (page.url() !== "about:blank") await page.goto("about:blank");
  await page.goto(APP_PATH + query + hash);
  await page.getByTestId("freshness-line").filter({ hasText: /^갱신 \d+초 전$/ }).waitFor({ timeout: 10_000 });
}

async function title(page) {
  return text(page.locator("[data-testid=screen-title]").first());
}

async function rowNames(list) {
  await list.first().waitFor({ timeout: 10_000 });
  return list.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("aria-label") ?? link.textContent));
}

// Red marks the problem, not the row: a stopped card's title keeps the label colour, its state words are red,
// and its time is the same grey as any card's time.
async function stoppedCardColours(list) {
  const rows = await list.locator("[data-testid=row]").evaluateAll((items) =>
    items.map((item) => ({
      stopped: item.classList.contains("is-stopped"),
      title: getComputedStyle(item.querySelector(".title")).color,
      state: getComputedStyle(item.querySelector("[data-testid=state]")).color,
      time: item.querySelector(".time") ? getComputedStyle(item.querySelector(".time")).color : null,
    })),
  );
  const stopped = rows.find((row) => row.stopped);
  const running = rows.find((row) => !row.stopped);
  check(stopped && running, "the list needs a stopped and a running card to compare");
  check(stopped.title === running.title, "the stopped card's title is " + stopped.title + ", a running card's " + running.title);
  check(stopped.state === "rgb(255, 59, 48)", "the stopped card's state words are " + stopped.state);
  check(stopped.time === running.time, "the stopped card's time is " + stopped.time + ", a running card's " + running.time);
  return "title " + stopped.title + ", state " + stopped.state + ", time " + stopped.time;
}

async function decisionNames(list) {
  await list.first().waitFor({ timeout: 10_000 });
  return list.locator(":scope > li > .row-button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
}

const ACCENT = "rgb(0, 122, 255)";

// A text button reads as a button: accent text when enabled, secondary grey only when disabled, 44 px tall on a phone.
async function buttonLook(page, locator) {
  const look = await locator.evaluate((button) => ({ text: button.textContent.trim(), colour: getComputedStyle(button).color, disabled: button.disabled, height: button.getBoundingClientRect().height }));
  if (look.disabled) check(look.colour !== ACCENT, look.text + " is disabled but drawn in the accent colour");
  else check(look.colour === ACCENT, look.text + " is enabled but drawn " + look.colour);
  if (page.viewportSize().width < 900) check(look.height >= 44, look.text + " is " + look.height + " px tall on a phone");
  return look.text + "=" + look.colour + (look.disabled ? " (disabled)" : "") + ", " + Math.round(look.height) + " px";
}

async function sidebarCount(page, testid) {
  const nav = page.getByTestId(testid);
  if (!(await nav.count())) return null;
  return (await nav.getByTestId("nav-count").innerText()).trim();
}

const drivers = {
  async inbox(page, step) {
    await step("open the app on 수신함", async () => {
      await openApp(page, "#/inbox");
      return await title(page);
    });
    await step("read the three groups in order", async () => {
      const decide = await decisionNames(page.getByRole("list", { name: "결정 필요" }));
      const review = await rowNames(page.getByRole("list", { name: "검토 필요" }));
      const mine = await rowNames(page.getByRole("list", { name: "내 할 일" }));
      check(decide.length === 4 && review.length === 1 && mine.length === 2, "groups have " + decide.length + "/" + review.length + "/" + mine.length + " rows, expected 4/1/2");
      check(decide.filter((name) => name.endsWith("질문")).length === 2 && decide.filter((name) => name.endsWith("요청")).length === 2, "decisions are not two 질문 and two 요청: " + decide.join(" | "));
      const all = [...decide, ...review, ...mine];
      check(new Set(all).size === all.length, "an item appears twice");
      const shown = await sidebarCount(page, "nav-inbox");
      if (shown !== null) check(shown === String(all.length), "the 수신함 count is " + shown + ", not " + all.length);
      return [...decide, ...review, ...mine].join(" | ");
    });
    await step("decisions run oldest first", async () => {
      const days = await page.getByRole("list", { name: "결정 필요" }).locator(".trail .time").allInnerTexts();
      const ages = days.map((text) => Number(text.match(/\d+/)?.[0] ?? 0) * (text.includes("일") ? 1440 : text.includes("시간") ? 60 : 1));
      check(ages.every((age, index) => index === 0 || age <= ages[index - 1]), "decisions are not oldest first: " + days.join(", "));
      return days.join(", ");
    });
    await step("each decision opens the record it is aimed at, which shows the decision", async () => {
      const list = page.getByRole("list", { name: "결정 필요" });
      const buttons = list.locator(":scope > li > .row-button");
      for (let index = 0; index < (await buttons.count()); index += 1) await buttons.nth(index).click();
      const rows = await list.locator(":scope > li").evaluateAll((items) =>
        items.map((item) => ({ href: item.querySelector(".decision-panel a").getAttribute("href"), text: item.querySelector(".row-button .title").textContent.trim(), context: item.querySelector(".decision-panel a").textContent.trim(), kind: item.querySelector(".kind-word").textContent.trim() })),
      );
      const seen = { item: 0, card: 0 };
      for (const row of rows) {
        await openApp(page, row.href);
        const box = page.locator(".detail .box").filter({ has: page.locator(".box-head", { hasText: /^결정 필요$/ }) }).first();
        await box.waitFor({ timeout: 5_000 }).catch(() => check(false, row.href + " shows no decision box"));
        const boxText = await box.innerText();
        check(boxText.includes(row.text), row.href + " shows a different decision: " + boxText);
        check(boxText.includes(row.kind) && /\d+(분|시간|일) 전/.test(boxText), row.href + " decision box lacks kind word or age: " + boxText);
        const title = (await page.locator(".detail-title").first().innerText()).trim();
        if (row.href.startsWith("#/cards/")) {
          seen.card += 1;
          const first = (await page.locator(".detail .box").first().locator(".box-head").innerText()).trim();
          check(first === "결정 필요", "the card's question box is not on top (first box " + first + ")");
          check(row.context.endsWith(" › " + title), "card question context " + row.context + " does not end with the card " + title);
        } else {
          check(/^#\/(items|goals)\//.test(row.href), "a decision opens " + row.href + ", not a goal or to-do");
          seen.item += 1;
          check(row.context === title || row.context.endsWith(" › " + title), "context " + row.context + " does not read 목표 › 할 일 for " + title);
        }
      }
      check(seen.item >= 1 && seen.card >= 1, "expected decisions on records and a card question: " + JSON.stringify(seen));
      await openApp(page, "#/inbox");
      return rows.length + " decisions: " + seen.item + " on goals or to-dos, " + seen.card + " on a card";
    });
    await step("a decision expands in place, and its line opens the record", async () => {
      const first = page.getByRole("list", { name: "결정 필요" }).locator(":scope > li").first();
      await first.locator(".row-button").click();
      check((await first.locator(".row-button").getAttribute("aria-expanded")) === "true", "the row did not expand");
      check(/#\/inbox$/.test(page.url()), "expanding the row navigated to " + page.url());
      await first.getByRole("button", { name: /추천$/ }).waitFor({ timeout: 5_000 }).catch(() => check(false, "the first decision shows no recommended answer"));
      await first.locator(".decision-panel a").click();
      await page.locator(".detail-title").waitFor();
      check(/#\/items\//.test(page.url()), "the row opened " + page.url());
      return (await page.locator(".detail-title").innerText()) + " at " + new URL(page.url()).hash;
    });
  },

  async running(page, step) {
    await step("open 진행 중인 작업", async () => {
      await openApp(page, "#/");
      await page.getByRole("link", { name: /^진행 중인 작업/ }).click();
      return await title(page);
    });
    await step("stopped cards come first, then running cards", async () => {
      const names = await rowNames(page.getByRole("list", { name: "진행 중인 작업" }));
      check(names.length === 3, "expected 3 cards, got " + names.length);
      check(names[0].endsWith("중단됨 · 응답 없음"), "the first card is not stopped: " + names[0]);
      check(names.slice(1).every((name) => name.endsWith("진행 중")), "the rest are not running: " + names.join(" | "));
      check(!names.some((name) => name.includes("실패 화면 검토")), "a waiting card is in the list");
      const grey = await sidebarCount(page, "nav-running");
      if (grey !== null) {
        const red = (await page.getByTestId("nav-running").getByTestId("nav-stopped").innerText()).trim();
        check(grey === "2" && red === "1", "sidebar reads " + grey + " and red " + red + ", expected 2 and red 1");
      }
      return names.join(" | ");
    });
    await step("each card has one grey state line with its time", async () => {
      const lines = await page.getByRole("list", { name: "진행 중인 작업" }).locator(".sub:not(.now)").allInnerTexts();
      check(/^중단됨 · 응답 없음 · \d+분 전$/.test(lines[0]), "stopped line reads " + lines[0]);
      check(lines.slice(1).every((line) => /^진행 중 · \d+(분|시간)째$/.test(line)), "running lines read " + lines.join(", "));
      return lines.join(", ");
    });
    await step("a stopped card: label title, red state words, grey time", async () => stoppedCardColours(page.getByRole("list", { name: "진행 중인 작업" })));
    await step("with no running card the stopped one is still listed, with 다시 시도", async () => {
      await openApp(page, "#/running", "&running=none");
      const list = page.getByRole("list", { name: "진행 중인 작업", exact: true });
      await list.waitFor({ timeout: 5_000 }).catch(() => check(false, "the screen shows its empty state with a stopped card"));
      const names = await rowNames(list);
      check(names.length === 1 && names[0].endsWith("중단됨 · 응답 없음"), "the list reads " + names.join(" | "));
      const retry = await buttonLook(page, page.getByRole("button", { name: /다시 시도$/ }));
      check((await page.getByText("없음", { exact: true }).count()) === 0, "the empty state shows beside the stopped card");
      await openApp(page, "#/running");
      return names[0] + "; " + retry;
    });
    await step("the now line shows at 1280 only", async () => {
      const wide = page.viewportSize().width >= 900;
      const shown = await page.getByText("변경 목록을 기능별로 묶는 중").first().isVisible();
      check(shown === wide, "now line visible=" + shown + " at width " + page.viewportSize().width);
      return wide ? "now line shown" : "no now line on a phone";
    });
  },

  async due(page, step) {
    await step("open 마감일", async () => {
      await openApp(page, "#/");
      await page.getByRole("link", { name: /^마감일/ }).click();
      return await title(page);
    });
    await step("read the groups", async () => {
      const groups = {};
      for (const name of ["지남", "오늘", "이번 주", "이후"]) {
        const list = page.getByRole("list", { name, exact: true });
        groups[name] = (await list.count()) ? (await list.getByRole("link").count()) : 0;
      }
      const total = Object.values(groups).reduce((sum, n) => sum + n, 0);
      check(total === 5, "due rows total " + total + ", expected 5");
      check(groups["지남"] >= 1 && groups["오늘"] >= 1, "no overdue or today group: " + JSON.stringify(groups));
      const shown = await sidebarCount(page, "nav-due");
      if (shown !== null) check(shown === String(total), "the 마감일 count is " + shown + ", not " + total);
      return JSON.stringify(groups);
    });
    await step("overdue dates are red and today's orange", async () => {
      const overdue = page.getByRole("list", { name: "지남", exact: true }).locator(".due-date").first();
      const today = page.getByRole("list", { name: "오늘", exact: true }).locator(".due-date").first();
      const red = await overdue.evaluate((element) => getComputedStyle(element).color);
      const orange = await today.evaluate((element) => getComputedStyle(element).color);
      check(red === "rgb(255, 59, 48)", "overdue colour " + red);
      check(orange === "rgb(255, 149, 0)", "today colour " + orange);
      return "overdue " + red + ", today " + orange;
    });
  },

  async done(page, step) {
    await step("open 완료", async () => {
      await openApp(page, "#/");
      await page.getByRole("link", { name: /^완료/ }).first().click();
      return await title(page);
    });
    await step("read the finished cards", async () => {
      const list = page.getByRole("list", { name: "완료" });
      const names = await rowNames(list);
      const lines = await list.locator(".sub").allInnerTexts();
      check(names.length === 1 && names.every((name) => name.endsWith("완료")), "done list " + names.join(" | "));
      check(/^완료 · \d+분$/.test(lines[0]), "done line reads " + lines[0]);
      return names.join(" | ") + " / " + lines.join(", ");
    });
  },

  async "agent-screen"(page, step) {
    let agent = "";
    await step("open an agent from the sidebar", async () => {
      await openApp(page, "#/");
      const link = page.getByRole("list", { name: "에이전트" }).getByRole("link").nth(1);
      agent = (await link.locator(".nav-label").innerText()).trim();
      await link.click();
      return agent + " at " + new URL(page.url()).hash;
    });
    await step("the screen reads 진행 중, 검토 필요, 목표, then one done line", async () => {
      const heads = await page.locator(".list h2.section-head > span:first-child").allInnerTexts();
      check(JSON.stringify(heads) === JSON.stringify(["진행 중", "검토 필요", "목표"]), "sections " + heads.join(", "));
      const doneLine = await page.getByTestId("done-today").innerText();
      check(/^완료 · 오늘 \d+$/.test(doneLine.trim()), "done line reads " + doneLine);
      return heads.join(" → ") + " → " + doneLine.trim();
    });
    await step("a stopped card in 진행 중: label title, red state words, grey time", async () => stoppedCardColours(page.getByTestId("section-running")));
    await step("the head draws its counts like the sidebar and the section headings: grey, stopped in red", async () => {
      const read = (locator) => locator.evaluateAll((nodes) => nodes.map((node) => ({ text: node.textContent.trim(), colour: getComputedStyle(node).color, pair: Boolean(node.closest(".count-pair")) })));
      const head = await read(page.getByTestId("agent-counts").locator(".count"));
      const sections = await read(page.locator(".list .section-head .count"));
      const sidebar = await read(page.locator(".nav-row:not(.is-current) .count"));
      const red = "rgb(255, 59, 48)";
      const grey = sections.find((entry) => entry.colour !== red)?.colour;
      const stopped = await page.getByTestId("agent-counts").getByLabel(/^중단됨 \d+$/).evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
      check(stopped.length === 1 && stopped[0] === red, "the head's stopped count is drawn " + stopped.join(", ") + ", expected " + red);
      const plain = head.filter((entry) => entry.colour !== red);
      check(plain.every((entry) => entry.colour !== "rgb(0, 0, 0)" && entry.colour !== "rgb(255, 255, 255)"), "a head count is drawn in the label colour: " + plain.map((entry) => entry.text + "=" + entry.colour).join(", "));
      check(plain.every((entry) => entry.colour === grey), "head counts are " + plain.map((entry) => entry.colour).join(", ") + ", section headings " + grey);
      check(head.length > 0 && head.every((entry) => entry.pair), "the head does not use the shared count component");
      check(sidebar.every((entry) => entry.pair) && sections.every((entry) => entry.pair), "the sidebar or a section heading does not use the shared count component");
      return "grey " + grey + ", stopped " + stopped[0];
    });
    await step("the header shows counts only; stopped cards get their own red number", async () => {
      const header = (await page.getByTestId("agent-counts").innerText()).trim();
      for (const id of ["running", "review", "goals"]) {
        const head = page.getByTestId("agent-count-" + id);
        const grey = Number(await head.locator(".count").first().innerText());
        const red = (await head.getByTestId("stopped-count").count()) ? Number(await head.getByTestId("stopped-count").innerText()) : 0;
        const list = page.getByTestId("section-" + id);
        const rows = (await list.count()) ? await list.getByTestId("row").count() : 0;
        const stopped = (await list.count()) ? await list.locator("[data-testid=row].is-stopped").count() : 0;
        check(grey === rows - stopped && red === stopped, id + " head " + grey + "/" + red + " but rows " + rows + " with " + stopped + " stopped");
      }
      return header;
    });
  },

  async goals(page, step) {
    await step("open 목표", async () => {
      await openApp(page, "#/");
      await page.getByRole("link", { name: /^목표/ }).click();
      return await title(page);
    });
    await step("read the goal lines", async () => {
      const names = await rowNames(page.getByRole("list", { name: "목표" }));
      check(names.length === 5, "expected 5 goals, got " + names.length);
      return names.join(" | ");
    });
    await step("open a goal and read its boxes", async () => {
      await page.getByRole("list", { name: "목표" }).getByRole("link", { name: /결제 화면 개편/ }).click();
      await page.locator(".detail-title").waitFor();
      const heads = await page.locator(".detail .box-head").allInnerTexts();
      for (const head of ["완료 조건", "내 말", "할 일", "작업"]) check(heads.some((text) => text.includes(head)), "no " + head + " box: " + heads.join(", "));
      const fold = await page.locator("details.fold").evaluate((element) => element.open);
      check(fold === false, "the owner's words are not folded");
      const boxes = page.locator(".detail").getByRole("list", { name: "할 일" }).getByRole("checkbox", { name: /완료로 표시$/ });
      check((await boxes.count()) === 3, "expected 3 to-do check boxes");
      const all = await page.locator(".detail").getByRole("checkbox").count();
      check(all === 4 && (await page.locator(".detail-head").getByRole("checkbox", { name: "결제 화면 개편 완료로 표시" }).count()) === 1, "expected the goal's head box plus 3, got " + all);
      check((await boxes.first().getAttribute("aria-disabled")) === null, "an open to-do's check box is inert");
      const cards = await rowNames(page.getByRole("list", { name: "작업" }));
      check(cards.length === 3, "expected 3 work cards, got " + cards.length);
      check(await page.getByRole("textbox", { name: "댓글 달기" }).isVisible(), "the goal page has no comment field");
      return heads.join(", ") + "; cards " + cards.join(" | ");
    });
    await step("a done goal shows the evidence that closed it", async () => {
      await openApp(page, "#/goals/G4");
      await page.getByTestId("evidence").waitFor();
      return await page.getByTestId("evidence").innerText();
    });
  },

  async "item-detail"(page, step) {
    await step("open a to-do from its goal", async () => {
      await openApp(page, "#/goals/G2");
      await page.getByRole("list", { name: "할 일" }).getByRole("link", { name: /^카드 입력 폼 다듬기/ }).click();
      await page.getByTestId("screen-item").waitFor();
      return new URL(page.url()).hash;
    });
    await step("read the check box, done condition, state, runs and thread", async () => {
      const box = page.locator(".detail-head").getByRole("checkbox", { name: "카드 입력 폼 다듬기 완료로 표시" });
      check((await box.getAttribute("aria-disabled")) === null, "the open to-do's check box is inert");
      const heads = await page.locator(".detail .box-head").allInnerTexts();
      check(JSON.stringify(heads) === JSON.stringify(["완료 조건", "실행", "댓글"]), "boxes " + heads.join(", "));
      const resolved = page.getByTestId("resolved");
      check((await resolved.count()) === 1 && !(await resolved.evaluate((fold) => fold.open)), "the resolved thread is not folded");
      const fold = (await resolved.locator("summary").innerText()).trim();
      check(/^해결됨 · \S+/.test(fold), "the resolved thread reads " + fold);
      const runs = await page.getByRole("list", { name: "실행" }).innerText();
      check(/카드 입력 폼 다듬기\s*·\s*진행 중/.test(runs), "run line reads " + runs);
      const comments = await page.getByTestId("comment").count();
      const replies = await page.getByTestId("reply").count();
      check(comments === 2 && replies === 2, "thread has " + comments + " comments and " + replies + " replies");
      const byline = await page.getByTestId("reply").first().locator(".sub").innerText();
      check(/^.+ · \d+(분|시간|일) 전/.test(byline), "reply byline reads " + byline);
      return heads.join(", ") + "; " + comments + " comments, " + replies + " replies";
    });
    await step("send a comment: it shows at once with its pending line and lands in the record", async () => {
      const field = page.getByRole("textbox", { name: "댓글 달기" });
      const send = page.getByRole("button", { name: "보내기", exact: true });
      check(await send.isDisabled(), "보내기 is enabled on an empty field");
      const empty = await buttonLook(page, send);
      await field.fill("휴대폰 가로 화면도 봐 주세요");
      const ready = await buttonLook(page, send);
      check(ready.includes(ACCENT), "보내기 does not turn accent once the field has text: " + ready);
      await send.click();
      const pending = page.getByTestId("comment-pending");
      await pending.waitFor({ timeout: 2_000 });
      const line = (await pending.innerText()).trim();
      check(/^\S+에게 보냄 · 방금$/.test(line), "the pending line reads " + line + " (button " + empty + " → " + ready + ")");
      check((await field.inputValue()) === "", "the field still holds the sent text");
      await page.waitForFunction(() => window.__linaScene.itemDetails.T4.comments.some((comment) => comment.text === "휴대폰 가로 화면도 봐 주세요" && comment.by === "owner"), null, { timeout: 5_000 }).catch(() => check(false, "the synthetic record has no such comment"));
      return line;
    });
    await step("the agent's reply arrives on a later refresh and the pending line goes", async () => {
      await page.getByTestId("comment-pending").waitFor({ state: "detached", timeout: 25_000 }).catch(() => check(false, "the pending line stayed after the reply was due"));
      const reply = (await page.getByTestId("reply").last().locator(".sub").innerText()).trim();
      check(/^\S+ · \d+분 전 · 반영함$/.test(reply), "the reply reads " + reply);
      return reply;
    });
  },

  async "card-detail"(page, step) {
    await step("open a running card", async () => {
      await openApp(page, "#/running");
      await page.getByRole("list", { name: "진행 중인 작업" }).getByRole("link", { name: /릴리스 노트: 변경 목록 정리/ }).click();
      await page.getByTestId("screen-card").waitFor();
      return new URL(page.url()).hash;
    });
    await step("read its state, now line, to-dos, dimmed runs and comments", async () => {
      const state = await page.locator(".detail-head .sub").innerText();
      check(/^진행 중 · \d+분째$/.test(state), "state reads " + state);
      const heads = await page.locator(".detail .box-head").allInnerTexts();
      check(JSON.stringify(heads) === JSON.stringify(["지금", "할 일", "실행", "댓글"]), "boxes " + heads.join(", "));
      check((await page.getByRole("checkbox", { name: /완료로 표시$/ }).count()) === 2, "expected 2 to-dos");
      const dim = page.getByRole("list", { name: "실행" }).locator(".row.is-dim");
      check((await dim.count()) === 1, "expected 1 worker run row, got " + (await dim.count()));
      const look = await dim.first().evaluate((row) => ({ opacity: getComputedStyle(row).opacity, state: getComputedStyle(row.querySelector("[data-testid=state]")).color }));
      check(look.opacity === "1", "the worker run row is faded (opacity " + look.opacity + ")");
      check((await page.getByTestId("comment").count()) === 2, "expected 2 comments");
      return state + "; " + heads.join(", ");
    });
    await step("a run outside any card opens on its own", async () => {
      await openApp(page, "#/inbox");
      await page.getByRole("list", { name: "검토 필요" }).getByRole("link").first().click();
      await page.getByTestId("screen-run").waitFor();
      const state = await page.locator(".detail-head .sub").innerText();
      check(/^대기 · 검토 필요 · \d+시간 전$/.test(state), "run state reads " + state);
      return new URL(page.url()).hash + " " + state;
    });
  },

  async status(page, step) {
    await step("open 기기·쿼터 from the sidebar line", async () => {
      await openApp(page, "#/");
      const line = (await page.getByTestId("device-line").innerText()).trim();
      check(line === "기기 3 · 정상 1 · 경고 1 · 꺼짐 1", "device line reads " + line);
      const colours = await page.getByTestId("device-line").evaluate((element) => [...element.querySelectorAll("span")].map((span) => span.textContent.trim() + "=" + getComputedStyle(span).color));
      check(colours.some((entry) => entry.endsWith("경고 1=rgb(255, 149, 0)")) && colours.some((entry) => entry.endsWith("꺼짐 1=rgb(255, 59, 48)")), "colours " + colours.join(", "));
      await page.getByTestId("device-line").click();
      await page.getByTestId("screen-status").waitFor();
      return line;
    });
    await step("read the machines", async () => {
      const names = await page.getByRole("list", { name: "기기" }).locator(".row-body").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));
      check(names.length === 3, "expected 3 machines");
      const meters = "CPU (\\d+%|—) · 메모리 (\\d+%|—) · 디스크 (\\d+%|—) · 작업 (\\d+|—)/\\d+$";
      check(names.some((name) => new RegExp(" · 정상 · " + meters).test(name)), "no 정상 machine with its meters: " + names.join(" | "));
      check(names.some((name) => new RegExp(" · 경고 · 디스크 · " + meters).test(name)), "no 경고 machine with its reason word: " + names.join(" | "));
      check(names.some((name) => / · 꺼짐 · 연결 끊김 · CPU — · 메모리 — · 디스크 — · 작업 —\/\d+$/.test(name)), "no 꺼짐 machine reading 연결 끊김 and — meters: " + names.join(" | "));
      const colours = await page.getByRole("list", { name: "기기" }).locator(".machine-state").evaluateAll((words) => words.map((word) => word.textContent + "=" + getComputedStyle(word).color));
      check(colours.includes("경고=rgb(255, 149, 0)") && colours.includes("꺼짐=rgb(255, 59, 48)"), "state colours " + colours.join(", "));
      const bars = await page.getByRole("list", { name: "기기" }).locator(".mini-meter .meter").count();
      check(bars === 6, "expected 6 thin bars on the two machines that report, got " + bars);
      const loads = await page.getByRole("list", { name: "기기" }).locator(".trail").allInnerTexts();
      check(loads.every((text) => /^작업 (\d+|—)\/\d+$/.test(text)), "loads read " + loads.join(", "));
      return names.join(" | ");
    });
    await step("read the quota and unfold a service", async () => {
      const list = page.getByRole("list", { name: "쿼터" });
      const names = await list.locator("summary").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));
      check(names.length === 3, "expected 3 services, got " + names.length);
      check(names[0].startsWith("Claude · ") && names[1].startsWith("ChatGPT · ") && names[2].startsWith("가온셈 · "), "service names " + names.join(" | "));
      check(names.filter((name) => name.endsWith("주의")).length === 1, "expected one service with 주의");
      check(names.every((name) => /^\S+ · \d+%( · 시간당 \+\d+%)? · \d+(분|시간|일) 후( · 주의)?$/.test(name)), "quota lines " + names.join(" | "));
      const title = await list.locator(".rate").first().getAttribute("title");
      check(title === "최근 5시간 평균", "the rate's title is " + title);
      const warn = await list.locator("summary .warn-mark").evaluate((mark) => getComputedStyle(mark).color);
      check(warn === "rgb(255, 59, 48)", "주의 is drawn " + warn);
      check(!(await list.getByTestId("account").first().isVisible()), "accounts are not folded");
      await list.locator("summary").first().click();
      const accounts = await list.getByTestId("account").evaluateAll((rows) => rows.filter((row) => row.checkVisibility()).map((row) => row.getAttribute("aria-label")));
      check(accounts.length === 2 && accounts.every((name) => /^계정 \d · \d+% · 시간당 \+\d+% · \d+(분|시간|일) 후( · 주의)?$/.test(name)), "Claude's accounts read " + accounts.join(" | "));
      return names.join(" | ") + "; Claude: " + accounts.join(" | ");
    });
    await step("주의 follows the rule, resets read hours under a day and days over, no rate means no rate part", async () => {
      const rows = await page.getByRole("list", { name: "쿼터", exact: true }).locator(":scope > li").evaluateAll((items) => items.map((item) => ({ name: item.querySelector("summary .title").textContent, sub: item.querySelector("summary .sub").textContent, warn: Boolean(item.querySelector("summary .warn-mark")) })));
      const scene = await page.evaluate(() => ({ at: Date.now() / 1000, quota: window.__linaScene.quota.quota }));
      for (const [index, service] of scene.quota.entries()) {
        const reaches = service.accounts.some((account) => account.windows.some((w) => w.ratePerHour !== null && w.percent + (w.ratePerHour * (w.resetAt - scene.at)) / 3600 >= 100));
        check(reaches === rows[index].warn, rows[index].name + " shows 주의=" + rows[index].warn + " but its rate reaches 100% before reset=" + reaches);
        const reset = Math.min(...service.accounts.map((account) => (account.windows.find((w) => w.key === account.mainWindow) ?? account.windows[0]).resetAt)) - scene.at;
        const word = rows[index].sub.split(" · ").at(-1);
        check(reset < 86400 ? /^\d+시간 후$/.test(word) : /^\d+일 후$/.test(word), rows[index].name + " resets in " + Math.round(reset) + " s but reads " + word);
        check(!/ · {2}| · $|^ · | ·  · /.test(rows[index].sub) && rows[index].sub.split(" · ").every(Boolean), rows[index].name + " has a gap: " + rows[index].sub);
        if (service.ratePerHour === null) check(!rows[index].sub.includes("시간당"), rows[index].name + " has no rate but reads " + rows[index].sub);
      }
      return rows.map((row) => row.name + ": " + row.sub + (row.warn ? " · 주의" : "")).join(" | ");
    });
  },

  // Every write control on the synthetic instance: what it changes on screen and in the page's copy of the record.
  async actions(page, step) {
    const scene = (pick) => page.evaluate(pick);
    const toastGone = () => page.getByTestId("toast").waitFor({ state: "detached", timeout: 8_000 }).catch(() => check(false, "the toast stayed past five seconds"));
    const wide = page.viewportSize().width >= 900;
    const headCount = async (id) => Number((await page.getByTestId("head-" + id).locator("[data-testid=count]").innerText()).trim());
    await step("a ticked 내 할 일 row stays struck and checked for the toast, then leaves", async () => {
      await openApp(page, "#/inbox");
      const mine = page.getByRole("list", { name: "내 할 일" });
      await mine.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }).click();
      await page.waitForFunction(() => window.__linaScene.itemDetails.T3.state === "done" && !window.__linaScene.board.inbox.mine.some((row) => row.id === "T3"), null, { timeout: 3_000 }).catch(() => check(false, "the record is not done"));
      const box = mine.getByRole("checkbox", { name: "공지 문구 확인 완료됨" });
      check((await box.count()) === 1, "the ticked row left the list before its toast ended");
      check((await box.getAttribute("aria-checked")) === "true", "the held row is not checked");
      const strike = await box.locator("xpath=..").locator(".title").evaluate((title) => getComputedStyle(title).textDecorationLine);
      check(strike === "line-through", "the held row is not struck through");
      check((await headCount("mine")) === 2, "내 할 일 counts " + (await headCount("mine")) + " while the row is shown");
      if (wide) check((await sidebarCount(page, "nav-inbox")) === "7", "the sidebar counts " + (await sidebarCount(page, "nav-inbox")));
      await toastGone();
      await mine.getByRole("checkbox", { name: /^공지 문구 확인/ }).waitFor({ state: "detached", timeout: 2_000 }).catch(() => check(false, "the row stayed after the toast"));
      check((await headCount("mine")) === 1, "내 할 일 counts " + (await headCount("mine")) + " after the row left");
      if (wide) check((await sidebarCount(page, "nav-inbox")) === "6", "the sidebar counts " + (await sidebarCount(page, "nav-inbox")) + " after the row left");
      return "held struck for the toast, then gone; 내 할 일 2 → 1";
    });
    await step("되돌리기 on a held row puts it back unchecked", async () => {
      await openApp(page, "#/inbox");
      const mine = page.getByRole("list", { name: "내 할 일" });
      await mine.getByRole("checkbox", { name: "저장소 접근 권한 주기 완료로 표시" }).click();
      await page.waitForFunction(() => window.__linaScene.itemDetails.T9.state === "done", null, { timeout: 3_000 }).catch(() => check(false, "the record is not done"));
      const undo = page.getByTestId("toast").getByRole("button", { name: "되돌리기" });
      const look = await undo.evaluate((button) => getComputedStyle(button).color + ", " + Math.round(button.getBoundingClientRect().height) + " px");
      if (!wide) check(Number(look.split(", ")[1].split(" ")[0]) >= 44, "the toast's 되돌리기 is " + look + " on a phone");
      await undo.click();
      await page.waitForFunction(() => window.__linaScene.itemDetails.T9.state === "planned", null, { timeout: 3_000 }).catch(() => check(false, "undo did not reopen the record"));
      await mine.getByRole("checkbox", { name: "저장소 접근 권한 주기 완료로 표시" }).waitFor({ timeout: 3_000 });
      check((await headCount("mine")) === 2, "내 할 일 counts " + (await headCount("mine")) + " after undo");
      return "back unchecked, 내 할 일 2; toast button " + look;
    });
    await step("a row hidden for its answer's toast is out of every count; undo puts it back", async () => {
      await openApp(page, "#/inbox");
      const list = page.getByRole("list", { name: "결정 필요" });
      await list.getByRole("button", { name: /배포를 금요일 오후에 해도 될까요/ }).click();
      const pick = page.getByRole("button", { name: "금요일 오후 · 추천" });
      await pick.waitFor({ timeout: 3_000 });
      await pick.click();
      const during = { decide: await headCount("decide"), rows: (await decisionNames(list)).length, sidebar: wide ? await sidebarCount(page, "nav-inbox") : "6" };
      check(during.decide === 3 && during.rows === 3 && during.sidebar === "6", "during the toast: " + JSON.stringify(during));
      await page.getByTestId("toast").getByRole("button", { name: "되돌리기" }).click();
      const after = { decide: await headCount("decide"), rows: (await decisionNames(list)).length, sidebar: wide ? await sidebarCount(page, "nav-inbox") : "7" };
      check(after.decide === 4 && after.rows === 4 && after.sidebar === "7", "after undo: " + JSON.stringify(after));
      return "during " + JSON.stringify(during) + ", after undo " + JSON.stringify(after);
    });
    await step("done, then 되돌리기 in the toast", async () => {
      await openApp(page, "#/goals/G2");
      const todos = page.locator(".detail").getByRole("list", { name: "할 일" });
      await todos.getByRole("checkbox", { name: "결제 실패 화면 검토 완료로 표시" }).click();
      const done = todos.getByRole("checkbox", { name: "결제 실패 화면 검토 완료됨" });
      await done.waitFor({ timeout: 1_000 });
      check((await done.getAttribute("aria-checked")) === "true", "the box is not checked");
      const strike = await done.locator("xpath=..").locator(".title").evaluate((title) => getComputedStyle(title).textDecorationLine);
      check(strike === "line-through", "the row is not struck through: " + strike);
      check((await page.getByTestId("toast").innerText()).startsWith("완료로 표시함"), "no 완료로 표시함 toast");
      await page.waitForFunction(() => window.__linaScene.itemDetails.T6.state === "done", null, { timeout: 3_000 }).catch(() => check(false, "the record is not done"));
      await page.getByTestId("toast").getByRole("button", { name: "되돌리기" }).click();
      await todos.getByRole("checkbox", { name: "결제 실패 화면 검토 완료로 표시" }).waitFor({ timeout: 3_000 });
      await page.waitForFunction(() => window.__linaScene.itemDetails.T6.state === "waiting", null, { timeout: 3_000 }).catch(() => check(false, "undo did not reopen the record"));
      return "struck, toast, record done; undo: record " + (await scene(() => window.__linaScene.itemDetails.T6.state));
    });
    await step("after the toast the to-do page offers 되돌리기", async () => {
      await openApp(page, "#/items/T3");
      const head = page.locator(".detail-head");
      await head.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }).click();
      check((await head.getByRole("button", { name: "되돌리기" }).count()) === 0, "the page shows 되돌리기 beside the toast");
      await toastGone();
      const undo = head.getByRole("button", { name: "되돌리기" });
      await undo.waitFor({ timeout: 2_000 }).catch(() => check(false, "no 되돌리기 on the page after the toast"));
      const until = await scene(() => window.__linaScene.itemDetails.T3.ownerDone?.undoUntil - window.__linaScene.itemDetails.T3.ownerDone?.at);
      check(until === 600, "the undo window is " + until + " s");
      await undo.click();
      await head.getByRole("checkbox", { name: "공지 문구 확인 완료로 표시" }).waitFor({ timeout: 3_000 });
      const state = await scene(() => window.__linaScene.itemDetails.T3.state);
      check(state === "planned", "undo left the record " + state);
      return "되돌리기 after the toast; record " + state;
    });
    await step("a goal with open to-dos asks once, then one undo reopens all", async () => {
      await openApp(page, "#/goals/G1");
      const detail = page.locator(".detail");
      await detail.locator(".detail-head").getByRole("checkbox", { name: "릴리스 노트 정리 완료로 표시" }).click();
      const ask = (await page.getByTestId("with-open").innerText()).trim();
      check(ask.startsWith("열린 할 일 3개도 함께 완료할까요?"), "the question reads " + ask);
      check((await scene(() => window.__linaScene.itemDetails.G1.state)) === "in_progress", "asking already wrote");
      await buttonLook(page, page.getByRole("button", { name: "함께 완료" }));
      await buttonLook(page, page.getByRole("button", { name: "취소" }));
      await page.getByRole("button", { name: "함께 완료" }).click();
      await page.waitForFunction(() => ["G1", "T1", "T2", "T3"].every((id) => window.__linaScene.itemDetails[id].state === "done"), null, { timeout: 3_000 }).catch(() => check(false, "the goal and its to-dos are not all done"));
      const checked = await detail.getByRole("checkbox", { checked: true }).count();
      check(checked === 4, "checked boxes " + checked);
      await page.getByTestId("toast").getByRole("button", { name: "되돌리기" }).click();
      await page.waitForFunction(() => JSON.stringify(["G1", "T1", "T2", "T3"].map((id) => window.__linaScene.itemDetails[id].state)) === JSON.stringify(["in_progress", "in_progress", "waiting", "planned"]), null, { timeout: 3_000 }).catch(() => check(false, "undo did not reopen all"));
      return ask + " → 함께 완료 → 4 checked → 되돌리기 → all reopened";
    });
    await step("an answer with choices: the row leaves, and the answer goes after the toast", async () => {
      await openApp(page, "#/inbox");
      const list = page.getByRole("list", { name: "결정 필요" });
      await list.getByRole("button", { name: /배포를 금요일 오후에 해도 될까요/ }).click();
      const pick = page.getByRole("button", { name: "금요일 오후 · 추천" });
      await pick.waitFor({ timeout: 3_000 });
      await pick.click();
      check((await list.getByRole("button", { name: /배포를 금요일/ }).count()) === 0, "the row is still listed");
      check((await page.getByTestId("toast").innerText()).startsWith("답함"), "no 답함 toast");
      const early = await scene(() => window.__linaScene.itemDetails.T2.comments.filter((comment) => comment.kind === "answer").length);
      check(early === 0, "the answer was sent before the toast ended");
      await toastGone();
      await page.waitForFunction(() => window.__linaScene.itemDetails.T2.comments.some((comment) => comment.kind === "answer" && comment.text === "금요일 오후"), null, { timeout: 3_000 }).catch(() => check(false, "the answer did not reach the record"));
      check((await list.getByRole("button", { name: /배포를 금요일/ }).count()) === 0, "the row came back");
      return "row gone, answer 금요일 오후 recorded after the toast";
    });
    await step("a free-text answer and a card's question", async () => {
      await openApp(page, "#/inbox");
      const list = page.getByRole("list", { name: "결정 필요" });
      await list.getByRole("button", { name: /자주 쓰는 검색어 열 개를/ }).click();
      await page.getByRole("textbox", { name: "답 달기" }).fill("결제, 환불, 배송");
      await page.getByRole("button", { name: "보내기", exact: true }).click();
      await toastGone();
      await page.waitForFunction(() => window.__linaScene.itemDetails.T12.comments.some((comment) => comment.kind === "answer" && comment.text === "결제, 환불, 배송"), null, { timeout: 3_000 }).catch(() => check(false, "the free-text answer did not reach the record"));
      await list.getByRole("button", { name: /카드 번호는 앞 여섯 자리까지/ }).click();
      await page.getByRole("textbox", { name: "답 달기" }).fill("앞 네 자리만요");
      await page.getByRole("button", { name: "보내기", exact: true }).click();
      await toastGone();
      await page.waitForFunction(() => window.__linaScene.cardDetails["k-102"].comments.some((comment) => comment.body === "앞 네 자리만요") && window.__linaScene.inbox.questions.length === 0, null, { timeout: 3_000 }).catch(() => check(false, "the card answer did not reach the card"));
      const left = await decisionNames(list);
      check(left.length === 2, "decisions left " + left.join(" | "));
      return "T12 and the card answered; left: " + left.join(" | ");
    });
    await step("다시 시도 on a stopped card", async () => {
      await openApp(page, "#/running");
      await page.getByRole("button", { name: /다시 시도$/ }).click();
      const line = page.getByTestId("retry-requested");
      await line.waitFor({ timeout: 2_000 });
      const text = (await line.innerText()).trim();
      check(/^\S+에게 요청함$/.test(text), "the row reads " + text);
      await page.waitForFunction(() => window.__linaScene.itemDetails.T5.comments.some((comment) => comment.text === "다시 시도해 주세요."), null, { timeout: 3_000 }).catch(() => check(false, "the retry did not reach the to-do"));
      await line.waitFor({ state: "detached", timeout: 15_000 }).catch(() => check(false, "요청함 stayed past the next refresh"));
      return text + ", then 다시 시도 again after the refresh";
    });
  },

  async bell(page, step) {
    const bell = () => page.getByRole("button", { name: /^알림/ });
    const dialog = () => page.getByRole("dialog", { name: "알림" });
    await step("the badge is the unread count; the dialog dims read notices", async () => {
      await openApp(page, "#/inbox");
      const name = await bell().getAttribute("aria-label");
      check(name === "알림 5", "bell is named " + name);
      await bell().click();
      const rows = await dialog().getByRole("list", { name: "알림" }).locator(":scope > li").evaluateAll((items) => items.map((item) => ({ read: item.classList.contains("is-read"), colour: getComputedStyle(item.querySelector(".title")).color })));
      check(rows.length === 7, "the bell lists " + rows.length + " notices");
      check(rows.filter((row) => row.read).length === 2, "read notices " + rows.filter((row) => row.read).length);
      const unread = rows.find((row) => !row.read).colour;
      check(rows.filter((row) => row.read).every((row) => row.colour !== unread), "read notices are not dimmed");
      check(await dialog().getByRole("button", { name: "모두 읽음" }).isEnabled(), "모두 읽음 is disabled");
      const header = (await dialog().getByTestId("unread-count").innerText()).trim();
      const unreadLines = rows.filter((row) => !row.read).length;
      check(header === "안 읽음 " + unreadLines && name === "알림 " + unreadLines, "badge " + name + ", header " + header + ", unread lines " + unreadLines);
      await buttonLook(page, dialog().getByRole("button", { name: "모두 읽음" }));
      await buttonLook(page, dialog().getByRole("button", { name: "닫기" }));
      await dialog().getByRole("button", { name: "닫기" }).click();
      check((await page.getByTestId("notices").count()) === 0, "닫기 did not close the dialog");
      await bell().click();
      await page.keyboard.press("Escape");
      await page.getByTestId("notices").waitFor({ state: "hidden", timeout: 2_000 }).catch(() => check(false, "Escape did not close the notices"));
      return name + ", 7 lines, 2 dimmed";
    });
    await step("choosing a notice opens its item and marks it read on the core", async () => {
      await bell().click();
      const first = dialog().locator("li:not(.is-read) a").first();
      const target = await first.getAttribute("href");
      await first.click();
      await page.waitForFunction((hash) => location.hash === hash, target, { timeout: 3_000 }).catch(() => check(false, "the notice did not open " + target));
      const name = await bell().getAttribute("aria-label");
      check(name === "알림 4", "after reading one the bell is named " + name);
      await bell().click();
      const header = (await dialog().getByTestId("unread-count").innerText()).trim();
      const unreadLines = await dialog().locator("li:not(.is-read)").count();
      check(header === "안 읽음 4" && unreadLines === 4, "after reading one: header " + header + ", unread lines " + unreadLines);
      await dialog().getByRole("button", { name: "닫기" }).click();
      await page.waitForFunction(() => window.__linaScene.board.counts.unread === 4, null, { timeout: 3_000 }).catch(() => check(false, "the record's unread count is not 4"));
      return target + "; " + name;
    });
    await step("모두 읽음 marks every notice read", async () => {
      await bell().click();
      await dialog().getByRole("button", { name: "모두 읽음" }).click();
      const name = await bell().getAttribute("aria-label");
      check(name === "알림", "after 모두 읽음 the bell is named " + name);
      check((await page.getByTestId("bell-count").count()) === 0, "the badge is still drawn");
      await page.waitForFunction(() => window.__linaScene.board.notices.every((notice) => notice.read) && window.__linaScene.board.counts.unread === 0, null, { timeout: 3_000 }).catch(() => check(false, "the record still has unread notices"));
      const dim = await dialog().locator("li.is-read").count();
      check(dim === 7, "dimmed lines " + dim);
      const header = (await dialog().getByTestId("unread-count").innerText()).trim();
      check(header === "안 읽음 0", "the header reads " + header);
      const stored = await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length);
      check(stored === 0, "the page keeps " + stored + " keys in web storage");
      return name + ", 7 dimmed, nothing in web storage";
    });
  },

  async freshness(page, step) {
    await step("read the freshness line", async () => {
      await openApp(page, "#/inbox");
      const first = await page.getByTestId("freshness-line").innerText();
      check(/^갱신 \d+초 전$/.test(first), "freshness reads " + first);
      await page.waitForFunction((before) => document.querySelector("[data-testid=freshness-line]")?.textContent !== before, first, { timeout: 5_000 });
      return first + " → " + (await page.getByTestId("freshness-line").innerText());
    });
    await step("a failed source reads 읽기 실패 and the rest still draws", async () => {
      await openApp(page, "#/inbox", "&error=quota");
      const failed = (await page.getByTestId("read-failed").innerText()).trim();
      check(failed === "· 읽기 실패: 쿼터", "failure reads " + failed);
      const rows = (await decisionNames(page.getByRole("list", { name: "결정 필요" }))).length;
      check(rows === 4, "the inbox drew " + rows + " decisions");
      return failed;
    });
  },

  async "phone-nav"(page, step) {
    const wide = page.viewportSize().width >= 900;
    if (wide) {
      await step("the split view shows the sidebar, list and detail side by side", async () => {
        await openApp(page, "#/running");
        await page.getByRole("list", { name: "진행 중인 작업" }).getByRole("link").first().click();
        await page.locator(".detail-pane .detail-title").waitFor();
        check(await page.getByRole("navigation", { name: "메뉴" }).isVisible(), "no sidebar");
        const selected = await page.locator(".list-pane [aria-current=page]").count();
        check(selected === 1, "no selected row");
        return new URL(page.url()).hash;
      });
      await step("browser back restores the list without a selection and folds the detail pane", async () => {
        await page.goBack();
        await page.waitForFunction(() => location.hash === "#/running");
        check((await page.locator(".list-pane [aria-current=page]").count()) === 0, "a row is still selected");
        check((await page.getByTestId("detail-pane").count()) === 0, "the empty detail pane is still drawn");
        const width = await page.locator(".list-pane").evaluate((pane) => pane.getBoundingClientRect().width);
        const room = await page.getByTestId("panes").evaluate((panes) => panes.getBoundingClientRect().width);
        check(width === room, "the list takes " + width + " of " + room + " px");
        return new URL(page.url()).hash + ", list " + width + " px wide";
      });
      return;
    }
    await step("the first screen is the menu with a large title", async () => {
      await openApp(page, "#/");
      check((await title(page)) === "LINA", "large title is not LINA");
      return "LINA";
    });
    await step("a row pushes the next screen; back names the screen it returns to", async () => {
      await page.getByRole("link", { name: /^진행 중인 작업/ }).click();
      await page.waitForFunction(() => location.hash === "#/running");
      const back = (await page.getByTestId("back").innerText()).trim();
      check(back === "LINA", "back reads " + back);
      await page.getByRole("list", { name: "진행 중인 작업" }).getByRole("link").first().click();
      await page.getByTestId("screen-card").waitFor();
      const back2 = (await page.getByTestId("back").innerText()).trim();
      check(back2 === "진행 중인 작업", "back reads " + back2);
      return "LINA → 진행 중인 작업 → card";
    });
    await step("the browser back button restores the screen and its scroll", async () => {
      await page.goBack();
      await page.waitForFunction(() => location.hash === "#/running");
      check((await title(page)) === "진행 중인 작업", "back did not restore the list");
      await openApp(page, "#/");
      await page.evaluate(() => document.querySelector(".stack").scrollTo(0, 120));
      const before = await page.evaluate(() => document.querySelector(".stack").scrollTop);
      await page.getByRole("link", { name: /^목표/ }).click();
      await page.waitForFunction(() => location.hash === "#/goals");
      await page.goBack();
      await page.waitForFunction(() => location.hash === "#/");
      const after = await page.evaluate(() => document.querySelector(".stack").scrollTop);
      check(after === before, "scroll " + after + " after back, " + before + " before");
      return "scroll kept at " + after;
    });
    await step("the bars keep clear of the status bar and the home indicator", async () => {
      // Headless Chromium has no notch, so the driver sets the safe-area tokens the page reads from env().
      await openApp(page, "#/running");
      await page.evaluate(() => {
        document.documentElement.style.setProperty("--safe-top", "47px");
        document.documentElement.style.setProperty("--safe-bottom", "34px");
      });
      const back = await page.getByTestId("back").evaluate((element) => element.getBoundingClientRect().top);
      const bar = await page.locator(".bottombar").evaluate((element) => {
        const box = element.getBoundingClientRect();
        const line = element.querySelector("[data-testid=freshness]").getBoundingClientRect();
        return { bottom: box.bottom, viewport: innerHeight, lineBottom: line.bottom };
      });
      check(back >= 47, "the back control starts at " + back + " px, under a 47 px status bar");
      check(bar.lineBottom <= bar.viewport - 34, "the freshness line ends at " + bar.lineBottom + " px, under the home indicator");
      return "back at " + back + " px, bar text ends " + (bar.viewport - bar.lineBottom) + " px above the bottom";
    });
  },

  async install(page, step) {
    await step("open the app", async () => {
      await openApp(page, "#/");
      return "opened";
    });
    await step("read the web app manifest", async () => {
      const href = await page.locator('link[rel="manifest"]').getAttribute("href");
      check(href === "/app/manifest.webmanifest", "the page links the manifest at " + href);
      const manifest = await (await page.request.get(href)).json();
      check(manifest.display === "standalone", "manifest display is " + manifest.display);
      for (const icon of manifest.icons) {
        const status = (await page.request.get(new URL(icon.src, "http://x" + href).pathname)).status();
        check(status === 200, "icon " + icon.src + " returned " + status);
      }
      return manifest.name + ", display " + manifest.display + ", " + manifest.icons.length + " icons";
    });
    await step("read the Home Screen icon", async () => {
      const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
      const status = (await page.request.get(href)).status();
      check(status === 200, "apple-touch-icon returned " + status);
      return href + " 200";
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
