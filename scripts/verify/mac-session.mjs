// SPDX-License-Identifier: Apache-2.0
// ioreg session facts only; no login, lock or power-management mutations.
export function consoleSessionState(roots) {
  const users = (Array.isArray(roots) ? roots : [roots])
    .flatMap(root => root?.IOConsoleUsers ?? [])
    .filter(user => user.kCGSSessionOnConsoleKey === true);
  // macOS omits the lock key while unlocked; only an explicit true means locked.
  return {
    locked: !users.length || users.some(user => user.CGSSessionScreenIsLocked === true),
    consoleUsers: users.map(user => ({
      lockKeyPresent: Object.hasOwn(user, 'CGSSessionScreenIsLocked'),
      lockValue: user.CGSSessionScreenIsLocked ?? null,
    })),
  };
}
