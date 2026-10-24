// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyDictionaryEvidence } from './verify/dictionary-evidence.mjs';

if (process.platform !== 'darwin') throw Error('Dictionary offline verification requires macOS');
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw Error(`${command}: ${result.error ?? result.stderr ?? result.stdout}`);
  return result.stdout;
}
run('swift', ['build', '--package-path', 'packages/lina_app/macos', '-j', '2', '--product', 'DictionaryOfflineCheck']);
const bin = run('swift', ['build', '--package-path', 'packages/lina_app/macos', '--show-bin-path']).trim();
const profile = '(version 1)(allow default)(deny network*)';
const observed = JSON.parse(run('/usr/bin/sandbox-exec', ['-p', profile, resolve(bin, 'DictionaryOfflineCheck')]));
const verified = verifyDictionaryEvidence(observed);
mkdirSync('docs/captures/44', { recursive: true });
writeFileSync('docs/captures/44/offline.json', JSON.stringify({ ...observed, verified, sandboxProfile: profile,
  sourceRevision: run('git', ['rev-parse', 'HEAD']).trim(), collectedAt: new Date().toISOString(),
}, null, 2) + '\n');
console.log(`PASS: Dictionary Services ran with network denied; definitions available: ${verified.available.join(', ') || 'none'}`);
if (verified.unavailable.length) console.log(`UNVERIFIED device dictionary acceptance (no installed active entry): ${verified.unavailable.join(', ')}`);
