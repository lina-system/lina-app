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
const FIXTURE = { inbox: "8", running: "2", stopped: "1", due: "5", done: "3", goals: "5", bell: "알림 5", devices: "기기 3 · 정상 1 · 경고 1 · 꺼짐 1" };
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
// Ready means the data is drawn and the change stream is open (실시간); a page whose stream cannot open
// (&live=down) is ready at 갱신 지연.
async function openApp(page, hash, query = "", line = "실시간") {
  if (page.url() !== "about:blank") await page.goto("about:blank");
  await page.goto(APP_PATH + query + hash);
  await page.getByTestId("freshness-line").filter({ hasText: new RegExp("^" + line + "$") }).waitFor({ timeout: 10_000 });
}

async function freshnessLine(page) {
  return (await page.getByTestId("freshness-line").innerText()).trim();
}

// The synthetic stream's connections and the page's snapshot reads (window.__linaStream).
async function stream(page) {
  return page.evaluate(() => window.__linaStream);
}

// A mark on the window that a page load would wipe: still there means nothing reloaded the page.
async function markPage(page) {
  await page.evaluate(() => (window.__notReloaded = true));
}

async function notReloaded(page) {
  return page.evaluate(() => window.__notReloaded === true);
}

// On a phone a tap pushes the next screen with a slide; it is in the document once the root drops data-nav.
async function settled(page) {
  await page.waitForFunction(() => !document.documentElement.dataset.nav);
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
      // A card without a checked title draws none (work-cards.md); it has no title colour to compare.
      // A card named by its kind (no checked title) is grey on purpose: only real titles carry the label colour.
      title: item.querySelector(".title:not(.is-kind)") ? getComputedStyle(item.querySelector(".title:not(.is-kind)")).color : null,
      state: getComputedStyle(item.querySelector("[data-testid=state]")).color,
      time: item.querySelector(".time") ? getComputedStyle(item.querySelector(".time")).color : null,
    })),
  );
  const stopped = rows.find((row) => row.stopped && row.title);
  const running = rows.find((row) => !row.stopped);
  check(stopped && running, "the list needs a stopped and a running card to compare");
  // With no titled running card in the list, the label colour is the page's own text colour.
  const label = rows.find((row) => !row.stopped && row.title)?.title ?? (await list.evaluate((element) => getComputedStyle(element.closest(".list") ?? document.body).color));
  check(stopped.title === label, "the stopped card's title is " + stopped.title + ", the label colour " + label);
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

// Phone rules (features/phone.md), measured on the page. Tappable: every a, button, input, textarea, summary and
// every element with a role of button, link, checkbox or textbox, drawn and not hidden. Text: every visible text node.
const HIT = 44;
const MIN_TEXT = 13;

async function phoneAudit(page) {
  return page.evaluate(({ hit, minText }) => {
    const drawn = (element) => {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return null;
      const style = getComputedStyle(element);
      return style.visibility === "hidden" || style.display === "none" ? null : box;
    };
    const roleOf = (element) => element.getAttribute("role") || { A: "link", BUTTON: "button", INPUT: "textbox", TEXTAREA: "textbox", SUMMARY: "disclosure" }[element.tagName] || element.tagName.toLowerCase();
    const nameOf = (element) => (element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const small = [];
    let tappable = 0;
    for (const element of document.querySelectorAll("a, button, input, textarea, summary, [role=button], [role=link], [role=checkbox], [role=textbox]")) {
      const box = drawn(element);
      if (!box) continue;
      tappable += 1;
      if (box.width < hit - 0.5 || box.height < hit - 0.5) small.push(roleOf(element) + ' "' + nameOf(element) + '" ' + Math.round(box.width) + "x" + Math.round(box.height));
    }
    const tiny = [];
    let texts = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const words = node.textContent.trim();
      if (!words || !node.parentElement || !drawn(node.parentElement)) continue;
      texts += 1;
      const size = parseFloat(getComputedStyle(node.parentElement).fontSize);
      if (size < minText) tiny.push('"' + words.slice(0, 30) + '" ' + size + "px");
    }
    return { tappable, small, texts, tiny };
  }, { hit: HIT, minText: MIN_TEXT });
}

async function phoneRules(page, where) {
  const audit = await phoneAudit(page);
  check(audit.small.length === 0, where + ": " + audit.small.length + " hit area(s) under " + HIT + "x" + HIT + ": " + audit.small.join("; "));
  check(audit.tiny.length === 0, where + ": " + audit.tiny.length + " text(s) under " + MIN_TEXT + "px: " + audit.tiny.join("; "));
  return where + ": " + audit.tappable + " tappable >= " + HIT + "x" + HIT + ", " + audit.texts + " texts >= " + MIN_TEXT + "px";
}

// Rows show at most two lines: the title and one status line.
async function rowLines(page) {
  return page.locator("[data-testid=row]:not(.is-open) .lines").evaluateAll((all) =>
    all.flatMap((lines) => {
      const children = [...lines.children].filter((child) => child.getBoundingClientRect().height > 0);
      const lineHeight = (child) => parseFloat(getComputedStyle(child).lineHeight) || parseFloat(getComputedStyle(child).fontSize) * 1.35;
      const tall = children.filter((child) => child.getBoundingClientRect().height > lineHeight(child) * 1.5 + 1);
      return children.length > 2 || tall.length ? [lines.textContent.trim().slice(0, 40) + " (" + children.length + " lines)"] : [];
    }),
  );
}

// A context like the drive's, with touch, to send the touches a finger would.
async function touchContext(page, options = {}) {
  const { width, height } = page.viewportSize();
  const context = await page.context().browser().newContext({ baseURL: new URL(page.url()).origin, viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, ...options });
  return context;
}

async function swipe(page, from, to) {
  await page.evaluate(
    ({ from, to }) => {
      const touch = (point) => new Touch({ identifier: 1, target: document.elementFromPoint(point.x, point.y) || document.body, clientX: point.x, clientY: point.y });
      const send = (type, point, active) => document.elementFromPoint(from.x, from.y).dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: active ? [touch(point)] : [], changedTouches: [touch(point)] }));
      send("touchstart", from, true);
      for (let step = 1; step <= 6; step += 1) send("touchmove", { x: from.x + ((to.x - from.x) * step) / 6, y: from.y + ((to.y - from.y) * step) / 6 }, true);
      send("touchend", to, false);
    },
    { from, to },
  );
}

// Every horizontal line drawn on the page, whatever draws it: an element's top or bottom border, a line-like
// box-shadow, or a ::before/::after with a border. getBoundingClientRect cannot see a pseudo-element, so an absolutely
// placed one is located from its computed top and left against its containing block; a pseudo line that cannot be
// placed is reported, never skipped. A line inside a list (between its first row's top and its last row's bottom) is a
// divider: it must lie on a row's top edge and start at that row's text (the first text not hidden from assistive
// technology, so after its icon, mark or check box).
async function dividerOffsets(page) {
  return page.evaluate(() => {
    const px = (value) => parseFloat(value) || 0;
    const drawn = (element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" ? box : null;
    };
    const lines = [];
    const unplaced = [];
    const shadowLines = (shadow, box) => {
      if (!shadow || shadow === "none") return [];
      return shadow.split(/,(?![^(]*\))/).flatMap((one) => {
        const inset = /\binset\b/.test(one);
        const lengths = (one.replace(/rgba?\([^)]*\)|#[0-9a-f]+|\binset\b/gi, "").match(/-?[\d.]+px/g) || []).map(px);
        const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
        if (blur !== 0 || y === 0) return [];
        const top = inset ? (y > 0 ? box.top : box.bottom) : y > 0 ? box.bottom : box.top;
        const left = box.left + (inset ? Math.max(0, x) - Math.min(0, spread) : x - spread);
        return [{ y: top, x: left, by: "box-shadow" }];
      });
    };
    const bordersOf = (style, box, by) => {
      const found = [];
      const side = (name) => px(style["border" + name + "Width"]) > 0 && style["border" + name + "Style"] !== "none";
      if (side("Left") || side("Right")) return found;
      if (side("Top")) found.push({ y: box.top, x: box.left, by: by + " border-top" });
      if (side("Bottom")) found.push({ y: box.bottom - px(style.borderBottomWidth), x: box.left, by: by + " border-bottom" });
      return found;
    };
    for (const element of document.body.querySelectorAll("*")) {
      const box = drawn(element);
      if (!box) continue;
      const style = getComputedStyle(element);
      for (const line of [...bordersOf(style, box, "element"), ...shadowLines(style.boxShadow, box)]) lines.push({ ...line, owner: element });
      for (const pseudo of ["::before", "::after"]) {
        const look = getComputedStyle(element, pseudo);
        if (look.content === "none" || look.display === "none") continue;
        const hasBorder = ["Top", "Bottom"].some((side) => px(look["border" + side + "Width"]) > 0 && look["border" + side + "Style"] !== "none");
        const hasShadow = look.boxShadow && look.boxShadow !== "none";
        if (!hasBorder && !hasShadow) continue;
        if (look.position !== "absolute" && look.position !== "fixed") {
          unplaced.push(element.className + pseudo);
          continue;
        }
        let block = element;
        while (block && getComputedStyle(block).position === "static") block = block.parentElement;
        const frame = block ? block.getBoundingClientRect() : { top: 0, left: 0 };
        const top = frame.top + (block ? block.clientTop : 0) + px(look.top);
        const left = frame.left + (block ? block.clientLeft : 0) + px(look.left);
        const pseudoBox = { top, left, bottom: top + px(look.height) + px(look.borderTopWidth) + px(look.borderBottomWidth), right: left + px(look.width) };
        for (const line of [...bordersOf(look, pseudoBox, pseudo), ...shadowLines(look.boxShadow, pseudoBox)]) lines.push({ ...line, owner: element });
      }
    }
    const nameOf = (row) => {
      const control = [":scope > a", ":scope > button.row-button", ":scope > .row-body", ":scope > details > summary", "a", "button"].map((selector) => row.querySelector(selector)).find(Boolean) || row;
      const role = control.getAttribute("role") || { A: "link", BUTTON: "button", SUMMARY: "disclosure" }[control.tagName] || "row";
      return role + ' "' + (control.getAttribute("aria-label") || control.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40) + '"';
    };
    const textLeft = (row) => {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim() || node.parentElement.closest("[aria-hidden=true], svg")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = [...range.getClientRects()].find((one) => one.width > 0);
        if (rect) return rect.left;
      }
      return null;
    };
    const lists = [...document.querySelectorAll("ul, ol, [role=list]")].map((list) => ({ list, rows: [...list.children].filter((row) => row.tagName === "LI" && drawn(row)) })).filter(({ rows }) => rows.length > 1);
    let measured = 0;
    const off = [];
    for (const line of lines) {
      const home = lists.find(({ rows }) => line.y > rows[0].getBoundingClientRect().top + 1 && line.y < rows.at(-1).getBoundingClientRect().bottom - 1 && rows.some((row) => row.contains(line.owner) || line.owner.contains(row)));
      if (!home) continue;
      measured += 1;
      const row = home.rows.find((candidate) => Math.abs(candidate.getBoundingClientRect().top - line.y) <= 1);
      if (!row) {
        const inside = home.rows.find((candidate) => line.y > candidate.getBoundingClientRect().top && line.y < candidate.getBoundingClientRect().bottom);
        off.push((inside ? nameOf(inside) + ": divider (" + line.by + ") " + Math.round((line.y - inside.getBoundingClientRect().top) * 10) / 10 + " px below the row's top" : "a divider (" + line.by + ") at y " + Math.round(line.y) + " on no row's edge"));
        continue;
      }
      const text = textLeft(row);
      if (text !== null && Math.abs(line.x - text) > 1) off.push(nameOf(row) + ": divider (" + line.by + ") starts at x " + Math.round(line.x) + ", the row's text at x " + Math.round(text));
    }
    for (const name of unplaced) off.push("a line drawn by " + name + " that the driver cannot place");
    return { measured, off };
  });
}

// The page itself never scrolls on a phone: its height is the window's, and focusing a field (by tap, click or Tab)
// leaves window.scrollY at 0 and the nav bar where it was.
async function pageHeight(page, where) {
  const { height, window: tall } = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, window: innerHeight }));
  check(height === tall, where + ": the page is " + height + " px tall in a " + tall + " px window");
  return where + " " + height + "/" + tall;
}

async function focusStill(page, where) {
  const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const place = () => page.evaluate(() => ({ y: scrollY, bar: document.querySelector(".navbar").getBoundingClientRect().top }));
  const before = await place();
  const fields = page.locator("input:visible, textarea:visible, [role=textbox]:visible");
  const count = await fields.count();
  const seen = [];
  for (let index = 0; index < count; index += 1) {
    const field = fields.nth(index);
    const name = (await field.getAttribute("aria-label")) || (await field.getAttribute("placeholder")) || "field " + index;
    for (const how of ["focus", "click", "Tab"]) {
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      if (how === "focus") await field.focus();
      if (how === "click") await field.click();
      if (how === "Tab") {
        await field.evaluate((element) => {
          const all = [...document.querySelectorAll("a[href], button:not([disabled]), input, textarea, summary, [tabindex]")].filter((candidate) => candidate.getClientRects().length);
          const before = all[all.indexOf(element) - 1];
          if (before) before.focus({ preventScroll: true });
        });
        await page.keyboard.press("Tab");
        const reached = await field.evaluate((element) => document.activeElement === element);
        check(reached, where + ": Tab did not reach " + name);
      }
      await frames();
      const now = await place();
      check(now.y === 0 && now.bar === before.bar, where + ": " + how + " on " + name + " moved the page to scrollY " + now.y + ", nav bar " + before.bar + " -> " + now.bar);
      await pageHeight(page, where + " (" + name + " " + how + ")");
    }
    seen.push(name);
  }
  return where + ": " + (seen.length ? seen.join(", ") + " focused by focus, click and Tab; page still" : "no text field; page still");
}

const PHONE_SCREENS = ["#/", "#/inbox", "#/running", "#/due", "#/done", "#/agents/ag-2", "#/goals", "#/goals/G2", "#/goals/G3", "#/items/T2", "#/items/T4", "#/cards/k-101", "#/cards/k-102", "#/runs/r6", "#/status"];

