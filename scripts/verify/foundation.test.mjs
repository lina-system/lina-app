// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { classify, components } from './scope.mjs';
import { verify } from './flutter.mjs';

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
    'scripts/design-study/unreviewed.mjs',
    'docs/research/90-accent/hidden.py',
    'docs/research/90-accent/fonts/hidden.mjs',
    'docs/research/90-accent/renders/hidden.dart',
    'docs/research/91-unknown/study.json',
  ]) assert.throws(() => classify([path]), /unmapped/, path);
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
