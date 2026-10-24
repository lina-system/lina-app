// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { test } from 'node:test';
import { classify, components } from './scope.mjs';
import { execute, verify } from './flutter.mjs';

test('mac panel spike is checked as a package and evidence cannot hide code', () => {
  assert.deepEqual(classify(['spikes/mac-panel/pubspec.yaml']), ['mac_panel']);
  assert.doesNotThrow(() => classify(['docs/research/captures/mac-panel/native-measurement.json']));
  assert.throws(() => classify(['spikes/unknown/lib/main.dart']), /unmapped/);
  assert.throws(() => classify(['docs/research/captures/mac-panel/hidden.swift']), /unmapped/);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'lina-foundation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, data) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), data);
  };
  put('.flutter-version', '3.47.8\n');
  put('release/manifest.json', JSON.stringify({ flutter: { version: '3.47.8', channel: 'stable' }, targets: ['ios', 'android', 'macos', 'windows', 'linux'] }));
  const checks = ['theme', 'visual-values', 'protocol'].map(id => ({ id, status: 'deferred', owner: '#5', outputs: [`generated/${id}/`] }));
  const configure = check => {
    const entries = check ? checks.map(c => c.id === check.id ? check : c) : checks;
    put('scripts/verify/generators.json', JSON.stringify({ checks: entries }));
  };
  configure();
  put('packages/foundation_tools/pubspec.yaml', 'name: foundation_tools\n');
  put('packages/foundation_tools/pubspec.lock', 'locked\n');
  put('packages/foundation_tools/test/policy_test.dart', '// test\n');
  const files = ['.flutter-version', 'release/manifest.json', 'scripts/verify/generators.json', 'packages/foundation_tools/pubspec.yaml', 'packages/foundation_tools/pubspec.lock', 'packages/foundation_tools/test/policy_test.dart'];
  const calls = [];
  const run = (command, args, cwd) => {
    calls.push({ command, args, cwd });
    if (args.includes('--version')) return JSON.stringify({ frameworkVersion: '3.47.8', channel: 'stable', dartSdkVersion: '3.13.7' });
    return '';
  };
  return { root, put, files, run, calls, configure };
}

test('app and design fail before registration; unknown package paths always fail', () => {
  for (const path of ['packages/lina_app/lib/main.dart', 'packages/lina_design/lib/theme.dart']) {
    assert.throws(() => classify([path], []), /unmapped/);
    assert.doesNotThrow(() => classify([path], components));
  }
  assert.throws(() => classify(['packages/forgotten/pubspec.yaml']), /unmapped/);
  assert.throws(() => classify(['docs/policy/hidden.dart']), /unmapped/);
});

test('benchmark and design-study registrations admit their files but no hidden executables', () => {
  for (const path of [
    'scripts/benchmarks/launcher_baseline.py',
    'scripts/benchmarks/tests/test_launcher_baseline.py',
    'scripts/benchmarks/probe/main.swift',
    'scripts/benchmarks/probe/Recorder.swift',
    'scripts/benchmarks/probe/RecorderModel.swift',
    'scripts/benchmarks/probe/tests/main.swift',
    'scripts/benchmarks/probe/tests/run.sh',
    'scripts/benchmarks/probe_trials.py',
    'scripts/benchmarks/tests/test_probe_trials.py',
    'scripts/benchmarks/probe/build.sh',
    'scripts/benchmarks/probe/sign.sh',
    'scripts/benchmarks/probe/run.sh',
    'docs/research/launcher-baseline-template.csv',
    'scripts/design-study/package.json',
    'scripts/design-study/package-lock.json',
    'scripts/design-study/render.mjs',
    'scripts/design-study/study.mjs',
    'scripts/design-study/study.test.mjs',
    'docs/research/90-accent/study.json',
    'docs/research/90-accent/README.md',
    'docs/research/90-accent/fonts/OFL.txt',
    'docs/research/90-accent/fonts/Pretendard-Regular.otf',
    'docs/research/90-accent/fonts/Pretendard-Bold.otf',
    'docs/research/90-accent/icons/identity.svg',
    'docs/research/90-accent/marks/lina-warm-40.svg',
    'docs/research/90-accent/renders/a-cobalt-light.svg',
  ]) assert.doesNotThrow(() => classify([path]), path);
  for (const path of [
    'scripts/benchmarks/unreviewed.py',
    'scripts/benchmarks/probe/hidden.swift',
    'scripts/design-study/unreviewed.mjs',
    'docs/research/90-accent/hidden.py',
    'docs/research/90-accent/fonts/hidden.mjs',
    'docs/research/90-accent/renders/hidden.dart',
    'docs/research/91-unknown/study.json',
  ]) assert.throws(() => classify([path]), /unmapped/, path);
});

