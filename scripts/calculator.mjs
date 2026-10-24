// SPDX-License-Identifier: Apache-2.0
// Exercise the production result layer while the real conversation engine is connected.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

if (process.platform !== 'darwin') throw Error('macOS only');
const app = resolve('packages/lina_app/build/macos/Build/Products/Release/LINA.app');
const signature = spawnSync('codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' });
assert.equal(signature.status, 0, signature.stderr);
const sockets = new Set();
const wireRequests = [];
let accepted = 0;
const server = createServer(socket => {
  accepted++;
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => {});
  let buffered = '';
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buffered += chunk;
    while (buffered.includes('\n')) {
      const end = buffered.indexOf('\n');
      const request = JSON.parse(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
      wireRequests.push(request.method);
      if (request.method === 'hello') {
        const welcome = JSON.parse(readFileSync('protocol/core/fixtures/client/1.0/welcome.json', 'utf8'));
        welcome.reply_to = request.params.message_id;
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: welcome }) + '\n');
      }
    }
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const child = spawn(`${app}/Contents/MacOS/LINA`, ['--calculator-smoke'], {
  env: { ...process.env, LINA_CORE_ENDPOINT: `tcp://127.0.0.1:${server.address().port}`, LINA_LOG_CORE_REQUESTS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '', stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
const exited = new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
const deadline = setTimeout(() => child.kill('SIGKILL'), 30000);
try {
  assert.equal(await exited, 0, stderr);
  const lines = stdout.split('\n');
  const evidence = JSON.parse(lines.find(line => line.startsWith('LINA_CALCULATOR '))?.slice('LINA_CALCULATOR '.length) ?? 'null');
  assert.ok(evidence, stdout + stderr);
  const expected = [
    { query: '(3+4)*12%', rows: ['0.84'], formattedCopy: '0.84', rawCopy: '0.84' },
    { query: '2^10', rows: ['1,024'], formattedCopy: '1,024', rawCopy: '1024' },
    { query: '1234567/100', rows: ['12,345.67'], formattedCopy: '12,345.67', rawCopy: '12345.67' },
    { query: '1234', rows: [] }, { query: '2+', rows: [] },
  ];
  assert.deepEqual(evidence.samples, expected);
  assert.equal(evidence.historyRows, 3);
  const appRequestLog = lines.filter(line => line.startsWith('LINA_CORE_REQUEST ')).map(line => line.slice('LINA_CORE_REQUEST '.length));
  assert.deepEqual(appRequestLog, ['hello'], 'app transport log must contain only the pre-calculation handshake');
  const begin = lines.indexOf('LINA_CALCULATOR_BEGIN');
  assert.ok(begin > lines.findIndex(line => line === 'LINA_CORE_REQUEST hello'));
  assert.deepEqual(lines.slice(begin).filter(line => line.startsWith('LINA_CORE_REQUEST ')), [], 'zero Core requests while typing/copying');
  assert.deepEqual(wireRequests, ['hello'], 'independent wire observation must agree with the app request log');
  assert.equal(accepted, 1);
  mkdirSync('docs/captures/40', { recursive: true });
  writeFileSync('docs/captures/40/request-log.json', JSON.stringify({
    sourceRevision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    dirty: spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.length > 0,
    appRequestLog, wireRequests, acceptedConnections: accepted, calculationRequests: 0, ...evidence,
    physicalInput: 'Not exercised; native delegate actions in the hidden release app',
  }, null, 2) + '\n');
  console.log('PASS: required expressions, formatted/raw copies, bare number suppression, local history; app request log and wire show zero calculation requests');
} finally {
  clearTimeout(deadline);
  for (const socket of sockets) socket.destroy();
  server.close();
  if (child.exitCode === null) child.kill('SIGTERM');
  const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(kill);
}
