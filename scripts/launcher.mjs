// SPDX-License-Identifier: Apache-2.0
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { consoleSessionState } from './verify/mac-session.mjs';
const root = process.cwd();
const app = resolve('packages/lina_app/build/macos/Build/Products/Release/LINA.app');
const mode = process.argv[2];
if (process.platform !== 'darwin' || !['smoke', 'evidence'].includes(mode)) throw Error('On macOS: node scripts/launcher.mjs smoke|evidence');
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw Error(`${command}: ${result.stderr || result.stdout}`);
  return result.stdout;
}
function start(command, args, env = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, LINA_CORE_ENDPOINT: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  done.finally(() => clearTimeout(timer));
  return { child, done, output: () => stdout, error: () => stderr, stop: async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await done;
  } };
}
async function waitFor(process, marker) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (process.output().includes(marker)) return;
    if (process.child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`Missing ${marker}: ${process.error()}`);
}
run('codesign', ['--verify', '--deep', '--strict', app]);
mkdirSync('build', { recursive: true });
let fixture;
try {
  if (mode === 'evidence') {
    const session = JSON.parse(run('python3', ['-c', `import plistlib,subprocess,json
v=plistlib.loads(subprocess.check_output(['ioreg','-n','Root','-d1','-a']))
v=v if isinstance(v,list) else [v]
print(json.dumps([{'IOConsoleUsers':[{k:u[k] for k in ('kCGSSessionOnConsoleKey','CGSSessionScreenIsLocked') if k in u} for u in r.get('IOConsoleUsers',[])]} for r in v]))`]));
    if (consoleSessionState(session).locked) throw Error('Evidence unverified: console locked; no GUI fixture launched');
    run('xcrun', ['swiftc', 'scripts/launcher-fixture.swift', '-o', 'build/launcher-fixture']);
    fixture = start(resolve('build/launcher-fixture'), []);
    await waitFor(fixture, 'LINA_FIXTURE_READY');
  }
  const launcher = start(`${app}/Contents/MacOS/LINA`, [`--launcher-${mode}`], fixture ? { LINA_FIXTURE_PID: String(fixture.child.pid) } : {});
  try {
    if (await launcher.done !== 0) throw Error(`Launcher failed: ${launcher.error()}`);
    const lines = launcher.output().split('\n');
    const ready = JSON.parse(lines.find(l => l.startsWith('LINA_LAUNCHER_READY '))?.slice('LINA_LAUNCHER_READY '.length) ?? 'null');
    if (!ready?.ready || ready.visible || ready.activationPolicy !== 1 || !ready.uiElement || ready.loginItem !== 'disabledInTests') throw Error('Hidden prewarm or test login guard failed');
    if (mode === 'evidence') {
      const evidence = JSON.parse(lines.find(l => l.startsWith('LINA_EVIDENCE '))?.slice('LINA_EVIDENCE '.length) ?? 'null');
      if (evidence?.samples?.length !== 4 || !evidence.firstFrameReady || evidence.samples.some(s => s.frontmostPID !== fixture.child.pid || s.appActive) ||
          !evidence.samples[1].panelKey || !evidence.samples[2].panelKey || evidence.samples[2].query !== 'abc' || evidence.samples[3].visible) {
        throw Error(`Focus/typing/dismissal failed: ${JSON.stringify(evidence)}`);
      }
      const capture = lines.find(l => l.startsWith('LINA_CAPTURE '))?.slice('LINA_CAPTURE '.length);
      if (!capture) throw Error('Own-window compositor capture missing');
      mkdirSync('docs/captures/31', { recursive: true });
      writeFileSync('docs/captures/31/launcher.png', Buffer.from(capture, 'base64'));
      writeFileSync('docs/captures/31/focus.json', JSON.stringify({ ...evidence, collectedAt: new Date().toISOString(),
        os: run('sw_vers', ['-productVersion']).trim(), sourceRevision: run('git', ['rev-parse', 'HEAD']).trim(),
        dirty: run('git', ['status', '--porcelain']).length > 0, signing: 'ad-hoc, codesign --verify --deep --strict passed',
        physicalShortcut: 'not exercised by this fixture; see Safari acceptance',
      }, null, 2) + '\n');
    }
    console.log(`PASS: launcher ${mode}; hidden rasterized frame ready, login changes disabled${fixture ? ', fixture PID unchanged across show/type/Esc' : ''}`);
  } finally { await launcher.stop(); }
} finally { if (fixture) await fixture.stop(); }
