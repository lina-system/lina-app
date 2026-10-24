// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

if (process.platform !== 'darwin') throw Error('Translation offline verification requires macOS');
// Native CI compiles the XCTest bundle first. The fixture uses the production
// provider with installed languages injected, since runners may have no packs.
const profile = '(version 1)(allow default)(deny network*)';
const test = 'TranslationTests/testInstalledLanguagesTranslateOfflineAndContinueAsDraft';
const result = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, 'swift', 'test',
  '--package-path', 'packages/lina_app/macos', '--disable-sandbox', '--skip-build', '--filter', test], {
  encoding: 'utf8', timeout: 120000,
  env: { ...process.env, LINA_TRANSLATION_OFFLINE: '1' },
});
const log = (result.stdout ?? '') + (result.stderr ?? '');
if (result.status !== 0 || !log.includes('testInstalledLanguagesTranslateOfflineAndContinueAsDraft') ||
    !/Executed 1 test, with 0 failures/.test(log)) throw Error(`Translation offline seam failed: ${result.error ?? log}`);
mkdirSync('docs/captures/45', { recursive: true });
writeFileSync('docs/captures/45/offline.json', JSON.stringify({
  sandboxProfile: profile,
  test,
  networkProbe: 'EPERM/EACCES required by XCTest in the translation process',
  installedLanguageSeam: 'passed: Korean result, download=false, local routing, unsent draft',
  realAppleOfflineTranslation: 'unverified; physical acceptance tracked in #116',
}, null, 2) + '\n');
console.log('PASS: installed-language translation seam with network denied; physical Apple offline acceptance remains unverified (#116)');
