// SPDX-License-Identifier: Apache-2.0
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyVisibleEvidence } from './mac-panel-evidence.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spike = resolve(root, 'spikes/mac-panel');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: spike, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL', ...options });
  if (result.status !== 0 || result.error) throw new Error(`${command}: ${result.stderr || result.error || result.stdout}`);
  return result.stdout;
}
function extractMetrics(output) {
  const line = output.split('\n').find(line => line.startsWith('LINA_PANEL_METRICS '));
  if (!line) throw new Error('No measurement returned; this run is unverified');
  return JSON.stringify(JSON.parse(line.slice('LINA_PANEL_METRICS '.length)), null, 2);
}
const mode = process.argv[2];
if (process.platform !== 'darwin' || !['native', 'permissions', 'measure', 'flutter', 'measure-flutter', 'smoke-flutter', 'fixture', 'measure-visible', 'measure-visible-local'].includes(mode)) {
  throw new Error('On macOS: dv heavy -- node scripts/mac-panel.mjs native|flutter; node scripts/mac-panel.mjs measure|measure-flutter|measure-visible-local|measure-visible|fixture|permissions|smoke-flutter');
}
const bundle = resolve(root, 'build/mac-panel-native/PanelNative.app');
if (mode === 'native') {
  // Per-process fallback only: never change xcode-select or accept a license.
  const env = { ...process.env, DEVELOPER_DIR: '/Library/Developer/CommandLineTools' };
  console.log(run('swift', ['build', '--build-system', 'native', '-c', 'release', '-j', '2'], { env }));
  const bin = run('swift', ['build', '--build-system', 'native', '-c', 'release', '--show-bin-path'], { env }).trim();
  mkdirSync(`${bundle}/Contents/MacOS`, { recursive: true });
  copyFileSync(`${bin}/mac-panel-native`, `${bundle}/Contents/MacOS/mac-panel-native`);
  writeFileSync(`${bundle}/Contents/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>mac-panel-native</string>
<key>CFBundleIdentifier</key><string>org.lina.spike.native</string><key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/></dict></plist>\n`);
  run('codesign', ['--force', '--sign', '-', bundle]);
  run('codesign', ['--verify', '--strict', bundle]);
  console.log(run(`${bundle}/Contents/MacOS/mac-panel-native`, ['--self-test']));
} else if (mode === 'fixture' || mode === 'measure-visible' || mode === 'measure-visible-local') {
  const state = run('/usr/sbin/ioreg', ['-l', '-d', '1']);
  if (!/"IOConsoleLocked" = No/.test(state)) throw new Error('Visible-latency collection refused: screen locked or state unknown');
  if (mode === 'fixture') {
    run('codesign', ['--verify', '--strict', bundle]);
    run(`${bundle}/Contents/MacOS/mac-panel-native`, ['--fixture'], { stdio: 'inherit', timeout: 185_000 });
  } else {
    const app = `${spike}/build/macos/Build/Products/Release/mac_panel.app`;
    run('codesign', ['--verify', '--deep', '--strict', app]);
    let result;
    let parseError;
    let errors = '';
    const child = spawn(`${app}/Contents/MacOS/mac_panel`, [], { cwd: spike, env: {
      ...process.env, LINA_PANEL_VISIBLE: '1',
      LINA_PANEL_LOCAL_STIMULUS: mode === 'measure-visible-local' ? '1' : '0',
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), 190_000);
    let pending = '';
    child.stdout.on('data', data => {
      pending += data.toString();
      if (pending.length > 16 * 1024 * 1024) { child.kill('SIGKILL'); return; }
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.startsWith('LINA_VISIBLE_METRICS ')) {
          try { result = JSON.parse(line.slice('LINA_VISIBLE_METRICS '.length)); }
          catch (error) { parseError = error; child.kill('SIGKILL'); }
        } else if (line.startsWith('LINA_VISIBLE_')) console.log(line);
      }
    });
    child.stderr.on('data', data => { errors = (errors + data.toString()).slice(-32_768); });
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    }).finally(() => clearTimeout(timer));
    if (parseError || code !== 0 || result?.status !== 'measured' || result.samples?.length !== 10) {
      throw new Error(`Visible-latency collection incomplete; no passing evidence written. ${errors}`);
    }
    const evidence = resolve(root, 'docs/research/captures/mac-panel');
    mkdirSync(evidence, { recursive: true });
    for (const sample of result.samples) {
      const filename = `visible-frame-${String(sample.trial).padStart(2, '0')}.png`;
      const bytes = Buffer.from(sample.framePngBase64, 'base64');
      writeFileSync(`${evidence}/${filename}`, bytes);
      sample.frame = filename;
      sample.frameSha256 = createHash('sha256').update(bytes).digest('hex');
      delete sample.framePngBase64;
    }
    const times = result.samples.map(sample => sample.shortcutToVisibleMs).sort((a, b) => a - b);
    result.summary = { count: times.length, medianMs: (times[4] + times[5]) / 2, p90Ms: times[8] };
    result.stimulus = mode === 'measure-visible-local'
      ? 'CUA native Control+Option+Space keyDown in the foreground same-process fixture; AppKit shortcut route'
      : 'Registered macOS Carbon Control+Option+Space event; key chord supplied outside the collector';
    result.backgroundGlobalHotkeyLatency = mode === 'measure-visible-local' ? 'unverified' : 'measured';
    result.artifactExecutableSha256 = createHash('sha256').update(readFileSync(`${app}/Contents/MacOS/mac_panel`)).digest('hex');
    result.artifactDartSha256 = createHash('sha256').update(readFileSync(`${app}/Contents/Frameworks/App.framework/Versions/A/App`)).digest('hex');
    result.collectedAt = new Date().toISOString();
    verifyVisibleEvidence(result, new URL('../docs/research/captures/mac-panel/', import.meta.url));
    writeFileSync(`${evidence}/visible-latency.json`, JSON.stringify(result, null, 2) + '\n');
    copyFileSync(`${evidence}/visible-frame-01.png`, resolve(root, 'docs/captures/LA-89/shortcut-visible.png'));
    console.log(JSON.stringify({ status: result.status, summary: result.summary, evidence: 'docs/research/captures/mac-panel/visible-latency.json' }));
  }
} else if (mode === 'permissions') {
  run('codesign', ['--verify', '--strict', bundle]);
  console.log(run(`${bundle}/Contents/MacOS/mac-panel-native`, ['--preflight']).trim());
} else if (mode === 'measure' || mode === 'measure-flutter' || mode === 'smoke-flutter') {
  // Fail closed when the lock state cannot be established. Never unlock.
  const state = run('/usr/sbin/ioreg', ['-l', '-d', '1']);
  if (mode !== 'smoke-flutter' && !/"IOConsoleLocked" = No/.test(state)) throw new Error('GUI measurement unverified: screen locked or state unknown');
  if (mode === 'measure') {
    run('codesign', ['--verify', '--strict', bundle]);
    const output = run(`${bundle}/Contents/MacOS/mac-panel-native`, ['--measure'], { timeout: 20_000 });
    console.log(extractMetrics(output));
  } else {
    const app = `${spike}/build/macos/Build/Products/Release/mac_panel.app`;
    run('codesign', ['--verify', '--deep', '--strict', app]);
    const output = run(`${app}/Contents/MacOS/mac_panel`, [], { timeout: 30_000, env: {
      ...process.env, [mode === 'smoke-flutter' ? 'LINA_PANEL_SMOKE' : 'LINA_PANEL_MEASURE']: '1',
    } });
    if (mode === 'smoke-flutter') {
      if (!output.includes('LINA_PANEL_SMOKE ready')) throw new Error('Flutter first-frame/platform-channel handshake did not complete');
      console.log('PASS: hidden Flutter first frame and platform channel ready');
    } else console.log(extractMetrics(output));
  }
} else {
  run('xcodebuild', ['-checkFirstLaunchStatus']);
  console.log(run('flutter', ['pub', 'get', '--enforce-lockfile']));
  console.log(run('flutter', ['build', 'macos', '--release', '--no-pub']));
  const app = `${spike}/build/macos/Build/Products/Release/mac_panel.app`;
  // Explicit entitlements prevent an ad-hoc re-sign from dropping the sandbox.
  run('codesign', ['--force', '--sign', '-', '--entitlements', `${spike}/macos/Runner/Release.entitlements`, app]);
  run('codesign', ['--verify', '--deep', '--strict', app]);
  const entitlements = run('codesign', ['--display', '--entitlements', '-', '--xml', app]);
  if (!/<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\s*\/>/.test(entitlements)) {
    throw new Error('Signed Flutter release lost its App Sandbox entitlement');
  }
}