test('research spike and evidence are registered without allowing executable docs', () => {
  assert.deepEqual(classify(['spikes/korean-input/lib/main.dart']), ['korean_input']);
  assert.doesNotThrow(() => classify([
    'docs/research/captures/korean-input/observations.json',
    'docs/research/captures/korean-input/linux-x11.gif',
    'docs/research/90-accent/renders/a-cobalt-light.svg',
    'scripts/design-study/study.test.mjs',
  ]));
  assert.throws(() => classify(['docs/research/captures/korean-input/hidden.dart']), /unmapped/);
  assert.throws(() => classify(['spikes/unknown/pubspec.yaml']), /unmapped/);
});

test('runs enforced install, dependency validation, analysis and tests with evidence', t => {
  const f = fixture(t);
  const evidence = verify(f);
  assert.equal(evidence.status, 'passed');
  assert.ok(f.calls.some(c => c.args.join(' ') === 'pub get --enforce-lockfile'));
  assert.ok(f.calls.some(c => c.args.join(' ') === 'analyze --no-pub'));
  assert.ok(f.calls.some(c => c.args.join(' ') === 'test --no-pub'));
  for (const id of ['dependencies', 'analyze:foundation_tools', 'test:foundation_tools']) {
    assert.equal(evidence.steps.find(s => s.id === id).status, 'passed');
  }
});

test('rejects a missing/untracked lockfile and a package without tests', t => {
  const f = fixture(t);
  assert.equal(verify({ ...f, files: f.files.filter(p => !p.endsWith('.lock')) }).status, 'failed');
  assert.equal(verify({ ...f, files: f.files.filter(p => !p.includes('/test/')) }).status, 'failed');
});

test('nested packages and local overrides cannot bypass package registration', t => {
  const f = fixture(t);
  f.put('packages/foundation_tools/example/pubspec.yaml', 'name: example\n');
  assert.equal(verify({ ...f, files: [...f.files, 'packages/foundation_tools/example/pubspec.yaml'] }).status, 'failed');
  f.put('packages/foundation_tools/pubspec_overrides.yaml', 'dependency_overrides: {}\n');
  assert.equal(verify(f).status, 'failed');
});

test('missing generator registrations and web release targets fail closed', t => {
  const f = fixture(t);
  f.put('scripts/verify/generators.json', '{"checks":[]}');
  assert.equal(verify(f).status, 'failed');
  f.configure();
  f.put('release/manifest.json', JSON.stringify({ flutter: { version: '3.47.8', channel: 'stable' }, targets: ['ios', 'android', 'macos', 'windows', 'linux', 'web'] }));
  assert.equal(verify(f).status, 'failed');
});

test('SDK mismatch and non-stable channel fail before package commands', t => {
  const f = fixture(t);
  for (const version of [{ frameworkVersion: '3.47.7', channel: 'stable' }, { frameworkVersion: '3.47.8', channel: 'beta' }]) {
    const evidence = verify({ ...f, run: () => JSON.stringify(version) });
    assert.equal(evidence.status, 'failed');
    assert.match(evidence.error, /SDK/);
  }
  f.put('release/manifest.json', JSON.stringify({ flutter: { version: '3.47.7', channel: 'stable' } }));
  assert.equal(verify(f).status, 'failed');
});

test('a successful install that mutates a lockfile still fails', t => {
  const f = fixture(t);
  const evidence = verify({ ...f, run: (cmd, args, cwd) => {
    if (args.includes('get')) f.put('packages/foundation_tools/pubspec.lock', 'changed\n');
    return f.run(cmd, args, cwd);
  } });
  assert.equal(evidence.status, 'failed');
  assert.match(evidence.error, /lockfile changed/);
});

