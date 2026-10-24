// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
if (process.platform !== 'darwin' || !['native', 'measure', 'flutter', 'measure-flutter', 'smoke-flutter'].includes(mode)) {
  throw new Error('On macOS: dv heavy -- node scripts/mac-panel.mjs native|flutter; node scripts/mac-panel.mjs measure|measure-flutter');
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
