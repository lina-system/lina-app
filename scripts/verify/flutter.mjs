// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, lstatSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { classify, components } from './scope.mjs';
import { findWindowsLauncher, windowsInvocation } from './launcher.mjs';

const exact = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const read = (root, path) => readFileSync(join(root, path), 'utf8');
const json = (root, path) => JSON.parse(read(root, path));
export function execute(command, args, cwd, { platform = process.platform, spawn = spawnSync, env: baseEnv = process.env, exists = existsSync } = {}) {
  const env = { ...baseEnv, CI: 'true', PUB_HOSTED_URL: 'https://pub.dev', FLUTTER_SUPPRESS_ANALYTICS: 'true' };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  const options = { cwd, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 * 1024 };
  const launcher = platform === 'win32' ? findWindowsLauncher(command, { env: baseEnv, exists }) : null;
  const invocation = launcher
    ? windowsInvocation(launcher, args, { comspec: env.ComSpec ?? env.COMSPEC ?? 'cmd.exe' })
    : { command, args };
  if (launcher) options.windowsVerbatimArguments = true;
  const result = spawn(invocation.command, invocation.args, options);
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status ?? result.signal}): ${result.error?.message ?? ''}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return result.stdout;
}
function safePath(root, path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.')) throw new Error(`unsafe path: ${path}`);
  const full = resolve(root, path);
  if (!full.startsWith(resolve(root) + sep)) throw new Error(`unsafe path: ${path}`);
  let current = root;
  for (const part of path.split('/').filter(Boolean)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`symlink is not allowed: ${path}`);
  }
  return full;
}
function snapshot(root, paths) {
  const result = {};
  function visit(path) {
    const full = safePath(root, path);
    if (!existsSync(full)) return;
    if (lstatSync(full).isDirectory()) {
      for (const name of readdirSync(full).sort()) visit(`${path.replace(/\/$/, '')}/${name}`);
    } else result[path] = createHash('sha256').update(readFileSync(full)).digest('hex');
  }
  paths.forEach(visit);
  return JSON.stringify(result);
}
export function verify({ root, files, trackedFiles = files, run = execute }) {
  const evidence = { schemaVersion: 1, status: 'failed', tools: {}, components: [], steps: [] };
  const step = (id, action) => {
    const started = Date.now();
    const entry = { id, status: 'failed' };
    evidence.steps.push(entry);
    try { const result = action(); entry.status = 'passed'; return result; }
    catch (error) { entry.error = error.message; throw error; }
    finally { entry.durationMs = Date.now() - started; }
  };
  const command = (id, cmd, args, cwd = root) => step(id, () => {
    const entry = evidence.steps.at(-1);
    entry.command = [cmd, ...args];
    entry.directory = cwd === root ? '.' : cwd.slice(root.length + 1);
    const output = run(cmd, args, cwd);
    entry.output = output;
    return output;
  });
  try {
    step('scope', () => { evidence.components = classify(files); });
    step('sdk', () => {
      const pin = read(root, '.flutter-version').trim();
      if (!/^\d+\.\d+\.\d+$/.test(pin)) throw new Error('Flutter SDK pin must be an exact stable version');
      const manifest = json(root, 'release/manifest.json');
      if (manifest.flutter?.version !== pin || manifest.flutter?.channel !== 'stable') throw new Error('release manifest and Flutter SDK pin disagree');
      if (JSON.stringify([...manifest.targets].sort()) !== JSON.stringify(['android', 'ios', 'linux', 'macos', 'windows'])) throw new Error('release targets must be the five native platforms; no web target');
      const observed = JSON.parse(run('flutter', ['--version', '--machine'], root));
      evidence.tools = { flutter: observed.frameworkVersion, channel: observed.channel, dart: observed.dartSdkVersion, node: process.versions.node };
      if (observed.frameworkVersion !== pin || observed.channel !== 'stable') throw new Error(`Flutter SDK mismatch: expected stable ${pin}, observed ${observed.channel} ${observed.frameworkVersion}`);
    });
    const packages = step('packages', () => {
      const found = files.filter(p => p.endsWith('/pubspec.yaml')).map(path => {
        const component = components.find(c => `${c.path}/pubspec.yaml` === path);
        if (!component) throw new Error(`unregistered Dart package: ${path}`);
        safePath(root, path);
        const lock = `${component.path}/pubspec.lock`;
        safePath(root, lock);
        if (!trackedFiles.includes(path) || !trackedFiles.includes(lock) || !existsSync(join(root, lock))) throw new Error(`missing committed manifest or lockfile: ${component.path}`);
        if (!files.some(p => p.startsWith(`${component.path}/test/`) && p.endsWith('_test.dart'))) throw new Error(`missing tests: ${component.path}`);
        if (existsSync(join(root, component.path, 'pubspec_overrides.yaml'))) throw new Error(`pubspec_overrides.yaml is forbidden: ${component.path}`);
        return component;
      });
      if (!found.some(c => c.name === 'foundation_tools')) throw new Error('foundation_tools package is required');
      return found;
    });
    const locks = packages.map(c => `${c.path}/pubspec.lock`);
    const beforeLocks = snapshot(root, locks);
    for (const c of packages) {
      command(`install:${c.name}`, 'flutter', ['pub', 'get', '--enforce-lockfile'], join(root, c.path));
      step(`lockfile:${c.name}`, () => { if (snapshot(root, locks) !== beforeLocks) throw new Error(`lockfile changed during install: ${c.name}`); });
    }
    command('dependencies', 'dart', ['run', 'bin/check_dependencies.dart', root, ...packages.map(c => c.path)], join(root, 'packages/foundation_tools'));
    const config = step('generator-policy', () => {
      const config = json(root, 'scripts/verify/generators.json');
      const ids = config.checks.map(c => c.id);
      if (new Set(ids).size !== ids.length || !['theme', 'visual-values', 'protocol'].every(id => ids.includes(id))) throw new Error('theme, visual-values and protocol checks must be registered exactly once');
      if (files.some(p => p.startsWith('packages/lina_app/macos/Runner/Launcher/')) && !ids.includes('swift-theme')) throw new Error('production launcher requires swift-theme registration');
      return config;
    });
    for (const check of config.checks) {
      if (!check.owner || !Array.isArray(check.outputs) || !check.outputs.length) throw new Error(`incomplete generator registration: ${check.id}`);
      const before = snapshot(root, check.outputs);
      if (check.status === 'deferred') {
        if (before !== '{}') throw new Error(`${check.id}: output exists before its check is activated (${check.owner})`);
        evidence.steps.push({ id: check.id, status: 'deferred', owner: check.owner, reason: 'Implementation belongs to the owning issue; no output exists yet.' });
        continue;
      }
      step(`pin:${check.id}`, () => {
        if (check.status !== 'active' || !exact.test(check.generator?.version) || !check.generator?.name || !Array.isArray(check.command) || check.command.length < 2 || !check.command.every(s => typeof s === 'string') || !['node', 'dart'].includes(check.command[0])) throw new Error(`invalid generator pin or command: ${check.id}`);
        const script = check.command[0] === 'dart' && check.command[1] === 'run' ? check.command[2] : check.command[1];
        const full = safePath(root, script);
        if (!trackedFiles.includes(script) || createHash('sha256').update(readFileSync(full)).digest('hex') !== check.generator.sha256) throw new Error(`generator source pin mismatch: ${check.id}`);
      });
      command(check.id, check.command[0], check.command.slice(1));
      step(`drift:${check.id}`, () => { if (snapshot(root, check.outputs) !== before) throw new Error(`generated output changed: ${check.id}; commit regenerated files`); });
    }
    for (const c of packages) {
      command(`analyze:${c.name}`, 'flutter', ['analyze', '--no-pub'], join(root, c.path));
      command(`test:${c.name}`, 'flutter', ['test', '--no-pub'], join(root, c.path));
    }
    step('lockfiles-final', () => { if (snapshot(root, locks) !== beforeLocks) throw new Error('lockfile changed during verification'); });
    evidence.status = 'passed';
  } catch (error) { evidence.error = error.message; }
  return evidence;
}