test('install, validation, analysis and test errors retain failure evidence', t => {
  const f = fixture(t);
  for (const failOn of ['get', 'run', 'analyze', 'test']) {
    const evidence = verify({ ...f, run: (cmd, args, cwd) => {
      if (args.includes(failOn)) throw new Error(`deliberate ${failOn} failure`);
      return f.run(cmd, args, cwd);
    } });
    assert.equal(evidence.status, 'failed');
    assert.match(evidence.error, /deliberate/);
    assert.ok(evidence.steps.some(s => s.status === 'failed'));
  }
});

test('deferred codegen is explicit and refuses output before activation', t => {
  const f = fixture(t);
  f.configure({ id: 'theme', status: 'deferred', owner: '#5', outputs: ['packages/lina_design/lib/generated/'] });
  assert.equal(verify(f).steps.find(s => s.id === 'theme').status, 'deferred');
  f.put('packages/lina_design/lib/generated/theme.dart', '// generated');
  f.files.push('packages/lina_design/lib/generated/theme.dart');
  assert.equal(verify(f).status, 'failed');
});

test('active generation rejects missing pins, failure, and new or changed output', t => {
  const f = fixture(t);
  f.put('scripts/tokens.mjs', '// generator');
  f.files.push('scripts/tokens.mjs');
  const check = { id: 'theme', status: 'active', owner: '#5', generator: { name: 'tokens', version: '1.0.0', sha256: createHash('sha256').update('// generator').digest('hex') }, command: ['node', 'scripts/tokens.mjs', '--check'], outputs: ['packages/lina_design/lib/generated/'] };
  const config = () => f.configure(check);
  config();
  assert.equal(verify(f).status, 'passed');
  check.generator.version = '^1.0.0'; config();
  assert.equal(verify(f).status, 'failed');
  check.generator.version = '1.0.0'; config();
  f.put('scripts/tokens.mjs', '// edited generator');
  assert.equal(verify(f).status, 'failed');
  f.put('scripts/tokens.mjs', '// generator');
  assert.equal(verify({ ...f, run: (cmd, args, cwd) => {
    if (args.includes('scripts/tokens.mjs')) throw new Error('stale generated output');
    return f.run(cmd, args, cwd);
  } }).status, 'failed');
  const evidence = verify({ ...f, run: (cmd, args, cwd) => {
    if (args.includes('scripts/tokens.mjs')) f.put('packages/lina_design/lib/generated/new.dart', '// new');
    return f.run(cmd, args, cwd);
  } });
  assert.equal(evidence.status, 'failed');
  assert.match(evidence.error, /generated output changed/);
  assert.equal(readFileSync(join(f.root, 'packages/lina_design/lib/generated/new.dart'), 'utf8'), '// new');
});

function windowsSdk() {
  const dir = 'C:\\flutter\\bin';
  const files = new Set(['flutter.bat', 'dart.bat'].map(name => win32.join(dir, name)));
  return { dir, exists: path => files.has(path), add: name => files.add(win32.join(dir, name)) };
}

function fakeSpawn(reply = { status: 0, stdout: '', stderr: '' }) {
  const calls = [];
  return {
    calls,
    spawn: (command, args, options) => { calls.push({ command, args, options }); return { ...reply }; },
  };
}

