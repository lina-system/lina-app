// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, verify } from './verify/flutter.mjs';

export function foundation(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const started = new Date().toISOString();
  let evidence;
  try {
    const trackedFiles = execute('git', ['ls-files', '-z'], root).split('\0').filter(Boolean);
    const untracked = execute('git', ['ls-files', '--others', '--exclude-standard', '-z'], root).split('\0').filter(Boolean);
    const changed = execute('git', ['diff', '--name-only', '-z', 'HEAD'], root).split('\0').filter(Boolean);
    const files = [...new Set([...trackedFiles, ...untracked, ...changed])].sort();
    const head = execute('git', ['rev-parse', 'HEAD'], root).trim();
    const dirty = execute('git', ['status', '--porcelain'], root).trim() !== '';
    evidence = { ...verify({ root, files, trackedFiles }), head, dirty, started };
    if (evidence.status === 'passed') {
      execute('git', ['diff', '--check'], root);
      execute('git', ['diff', '--cached', '--check'], root);
      const output = execute('node', ['--test', 'scripts/verify/foundation.test.mjs', 'scripts/verify/design.test.mjs', 'scripts/verify/protocol.test.mjs', 'scripts/verify/mac-session.test.mjs', 'scripts/verify/swift-tokens.test.mjs', 'scripts/verify/launcher-evidence.test.mjs'], root);
      evidence.steps.push({ id: 'automation', status: 'passed', output });
    }
  } catch (error) {
    evidence = { ...evidence, status: 'failed', error: error.message, started };
  }
  evidence.finished = new Date().toISOString();
  mkdirSync(resolve(root, 'build'), { recursive: true });
  writeFileSync(resolve(root, 'build/foundation-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  for (const step of evidence.steps ?? []) console.log(`${step.status}: ${step.id}`);
  console.log(`foundation: ${evidence.status}`);
  if (evidence.error) console.error(evidence.error);
  return evidence;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/foundation.mjs');
  process.exitCode = foundation().status === 'passed' ? 0 : 1;
}
