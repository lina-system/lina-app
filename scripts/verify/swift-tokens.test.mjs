// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSwift, checkSwift, outputDirectory } from './swift-tokens.mjs';
const root = process.cwd();
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lina-swift-'));
  for (const path of ['design', 'packages/lina_design/assets', outputDirectory]) cpSync(join(root, path), join(dir, path), { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('Swift shares the Dart revision, canonical output and app layout values', () => {
  const outputs = generateSwift(root);
  checkSwift(root, outputs);
  assert.equal(outputs[`${outputDirectory}/LinaTokens.swift`], readFileSync('design/tokens/core/tokens.swift', 'utf8'));
  assert.match(outputs[`${outputDirectory}/LinaAppTokens.swift`], /launcherWidth: CGFloat = 680/);
});
test('changed, missing, extra output and tampered provenance fail closed', t => {
  const dir = fixture(t);
  const outputs = generateSwift(dir);
  const path = Object.keys(outputs)[0];
  writeFileSync(join(dir, path), 'stale');
  assert.throws(() => checkSwift(dir, outputs), /drift/);
  rmSync(join(dir, path));
  assert.throws(() => checkSwift(dir, outputs), /drift/);
  writeFileSync(join(dir, path), outputs[path]);
  writeFileSync(join(dir, outputDirectory, 'extra.swift'), '// extra');
  assert.throws(() => checkSwift(dir, outputs), /unexpected/);
  writeFileSync(join(dir, 'design/tokens/core/tokens.swift'), '// changed');
  assert.throws(() => generateSwift(dir), /provenance/);
});
test('app layout changes invalidate Swift output', t => {
  const dir = fixture(t);
  const path = join(dir, 'design/tokens/app.json');
  const source = JSON.parse(readFileSync(path));
  source.launcher.width.$value.value = 720;
  writeFileSync(path, JSON.stringify(source));
  assert.throws(() => checkSwift(dir), /drift/);
});