test('win32 runs the Flutter batch launcher through cmd.exe', () => {
  const sdk = windowsSdk();
  const { calls, spawn } = fakeSpawn({ status: 0, stdout: '{"frameworkVersion":"3.47.8"}', stderr: '' });
  const env = { PATH: sdk.dir, PATHEXT: '.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
  const output = execute('flutter', ['--version', '--machine'], 'C:\\repo', { platform: 'win32', spawn, env, exists: sdk.exists });
  assert.equal(output, '{"frameworkVersion":"3.47.8"}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(calls[0].args, ['/d', '/s', '/c', `""${win32.join(sdk.dir, 'flutter.bat')}" "--version" "--machine""`]);
  assert.equal(calls[0].options.windowsVerbatimArguments, true);
  assert.equal(calls[0].options.cwd, 'C:\\repo');
  assert.equal(calls[0].options.env.CI, 'true');
  assert.equal(calls[0].options.env.FLUTTER_SUPPRESS_ANALYTICS, 'true');
});

test('win32 keeps spaces and cmd metacharacters inside one argument', () => {
  const sdk = windowsSdk();
  const { calls, spawn } = fakeSpawn({ status: 0, stdout: 'ok', stderr: '' });
  const args = ['a b', 'x & y', '100%PATH%', 'say "hi"', 'caret ^ here'];
  execute('dart', args, 'C:\\repo', { platform: 'win32', spawn, env: { PATH: sdk.dir, PATHEXT: '.BAT' }, exists: sdk.exists });
  const launcher = win32.join(sdk.dir, 'dart.bat');
  assert.deepEqual(calls[0].args, ['/d', '/s', '/c', `""${launcher}" "a b" "x & y" "100"^%"PATH"^%"" "say "^""hi"^""" "caret ^ here""`]);
});

test('win32 spawns executables without a shell', () => {
  const sdk = windowsSdk();
  sdk.add('git.exe');
  const { calls, spawn } = fakeSpawn({ status: 0, stdout: 'ok', stderr: '' });
  execute('git', ['status', '--porcelain'], 'C:\\repo', { platform: 'win32', spawn, env: { PATH: sdk.dir, PATHEXT: '.EXE;.BAT' }, exists: sdk.exists });
  assert.equal(calls[0].command, 'git');
  assert.deepEqual(calls[0].args, ['status', '--porcelain']);
  assert.equal(calls[0].options.windowsVerbatimArguments, undefined);
});

test('non-Windows keeps the command, arguments, environment and options unchanged', () => {
  const { calls, spawn } = fakeSpawn({ status: 0, stdout: 'ok', stderr: '' });
  assert.equal(execute('flutter', ['--version'], '/repo', { platform: 'linux', spawn, env: { PATH: '/bin', GIT_DIR: '/elsewhere', KEEP: '1' } }), 'ok');
  assert.deepEqual(calls, [{
    command: 'flutter',
    args: ['--version'],
    options: {
      cwd: '/repo',
      env: { PATH: '/bin', KEEP: '1', CI: 'true', PUB_HOSTED_URL: 'https://pub.dev', FLUTTER_SUPPRESS_ANALYTICS: 'true' },
      encoding: 'utf8',
      timeout: 600_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  }]);
});

test('win32 batch failures report the logical command and its output', () => {
  const sdk = windowsSdk();
  const { spawn } = fakeSpawn({ status: 1, stdout: 'out\n', stderr: 'boom\n' });
  assert.throws(
    () => execute('dart', ['run', 'bin/check.dart'], 'C:\\repo', { platform: 'win32', spawn, env: { PATH: sdk.dir, PATHEXT: '.BAT' }, exists: sdk.exists }),
    error => error.message === 'dart run bin/check.dart failed (1): \nout\nboom\n',
  );
});

test('win32 escaping leaves no metacharacter outside quotes', () => {
  const sdk = windowsSdk();
  const { calls, spawn } = fakeSpawn({ status: 0, stdout: 'ok', stderr: '' });
  const args = ['a&calc', 'a|calc', 'a<in', 'a>out', 'a^b', 'a%b%c', 'a"&calc&"b', 'a b'];
  execute('flutter', args, 'C:\\repo', { platform: 'win32', spawn, env: { PATH: sdk.dir, PATHEXT: '.BAT' }, exists: sdk.exists });
  const line = calls[0].args[3].slice(1, -1);
  let quoted = false;
  let bare = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (!quoted) bare += char === '^' ? line[++index] : char;
  }
  assert.equal(quoted, false);
  assert.equal(bare.replace(/ /g, '').replace(/[%"]/g, ''), '');
});

test('production launcher cannot lose its Swift generation gate', t => {
  const f = fixture(t);
  const path = 'packages/lina_app/macos/Runner/Launcher/LauncherPanel.swift';
  f.put(path, '// fixture'); f.files.push(path);
  assert.match(verify(f).error, /requires swift-theme/);
});