async function focusSteps(page, step) {
  for (const height of [480, 844]) {
    await page.setViewportSize({ width: 390, height });
    await step("at 390x" + height + ", every phone screen is exactly as tall as the window", async () => {
      const read = [];
      for (const hash of PHONE_SCREENS) {
        await openApp(page, hash);
        await page.locator("[data-testid=screen-title], .detail-head").first().waitFor();
        read.push(await pageHeight(page, hash));
      }
      return read.join(", ");
    });
    for (const [where, hash] of [["to-do", "#/items/T4"], ["goal", "#/goals/G2"]]) {
      await step("at 390x" + height + ", " + where + ": focusing each text field leaves the page and the nav bar still", async () => {
        await openApp(page, hash);
        await page.getByTestId("talk").waitFor();
        return await focusStill(page, where + " @390x" + height);
      });
    }
    await step("at 390x" + height + ", the bell sheet: the page and the nav bar stay still", async () => {
      await openApp(page, "#/inbox");
      await page.getByRole("button", { name: "알림 5" }).click();
      const sheet = page.getByRole("dialog", { name: "알림" });
      await sheet.waitFor();
      await sheet.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
      return (await focusStill(page, "bell @390x" + height)) + "; " + (await pageHeight(page, "bell"));
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

async function dividers(page, where) {
  const { measured, off } = await dividerOffsets(page);
  check(measured > 0, where + ": no divider to measure");
  check(off.length === 0, where + ": " + off.length + " divider(s) off the row's top edge: " + off.join("; "));
  return where + ": " + measured + " dividers on their row's top edge";
}

const DIVIDER_SCREENS = [
  ["home", "#/"],
  ["수신함", "#/inbox"],
  ["마감일", "#/due"],
  ["진행 중인 작업", "#/running"],
  ["goal detail", "#/goals/G2"],
];

async function dividerSteps(page, step, width) {
  for (const [where, hash] of DIVIDER_SCREENS) {
    await step("at " + width + ", " + where + ": every divider lies on its row's top edge, from the row's text", async () => {
      await openApp(page, hash);
      await page.locator("[data-testid=screen-title], .detail-head").first().waitFor();
      await page.locator("[data-testid=row], .nav-row").first().waitFor();
      return await dividers(page, where + " @" + width);
    });
  }
  await step("at " + width + ", the bell's notices: every divider lies on its row's top edge", async () => {
    await openApp(page, "#/inbox");
    await page.getByRole("button", { name: "알림 5" }).click();
    const notices = page.getByRole("dialog", { name: "알림" });
    await notices.waitFor();
    await notices.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    return await dividers(page, "bell @" + width);
  });
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
      // 검토 필요: the run outside any card and the work card waiting for review.
      check(decide.length === 4 && review.length === 2 && mine.length === 2, "groups have " + decide.length + "/" + review.length + "/" + mine.length + " rows, expected 4/2/2");
      check(review.some((name) => name.includes("결제: 실패 화면 검토")), "the card waiting for review is not in 검토 필요: " + review.join(" | "));
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
        // A card without a checked title draws none; its question names only its goal (work-cards.md).
        const title = (await page.locator(".detail-title").count()) ? (await page.locator(".detail-title").first().innerText()).trim() : "";
        if (row.href.startsWith("#/cards/")) {
          seen.card += 1;
          const first = (await page.locator(".detail .box").first().locator(".box-head").innerText()).trim();
          check(first === "결정 필요", "the card's question box is not on top (first box " + first + ")");
          check(title ? row.context.endsWith(" › " + title) : !row.context.includes(" › "), "card question context " + row.context + " for the card titled " + JSON.stringify(title));
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
      await settled(page);
      return await title(page);
    });
    await step("stopped cards come first, then running cards", async () => {
      const names = await rowNames(page.getByRole("list", { name: "진행 중인 작업" }));
      check(names.length === 3, "expected 3 cards, got " + names.length);
      check(names[0].endsWith("중단됨 · 응답 없음"), "the first card is not stopped: " + names[0]);
      // A running card's name ends with its state, then on a wide window its to-do count (할 일 n/m).
      check(names.slice(1).every((name) => / · 진행 중( · 할 일 \d+\/\d+)?$/.test(name)), "the rest are not running: " + names.join(" | "));
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
      const shown = await page.getByText("변경마다 한 줄 요약을 붙이는 중").first().isVisible();
      check(shown === wide, "now line visible=" + shown + " at width " + page.viewportSize().width);
      return wide ? "now line shown" : "no now line on a phone";
    });
  },

  async due(page, step) {
    await step("open 마감일", async () => {
      await openApp(page, "#/");
      await page.getByRole("link", { name: /^마감일/ }).click();
      await settled(page);
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
      await settled(page);
      return await title(page);
    });
    await step("read the finished cards", async () => {
      const list = page.getByRole("list", { name: "완료" });
      const names = await rowNames(list);
      const lines = await list.locator(".sub").allInnerTexts();
      // Three finished cards: two jobs with one generated title stay two (work-cards.md).
      check(names.length === 3 && names.every((name) => name.endsWith("완료")), "done list " + names.join(" | "));
      check(names.filter((name) => name.includes("가이드 초안 다듬기")).length === 2, "the two jobs with one title read " + names.join(" | "));
      // A finished card says when it ended; how long it took is in its detail.
      check(lines.every((line) => /^완료 · \d+(분|시간|일) 전$/.test(line)), "done lines read " + lines.join(", "));
      return names.join(" | ") + " / " + lines.join(", ");
    });
    await step("how long a finished card took is in its detail", async () => {
      await page.getByRole("list", { name: "완료" }).getByRole("link").first().click();
      await settled(page);
      const head = (await page.locator(".detail-head .sub").first().innerText()).trim();
      check(/^완료 · \d+(분|시간|일) 전 · \d+(분|시간)( \d+분)? 걸림$/.test(head), "the detail reads " + head);
      return head;
    });
  },

  async "agent-screen"(page, step) {
    let agent = "";
    await step("open an agent from the sidebar", async () => {
      await openApp(page, "#/");
      const link = page.getByRole("list", { name: "에이전트" }).getByRole("link").nth(1);
      agent = (await link.locator(".nav-label").innerText()).trim();
      await link.click();
      await settled(page);
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
      for (const id of ["running", "review", "planned", "goals"]) {
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
    await step("its 완료 · 오늘 line opens 완료 filtered to this agent", async () => {
      const target = await page.getByTestId("done-today").getByRole("link").getAttribute("href");
      const id = new URL(page.url()).hash.split("/").pop();
      check(target === "#/done?agent=" + id, "the done line opens " + target);
      return target;
    });
    await step("a card just created (예정) shows on its agent's screen after 검토 필요, with no time, and not on the home", async () => {
      await openApp(page, "#/agents/ag-3");
      const heads = await page.locator(".list h2.section-head > span:first-child").allInnerTexts();
      check(heads.includes("예정") && heads.indexOf("예정") === heads.length - 2 && heads.at(-1) === "목표", "sections " + heads.join(", "));
      const row = page.getByTestId("section-planned").locator('li:has(> a[href="#/cards/k-106"])');
      const state = (await row.locator(".state").innerText()).trim();
      check(state === "예정" && (await row.locator(".time").count()) === 0, "the planned card reads " + state + " with " + (await row.locator(".time").count()) + " time");
      const header = (await page.getByTestId("agent-counts").innerText()).replace(/\s+/g, " ").trim();
      check(/예정 1( |$)/.test(header), "the header reads " + header);
      // The latest-activity line sits under the counts, inset like them, and clear of the first section's head.
      const lines = await page.getByTestId("screen-agent").evaluate((screen) => {
        const box = (selector) => screen.querySelector(selector).getBoundingClientRect();
        // The text starts: the counts line's first part and the latest line itself (both sit inside padded boxes).
        return { counts: box("[data-testid=agent-counts] > span").left, latest: box("[data-testid=agent-latest]").left, latestBottom: box("[data-testid=agent-latest]").bottom, head: box(".section-head").top };
      });
      check(Math.abs(lines.latest - lines.counts) <= 1 && lines.latestBottom <= lines.head, "the latest line starts at " + lines.latest + " (counts " + lines.counts + ") and ends at " + lines.latestBottom + " under a head at " + lines.head);
      await openApp(page, "#/running");
      check((await page.locator('a[href="#/cards/k-106"]').count()) === 0, "the planned card is on the home");
      return heads.join(" → ") + "; " + header;
    });
  },

  async goals(page, step) {
    await step("open 목표", async () => {
      await openApp(page, "#/");
      await page.getByRole("link", { name: /^목표/ }).click();
      await settled(page);
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
      check(JSON.stringify(heads) === JSON.stringify(["완료 조건", "실행", "댓글", "대화"]), "boxes " + heads.join(", "));
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
      check(/^.+ · 1시간 전$/.test(byline), "an 80-minute-old reply reads " + byline + ", expected <author> · 1시간 전");
      const resolvedReply = (await page.getByTestId("resolved").getByTestId("reply").locator(".sub").textContent()).trim();
      check(/^\S+ · 55분 전 · 반영함$/.test(resolvedReply), "a 55-minute-old reply reads " + resolvedReply + ", expected <author> · 55분 전 · 반영함");
      return heads.join(", ") + "; " + comments + " comments, " + replies + " replies";
    });
    await step("send a comment: it shows at once with its pending line and lands in the record", async () => {
      const field = page.getByRole("textbox", { name: "댓글 달기" });
      const send = page.getByTestId("comments").getByRole("button", { name: "보내기", exact: true });
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
      check(/^\S+ · 방금 · 반영함$/.test(reply), "a reply seconds old reads " + reply + ", expected <author> · 방금 · 반영함");
      return reply;
    });
    await step("from 수신함, a decision's line opens 배포 순서 정하기 with its decision box", async () => {
      await openApp(page, "#/inbox");
      const row = page.getByRole("list", { name: "결정 필요" }).locator(":scope > li").filter({ has: page.getByRole("button", { name: /배포를 금요일 오후에 해도 될까요/ }) });
      await row.locator(".row-button").click();
      await row.locator(".decision-panel a").click();
      await page.waitForFunction(() => location.hash === "#/items/T2", null, { timeout: 3_000 }).catch(() => check(false, "the decision opened " + page.url()));
      const title = (await page.locator(".detail-title").first().innerText()).trim();
      check(title === "배포 순서 정하기", "the to-do opened is " + title);
      const box = (await page.getByTestId("decision").innerText()).replace(/\s+/g, " ");
      check(box.includes("배포를 금요일 오후에 해도 될까요?") && box.includes("질문") && /\d+일 전/.test(box), "the decision box reads " + box);
      return "#/items/T2 " + title + ": " + box;
    });
  },

  async talk(page, step) {
    const box = page.getByTestId("talk");
    const field = box.getByRole("textbox", { name: "메시지" });
    const send = box.getByRole("button", { name: "보내기", exact: true });
    let comments = 0;
    await step("open a to-do from its goal: 대화 sits under 댓글", async () => {
      await openApp(page, "#/goals/G2");
      await page.getByRole("list", { name: "할 일" }).getByRole("link", { name: /^카드 입력 폼 다듬기/ }).click();
      await page.getByTestId("screen-item").waitFor();
      const heads = await page.locator(".detail .box-head").allInnerTexts();
      check(JSON.stringify(heads.slice(-2)) === JSON.stringify(["댓글", "대화"]), "boxes " + heads.join(", "));
      check((await box.getByTestId("talk-mine").count()) === 0, "the conversation shows turns before any was sent on this page");
      comments = await page.evaluate(() => window.__linaScene.itemDetails.T4.comments.length);
      check(await send.isDisabled(), "보내기 is enabled on an empty field");
      return heads.join(", ") + "; " + (await buttonLook(page, send));
    });
    await step("type and press Enter: the message sits on the right and the reply streams on the left with a live mark", async () => {
      await field.fill("입력 폼 간격 봐 주세요");
      const ready = await buttonLook(page, send);
      if (page.viewportSize().width < 900) {
        const height = (await field.boundingBox()).height;
        check(height >= 44, "the field is " + height + " px tall on a phone");
      }
      await field.press("Enter");
      await box.getByTestId("talk-live").waitFor({ state: "attached", timeout: 3_000 }).catch(() => check(false, "no live mark while the reply streams"));
      const mine = await box.getByTestId("talk-mine").locator(".talk-bubble").boundingBox();
      const reply = box.getByTestId("talk-reply");
      await reply.filter({ hasText: /확인했어요/ }).waitFor({ timeout: 3_000 }).catch(() => check(false, "no words of the reply while it streams"));
      const partial = (await reply.locator(".talk-bubble").innerText()).trim();
      const theirs = await reply.locator(".talk-bubble").boundingBox();
      const area = await box.boundingBox();
      check(mine.x + mine.width > area.x + area.width - 24 && mine.x > theirs.x, "the owner's message is not on the right");
      check((await reply.locator(".mark").count()) === 1, "the reply has no agent mark");
      check((await field.inputValue()) === "", "the field still holds the sent text");
      check(await send.isDisabled(), "보내기 is enabled while the reply streams");
      return "mid-stream: " + partial + " (" + ready + ")";
    });
    await step("the reply ends: the live mark goes and one line says the agent keeps the exchange", async () => {
      const carried = box.getByTestId("talk-carried");
      await carried.waitFor({ timeout: 10_000 }).catch(() => check(false, "no carried line after the reply"));
      const line = (await carried.innerText()).trim();
      check(/^\S+ 대화에 남음$/.test(line), "the carried line reads " + line);
      check((await box.getByTestId("talk-live").count()) === 0, "the live mark stayed after the reply");
      const reply = (await box.getByTestId("talk-reply").locator(".talk-bubble").innerText()).trim();
      check(reply === "네, 확인했어요. 입력 폼 간격부터 맞추고 오늘 안에 다시 알려 드릴게요.", "the reply reads " + reply);
      check((await box.getByTestId("write-error").count()) === 0, "an error line shows after a full reply");
      const after = await page.evaluate(() => window.__linaScene.itemDetails.T4.comments.length);
      check(after === comments, "the talk wrote " + (after - comments) + " comment(s) into the work record");
      return reply + " / " + line;
    });
    await step("the next message takes the carried line away", async () => {
      await field.fill("고마워요");
      await send.click();
      await box.getByTestId("talk-mine").nth(1).waitFor({ timeout: 3_000 });
      check((await box.getByTestId("talk-carried").count()) === 0, "the carried line stays while the next reply streams");
      await box.getByTestId("talk-carried").waitFor({ timeout: 10_000 });
      return (await box.getByTestId("talk-mine").count()) + " messages, carried line on the last reply only: " + (await box.getByTestId("talk-carried").count());
    });
    await step("with reduced motion the live mark holds still", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openApp(page, "#/items/T4");
      await field.fill("입력 폼 간격 봐 주세요");
      await field.press("Enter");
      const live = box.getByTestId("talk-live");
      await live.waitFor({ state: "attached", timeout: 3_000 });
      const animation = await live.evaluate((node) => getComputedStyle(node).animationName);
      check(animation === "none", "the live mark animates (" + animation + ") under prefers-reduced-motion");
      await page.emulateMedia({ reducedMotion: null });
      return "animation " + animation;
    });
    for (const [talk, status, line] of [["busy", 429, "에이전트가 바쁨"], ["down", 503, "에이전트 연결 안 됨"], ["none", 409, "맡은 에이전트 없음"]]) {
      await step("refused " + status + ": one line, the message stays in the field", async () => {
        await openApp(page, "#/items/T4", "&talk=" + talk);
        await field.fill("오늘 어디까지 했어요?");
        await field.press("Enter");
        const error = box.getByTestId("write-error");
        await error.waitFor({ timeout: 3_000 }).catch(() => check(false, "no refusal line"));
        const shown = (await error.innerText()).trim();
        check(shown === line, "the refusal reads " + shown + ", expected " + line);
        check((await field.inputValue()) === "오늘 어디까지 했어요?", "the message left the field");
        check((await box.getByTestId("talk-mine").count()) === 0, "a refused message shows as sent");
        check(!(await send.isDisabled()), "보내기 stays disabled after a refusal");
        return status + " " + shown;
      });
    }
  },

  async "card-detail"(page, step) {
    await step("open a running card", async () => {
      await openApp(page, "#/running");
      await page.getByRole("list", { name: "진행 중인 작업" }).getByRole("link", { name: /릴리스 노트: 변경 목록 정리/ }).click();
      await page.getByTestId("screen-card").waitFor();
      return new URL(page.url()).hash;
    });
    await step("read its state, now line, to-dos, dimmed runs and comments", async () => {
      const state = await page.locator(".detail-head .sub").first().innerText();
      check(/^진행 중 · \d+분째$/.test(state), "state reads " + state);
      await page.getByTestId("timeline").waitFor();
      const heads = await page.locator(".detail .box-head").allInnerTexts();
      // One round list: the record's blocks; 실행 does not stand beside them.
      check(JSON.stringify(heads) === JSON.stringify(["지금", "할 일", "기록", "댓글"]), "boxes " + heads.join(", "));
      check((await page.getByTestId("worker-runs").count()) === 0, "the 실행 box stands beside the record");
      check((await page.getByTestId("card-now").innerText()).includes("변경마다 한 줄 요약을 붙이는 중"), "the now box does not read the checked now line");
      const todos = page.locator(".detail .box").filter({ has: page.locator(".box-head", { hasText: /^할 일$/ }) });
      check((await todos.getByRole("checkbox").count()) === 3, "expected 3 to-dos");
      const order = await todos.locator(".title").allInnerTexts();
      check(JSON.stringify(order) === JSON.stringify(["변경 목록 모으기", "모은 변경 확인", "공지 문구 확인"]), "the to-dos read " + order.join(", "));
      const links = page.getByTestId("timeline-link");
      const hrefs = await links.evaluateAll((items) => items.map((item) => item.getAttribute("href")));
      check(JSON.stringify(hrefs) === JSON.stringify(["#/runs/r1", "#/runs/r10", "#/runs/r9"]), "the round heads link to " + JSON.stringify(hrefs));
      check((await page.getByTestId("comment").count()) === 4, "expected 4 comments");
      return state + "; " + heads.join(", ") + "; " + order.join(", ");
    });
    await step("a run outside any card opens on its own, with its timeline", async () => {
      await openApp(page, "#/inbox");
      await page.getByRole("list", { name: "검토 필요" }).getByRole("link").first().click();
      await page.getByTestId("screen-run").waitFor();
      const state = await page.locator(".detail-head .sub").first().innerText();
      check(/^대기 · 검토 필요 · \d+시간 전$/.test(state), "run state reads " + state);
      const block = page.getByTestId("screen-run").getByTestId("timeline-block");
      await block.waitFor();
      const head = (await block.locator(".timeline-head").innerText()).trim();
      // Its raw result line is left out, with no placeholder; the round keeps its head.
      const results = await block.getByTestId("timeline-result").count();
      const text = await page.getByTestId("timeline").innerText();
      check(/^라운드 1 · (어제 )?\d\d:\d\d–(어제 )?\d\d:\d\d · 작업 마침$/.test(head) && results === 0 && !text.includes("가린 문장") && !/benchmark|3f2a1c9/.test(text), "the run's timeline reads " + head + " / results " + results + " / " + text.replace(/\s+/g, " "));
      return new URL(page.url()).hash + " " + state + "; " + head + "; no result line";
    });
    await step("a run names the model it used", async () => {
      const noRevision = async () => check(!/\br\d+\b/.test(await page.locator("article.detail").innerText()), "the page shows a settings revision");
      await openApp(page, "#/runs/r1");
      await page.getByTestId("screen-run").waitFor();
      await page.getByTestId("timeline").waitFor();
      const used = await text(page.locator(".detail-head").getByTestId("run-model"));
      check(used === "model-a · 보통", "r1 reads " + used);
      check((await page.getByTestId("run-model").count()) === 1, "r1 names the model " + (await page.getByTestId("run-model").count()) + " times");
      check((await page.getByTestId("timeline-block").getByTestId("run-model").count()) === 0, "a round of r1's 기록 names a model");
      await noRevision();
      await openApp(page, "#/cards/k-101");
      await page.getByTestId("timeline").waitFor();
      const rounds = await page.getByTestId("timeline").evaluate((root) =>
        [...root.querySelectorAll("[data-testid=timeline-block]")].map((block) => ({
          outcome: block.getAttribute("data-outcome"),
          head: block.querySelector(".timeline-head")?.textContent ?? "",
          line: block.querySelector("[data-testid=run-model]")?.textContent ?? null,
          inHead: Boolean(block.querySelector(".timeline-head")?.contains(block.querySelector("[data-testid=run-model]"))),
        })),
      );
      const roundOf = (n) => rounds.find((block) => block.outcome !== "comment" && block.head.startsWith("라운드 " + n));
      const third = roundOf(3);
      check(Boolean(third) && third.line === "model-a · 보통" && !third.inHead, "round 3 reads " + JSON.stringify(third));
      check(roundOf(2)?.line === null, "round 2 reads " + JSON.stringify(roundOf(2)));
      check(roundOf(1)?.line === null, "round 1 reads " + JSON.stringify(roundOf(1)));
      check(rounds.filter((block) => block.outcome === "comment").every((block) => block.line === null), "a comment block names a model");
      await noRevision();
      await openApp(page, "#/runs/r8");
      await page.getByTestId("screen-run").waitFor();
      const fallback = await text(page.locator(".detail-head").getByTestId("run-model"));
      check(fallback === "model-b · 높음 · 대체 모델", "r8 reads " + fallback);
      check((await page.getByTestId("run-model").count()) === 1, "r8 names the model " + (await page.getByTestId("run-model").count()) + " times");
      check((await page.getByTestId("timeline-block").getByTestId("run-model").count()) === 0, "a round of r8's 기록 names a model");
      await noRevision();
      await openApp(page, "#/runs/r6");
      await page.getByTestId("timeline").waitFor();
      check((await page.getByTestId("run-model").count()) === 0, "a run with no model drew a line");
      await noRevision();
      return "r1 model-a · 보통 once; k-101 round 3 model-a · 보통, rounds 2 and 1 none; r8 model-b · 높음 · 대체 모델 once; r6 none";
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
      const names = await page.getByRole("list", { name: "기기", exact: true }).locator(".row-body").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));
      check(names.length === 3, "expected 3 machines");
      const meters = "CPU (\\d+%|—) · 메모리 (\\d+%|—) · 디스크 (\\d+%|—) · 작업 (\\d+|—)/\\d+$";
      check(names.some((name) => new RegExp(" · 정상 · " + meters).test(name)), "no 정상 machine with its meters: " + names.join(" | "));
      check(names.some((name) => new RegExp(" · 경고 · 디스크 · " + meters).test(name)), "no 경고 machine with its reason word: " + names.join(" | "));
      check(names.some((name) => / · 꺼짐 · 연결 끊김 · CPU — · 메모리 — · 디스크 — · 작업 —\/\d+$/.test(name)), "no 꺼짐 machine reading 연결 끊김 and — meters: " + names.join(" | "));
      const colours = await page.getByRole("list", { name: "기기", exact: true }).locator(".machine-state").evaluateAll((words) => words.map((word) => word.textContent + "=" + getComputedStyle(word).color));
      check(colours.includes("경고=rgb(255, 149, 0)") && colours.includes("꺼짐=rgb(255, 59, 48)"), "state colours " + colours.join(", "));
      const bars = await page.getByRole("list", { name: "기기", exact: true }).locator(".mini-meter .meter").count();
      check(bars === 6, "expected 6 thin bars on the two machines that report, got " + bars);
      const loads = await page.getByRole("list", { name: "기기", exact: true }).locator(".trail").allInnerTexts();
      check(loads.every((text) => /^작업 (\d+|—)\/\d+$/.test(text)), "loads read " + loads.join(", "));
      return names.join(" | ");
    });
    await step("read the quota: service rows, then the service OCX has no account for and OCX itself as rows", async () => {
      const list = page.getByRole("list", { name: "쿼터", exact: true });
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
      // The last two rows of the same list, with the service rows' look: the service with no account, then OCX itself.
      const plain = await list.locator(":scope > li:not(.quota-row) .row-body").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));
      check(JSON.stringify(plain) === JSON.stringify(["Cursor · 계정 없음", "OCX · 모델 3개 켜짐 · 연결 끊김: 물레방아"]), "the quota list's last rows read " + JSON.stringify(plain));
      const insets = await list.evaluate((element) => {
        const box = (body) => {
          const rect = body.getBoundingClientRect();
          return [Math.round(rect.left), Math.round(rect.right), Math.round(rect.height)];
        };
        const service = box(element.querySelector(":scope > .quota-row .row-body"));
        return [...element.querySelectorAll(":scope > li:not(.quota-row) .row-body")].map((body) => {
          const [left, right, height] = box(body);
          return { left, right, height, service };
        });
      });
      for (const row of insets) check(row.left === row.service[0] && row.right === row.service[1], "a last row is inset " + row.left + "-" + row.right + " px, the service rows " + row.service[0] + "-" + row.service[1]);
      if (page.viewportSize().width < 900) for (const row of insets) check(row.height >= HIT, "a last row is " + row.height + " px tall on a phone");
      await list.locator("summary").first().click();
      const accounts = await list.getByTestId("account").evaluateAll((rows) => rows.filter((row) => row.checkVisibility()).map((row) => ({ name: row.getAttribute("aria-label"), bar: Boolean(row.querySelector(".meter")), word: row.querySelector(".sub .warn-mark")?.textContent ?? null, colour: row.querySelector(".sub .warn-mark") ? getComputedStyle(row.querySelector(".sub .warn-mark")).color : null })));
      // The service row's percent, never "left": one convention in the panel.
      check(accounts.length === 2 && /^계정 1 · \d+% · 시간당 \+\d+% · \d+(분|시간|일) 후(?: · 주의)?$/.test(accounts[0].name), "Claude's live account reads " + accounts[0].name);
      check(!accounts[0].name.includes("남음"), "the account still reads what is left: " + accounts[0].name);
      // OCX cannot read this one, so it says only that: no rate, no reset and no bar, in the warning colour.
      check(accounts[1].name === "계정 2 · 다시 로그인 필요" && accounts[1].word === "다시 로그인 필요" && accounts[1].colour === "rgb(255, 59, 48)" && !accounts[1].bar, "the account to sign in again reads " + JSON.stringify(accounts[1]));
      // A paused account keeps its reset, drops its rate and its bar stays only about the window.
      await list.locator("summary").nth(2).click();
      const paused = await list.getByTestId("account").evaluateAll((rows) => rows.filter((row) => row.checkVisibility()).map((row) => ({ name: row.getAttribute("aria-label"), rate: row.textContent.includes("시간당") })));
      const pausedRow = paused.find((row) => row.name.includes("일시 중지"));
      check(pausedRow && /^계정 \d · 일시 중지 · \d+(분|시간|일) 후$/.test(pausedRow.name) && !pausedRow.rate, "the paused account reads " + JSON.stringify(pausedRow));
      return names.join(" | ") + "; " + plain.join(" | ") + "; Claude: " + accounts.map((row) => row.name).join(" | ") + "; " + pausedRow.name;
    });
    await step("주의 follows the rule over the accounts that are not paused, resets read hours under a day and days over, no rate means no rate part", async () => {
      const rows = await page.getByRole("list", { name: "쿼터", exact: true }).locator(":scope > .quota-row").evaluateAll((items) => items.map((item) => ({ name: item.querySelector("summary .title").textContent, sub: item.querySelector("summary .sub").textContent, warn: Boolean(item.querySelector("summary .warn-mark")) })));
      const scene = await page.evaluate(() => ({ at: Date.now() / 1000, quota: window.__linaScene.quota.quota }));
      const main = (account) => account.windows.find((w) => w.key === account.mainWindow);
      for (const [index, service] of scene.quota.entries()) {
        const live = service.accounts.filter((account) => !account.paused && main(account));
        const reaches = live.some((account) => main(account).ratePerHour !== null && main(account).percent + (main(account).ratePerHour * (main(account).resetAt - scene.at)) / 3600 >= 100);
        check(reaches === rows[index].warn, rows[index].name + " shows 주의=" + rows[index].warn + " but its rate reaches 100% before reset=" + reaches);
        const reset = Math.min(...live.map((account) => main(account).resetAt)) - scene.at;
        const word = rows[index].sub.split(" · ").at(-1);
        check(reset < 86400 ? /^\d+시간 후$/.test(word) : /^\d+일 후$/.test(word), rows[index].name + " resets in " + Math.round(reset) + " s but reads " + word);
        check(!/ · {2}| · $|^ · | ·  · /.test(rows[index].sub) && rows[index].sub.split(" · ").every(Boolean), rows[index].name + " has a gap: " + rows[index].sub);
        if (service.ratePerHour === null) check(!rows[index].sub.includes("시간당"), rows[index].name + " has no rate but reads " + rows[index].sub);
      }
      return rows.map((row) => row.name + ": " + row.sub + (row.warn ? " · 주의" : "")).join(" | ");
    });
    await step("read usage for today, then switch to 7 days and 30 days", async () => {
      const panel = page.getByTestId("section-usage");
      const total = async () => (await panel.getByTestId("usage-total").innerText()).trim();
      const rows = async (name) => (await panel.getByRole("list", { name }).locator(".usage-row").allInnerTexts()).map((text) => text.trim());
      // 기기별 names the machines exactly as the 기기 panel above it does: one machine, one name on the screen.
      const machinesAbove = (await page.getByRole("list", { name: "기기", exact: true }).locator(".row-body .title").allInnerTexts()).map((text) => text.trim());
      check(JSON.stringify(await rows("기기별")) === JSON.stringify(["모래톱 · $2.05 · 토큰 7,000", "솔방울 · $1.01 · 토큰 3,800", "물레방아 · $0.36 · 토큰 1,680"]), "today's machines read " + JSON.stringify(await rows("기기별")));
      check((await rows("기기별")).every((row) => machinesAbove.includes(row.split(" · ")[0])), "기기별 names a machine the 기기 panel does not: " + machinesAbove.join(", "));
      check((await total()) === "$3.42 · 토큰 1.2만", "today's total reads " + (await total()));
      check(JSON.stringify(await rows("모델별")) === JSON.stringify(["haru · $1.85 · 토큰 6,200", "saeol · $1.12 · 토큰 4,200", "moru · $0.45 · 토큰 2,080"]), "today's models read " + JSON.stringify(await rows("모델별")));
      await panel.getByRole("button", { name: "7일" }).click();
      check((await panel.getByRole("button", { name: "7일" }).getAttribute("aria-pressed")) === "true", "7일 is not pressed");
      check((await total()) === "$18.40 · 토큰 8.6만", "7 days' total reads " + (await total()));
      check(JSON.stringify(await rows("기기별")) === JSON.stringify(["모래톱 · $11.20 · 토큰 4.9만", "솔방울 · $5.40 · 토큰 2.6만", "물레방아 · $1.80 · 토큰 1.1만"]), "7 days' machines read " + JSON.stringify(await rows("기기별")));
      await panel.getByRole("button", { name: "30일" }).click();
      check((await total()) === "$63.10 · 토큰 42만", "30 days' total reads " + (await total()));
      check(JSON.stringify(await rows("모델별")) === JSON.stringify(["haru · $34.20 · 토큰 19만", "saeol · $19.90 · 토큰 14.8만", "moru · $9.00 · 토큰 8.2만"]), "30 days' models read " + JSON.stringify(await rows("모델별")));
      await panel.getByRole("button", { name: "오늘" }).click();
      check((await total()) === "$3.42 · 토큰 1.2만", "today's total after switching back reads " + (await total()));
      // Phone rules (features/phone.md): each range control is a 44 pt tap target and no line is under 13 px.
      let phone = "";
      if (page.viewportSize().width < 900) {
        const heights = await panel.locator(".usage-range .choice").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
        check(heights.every((height) => height >= HIT), "range controls are " + heights.map(Math.round).join(", ") + " px tall on a phone");
        const sizes = await panel.locator(".usage-head, .usage-total, .usage-row .title").evaluateAll((items) => items.map((item) => parseFloat(getComputedStyle(item).fontSize)));
        check(sizes.every((size) => size >= MIN_TEXT), "usage text draws at " + sizes.join(", ") + " px on a phone");
        phone = "; controls " + Math.round(Math.min(...heights)) + " px, text " + Math.min(...sizes) + " px";
      }
      return "오늘 $3.42 · 토큰 1.2만; 7일 $18.40 · 토큰 8.6만; 30일 $63.10 · 토큰 42만" + phone;
    });
    await step("read the checks", async () => {
      const list = page.getByRole("list", { name: "점검" });
      const rows = await list.locator(".status-check-row").evaluateAll((items) =>
        items.map((item) => ({
          text: item.querySelector(".title").textContent,
          state: item.querySelector(".check-state").textContent,
          time: item.querySelector(".time").textContent,
          colour: getComputedStyle(item.querySelector(".check-state")).color,
          checkRow: item.classList.contains("check-row"),
          trail: item.querySelector(".trail").getBoundingClientRect().right,
        })),
      );
      check(rows.length === 2, "expected 2 open checks, got " + rows.length);
      check(rows[0]?.text === "백업 회선 · 응답 없음" && rows[0].state === "실패" && rows[0].time === "12분 전" && rows[0].colour === "rgb(255, 59, 48)", "first open check " + JSON.stringify(rows[0]));
      check(rows[1]?.text === "대기 봇 · 소식이 끊김" && rows[1].state === "오래됨" && rows[1].time === "3시간 전" && rows[1].colour === "rgb(255, 149, 0)", "second open check " + JSON.stringify(rows[1]));
      for (const row of rows) check(!row.checkRow, row.text + " carries the to-do row's check-row class");
      // The same row layout as 기기: the trail (state word over time) ends at the row's right edge, not after the title.
      const machineEdge = await page.getByRole("list", { name: "기기", exact: true }).locator(".machine-row .trail").first().evaluate((item) => item.getBoundingClientRect().right);
      for (const row of rows) check(Math.abs(row.trail - machineEdge) <= 2, row.text + " has its trail at " + Math.round(row.trail) + " px, the 기기 rows' at " + Math.round(machineEdge) + " px");
      const folded = (await list.locator(".status-check-fold").innerText()).trim();
      check(folded === "정상 3", "the passing checks read " + folded);
      return rows.map((row) => row.text + " / " + row.state + " / " + row.time).join(" | ") + "; " + folded + "; trail " + Math.round(rows[0].trail) + " px, 기기 " + Math.round(machineEdge) + " px";
    });
  },

  // The work settings: every write control (switch, picker, stepper, rule edit, rollback), a stale write (412), a
  // refused one (422) and a device that may only read. Writes land in the page's copy of the scene.
  async settings(page, step) {
    const wide = page.viewportSize().width >= 900;
    const ORANGE = "rgb(255, 149, 0)";
    const RED = "rgb(255, 59, 48)";
    const rev = async () => (await page.getByTestId("settings-rev").innerText()).trim();
    const latest = () => page.evaluate(() => window.__linaScene.settings.revisions.at(-1));
    const writes = () => page.evaluate(() => window.__linaSettingsWrites);
    const toggle = (name) => page.getByTestId("screen-settings").getByRole("switch", { name, exact: true });
    const rows = (testid) => page.getByTestId(testid).locator("[data-testid=row]").evaluateAll((items) => items.map((item) => [item.querySelector(".title")?.textContent, item.querySelector(".sub")?.textContent].filter(Boolean).join(" / ")));
    const rules = () => page.getByTestId("settings-rules").locator("[data-testid=rule] .title, [data-testid=rule-other] .title").allInnerTexts();
    const firstHistory = async () => (await page.getByTestId("history-row").first().locator(".title").innerText()).trim();
    // Who drew each revision over which: the proof that a write went against the revision it was drawn over.
    const lineage = () => page.evaluate(() => window.__linaScene.settings.history.map((line) => line.rev + "<" + line.base + " " + line.by.device));
    const elsewhere = (patch) => page.evaluate((body) => window.__linaSettingsElsewhere.write(body), patch);
    const warningLines = async () => ((await page.getByTestId("settings-warnings").count()) ? await page.getByTestId("settings-warning").allInnerTexts() : []).map((line) => line.trim());
    const until = async (read, wanted, what) => {
      const end = Date.now() + 10_000;
      let seen = await read();
      while (!wanted(seen) && Date.now() < end) {
        await page.waitForTimeout(100);
        seen = await read();
      }
      check(wanted(seen), what + ": " + JSON.stringify(seen));
      return seen;
    };
    // Back to the settings the way a person goes: the sidebar line on a wide window, the back control on a phone.
    const toSettings = async () => {
      if (wide) await page.getByTestId("nav-settings").getByRole("link").click();
      else
        while (!(await page.getByTestId("screen-settings").isVisible())) {
          await page.getByTestId("back").click();
          await settled(page);
        }
      await page.getByTestId("screen-settings").waitFor();
    };

    await step("open 설정 from its line right under 기기·쿼터", async () => {
      await openApp(page, wide ? "#/running" : "#/");
      const order = await page.getByTestId("sidebar").locator("li[data-testid^=nav-]").evaluateAll((items) => items.map((item) => item.dataset.testid));
      check(order.at(-2) === "nav-status" && order.at(-1) === "nav-settings", "the sidebar ends " + order.slice(-3).join(", "));
      await page.getByTestId("nav-settings").getByRole("link").click();
      await settled(page);
      await page.getByTestId("screen-settings").waitFor();
      check((await title(page)) === "설정", "the screen is titled " + (await title(page)));
      return order.slice(-2).join(" > ") + "; " + (await title(page));
    });
    await step("read the groups: warnings, 기본값, 실행기, 배정 규칙, 기기, 모델 (OCX), 기록 and the revision", async () => {
      const groups = await page.getByTestId("screen-settings").evaluate((element) => [...element.children].map((child) => child.dataset.testid).filter(Boolean));
      check(JSON.stringify(groups) === JSON.stringify(["settings-warnings", "settings-defaults", "settings-runners", "settings-rules", "settings-devices", "settings-models", "settings-history", "settings-rev"]), "groups " + groups.join(", "));
      const warnings = await page.getByTestId("settings-warning").evaluateAll((items) => items.map((item) => [item.textContent, getComputedStyle(item).color]));
      check(warnings.length === 2 && warnings[0][0].startsWith("codex 모델의 쿼터가 다 찼습니다") && warnings[1][0].startsWith("dsh 모델이 꺼져 있습니다") && warnings.every(([, colour]) => colour === ORANGE), "warnings " + JSON.stringify(warnings));
      // One way to write a model: the warnings name the fallback as the 기본값 row and the picker do.
      const fallback = (await page.getByTestId("settings-defaults").locator("[data-testid=row]").nth(1).locator(".settings-value").innerText()).trim();
      check(fallback === "model-b", "the 기본값 row's fallback reads " + fallback);
      check(warnings.every(([line]) => line.endsWith(" · 다음 실행은 " + fallback + "로 갑니다")), "the warnings name the fallback another way: " + JSON.stringify(warnings));
      const runners = await rows("settings-runners");
      check(JSON.stringify(runners) === JSON.stringify(["omo / model-a · 높음", "codex / model-c · 보통", "dsh / model-d"]), "runners " + JSON.stringify(runners));
      const order = await rules();
      check(JSON.stringify(order) === JSON.stringify(["docs → codex", "quick · S → dsh", "그 외 → omo"]), "rules " + JSON.stringify(order));
      const work = await rows("devices-work");
      const files = await rows("devices-files");
      const mine = await rows("devices-mine");
      check(JSON.stringify(work) === JSON.stringify(["machine-a / 입찰 2 · 지정 2", "machine-b / 입찰 1 · 지정 1"]) && JSON.stringify(files) === JSON.stringify(["files-a / 지정 1"]), "machines " + JSON.stringify([work, files]));
      check(JSON.stringify(mine) === JSON.stringify(["laptop-a / 상태만 봅니다"]), "my devices " + JSON.stringify(mine));
      check((await page.getByTestId("devices-mine").locator("a, button, [role=switch]").count()) === 0, "a person's device has a control");
      const models = (await page.getByTestId("settings-models").innerText()).replace(/\s+/g, " ");
      check(models.includes("켜진 모델 3개") && models.includes("모델 켜고 끄기는 OCX에서 합니다"), "models " + models);
      const history = await page.getByTestId("history-row").locator(".title").allInnerTexts();
      check(history.length === 3 && / · 바깥 편집 · machine-a 입찰 2 외 1개$/.test(history[0]) && / · 앱 · codex 모델 model-c$/.test(history[1]) && / · CLI · machine-a 추가 외 9개$/.test(history[2]) && history.every((line) => /^\d\d-\d\d \d\d:\d\d · /.test(line)), "history " + JSON.stringify(history));
      check(!history.some((line) => / · (기기|실행기|배정 규칙|모델)( 외 \d+개)?$/.test(line)), "a history line names a bare section: " + JSON.stringify(history));
      const rollback = await page.getByTestId("rollback").evaluate((button) => getComputedStyle(button).color);
      check(rollback === RED, "한 단계 되돌리기 is drawn " + rollback);
      check((await rev()) === "설정 r3", "the revision reads " + (await rev()));
      return [warnings.length + " warnings, fallback " + fallback, runners.join(", "), order.join(", "), work.concat(files, mine).join(", "), history.length + " changes", await rev()].join("; ");
    });
    await step("a switch saves at once: machine-b off, a new revision written against the one read", async () => {
      await toggle("machine-b 켜기").click();
      check((await toggle("machine-b 켜기").getAttribute("aria-checked")) === "false", "machine-b did not turn off at once");
      await until(rev, (line) => line === "설정 r4", "the revision after the switch");
      const line = await until(firstHistory, (text) => / · 앱 · machine-b 끔$/.test(text), "the first history row");
      const device = (await latest()).devices.workers["machine-b"];
      check(device.off === true, "the settings copy has machine-b " + JSON.stringify(device));
      const sent = (await writes()).at(-1);
      check(sent.ifMatch === "r3" && sent.status === 200, "the write went " + JSON.stringify(sent));
      return line + "; If-Match " + sent.ifMatch;
    });
    await step("a picker pushes a list of the models OCX serves and saves the choice", async () => {
      await page.getByRole("link", { name: "codex · model-c · 보통" }).click();
      await settled(page);
      await page.getByRole("link", { name: "모델 · model-c" }).click();
      await settled(page);
      const picker = page.getByTestId("setting-page");
      await picker.getByRole("radio").first().waitFor();
      const services = await picker.locator("[data-testid=model-group] h2").allInnerTexts();
      check(JSON.stringify(services) === JSON.stringify(["Claude", "ChatGPT"]), "services " + JSON.stringify(services));
      const names = await picker.getByRole("radio").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));
      check(JSON.stringify(names) === JSON.stringify(["model-a · 남은 양 72% · 3시간 후", "model-b · 남은 양 40% · 2일 후", "model-c · 다 씀"]), "models " + JSON.stringify(names));
      check(!(await picker.innerText()).includes("model-d"), "the picker offers model-d, which OCX has off");
      const used = await picker.getByRole("radio", { name: "model-c · 다 씀" }).locator(".is-red").evaluate((item) => getComputedStyle(item).color);
      check(used === RED, "다 씀 is drawn " + used);
      await picker.getByRole("radio", { name: names[0] }).click();
      check((await picker.getByRole("radio", { name: names[0] }).getAttribute("aria-checked")) === "true", "model-a is not checked");
      await until(async () => (await latest()).worker.runners.codex.model, (model) => model === "anthropic/model-a:medium", "codex's model in the settings copy");
      await toSettings();
      const runners = await until(() => rows("settings-runners"), (list) => list[1] === "codex / model-a · 보통", "codex's row");
      return services.join(", ") + ": " + names.join(" | ") + "; chose model-a, codex reads " + runners[1];
    });
    await step("a stepper and a machine's switches save each change", async () => {
      await page.getByRole("link", { name: "machine-a · 입찰 2 · 지정 2" }).click();
      await settled(page);
      const machine = page.getByTestId("setting-page");
      await machine.getByRole("button", { name: "동시 작업 (입찰) 늘리기" }).click();
      check((await machine.getByTestId("stepper-value").first().innerText()).trim() === "3", "the bid cap does not read 3");
      await until(async () => (await latest()).devices.workers["machine-a"].cap, (cap) => cap === 3, "machine-a's cap in the settings copy");
      await machine.getByRole("switch", { name: "빠른 기기" }).click();
      await until(async () => (await latest()).devices.workers["machine-a"].fast, (fast) => fast === undefined, "machine-a's 빠른 기기 in the settings copy");
      check((await machine.getByRole("switch", { name: "빠른 기기" }).getAttribute("aria-checked")) === "false", "빠른 기기 is still on");
      await toSettings();
      const work = await until(() => rows("devices-work"), (list) => list[0] === "machine-a / 입찰 3 · 지정 2", "machine-a's row");
      return "cap 3, 빠른 기기 off; " + work[0];
    });
    await step("편집 moves and deletes a rule, 규칙 추가 adds one last; edit mode lasts until 완료", async () => {
      const edit = page.getByTestId("screen-settings").getByTestId("rules-edit");
      const editState = async () => [(await edit.innerText()).trim(), await edit.getAttribute("aria-pressed")].join(" ");
      check((await editState()) === "편집 false", "the rules' button reads " + (await editState()));
      await edit.click();
      check((await editState()) === "완료 true", "편집 did not turn into 완료: " + (await editState()));
      await page.getByRole("button", { name: "docs → codex 아래로" }).click();
      await until(rules, (list) => list[0] === "quick · S → dsh" && list[1] === "docs → codex", "the rules after moving docs down");
      await page.getByRole("button", { name: "quick · S → dsh 삭제" }).click();
      await until(rules, (list) => JSON.stringify(list) === JSON.stringify(["docs → codex", "그 외 → omo"]), "the rules after deleting quick");
      await page.getByRole("link", { name: "규칙 추가" }).click();
      await settled(page);
      const form = page.getByTestId("setting-page");
      await form.getByRole("textbox", { name: "라벨" }).fill("review");
      await form.getByRole("button", { name: "M", exact: true }).click();
      await form.getByRole("radio", { name: "dsh", exact: true }).click();
      await form.getByTestId("rule-save").click();
      await settled(page);
      await page.getByTestId("screen-settings").waitFor();
      const list = await until(rules, (items) => items.at(-2) === "review · M → dsh", "the rules after adding review");
      const routing = (await latest()).worker.routing;
      check(JSON.stringify(routing.at(-1)) === JSON.stringify({ name: "review", when: { labels_any: ["review"], size: ["M"] }, runner: "dsh" }), "the new rule is " + JSON.stringify(routing.at(-1)));
      const kept = await editState();
      check(kept === "완료 true" && (await page.getByRole("button", { name: "review · M → dsh 삭제" }).count()) === 1, "edit mode ended on the way back from 규칙 추가: " + kept);
      await edit.click();
      check((await editState()) === "편집 false" && (await page.getByRole("button", { name: "review · M → dsh 삭제" }).count()) === 0, "완료 did not end edit mode: " + (await editState()));
      return list.join(", ") + "; still " + kept.split(" ")[0] + " after 규칙 추가, 편집 after 완료";
    });
    await step("a refused write (422) puts the switch back and shows the core's reason under its row", async () => {
      await toggle("omo 켜기").click();
      const row = page.getByTestId("settings-runners").locator("li", { has: page.getByRole("switch", { name: "omo 켜기", exact: true }) });
      const reason = (await text(row.getByTestId("write-error"))).trim();
      check(reason === "worker.default_runner: runner 'omo' is off", "the reason reads " + reason);
      check((await toggle("omo 켜기").getAttribute("aria-checked")) === "true", "omo stayed off");
      check((await writes()).at(-1).status === 422, "the write was not refused: " + JSON.stringify((await writes()).at(-1)));
      return reason;
    });
    await step("a refused change drops the change queued behind it: it is not sent, one reason shows", async () => {
      const before = (await writes()).length;
      // Two taps in one go, so the second change waits behind the first write, which the core refuses (422).
      await page.evaluate(() => {
        const toggle = (name) => document.querySelector(`[data-testid=screen-settings] [role=switch][aria-label="${name}"]`);
        toggle("omo 켜기").click();
        toggle("files-a 켜기").click();
      });
      const row = page.getByTestId("settings-runners").locator("li", { has: page.getByRole("switch", { name: "omo 켜기", exact: true }) });
      const reason = (await text(row.getByTestId("write-error"))).trim();
      check(reason === "worker.default_runner: runner 'omo' is off", "the reason reads " + reason);
      await until(async () => toggle("files-a 켜기").getAttribute("aria-checked"), (checked) => checked === "true", "files-a's switch back on");
      await page.waitForTimeout(300);
      const sent = (await writes()).slice(before);
      check(sent.length === 1 && sent[0].status === 422, "the writes after the taps: " + JSON.stringify(sent));
      check((await latest()).devices.workers["files-a"].off === undefined, "files-a was turned off in the settings copy");
      const reasons = await page.getByTestId("screen-settings").getByTestId("write-error").count();
      check(reasons === 1, reasons + " reasons show");
      return reason + "; files-a stays on; " + sent.length + " write sent";
    });
    await step("한 단계 되돌리기 asks once; 취소 writes nothing, 이전 설정으로 되돌리기 writes a new revision", async () => {
      const before = Number((await rev()).replace("설정 r", ""));
      const sent = (await writes()).length;
      await page.getByTestId("rollback").click();
      const sheet = page.getByRole("dialog", { name: "한 단계 되돌리기" });
      await sheet.waitFor();
      await sheet.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
      const words = (await sheet.innerText()).replace(/\s+/g, " ").trim();
      check(words === "이전 설정으로 되돌립니다. 되돌리기도 기록에 남습니다. 이전 설정으로 되돌리기 취소", "the sheet reads " + words);
      check((await sheet.getByRole("button", { name: "되돌리기", exact: true }).count()) === 0, "the sheet has a button named 되돌리기, the owner-record undo's name");
      let phone = "";
      if (!wide) {
        const box = await sheet.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
        });
        check(box.left === 0 && box.right === box.width && Math.abs(box.bottom - box.height) < 1, "the sheet is not at the bottom: " + JSON.stringify(box));
        phone = "; " + (await phoneRules(page, "rollback sheet @390"));
      }
      await sheet.getByRole("button", { name: "취소" }).click();
      await sheet.waitFor({ state: "detached" });
      check((await writes()).length === sent, "취소 sent a write");
      await page.getByTestId("rollback").click();
      await sheet.getByRole("button", { name: "이전 설정으로 되돌리기", exact: true }).click();
      await until(rev, (line) => line === "설정 r" + (before + 1), "the revision after the rollback");
      const line = await until(firstHistory, (row) => / · 되돌리기 · /.test(row), "the first history row");
      check((await writes()).at(-1).status === 200, "the rollback was refused: " + JSON.stringify((await writes()).at(-1)));
      return "r" + before + " -> r" + (before + 1) + "; " + line + phone;
    });
    await step("a stale write (412): another device wrote first, the page reloads the settings and says so", async () => {
      await openApp(page, "#/settings", "&settings=stale");
      await page.getByTestId("screen-settings").waitFor();
      // One raw press: the reload puts machine-a back on, and Playwright's click() would see the switch move back,
      // press again and write a second time, against the new revision.
      await page.evaluate(() => document.querySelector('[data-testid=screen-settings] [role=switch][aria-label="machine-a 켜기"]').click());
      const toast = page.getByTestId("toast");
      const said = (await text(toast)).trim();
      check(said === "다른 곳에서 먼저 바뀌었습니다 · 새로 읽었습니다", "the toast reads " + said);
      check((await toast.getByRole("button").count()) === 0, "the toast offers 되돌리기");
      await until(rev, (line) => line === "설정 r4", "the revision after the stale write");
      check((await toggle("machine-a 켜기").getAttribute("aria-checked")) === "true", "machine-a stayed off");
      const work = await until(() => rows("devices-work"), (list) => list[1] === "machine-b / 입찰 2 · 지정 2", "machine-b's row after the other device's write");
      const all = await writes();
      const sent = all.at(-1);
      check(all.length === 1 && sent.status === 412 && sent.ifMatch === "r3", "the writes went " + JSON.stringify(all));
      const drawn = await lineage();
      check(JSON.stringify(drawn.slice(3)) === JSON.stringify(["r4<r3 phone-a"]), "the revisions after r3 are " + JSON.stringify(drawn));
      return said + "; " + work.join(", ") + "; " + (await rev()) + "; " + drawn.slice(3).join(", ");
    });
    await step("changes queued behind a write go only against the revision they were drawn over", async () => {
      await openApp(page, "#/settings", "&settings=race");
      await page.getByTestId("screen-settings").waitFor();
      await page.getByTestId("rules-edit").click();
      // Two taps in one go, so the second change waits behind the first write; another device writes as it lands.
      await page.evaluate(() => {
        const button = (name) => document.querySelector(`[data-testid=settings-rules] button[aria-label="${name}"]`);
        button("docs → codex 아래로").click();
        button("quick · S → dsh 삭제").click();
      });
      const said = (await text(page.getByTestId("toast"))).trim();
      check(said === "다른 곳에서 먼저 바뀌었습니다 · 새로 읽었습니다", "the toast reads " + said);
      await until(rev, (line) => line === "설정 r5", "the revision after the other device's write");
      const sent = await writes();
      check(sent.length === 1 && sent[0].ifMatch === "r3" && sent[0].status === 200, "the queued change was sent: " + JSON.stringify(sent));
      const list = await until(rules, (items) => JSON.stringify(items) === JSON.stringify(["quick · S → dsh", "docs → codex", "그 외 → omo"]), "the rules after the first change");
      const work = await until(() => rows("devices-work"), (items) => items[1] === "machine-b / 입찰 2 · 지정 2", "machine-b's row after the other device's write");
      const drawn = await lineage();
      check(JSON.stringify(drawn.slice(3)) === JSON.stringify(["r4<r3 laptop-a", "r5<r4 phone-a"]), "the revisions after r3 are " + JSON.stringify(drawn));
      return said + "; sent " + sent.map((write) => write.ifMatch + " " + write.status).join(", ") + "; " + list.join(", ") + "; " + work[1] + "; " + drawn.slice(3).join(", ");
    });
    await step("OCX not read: one grey line with the list's time, every model 확인 못 함, warnings say how old", async () => {
      await openApp(page, "#/settings", "&settings=ocx-down");
      await page.getByTestId("screen-settings").waitFor();
      const time = await page.evaluate(() => {
        const date = new Date(window.__linaScene.settings.ocxReadAt * 1000);
        return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
      });
      const line = page.getByTestId("models-stale");
      const said = [(await text(line)).trim(), await line.evaluate((item) => getComputedStyle(item).color)];
      check(said[0] === "OCX를 읽지 못했습니다 · 모델 상태는 " + time + " 기준", "the line reads " + said[0]);
      const grey = await page.getByTestId("settings-rev").evaluate((item) => getComputedStyle(item).color);
      check(said[1] === grey, "the line is drawn " + said[1] + ", not the grey of 설정 <rev> " + grey);
      const first = await page.getByTestId("screen-settings").evaluate((element) => element.firstElementChild?.dataset.testid);
      check(first === "models-stale", "the first line of the screen is " + first);
      const warnings = await page.getByTestId("settings-warning").allInnerTexts();
      check(warnings.length === 2 && warnings.every((each) => each.endsWith(" · " + time + " 기준")), "warnings " + JSON.stringify(warnings));
      await page.getByRole("link", { name: /^codex · / }).click();
      await settled(page);
      await page.getByRole("link", { name: /^모델 · / }).click();
      await settled(page);
      const picker = page.getByTestId("setting-page");
      await picker.getByRole("radio").first().waitFor();
      check((await picker.getByTestId("models-stale").count()) === 1, "the model picker has no grey line");
      const names = await picker.getByRole("radio").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));
      check(JSON.stringify(names) === JSON.stringify(["model-a · 확인 못 함", "model-b · 확인 못 함", "model-c · 확인 못 함"]), "models " + JSON.stringify(names));
      return said[0] + "; " + warnings.length + " warnings as of " + time + "; picker " + names.join(" | ");
    });
    await step("four models warned about: the first three lines, then 외 1개", async () => {
      await openApp(page, "#/settings", "&settings=many-warnings");
      await page.getByTestId("screen-settings").waitFor();
      const lines = await warningLines();
      const more = (await text(page.getByTestId("settings-warning-more"))).trim();
      check(lines.length === 3 && more === "외 1개", "warnings " + JSON.stringify(lines) + " then " + more);
      return lines.join(" | ") + " | " + more;
    });
    await step("another device's write and a model's new state refresh the model warnings without a reload", async () => {
      await openApp(page, "#/settings");
      await page.getByTestId("screen-settings").waitFor();
      await page.evaluate(() => (window.__sameLoad = true));
      const before = await warningLines();
      check(before.some((line) => line.startsWith("dsh ")) && before.some((line) => line.startsWith("codex ")), "warnings before " + JSON.stringify(before));
      const written = await elsewhere({ worker: { runners: { dsh: { model: "anthropic/model-a" } } } });
      check(written.ok, "the other device's write was refused: " + JSON.stringify(written));
      const after = await until(warningLines, (lines) => lines.length === 1 && lines[0].startsWith("codex "), "the warnings after dsh's model changed elsewhere");
      await page.evaluate(() => window.__linaSettingsElsewhere.model("model-c", { state: "ok", left: 55, resetAt: null }));
      await until(warningLines, (lines) => lines.length === 0, "the warnings after model-c came back");
      check(await page.evaluate(() => window.__sameLoad === true), "the page reloaded");
      return before.length + " warnings -> " + after.join("") + " -> none; " + (await rev()) + ", same load";
    });
    await step("history names a rule changed in place, a device and a runner added and removed", async () => {
      await openApp(page, "#/settings");
      await page.getByTestId("screen-settings").waitFor();
      const routing = (await latest()).worker.routing.map((rule) => (rule.name === "docs" ? { ...rule, runner: "dsh" } : rule));
      const lines = [];
      for (const [patch, wanted] of [
        [{ worker: { routing } }, "docs → dsh"],
        [{ devices: { workers: { "build-a": { host: "build-a", role: "work", cap: 1 } } } }, "build-a 추가"],
        [{ devices: { workers: { "machine-b": null } } }, "machine-b 삭제"],
        [{ worker: { runners: { gem: { type: "command", argv: ["gem", "-"], model: "anthropic/model-b" } } } }, "gem 추가"],
        [{ worker: { runners: { gem: null } } }, "gem 삭제"],
      ]) {
        const written = await elsewhere(patch);
        check(written.ok, "the other device's write was refused: " + JSON.stringify(written));
        lines.push(await until(firstHistory, (row) => row.endsWith(" · 앱 · " + wanted), "the first history row after " + wanted));
      }
      const list = await rules();
      check(list[0] === "docs → dsh", "the rules read " + JSON.stringify(list));
      const work = await rows("devices-work");
      check(work.some((row) => row.startsWith("build-a")) && !work.some((row) => row.startsWith("machine-b")), "기기 (작업) " + JSON.stringify(work));
      return lines.map((line) => line.replace(/^.* · 앱 · /, "")).join(", ") + "; rules " + list.join(", ") + "; " + (await rev());
    });
    await step("a device that may only read: every control disabled, one grey line, nothing sent", async () => {
      await openApp(page, "#/settings", "&settings=readonly");
      await page.getByTestId("screen-settings").waitFor();
      const line = await page.getByTestId("read-only").evaluate((item) => [item.textContent, getComputedStyle(item).color]);
      check(line[0] === "이 기기에서는 볼 수만 있습니다", "the line reads " + line[0]);
      const controls = await page.getByTestId("screen-settings").locator("button").evaluateAll((buttons) => buttons.map((button) => button.disabled));
      check(controls.length > 0 && controls.every(Boolean), (controls.length - controls.filter(Boolean).length) + " of " + controls.length + " buttons are enabled");
      check((await page.getByTestId("rollback").count()) === 0, "한 단계 되돌리기 shows on a device that may only read");
      const pickers = await page.getByTestId("settings-defaults").locator("[data-testid=row]").evaluateAll((items) => items.map((item) => item.querySelectorAll("a, .disclosure").length));
      check(pickers.every((count) => count === 0), "기본값 rows still open a picker: " + JSON.stringify(pickers));
      const look = await toggle("machine-a 켜기").evaluate((button) => [getComputedStyle(button).opacity, getComputedStyle(button).cursor, getComputedStyle(button.querySelector(".switch")).filter]);
      check(look[0] === "0.5" && look[1] === "not-allowed" && look[2].includes("grayscale"), "a disabled switch looks " + JSON.stringify(look));
      await toggle("machine-a 켜기").click({ force: true });
      check((await writes()).length === 0, "a write was sent: " + JSON.stringify(await writes()));
      // Opened by its address, a sub-page has no enabled control either: each disabled on its own, drawn grey.
      await openApp(page, "#/settings/rule-new", "&settings=readonly");
      const form = page.getByTestId("setting-page");
      await form.locator(".rows").first().waitFor();
      const open = await form.locator("button, input").evaluateAll((items) => items.filter((item) => !item.disabled).map((item) => item.getAttribute("aria-label") ?? item.textContent));
      check(open.length === 0, "새 규칙 has enabled controls: " + JSON.stringify(open));
      const label = await form.getByRole("textbox").evaluate((input) => [input.disabled, getComputedStyle(input).opacity]);
      check(label[0] === true && label[1] === "0.5", "라벨 is " + JSON.stringify(label));
      return line.join(" ") + "; " + controls.length + " buttons disabled (" + look.join(", ") + "); no rollback, 기본값 rows open nothing; 새 규칙 by address all disabled";
    });
    await step("the scene as it starts is writable: no read-only line, every switch and 한 단계 되돌리기 enabled", async () => {
      await openApp(page, "#/settings");
      await page.getByTestId("screen-settings").waitFor();
      check((await page.getByTestId("read-only").count()) === 0, "the default scene says it is read-only");
      const enabled = await page.getByTestId("screen-settings").getByRole("switch").evaluateAll((items) => items.every((item) => !item.disabled));
      check(enabled, "a switch is disabled in the default scene");
      check(await page.getByTestId("rollback").isEnabled(), "한 단계 되돌리기 is disabled in the default scene");
      const pickers = await page.getByTestId("settings-defaults").locator("[data-testid=row] a").count();
      check(pickers === 2, "기본값 has " + pickers + " pickers");
      return "writable; " + (await rev());
    });
    if (!wide) {
      for (const [where, hash] of [
        ["설정", "#/settings"],
        ["a machine", "#/settings/device/machine-a"],
        ["a runner", "#/settings/runner/codex"],
        ["a model picker", "#/settings/runner/codex/model"],
        ["a new rule", "#/settings/rule-new"],
      ]) {
        await step("at 390, " + where + ": every hit area is 44x44 and every text 13px or larger", async () => {
          await openApp(page, hash);
          await page.locator("[data-testid=screen-settings], [data-testid=setting-page] .rows").first().waitFor();
          const lines = await rowLines(page);
          check(lines.length === 0, "rows with more than two lines: " + lines.join("; "));
          return phoneRules(page, where + " @390");
        });
      }
    }
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
      if (wide) check((await sidebarCount(page, "nav-inbox")) === "8", "the sidebar counts " + (await sidebarCount(page, "nav-inbox")));
      await toastGone();
      await mine.getByRole("checkbox", { name: /^공지 문구 확인/ }).waitFor({ state: "detached", timeout: 2_000 }).catch(() => check(false, "the row stayed after the toast"));
      check((await headCount("mine")) === 1, "내 할 일 counts " + (await headCount("mine")) + " after the row left");
      if (wide) check((await sidebarCount(page, "nav-inbox")) === "7", "the sidebar counts " + (await sidebarCount(page, "nav-inbox")) + " after the row left");
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
      const during = { decide: await headCount("decide"), rows: (await decisionNames(list)).length, sidebar: wide ? await sidebarCount(page, "nav-inbox") : "7" };
      check(during.decide === 3 && during.rows === 3 && during.sidebar === "7", "during the toast: " + JSON.stringify(during));
      await page.getByTestId("toast").getByRole("button", { name: "되돌리기" }).click();
      const after = { decide: await headCount("decide"), rows: (await decisionNames(list)).length, sidebar: wide ? await sidebarCount(page, "nav-inbox") : "8" };
      check(after.decide === 4 && after.rows === 4 && after.sidebar === "8", "after undo: " + JSON.stringify(after));
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
      // The board does not list a card's own runs (as the core), so the card's to-do is not known: the retry is a
      // comment on the card itself.
      await page.waitForFunction(() => window.__linaScene.cardDetails["k-103"].comments.some((comment) => comment.body === "다시 시도해 주세요."), null, { timeout: 3_000 }).catch(() => check(false, "the retry did not reach the card"));
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
      const line = await freshnessLine(page);
      check(line === "실시간", "freshness reads " + line);
      return line;
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

  async phone(page, step) {
    if (page.viewportSize().width >= 900) {
      await step("a wide window draws the split view, where the phone rules do not apply", async () => {
        await openApp(page, "#/inbox");
        check((await page.locator("[data-layout=wide]").count()) === 1, "no split view at " + page.viewportSize().width);
        check((await page.locator("[data-layout=phone]").count()) === 0, "the phone stack is drawn at " + page.viewportSize().width);
        return "split view";
      });
      await dividerSteps(page, step, page.viewportSize().width);
      return;
    }
    const screens = [
      ["home", "#/"],
      ["list 진행 중인 작업", "#/running"],
      ["goal detail", "#/goals/G2"],
      ["to-do detail", "#/items/T4"],
      ["card detail", "#/cards/k-101"],
      ["card with no checked lines", "#/cards/k-102"],
      ["worker run outside a card", "#/runs/r7"],
      ["card with folded comments", "#/cards/k-103"],
      ["완료 filtered to one agent", "#/done?agent=ag-1"],
    ];
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [where, hash] of screens) {
        await step("at " + width + ", " + where + ": every hit area is 44x44 and every text 13px or larger", async () => {
          await openApp(page, hash);
          await page.locator("[data-testid=screen-title], .detail-head").first().waitFor();
          const lines = await rowLines(page);
          check(lines.length === 0, "rows with more than two lines: " + lines.join("; "));
          return await phoneRules(page, where + " @" + width);
        });
      }
      await step("at " + width + ", the bell opens a bottom sheet that keeps the same rules", async () => {
        await openApp(page, "#/inbox");
        await page.getByRole("button", { name: "알림 5" }).click();
        const sheet = page.getByRole("dialog", { name: "알림" });
        await sheet.waitFor();
        await sheet.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
        const box = await sheet.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, bottom: rect.bottom, top: rect.top, width: innerWidth, height: innerHeight };
        });
        check(box.left === 0 && box.right === box.width, "the sheet spans " + box.left + "-" + box.right + " of " + box.width);
        check(Math.abs(box.bottom - box.height) < 1, "the sheet ends at " + box.bottom + " of " + box.height);
        return (await phoneRules(page, "bell sheet @" + width)) + ", sheet " + Math.round(box.top) + "-" + Math.round(box.bottom);
      });
    }
    await step("under reduced motion the bell sheet opens at once", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      try {
        await openApp(page, "#/inbox");
        await page.getByRole("button", { name: "알림 5" }).click();
        const sheet = page.getByRole("dialog", { name: "알림" });
        await sheet.waitFor();
        // Read in the first frame after the tap: a sliding sheet is still below the window then.
        const seen = await sheet.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const running = element.getAnimations().filter((animation) => animation.playState === "running").map((animation) => animation.animationName + " " + animation.effect.getTiming().duration + "ms");
          return { bottom: rect.bottom, height: innerHeight, duration: getComputedStyle(element).animationDuration, running };
        });
        check(seen.running.length === 0, "the sheet still animates under reduced motion: " + seen.running.join(", "));
        check(Math.abs(seen.bottom - seen.height) < 1, "in its first frame the sheet ends at " + seen.bottom + " of " + seen.height);
        return "sheet at the bottom in its first frame, animation " + seen.duration;
      } finally {
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await step("at 390, the stale line on a stream that is down keeps the phone rules", async () => {
      await openApp(page, "#/inbox", "&live=down", "갱신 지연");
      return phoneRules(page, "stream down @390");
    });
    await dividerSteps(page, step, 390);
    await focusSteps(page, step);
    await openApp(page, "#/inbox");
    await page.getByRole("button", { name: "알림 5" }).click();
    await page.getByRole("dialog", { name: "알림" }).waitFor();
    await step("Escape and a tap outside close the sheet", async () => {
      const sheet = page.getByRole("dialog", { name: "알림" });
      await page.keyboard.press("Escape");
      await sheet.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "알림 5" }).click();
      await sheet.waitFor();
      await page.mouse.click(200, 120);
      await sheet.waitFor({ state: "detached" });
      check(new URL(page.url()).hash === "#/inbox", "the outside tap went through to " + new URL(page.url()).hash);
      return "closed by Escape and by a tap on the dimmed screen";
    });
    await step("a pressed row and a pressed button change at once; no tap flash, no zoom delay, no selection on rows", async () => {
      await openApp(page, "#/");
      const pressed = async (locator, property) => {
        const box = await locator.boundingBox();
        const rest = await locator.evaluate((element, property) => getComputedStyle(element)[property], property);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        const down = await locator.evaluate((element, property) => ({ value: getComputedStyle(element)[property], running: element.getAnimations().length }), property);
        await page.mouse.move(1, 1);
        await page.mouse.up();
        check(down.value !== rest, property + " stays " + rest + " when pressed");
        check(down.running === 0, "the pressed state waits on a transition");
        return rest + " -> " + down.value;
      };
      const row = await pressed(page.getByTestId("nav-running").getByRole("link"), "backgroundColor");
      const bell = await pressed(page.getByRole("button", { name: "알림 5" }), "opacity");
      const look = await page.getByTestId("nav-running").getByRole("link").evaluate((element) => {
        const style = getComputedStyle(element);
        return { flash: style.webkitTapHighlightColor, touch: style.touchAction, select: style.userSelect || style.webkitUserSelect, callout: style.webkitTouchCallout };
      });
      check(look.flash === "rgba(0, 0, 0, 0)", "tap highlight is " + look.flash);
      check(look.touch === "manipulation", "touch-action is " + look.touch);
      check(look.select === "none", "a row is selectable: " + look.select);
      await openApp(page, "#/items/T4");
      const field = await page.getByRole("textbox", { name: "댓글 달기" }).evaluate((element) => getComputedStyle(element).userSelect);
      const body = await page.locator(".comment-text").first().evaluate((element) => getComputedStyle(element).userSelect);
      check(field !== "none" && body !== "none", "a field or a comment is not selectable: " + field + ", " + body);
      return "row " + row + ", bell " + bell + ", flash " + look.flash + ", " + look.touch + ", rows " + look.select + ", fields " + field + ", comments " + body;
    });
    await step("the bars stay put, only the screen scrolls, and the page does not rubber-band", async () => {
      // A short window, so the to-do screen has something to scroll.
      await page.setViewportSize({ width: 390, height: 480 });
      await openApp(page, "#/items/T4");
      await page.getByTestId("talk").waitFor();
      const before = await page.evaluate(() => ({ bar: document.querySelector(".navbar").getBoundingClientRect().top, bottom: document.querySelector(".bottombar").getBoundingClientRect().bottom }));
      const after = await page.evaluate(() => {
        const main = document.querySelector(".phone-main");
        main.scrollTo(0, main.scrollHeight);
        return {
          scrolled: main.scrollTop,
          page: document.scrollingElement.scrollTop,
          bar: document.querySelector(".navbar").getBoundingClientRect().top,
          bottom: document.querySelector(".bottombar").getBoundingClientRect().bottom,
          height: innerHeight,
          pane: getComputedStyle(main).overscrollBehaviorY,
          root: getComputedStyle(document.documentElement).overscrollBehaviorY,
          overflow: getComputedStyle(document.body).overflowY,
        };
      });
      check(after.scrolled > 0, "the to-do screen did not scroll");
      check(after.page === 0, "the page scrolled by " + after.page);
      check(after.bar === before.bar && after.bottom === before.bottom && after.bottom === after.height, "a bar moved: nav " + before.bar + "->" + after.bar + ", bottom " + before.bottom + "->" + after.bottom);
      check(after.pane === "contain", "the screen's overscroll is " + after.pane);
      check(after.root === "none" && after.overflow === "hidden", "the page can rubber-band: " + after.root + ", " + after.overflow);
      await page.setViewportSize({ width: 390, height: 844 });
      return "screen scrolled " + after.scrolled + " px, page 0, bars fixed, overscroll " + after.pane + "/" + after.root;
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
      // A short window, so the menu has something to scroll.
      await page.setViewportSize({ width: 390, height: 480 });
      await openApp(page, "#/");
      await page.evaluate(() => document.querySelector(".phone-main").scrollTo(0, 120));
      const before = await page.evaluate(() => document.querySelector(".phone-main").scrollTop);
      check(before === 120, "the menu scrolled to " + before + ", not 120");
      await page.getByRole("link", { name: /^목표/ }).click();
      await page.waitForFunction(() => location.hash === "#/goals");
      await page.goBack();
      await page.waitForFunction(() => location.hash === "#/");
      const after = await page.evaluate(() => document.querySelector(".phone-main").scrollTop);
      check(after === before, "scroll " + after + " after back, " + before + " before");
      await page.setViewportSize({ width: 390, height: 844 });
      return "scroll kept at " + after;
    });
    await step("a push slides in from the right, a pop slides out, and back draws no frame without its scroll", async () => {
      await page.setViewportSize({ width: 390, height: 480 });
      await openApp(page, "#/");
      await page.evaluate(() => document.querySelector(".phone-main").scrollTo(0, 120));
      check((await page.evaluate(() => document.querySelector(".phone-main").scrollTop)) === 120, "the menu does not scroll to 120");
      await page.evaluate(() => {
        window.__nav = [];
        window.__frames = [];
        new MutationObserver(() => window.__nav.push(document.documentElement.dataset.nav ?? "")).observe(document.documentElement, { attributes: true, attributeFilter: ["data-nav"] });
        const frame = () => {
          const main = document.querySelector(".phone-main");
          window.__frames.push({ hash: location.hash, title: document.querySelector("[data-testid=screen-title]")?.textContent ?? "", scroll: main ? main.scrollTop : -1, rows: main ? main.querySelectorAll("a").length : 0 });
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      await page.getByRole("link", { name: /^목표/ }).click();
      await page.waitForFunction(() => location.hash === "#/goals" && !document.documentElement.dataset.nav);
      await page.getByTestId("back").click();
      await page.waitForFunction(() => location.hash === "#/" && !document.documentElement.dataset.nav);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const { nav, frames } = await page.evaluate(() => ({ nav: window.__nav, frames: window.__frames }));
      check(nav.includes("push") && nav.includes("pop"), "the stack set " + JSON.stringify(nav) + ", not a push and a pop");
      const menu = frames.filter((frame, index) => frame.title === "LINA" && frames.slice(0, index).some((seen) => seen.hash === "#/goals"));
      check(menu.length > 0, "no frame of the menu after back");
      const off = menu.filter((frame) => frame.scroll !== 120 || frame.rows === 0);
      check(off.length === 0, off.length + " frame(s) of the menu after back without its scroll or rows: " + JSON.stringify(off[0]));
      await page.setViewportSize({ width: 390, height: 844 });
      return "directions " + nav.filter(Boolean).join(", ") + "; " + menu.length + " menu frames after back, all at scroll 120";
    });
    await step("under reduced motion the screens swap at once", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openApp(page, "#/");
      await page.evaluate(() => {
        window.__nav = [];
        new MutationObserver(() => window.__nav.push(document.documentElement.dataset.nav ?? "")).observe(document.documentElement, { attributes: true, attributeFilter: ["data-nav"] });
      });
      await page.getByRole("link", { name: /^목표/ }).click();
      await page.waitForFunction(() => location.hash === "#/goals");
      const nav = await page.evaluate(() => window.__nav);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      check(nav.length === 0, "a slide ran under reduced motion: " + JSON.stringify(nav));
      return "no slide";
    });
    await step("in the installed app a swipe from the left edge goes back; not in a tab, not vertical, not on the menu", async () => {
      const tab = await touchContext(page);
      const app = await touchContext(page);
      const countBacks = () => {
        window.__backs = 0;
        const back = history.back.bind(history);
        history.back = () => {
          window.__backs += 1;
          back();
        };
      };
      await tab.addInitScript(countBacks);
      await app.addInitScript(countBacks);
      await app.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
      try {
        const results = [];
        const tryIt = async (context, hash, from, to) => {
          const touchPage = await context.newPage();
          await openApp(touchPage, hash);
          await swipe(touchPage, from, to);
          // The swipe goes back inside touchend, so a swipe that went back has called history.back by now.
          const backs = await touchPage.evaluate(() => window.__backs);
          const after = new URL(touchPage.url()).hash;
          await touchPage.close();
          return backs ? "back" : after;
        };
        await (async () => {
          const touchPage = await app.newPage();
          await openApp(touchPage, "#/");
          await touchPage.getByRole("link", { name: /^진행 중인 작업/ }).click();
          // A person swipes once the push has slid in.
          await touchPage.waitForFunction(() => location.hash === "#/running" && !document.documentElement.dataset.nav);
          await swipe(touchPage, { x: 6, y: 400 }, { x: 200, y: 410 });
          await touchPage.waitForFunction(() => location.hash === "#/", null, { timeout: 5_000 }).catch(() => null);
          results.push(["installed, edge to the right", new URL(touchPage.url()).hash, "#/"]);
          await touchPage.close();
        })();
        results.push(["installed, from the middle", await tryIt(app, "#/running", { x: 120, y: 400 }, { x: 320, y: 410 }), "#/running"]);
        results.push(["installed, mostly vertical", await tryIt(app, "#/running", { x: 6, y: 300 }, { x: 60, y: 600 }), "#/running"]);
        results.push(["installed, short", await tryIt(app, "#/running", { x: 6, y: 400 }, { x: 50, y: 400 }), "#/running"]);
        results.push(["installed, on the menu", await tryIt(app, "#/", { x: 6, y: 400 }, { x: 200, y: 400 }), "#/"]);
        results.push(["browser tab, edge to the right", await tryIt(tab, "#/running", { x: 6, y: 400 }, { x: 200, y: 410 }), "#/running"]);
        const wrong = results.filter(([, got, want]) => got !== want);
        check(wrong.length === 0, wrong.map(([what, got, want]) => what + " ended on " + got + ", not " + want).join("; "));
        return results.map(([what, got]) => what + " -> " + got).join("; ");
      } finally {
        await tab.close();
        await app.close();
      }
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

  async live(page, step) {
    const wide = page.viewportSize().width >= 900;
    await step("one socket for the app: moving between screens opens no other", async () => {
      await openApp(page, "#/inbox");
      await markPage(page);
      const go = async (name) => {
        if (!wide && new URL(page.url()).hash !== "#/") {
          await page.getByTestId("back").click();
          await settled(page);
        }
        await page.getByRole("link", { name }).first().click();
        await settled(page);
      };
      await go(/^진행 중인 작업/);
      await go(/^목표/);
      await go(/^마감일/);
      const { connections } = await stream(page);
      check(connections.length === 1 && connections[0].open, "the stream had " + JSON.stringify(connections));
      check(await notReloaded(page), "the page reloaded");
      return "1 connection after 3 screens; " + (await freshnessLine(page));
    });
    await step("nothing polls: a still page reads no snapshot", async () => {
      const before = (await stream(page)).reads;
      await page.waitForTimeout(12_000);
      const after = (await stream(page)).reads;
      check(after === before, "the page read " + (after - before) + " snapshot route(s) in 12 s with nothing changing");
      return "0 reads in 12 s, " + before + " before";
    });
    await step("the agent's reply arrives through the stream, without a reload", async () => {
      await openApp(page, "#/items/T4");
      await markPage(page);
      const replies = await page.getByTestId("reply").count();
      const field = page.getByRole("textbox", { name: "댓글 달기" });
      await field.fill("폭도 봐 주세요");
      await page.getByTestId("comments").getByRole("button", { name: "보내기" }).click();
      const sent = Date.now();
      await page.waitForFunction((count) => document.querySelectorAll("[data-testid=reply]").length > count, replies, { timeout: 10_000 });
      check(await notReloaded(page), "the page reloaded");
      return "reply drawn " + ((Date.now() - sent) / 1000).toFixed(1) + " s after 보내기 (the agent answers after 5 s)";
    });
    await step("a drop says 갱신 지연, the reconnect resumes from its cursor and draws what another device did meanwhile, the open row, the selection and the scroll kept", async () => {
      // Wide: a to-do is selected, its detail open beside the list. Phone: a short window, so the list scrolls.
      const size = page.viewportSize();
      if (!wide) await page.setViewportSize({ width: size.width, height: 480 });
      await openApp(page, wide ? "#/items/T3" : "#/inbox", "&live=drop");
      await markPage(page);
      const row = page.getByRole("button", { name: /배포를 금요일 오후에 해도 될까요/ });
      await row.click();
      check((await row.getAttribute("aria-expanded")) === "true", "the decision row did not open");
      const kept = async () =>
        page.evaluate(() => ({
          selected: document.querySelector(".list-pane [aria-current=page]")?.textContent?.trim() ?? null,
          detail: document.querySelector(".detail-pane .detail-title")?.textContent?.trim() ?? null,
          scroll: document.querySelector(".phone-main")?.scrollTop ?? null,
        }));
      if (!wide) await page.evaluate(() => document.querySelector(".phone-main").scrollTo(0, 40));
      const before = await kept();
      if (wide) check(before.selected && before.detail, "no selected row with its detail: " + JSON.stringify(before));
      else check(before.scroll > 0, "the list did not scroll");
      check((await page.getByTestId("bell").getAttribute("aria-label")) === "알림 5", "the bell does not read 알림 5 before the drop");
      await page.getByTestId("freshness-line").filter({ hasText: /^갱신 지연$/ }).waitFor({ timeout: 6_000 });
      await page.getByTestId("freshness-line").filter({ hasText: /^실시간$/ }).waitFor({ timeout: 6_000 });
      await page.getByRole("button", { name: "알림 4" }).waitFor({ timeout: 3_000 });
      const { connections } = await stream(page);
      check(connections.length === 2, "the stream had " + connections.length + " connections");
      check(connections[1].since !== null && connections[1].first === "missed" && connections[1].missed === 1, "the reconnect was " + JSON.stringify(connections[1]));
      check((await row.getAttribute("aria-expanded")) === "true", "the open decision row closed");
      const after = await kept();
      check(JSON.stringify(after) === JSON.stringify(before), "the screen moved: " + JSON.stringify(before) + " -> " + JSON.stringify(after));
      check(await notReloaded(page), "the page reloaded");
      await page.setViewportSize(size);
      return "갱신 지연 → 실시간, reconnect " + JSON.stringify(connections[1]) + ", 알림 5 → 알림 4, row open, kept " + JSON.stringify(after);
    });
    await step("a resync reads the snapshot once", async () => {
      await openApp(page, "#/inbox", "&live=resync");
      await markPage(page);
      const before = (await stream(page)).reads;
      await page.waitForFunction((count) => window.__linaStream.reads > count, before, { timeout: 5_000 });
      await page.waitForTimeout(1_500);
      const after = (await stream(page)).reads;
      const { connections } = await stream(page);
      // One refresh reads each list route and each card's detail once.
      const once = await page.evaluate(() => 5 + window.__linaScene.cards.cards.length);
      check(after - before === once, "the resync read " + (after - before) + " route(s), one refresh is " + once);
      check(connections.length === 1, "the resync opened another connection");
      check(await notReloaded(page), "the page reloaded");
      return (after - before) + " reads (one refresh), still 1 connection";
    });
    await step("a core restarted with a new session token: the page reads the token once, resumes from its cursor and draws what it missed, without a reload or a stored token", async () => {
      await openApp(page, "#/inbox", "&live=token");
      await markPage(page);
      check((await page.getByTestId("bell").getAttribute("aria-label")) === "알림 5", "the bell does not read 알림 5 before the restart");
      await page.getByTestId("freshness-line").filter({ hasText: /^갱신 지연$/ }).waitFor({ timeout: 6_000 });
      await page.getByTestId("freshness-line").filter({ hasText: /^실시간$/ }).waitFor({ timeout: 6_000 });
      await page.getByRole("button", { name: "알림 4" }).waitFor({ timeout: 3_000 });
      const { connections, renewals } = await stream(page);
      const last = connections.at(-1);
      check(renewals === 1, "the page renewed its token " + renewals + " times");
      check(last.open && last.first === "missed" && last.missed === 1 && last.since !== null, "the reconnect was " + JSON.stringify(last));
      check(connections.filter((connection) => connection.open).length === 1, "open connections: " + JSON.stringify(connections));
      const stored = await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length);
      check(stored === 0, "the page keeps " + stored + " keys in web storage");
      check(await notReloaded(page), "the page reloaded");
      return "갱신 지연 → 실시간, 1 renewal, connections " + connections.map((connection) => connection.first).join(" → ") + ", 알림 5 → 알림 4";
    });
    await step("a stream that cannot open says 갱신 지연 and retries with growing waits; the screens still draw", async () => {
      await openApp(page, "#/inbox", "&live=down", "갱신 지연");
      const rows = (await decisionNames(page.getByRole("list", { name: "결정 필요" }))).length;
      check(rows === 4, "the inbox drew " + rows + " decisions");
      await page.waitForTimeout(5_000);
      const { connections } = await stream(page);
      check(connections.length >= 2 && connections.length <= 5, connections.length + " tries in 5 s");
      check(connections.every((connection) => !connection.open), "a connection opened");
      return (await freshnessLine(page)) + ", " + connections.length + " tries in 5 s, 결정 필요 " + rows;
    });
  },

  "work-cards": async (page, step) => {
    const wide = page.viewportSize().width >= 900;
    const home = () => page.getByTestId("screen-running");
    const rowsOf = (label) => home().getByRole("list", { name: label, exact: true }).locator(":scope > li > a");
    await step("open the home: 진행 중인 작업", async () => {
      await openApp(page, "#/");
      if (!wide) {
        await page.getByRole("link", { name: /^진행 중인 작업/ }).click();
        await settled(page);
      }
      await home().waitFor();
      return (await title(page)) + " at " + new URL(page.url()).hash;
    });
    await step("the home order: one decisions line, stopped then running, waiting, the last 24 hours, then older", async () => {
      const lists = await home().locator("ul.rows").evaluateAll((all) => all.map((list) => list.getAttribute("aria-label")));
      check(JSON.stringify(lists) === JSON.stringify(["수신함", "진행 중인 작업", "대기", "24시간 안에 끝남", "이전에 끝남"]), "the home lists " + JSON.stringify(lists));
      const decisions = (await page.getByTestId("home-decisions").getByRole("link").getAttribute("aria-label")) ?? "";
      check(decisions === "결정 필요 4", "the decisions line reads " + decisions);
      const first = (await rowsOf("진행 중인 작업").first().getAttribute("aria-label")) ?? "";
      check(first.endsWith("중단됨 · 응답 없음"), "the first card is " + first);
      const reason = (await rowsOf("진행 중인 작업").first().locator(".state").innerText()).trim();
      check(reason === "중단됨 · 응답 없음", "the stopped card's state reads " + reason);
      return lists.join(" → ") + "; " + decisions + "; first " + first;
    });
    await step("every count equals its list", async () => {
      const found = [];
      for (const id of ["waiting", "recent", "older"]) {
        const section = page.getByTestId("section-" + id);
        const shown = Number((await section.getByTestId("count").innerText()).trim());
        const rows = await section.locator(":scope li[data-testid=row]").count();
        check(shown === rows, id + " says " + shown + " and lists " + rows);
        found.push(id + " " + rows);
      }
      const running = await rowsOf("진행 중인 작업").count();
      const nav = await sidebarCount(page, "nav-running");
      if (nav !== null) {
        const red = Number((await page.getByTestId("nav-running").getByTestId("nav-stopped").innerText()).trim());
        check(Number(nav) + red === running, "the sidebar says " + nav + " and red " + red + ", the list has " + running);
        const done = Number(await sidebarCount(page, "nav-done"));
        const finished = (await rowsOf("24시간 안에 끝남").count()) + (await rowsOf("이전에 끝남").count());
        check(done === finished, "완료 says " + done + ", the home lists " + finished + " finished");
      }
      return found.join(", ") + "; running list " + running;
    });
    await step("one card per run: three rounds of one card stay one card, two jobs with one title stay two", async () => {
      const release = await home().getByRole("link", { name: /릴리스 노트: 변경 목록 정리/ }).count();
      check(release === 1, "the three-round card shows " + release + " times");
      const rounds = await home().locator('a[href="#/runs/r9"], a[href="#/runs/r10"]').count();
      check(rounds === 0, "earlier rounds' worker runs show as " + rounds + " cards");
      const twins = await home().getByRole("link", { name: /가이드 초안 다듬기/ }).evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      check(twins.length === 2 && new Set(twins).size === 2, "the two jobs show as " + JSON.stringify(twins));
      return "1 card for 3 rounds; 2 cards " + twins.join(", ");
    });
    await step("the now line comes from the checked line only, on a wide window", async () => {
      const raw = ["one-line summar", "editing", "payment card-form polish", "LINA-41", "guide-draft.md", "CHANGES.md"];
      const text = await home().innerText();
      const leaked = raw.filter((line) => text.includes(line));
      check(leaked.length === 0, "raw text on the home: " + leaked.join(", "));
      const now = await home().getByText("변경마다 한 줄 요약을 붙이는 중", { exact: true }).count();
      check(now === (wide ? 1 : 0), "the now line shows " + now + " times at " + page.viewportSize().width);
      return wide ? "now line from plain.now" : "no now line on a phone";
    });
    await step("a card with no checked lines is named by its kind of work in grey, never by raw text", async () => {
      const row = home().locator('li:has(> a[href="#/cards/k-102"])');
      const kindTitle = row.locator(".title.is-kind");
      check((await kindTitle.innerText()).trim() === "코드 작업", "the card is named " + (await row.locator(".title").allInnerTexts()).join(""));
      const grey = await kindTitle.evaluate((title) => getComputedStyle(title).color === getComputedStyle(title.closest(".row").querySelector(".sub")).color);
      check(grey, "the kind name is not grey like the state line");
      const state = (await row.locator(".state").innerText()).trim();
      check(state === "진행 중", "its state line reads " + state);
      await row.getByRole("link").click();
      await settled(page);
      const detail = page.getByTestId("screen-card");
      await detail.waitFor();
      const head = (await detail.locator(".detail-title.is-kind").innerText()).trim();
      check(head === "코드 작업", "the detail is named " + head);
      const kind = (await detail.getByTestId("kind").innerText()).trim();
      check(kind === "코드", "the kind reads " + kind);
      check((await detail.getByTestId("card-now").count()) === 0, "the detail shows a now line");
      const text = await detail.innerText();
      check(!/payment|card-form|editing/.test(text), "raw text in the detail: " + text.slice(0, 120));
      return "row: 코드 작업 · " + state + "; detail: " + kind + ", " + head + ", no now line";
    });
    await step("a card's detail: now, to-dos, then one round list (기록), each round's head the link to its worker run", async () => {
      await openApp(page, "#/cards/k-101");
      const detail = page.getByTestId("screen-card");
      await detail.getByTestId("timeline").waitFor();
      const heads = await detail.locator(":scope > .box > .box-head").allInnerTexts();
      check(JSON.stringify(heads) === JSON.stringify(["지금", "할 일", "기록", "댓글"]), "the boxes read " + JSON.stringify(heads));
      const rounds = await detail.getByTestId("timeline-link").allInnerTexts();
      check(
        rounds.length === 3 && /^라운드 3 · (어제 )?\d\d:\d\d · 진행 중$/.test(rounds[0]) && /^라운드 2 · (어제 )?\d\d:\d\d–(어제 )?\d\d:\d\d · 검토 반려$/.test(rounds[1]) && /^라운드 1 · (어제 )?\d\d:\d\d · 작업 마침$/.test(rounds[2]),
        "the rounds read " + JSON.stringify(rounds),
      );
      // Round 1's end is r9's own end (2시간 40분 전), so the head and the run agree.
      const end = await detail.getByTestId("timeline-link").nth(2).evaluate(() => {
        // The app's clock rule: the time alone today, 어제 before it when it was yesterday.
        const at = new Date((window.__linaScene.now - 2 * 3600 - 40 * 60) * 1000);
        const time = String(at.getHours()).padStart(2, "0") + ":" + String(at.getMinutes()).padStart(2, "0");
        return at.toDateString() === new Date(window.__linaScene.now * 1000).toDateString() ? time : "어제 " + time;
      });
      check(rounds[2] === "라운드 1 · " + end + " · 작업 마침", "round 1 ends " + rounds[2] + ", its run at " + end);
      return heads.join(", ") + "; " + rounds.join(" | ");
    });
    await step("the stopped and running group has its heading and counts; finished cards say when they ended", async () => {
      await openApp(page, "#/running");
      const head = page.getByTestId("head-active");
      const words = (await head.locator("span").first().innerText()).trim();
      const grey = (await head.getByTestId("count").innerText()).trim();
      const red = (await head.getByTestId("stopped-count").innerText()).trim();
      check(words === "진행 중" && grey === "2" && red === "1", "the group heads " + words + " " + grey + " red " + red);
      const recent = await page.getByTestId("section-recent").locator(".sub").allInnerTexts();
      const older = await page.getByTestId("section-older").locator(".sub").allInnerTexts();
      check(recent.every((line) => /^완료 · \d+(분|시간) 전$/.test(line)), "the last 24 hours read " + recent.join(", "));
      check(older.every((line) => /^완료 · \d+일 전$/.test(line)), "older cards read " + older.join(", "));
      return words + " " + grey + " / " + red + "; " + recent.join(", ") + "; " + older.join(", ");
    });
    await step("a comment with a path, a hash or a cut-off fragment is one folded entry; it opens on demand", async () => {
      await openApp(page, "#/cards/k-103");
      const comments = page.getByTestId("comment");
      const folded = await comments.evaluateAll((items) => items.map((item) => item.getAttribute("data-folded")));
      check(JSON.stringify(folded) === JSON.stringify([null, "hash", "fragment"]), "the comments fold as " + JSON.stringify(folded));
      const text = await page.getByTestId("screen-card").innerText();
      check(!text.includes("errors.json") && !text.includes("3f2a1c9"), "a folded comment shows its text closed");
      const label = (await comments.nth(1).locator("summary").innerText()).trim();
      check(/^접힌 댓글 · \S+ · \d+(분|시간) 전$/.test(label), "the folded entry reads " + label);
      await comments.nth(1).locator("summary").click();
      const raw = (await comments.nth(1).locator(".comment-raw").innerText()).trim();
      check(raw.includes("errors.json"), "the opened entry reads " + raw);
      return label + "; opened: " + raw;
    });
    await step("a round with no start on record is one dim line when it holds content; an end alone shows nothing", async () => {
      const heads = await page.getByTestId("round").locator(".round-head").allInnerTexts();
      check(heads.length === 2 && /^라운드 3 · (어제 )?\d\d:\d\d · 중단됨$/.test(heads[0]) && heads[1] === "라운드 1 · 시작 기록 없음", "the rounds read " + JSON.stringify(heads));
      const weight = await page.getByTestId("round").nth(1).locator(".round-head").evaluate((head) => getComputedStyle(head).fontWeight);
      check(weight === "400", "the no-start line has weight " + weight);
      const line = (await page.getByTestId("round").nth(1).getByTestId("round-line").innerText()).trim();
      check(line === "오류 문구 초안을 남김", "the no-start round's line reads " + line);
      const head = await page.locator(".detail-head .sub").first().evaluate((sub) => ({ state: getComputedStyle(sub.querySelector(".state")).color, time: getComputedStyle(sub.querySelector(".time")).color, grey: getComputedStyle(document.querySelector(".kind-mark")).color }));
      check(head.state === "rgb(255, 59, 48)" && head.time === head.grey, "the stopped head reads state " + head.state + ", time " + head.time);
      return heads.join(" | ") + "; " + line + "; head state red, time grey";
    });
    await step("완료's agent filter is the address and survives a reload; each count is its list; latest activity agrees", async () => {
      await openApp(page, "#/done");
      // The filter lines up with the rows below it.
      const edges = await page.getByTestId("screen-done").evaluate((screen) => ({ filter: screen.querySelector("[data-testid=done-filter]").getBoundingClientRect().left, row: screen.querySelector("li.row .lines").getBoundingClientRect().left, list: screen.getBoundingClientRect().left }));
      check(edges.filter - edges.list >= 12, "the filter starts " + (edges.filter - edges.list) + " px from the pane's edge");
      const choice = page.getByTestId("done-filter").getByRole("button").nth(1);
      const name = (await choice.getAttribute("aria-label")) ?? "";
      await choice.click();
      await page.waitForFunction(() => location.hash.startsWith("#/done?agent="));
      const hash = new URL(page.url()).hash;
      await page.reload();
      await page.getByTestId("freshness-line").filter({ hasText: /^실시간$/ }).waitFor({ timeout: 10_000 });
      check(new URL(page.url()).hash === hash, "the reload lost the filter: " + new URL(page.url()).hash);
      const pressed = (await page.getByTestId("done-filter").locator('[aria-pressed="true"]').getAttribute("aria-label")) ?? "";
      check(pressed === name, "after the reload the filter is " + pressed + ", not " + name);
      const rows = await page.getByTestId("screen-done").getByRole("list", { name: "완료", exact: true }).locator(":scope > li").count();
      check(name.endsWith(" " + rows), "the choice " + name + " lists " + rows);
      const doneLatest = (await page.getByTestId("done-latest").innerText()).trim();
      const agent = new URLSearchParams(hash.split("?")[1]).get("agent");
      await openApp(page, "#/agents/" + agent);
      const agentLatest = (await page.getByTestId("agent-latest").innerText()).trim();
      check(doneLatest === agentLatest, "완료 says " + doneLatest + ", the agent screen " + agentLatest);
      const stored = await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length);
      check(stored === 0, "the page keeps " + stored + " keys in web storage");
      return hash + ": " + name + "; " + doneLatest;
    });
    await step("a running card's to-dos: a thin bar and the count on a wide window, in the detail only on a phone", async () => {
      await openApp(page, "#/running");
      const bars = await page.getByTestId("screen-running").getByTestId("progress").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));
      check(JSON.stringify(bars) === JSON.stringify(wide ? ["할 일 1/3", "할 일 0/1"] : []), "the home's bars read " + JSON.stringify(bars));
      await openApp(page, "#/cards/k-101");
      const head = (await page.locator(".detail-head [data-testid=progress] .progress-count").innerText()).trim();
      check(head === "할 일 1/3", "the detail head's bar reads " + head);
      return (wide ? bars.join(", ") : "no bar on the phone home") + "; detail " + head;
    });
    await step("the run's own timeline: rounds newest first with their span and outcome; sentences bright, tools dim, raw text left out", async () => {
      await openApp(page, "#/cards/k-101");
      const timeline = page.getByTestId("timeline");
      await timeline.waitFor();
      const heads = await page.locator(".detail > .box > .box-head").allInnerTexts();
      check(heads.slice(-2).join(",") === "기록,댓글", "the timeline is not between the boxes and the comments: " + heads.join(", "));
      const blocks = timeline.getByTestId("timeline-block");
      const outcomes = await blocks.evaluateAll((items) => items.map((item) => item.getAttribute("data-outcome")));
      check(JSON.stringify(outcomes) === JSON.stringify(["going", "comment", "rejected", "comment", "ended"]), "the blocks read " + JSON.stringify(outcomes));
      const titles = await timeline.locator(".timeline-head").allInnerTexts();
      check(/^라운드 3 · .* · 진행 중$/.test(titles[0]) && /^라운드 2 · .* · 검토 반려$/.test(titles[2]) && /^댓글 · /.test(titles[3]) && /^라운드 1 · (어제 )?\d\d:\d\d · 작업 마침$/.test(titles[4]) && !titles.some((title) => title.includes(" –") || title.startsWith("–")), "the heads read " + JSON.stringify(titles));
      const rows = await blocks.first().locator(".timeline-row").evaluateAll((items) =>
        items.map((item) => ({ kind: item.getAttribute("data-kind"), text: item.textContent.trim(), colour: getComputedStyle(item).color })),
      );
      const label = await page.locator(".detail-title").evaluate((title) => getComputedStyle(title).color);
      check(rows.map((row) => row.text).join(" | ") === "변경마다 한 줄 요약을 붙이는 중 | 도구 사용 4번 | 요약을 표로 옮기는 중 ×3", "the going round reads " + rows.map((row) => row.text).join(" | "));
      check(rows[0].colour === label && rows[1].colour !== label && rows[2].colour === label, "sentence and dim colours " + JSON.stringify(rows.map((row) => row.colour)) + ", label " + label);
      const noStart = (await blocks.nth(4).getByTestId("timeline-no-start").innerText()).trim();
      check(noStart === "시작 기록 없음", "the start-unknown round reads " + noStart);
      const text = await timeline.innerText();
      check(!/Running|npm|packages|run 3|3f2a1c9/.test(text) && !text.includes("가린 문장"), "raw text or a placeholder in the timeline: " + text.slice(0, 160));
      return outcomes.join(" → ") + "; " + titles.join(" | ");
    });
    await step("a worker run a card started opens from its round's head by keyboard, with its timeline, though the board does not list it", async () => {
      await page.getByTestId("timeline-link").first().focus();
      await page.keyboard.press("Enter");
      await settled(page);
      await page.getByTestId("screen-run").waitFor();
      await page.getByTestId("screen-run").getByTestId("timeline").waitFor();
      const title = (await page.locator(".detail-title").first().innerText()).trim();
      check(title === "코드 작업", "the run page is named " + title);
      return new URL(page.url()).hash + " " + title;
    });
    await step("a stopped writer: one 요약 멈춤 line beside the freshness line", async () => {
      await openApp(page, "#/running", "&writer=stopped");
      const lines = await page.getByTestId("summaries-stopped").allInnerTexts();
      check(lines.length === 1 && lines[0].trim() === "· 요약 멈춤", "the line reads " + JSON.stringify(lines));
      const row = page.getByTestId("screen-running").locator('li:has(> a[href="#/cards/k-102"])');
      check((await row.locator(".title.is-kind").innerText()).trim() === "코드 작업", "the card with no checked lines is not named by its kind");
      if (!wide) await phoneRules(page, "summaries stopped @390");
      return lines[0].trim();
    });
  },

  async "notifications-push"(page, step) {
    const width = page.viewportSize().width;
    const viewport = page.viewportSize();
    const origin = new URL(readState().url).origin;
    const shots = path.join(evidenceRoot, "notifications-push");
    const bell = (where) => where.getByRole("button", { name: /^알림/ });
    const row = (where) => where.getByRole("dialog", { name: "알림" }).getByTestId("push-row");
    const pushSwitch = (where) => row(where).getByRole("switch", { name: "알림 받기" });
    // Opens the bell and reads the row once it has left its loading state.
    const readRow = async (where) => {
      await bell(where).click();
      await row(where).waitFor({ timeout: 10_000 });
      return row(where).evaluate((element) => ({
        state: element.dataset.state,
        line: element.querySelector("[data-testid=push-line]")?.textContent ?? null,
        error: element.querySelector("[data-testid=push-error]")?.textContent ?? null,
        switches: element.querySelectorAll("[role=switch]").length,
        checked: element.querySelector("[role=switch]")?.getAttribute("aria-checked") ?? null,
      }));
    };
    const shot = async (where, state) => {
      mkdirSync(shots, { recursive: true });
      await where.screenshot({ path: path.join(shots, "notifications-push-" + state + "-" + width + ".png"), fullPage: true, animations: "disabled" });
    };
    // Notifications need a full Chromium (the headless shell denies them); it also answers a permission prompt with denied.
    const chromium = await loadChromium();
    const full = await chromium.launch({ channel: "chromium" });
    const open = async (options = {}, hash = "#/inbox", query = "") => {
      const context = await full.newContext({ baseURL: origin, viewport, deviceScaleFactor: 1, ...options });
      const tab = await context.newPage();
      await openApp(tab, hash, query);
      return { context, tab };
    };
    const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    try {
      await step("push off in the core: one line, no switch", async () => {
        const { context, tab } = await open({}, "#/inbox", "&push=off");
        const seen = await readRow(tab);
        check(seen.state === "off" && seen.line === "푸시 설정 안 됨" && seen.switches === 0, "the row is " + JSON.stringify(seen));
        await shot(tab, "off");
        await context.close();
        return seen.line;
      });
      await step("iPhone Safari outside the Home Screen: how to add it, no switch", async () => {
        const { context, tab } = await open({ userAgent: IPHONE });
        const seen = await readRow(tab);
        check(seen.state === "home" && seen.line === "공유 › 홈 화면에 추가 후 켤 수 있음" && seen.switches === 0, "the row is " + JSON.stringify(seen));
        await shot(tab, "home");
        await context.close();
        return seen.line;
      });
      await step("the iPhone Home Screen app, and a desktop browser: the switch, off, and the page asked nothing on load", async () => {
        const seen = [];
        for (const options of [{ userAgent: IPHONE }, {}]) {
          const context = await full.newContext({ baseURL: origin, viewport, deviceScaleFactor: 1, ...options });
          await context.addInitScript((standalone) => {
            if (standalone) Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
            window.__asked = 0;
            const ask = Notification.requestPermission.bind(Notification);
            Notification.requestPermission = async (...args) => {
              window.__asked += 1;
              window.__answer = await ask(...args);
              return window.__answer;
            };
          }, Boolean(options.userAgent));
          const tab = await context.newPage();
          await openApp(tab, "#/inbox");
          const one = await readRow(tab);
          const asked = await tab.evaluate(() => window.__asked);
          check(one.state === "ready" && one.checked === "false" && one.line === null && asked === 0, (options.userAgent ? "Home Screen" : "desktop") + ": " + JSON.stringify(one) + ", asked " + asked);
          if (!options.userAgent) {
            await shot(tab, "ready");
            await pushSwitch(tab).click();
            await tab.waitForFunction(() => window.__answer !== undefined, null, { timeout: 5_000 }).catch(() => check(false, "the switch did not ask for permission"));
            const answer = await tab.evaluate(() => window.__answer);
            await tab.waitForFunction(() => !document.querySelector("[data-testid=push-switch]")?.disabled, null, { timeout: 5_000 });
            const after = await row(tab).getAttribute("data-state");
            const asks = await tab.evaluate(() => window.__asked);
            // The headless prompt is dismissed (default) or refused (denied); neither turns push on.
            check(asks === 1 && after === (answer === "denied" ? "blocked" : "ready"), "the prompt answered " + answer + " after " + asks + " ask(s) and the row is " + after);
            seen.push("desktop asked once from the switch, the prompt answered " + answer + " -> " + after);
          } else seen.push("Home Screen ready");
          await context.close();
        }
        return seen.join("; ");
      });
      await step("turning it on subscribes and the core keeps this device; off removes it and unsubscribes", async () => {
        const { context, tab } = await open({ permissions: ["notifications"] });
        const before = await readRow(tab);
        check(before.state === "ready", "the row is " + JSON.stringify(before));
        await pushSwitch(tab).click();
        await tab.waitForFunction(() => document.querySelector("[data-testid=push-row]")?.dataset.state === "on", null, { timeout: 5_000 }).catch(() => check(false, "the row did not turn on"));
        const core = await tab.evaluate(() => window.__linaPush);
        check(core.subscriptions.length === 1 && core.subscriptions[0].endpoint.startsWith("https://fcm.googleapis.com/"), "the core keeps " + JSON.stringify(core.subscriptions));
        check((await pushSwitch(tab).getAttribute("aria-checked")) === "true", "the switch is not on");
        await shot(tab, "on");
        await pushSwitch(tab).click();
        await tab.waitForFunction(() => document.querySelector("[data-testid=push-row]")?.dataset.state === "ready", null, { timeout: 5_000 }).catch(() => check(false, "the row did not turn off"));
        const after = await tab.evaluate(() => window.__linaPush);
        check(after.subscriptions.length === 0 && after.removes === 1, "after off the core keeps " + JSON.stringify(after));
        await context.close();
        return "on: " + core.subscriptions[0].endpoint.replace(/[^/]+$/, "…") + "; off: 0 kept, 1 removed";
      });
      await step("the service worker shows, replaces by tag and closes the core's messages", async () => {
        const { context, tab } = await open({ permissions: ["notifications"] });
        await tab.reload();
        await tab.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active), null, { timeout: 15_000 });
        const cdp = await context.newCDPSession(tab);
        const registration = new Promise((resolve) => cdp.on("ServiceWorker.workerRegistrationUpdated", (event) => event.registrations.length && resolve(event.registrations[0].registrationId)));
        await cdp.send("ServiceWorker.enable");
        const registrationId = await registration;
        const notes = () => tab.evaluate(async () => (await (await navigator.serviceWorker.getRegistration()).getNotifications()).map((note) => ({ tag: note.tag, title: note.title, body: note.body, data: note.data })));
        // waitForFunction takes a promise as truthy, so the notifications are read until they are the ones expected (5 s at most).
        const settle = async (done) => {
          for (let tries = 0; tries < 50 && !done(await notes()); tries += 1) await tab.waitForTimeout(100);
          return notes();
        };
        const push = async (message, done) => {
          await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId, data: JSON.stringify(message) });
          return settle(done);
        };
        const scene = await tab.evaluate(() => window.__linaScene);
        const key = scene.board.notices.find((notice) => !notice.read).key;
        const ask = { v: 1, type: "show", tag: key, kind: "ask", target: "T2", at: 0, title: "배포 순서 정하기", body: "오늘 저녁에 배포할까요?" };
        let seen = await push(ask, (all) => all.length === 1);
        check(seen.length === 1 && seen[0].title === ask.title && seen[0].body === "결정 필요\n" + ask.body && seen[0].tag === key, "after show: " + JSON.stringify(seen));
        seen = await push({ ...ask, body: "src/app.tsx 고쳤어요" }, (all) => all.length === 1 && all[0].body === "결정 필요");
        check(seen.length === 1 && seen[0].body === "결정 필요", "the same tag again did not replace it with the kind line only: " + JSON.stringify(seen));
        seen = await push({ v: 1, type: "show", tag: "reply:T4:n1", kind: "reply", target: "T4", at: 0, title: "입력 폼 정리", body: "간격 맞췄어요." }, (all) => all.length === 2);
        check(seen.length === 2, "a second item did not get its own notification: " + JSON.stringify(seen));
        seen = await push({ v: 1, type: "close", tag: "reply:T4:n1" }, (all) => all.length === 1);
        check(seen.length === 1 && seen[0].tag === key, "close left " + JSON.stringify(seen));
        seen = await push({ v: 1, type: "close", tag: "question:k-102:7" }, (all) => all.length !== 1);
        check(seen.length === 1, "a close with nothing to close changed " + JSON.stringify(seen));
        const unread = scene.board.notices.filter((notice) => !notice.read).map((notice) => notice.key);
        for (const [index, tag] of unread.entries()) seen = await push({ ...ask, tag }, (all) => all.length === index + 1);
        check(seen.length === unread.length, "one notification per unread notice: " + seen.length + " of " + unread.length);
        await bell(tab).click();
        await tab.getByRole("dialog", { name: "알림" }).locator("a[href]").filter({ has: tab.locator(".notice-dot.is-unread") }).first().click();
        await tab.waitForFunction((count) => window.__linaScene.board.notices.filter((notice) => !notice.read).length === count, unread.length - 1, { timeout: 5_000 });
        const left = (await tab.evaluate(() => window.__linaScene)).board.notices.filter((notice) => !notice.read).map((notice) => notice.key).sort();
        seen = await settle((all) => all.length === left.length);
        check(JSON.stringify(seen.map((note) => note.tag).sort()) === JSON.stringify(left), "after reading one notice the device shows " + JSON.stringify(seen.map((note) => note.tag)) + ", the unread are " + JSON.stringify(left));
        await cdp.detach();
        await context.close();
        return "show, replace by tag, a second tag, close, an empty close, and the read mark closing it here";
      });
      await step("choosing a notification takes the open window to the item, as the bell does", async () => {
        const { context, tab } = await open({ permissions: ["notifications"] }, "#/due");
        await tab.reload();
        await tab.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active), null, { timeout: 15_000 });
        const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
        const routes = [];
        for (const [kind, target, hash] of [["ask", "T2", "#/inbox"], ["reply", "T4", "#/items/T4"], ["blocked", "k-101", "#/cards/k-101"]]) {
          // A notification the worker drew, then a click on it; a click sent from a script may not focus, so only the route is read.
          await worker.evaluate(async ({ kind, target }) => {
            await self.registration.showNotification("항목", { tag: kind + ":" + target, body: "", data: { kind, target } });
            const [note] = await self.registration.getNotifications({ tag: kind + ":" + target });
            self.dispatchEvent(new NotificationEvent("notificationclick", { notification: note }));
          }, { kind, target });
          await tab.waitForFunction((hash) => location.hash === hash, hash, { timeout: 5_000 }).catch(() => check(false, kind + " opened " + new URL(tab.url()).hash + ", not " + hash));
          routes.push(kind + " -> " + hash);
        }
        await context.close();
        return routes.join(", ");
      });
      await step("opening a reply read-marks it once on the synthetic core; a decision, a stopped card or a question does not", async () => {
        const { context, tab } = await open({ permissions: ["notifications"] }, "#/due");
        await tab.reload();
        await tab.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active), null, { timeout: 15_000 });
        const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
        // A successful read mark is what asks this device to close the tag; the synthetic core accepted the key.
        await worker.evaluate(() => {
          self.__closes = [];
          self.addEventListener("message", (event) => {
            if (event.data && event.data.type === "lina-close") self.__closes.push(event.data);
          });
        });
        const click = async (kind, target, tag) => {
          await worker.evaluate(
            async ({ kind, target, tag }) => {
              await self.registration.showNotification("항목", { tag, body: "", data: { kind, target } });
              const [note] = await self.registration.getNotifications({ tag });
              self.dispatchEvent(new NotificationEvent("notificationclick", { notification: note }));
            },
            { kind, target, tag },
          );
        };
        const closes = () => worker.evaluate(() => self.__closes);
        await click("reply", "T4", "reply:T4:n1");
        await tab.waitForFunction(() => location.hash === "#/items/T4", null, { timeout: 5_000 }).catch(() => check(false, "the reply opened " + new URL(tab.url()).hash));
        let seen = [];
        for (let tries = 0; tries < 50; tries += 1) {
          seen = await closes();
          if (seen.some((message) => (message.tags || []).includes("reply:T4:n1"))) break;
          await tab.waitForTimeout(100);
        }
        check(seen.length === 1 && JSON.stringify(seen[0].tags) === JSON.stringify(["reply:T4:n1"]), "the reply's read mark closed " + JSON.stringify(seen));
        for (const [kind, target, tag, hash] of [
          ["ask", "T2", "ask:T2:1", "#/inbox"],
          ["blocked", "k-101", "blocked:k-101", "#/cards/k-101"],
          ["question", "k-102", "question:k-102:7", "#/cards/k-102"],
        ]) {
          await click(kind, target, tag);
          await tab.waitForFunction((hash) => location.hash === hash, hash, { timeout: 5_000 }).catch(() => check(false, kind + " opened " + new URL(tab.url()).hash));
        }
        await tab.waitForTimeout(1000);
        seen = await closes();
        check(seen.length === 1 && JSON.stringify(seen[0].tags) === JSON.stringify(["reply:T4:n1"]), "a decision, a stopped card or a question read-marked " + JSON.stringify(seen));
        await context.close();
        return "reply:T4:n1 read once; ask, blocked and question sent nothing";
      });
    } finally {
      await full.close();
    }
    await step("on this page (the drive's own browser) the bell carries the row", async () => {
      await openApp(page, "#/inbox", "&push=off");
      const seen = await readRow(page);
      check(seen.state === "off", "the row is " + JSON.stringify(seen));
      return "row " + seen.state + "; state shots in " + path.relative(repo, shots);
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
