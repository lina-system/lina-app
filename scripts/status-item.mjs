// SPDX-License-Identifier: Apache-2.0
// Real release process, one synthetic Core socket, actual native menu updates.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

if (process.platform !== 'darwin') throw Error('macOS only');
const app = resolve('packages/lina_app/build/macos/Build/Products/Release/LINA.app');
const signature = spawnSync('codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' });
assert.equal(signature.status, 0, signature.stderr);
const sockets = new Set();
let accepted = 0;
const server = createServer(socket => {
  accepted++;
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  let buffered = '';
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buffered += chunk;
    if (!buffered.includes('\n')) return;
    const request = JSON.parse(buffered.trim());
    assert.equal(request.method, 'hello');
    const welcome = JSON.parse(readFileSync('protocol/core/fixtures/client/1.0/welcome.json', 'utf8'));
    welcome.reply_to = request.params.message_id;
    socket.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: welcome }) + '\n');
    buffered = '';
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const child = spawn(`${app}/Contents/MacOS/LINA`, ['--status-item-smoke'], {
  env: { ...process.env, LINA_CORE_ENDPOINT: `tcp://127.0.0.1:${server.address().port}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '', buffered = '', stoppedAt, latency;
const snapshots = [];
const exited = new Promise(resolve => child.once('close', resolve));
let deadline;
try {
  await new Promise((resolve, reject) => {
    deadline = setTimeout(() => reject(Error(`No native status within deadline: ${stderr}`)), 30000);
    child.once('error', reject);
    child.once('exit', code => reject(Error(`App exited early (${code}): ${stderr}`)));
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.on('data', chunk => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('LINA_STATUS_ITEM ')) continue;
        const snapshot = JSON.parse(line.slice('LINA_STATUS_ITEM '.length));
        snapshots.push(snapshot);
        if (snapshot.phase === 'connected' && stoppedAt === undefined) {
          stoppedAt = performance.now();
          clearTimeout(deadline);
          deadline = setTimeout(() => reject(Error('Native disconnect exceeded 5 seconds')), 5000);
          for (const socket of sockets) socket.destroy();
          server.close();
        } else if (snapshot.phase === 'disconnected' && stoppedAt !== undefined) {
          latency = performance.now() - stoppedAt;
          resolve();
        }
      }
    });
  });
  assert.equal(accepted, 1, 'menu must reuse the conversation connection');
  assert.ok(latency < 5000);
  assert.ok(snapshots.at(-1).menu.includes('Core: 연결 끊김'));
  assert.ok(snapshots.at(-1).menu.includes('런처 열기'));
  assert.ok(snapshots.at(-1).menu.includes('대화 열기'));
  mkdirSync('docs/captures/49', { recursive: true });
  writeFileSync('docs/captures/49/stopped-core.json', JSON.stringify({
    sourceRevision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    dirty: spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.length > 0,
    os: spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim(),
    acceptedConnections: accepted, disconnectMilliseconds: latency, snapshots,
    scope: 'Release Dart connection -> method channel -> AppKit menu; no physical menu interaction',
  }, null, 2) + '\n');
  console.log(`PASS: native menu disconnected in ${latency.toFixed(1)}ms; one Core connection`);
} finally {
  clearTimeout(deadline);
  for (const socket of sockets) socket.destroy();
  server.close();
  if (child.exitCode === null) child.kill('SIGTERM');
  const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(kill);
}
