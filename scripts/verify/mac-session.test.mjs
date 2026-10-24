// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consoleSessionState } from './mac-session.mjs';

const consoleUser = { kCGSSessionOnConsoleKey: true };
test('active console with absent lock key is unlocked', () => {
  assert.deepEqual(consoleSessionState({ IOConsoleUsers: [consoleUser] }), {
    locked: false,
    consoleUsers: [{ lockKeyPresent: false, lockValue: null }],
  });
});
test('active console with true lock key is locked', () => {
  assert.deepEqual(consoleSessionState([{ IOConsoleUsers: [{ ...consoleUser, CGSSessionScreenIsLocked: true }] }]), {
    locked: true,
    consoleUsers: [{ lockKeyPresent: true, lockValue: true }],
  });
});
test('active console with false lock key is unlocked', () => {
  assert.equal(consoleSessionState({ IOConsoleUsers: [{ ...consoleUser, CGSSessionScreenIsLocked: false }] }).locked, false);
});
test('no active console user is locked', () => {
  for (const roots of [[], {}, { IOConsoleUsers: [] }, { IOConsoleUsers: [{ kCGSSessionOnConsoleKey: false }] }]) {
    assert.deepEqual(consoleSessionState(roots), { locked: true, consoleUsers: [] });
  }
});
test('inactive sessions do not determine the active console lock state', () => {
  assert.equal(consoleSessionState({ IOConsoleUsers: [
    { kCGSSessionOnConsoleKey: false, CGSSessionScreenIsLocked: true }, consoleUser,
  ] }).locked, false);
});
test('any explicitly locked active console prevents launch', () => {
  assert.equal(consoleSessionState({ IOConsoleUsers: [consoleUser, { ...consoleUser, CGSSessionScreenIsLocked: true }] }).locked, true);
});
