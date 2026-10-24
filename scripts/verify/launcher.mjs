// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

const batchLauncher = /\.(?:bat|cmd)$/i;

// Node refuses to spawn .bat/.cmd files without a shell (CVE-2024-27980), so a
// batch launcher is run through `cmd.exe /d /s /c`. Everything inside the
// command string is data: each argument is wrapped in double quotes, where
// `& | < > ^ ( ) space ; , =` are literal, and `%` / `"` — the two characters
// that stay special inside quotes — are escaped by closing the quote, applying
// the caret escape, and reopening it. `^%` is literal percent on a command
// line (caret loses that meaning only inside quotes), and `^"` is a literal
// quote instead of a quote delimiter. The escaping never emits an unquoted
// metacharacter, so an argument cannot terminate the command or start a new one.
export function escapeCmdArgument(value) {
  let escaped = '"';
  for (const char of value) {
    if (char === '"') escaped += '"^""';
    else if (char === '%') escaped += '"^%"';
    else escaped += char;
  }
  return `${escaped}"`;
}

// Resolve a bare command name the way Windows does: PATH order, then PATHEXT
// order. Only a batch file needs the cmd.exe wrapper; an .exe or .com launcher
// keeps the direct spawn it has today.
export function findWindowsLauncher(command, { env = process.env, exists = existsSync } = {}) {
  if (batchLauncher.test(command)) return exists(command) ? command : null;
  const extensions = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const directories = /[\\/]/.test(command) ? [''] : (env.PATH || '').split(win32.delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const extension of extensions) {
      const base = directory ? win32.join(directory, command) : command;
      // Windows file systems are case-insensitive; probing the lowercase form
      // as well keeps the lookup honest on case-sensitive hosts.
      const file = [base + extension, base + extension.toLowerCase()].find(exists);
      if (!file) continue;
      return batchLauncher.test(file) ? file : null;
    }
  }
  return null;
}

// `/d` skips AutoRun commands and `/s` makes the outer quote stripping
// deterministic: cmd removes the first and last quote of the command string,
// leaving the quoted launcher and arguments for a single parse. The command
// line is already quoted, so it must reach cmd verbatim.
export function windowsInvocation(launcher, args, { comspec = 'cmd.exe' } = {}) {
  const line = [launcher, ...args].map(escapeCmdArgument).join(' ');
  return { command: comspec, args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
}
