// SPDX-License-Identifier: Apache-2.0
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { foundation } from './foundation.mjs';
import { execute } from './verify/flutter.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = { ios: 'ios', android: 'appbundle', macos: 'macos', windows: 'windows', linux: 'linux' };
const target = process.argv[2];
if (process.argv.length !== 3 || !Object.hasOwn(targets, target)) throw new Error('Usage: node scripts/build.mjs ios|android|macos|windows|linux');
if (!existsSync(resolve(root, 'packages/lina_app/pubspec.yaml'))) throw new Error('The native app skeleton belongs to #6; no release artifact exists yet.');
if (foundation(root).status !== 'passed') process.exitCode = 1;
else console.log(execute('flutter', ['build', targets[target], '--release', '--no-pub'], resolve(root, 'packages/lina_app')));
