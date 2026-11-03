// Reads vite preview's log. Vite colours its output when the terminal (or FORCE_COLOR, as on the
// Actions runner) asks for it, wrapping the port in ANSI codes, so the codes go before any match.

const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text) {
  return text.replace(ANSI, "");
}

// The address is looked up as text, never built into a pattern: "127.0.0.1:<port>" not followed by a digit.
export function previewReady(logText, port) {
  const text = stripAnsi(logText);
  const address = `127.0.0.1:${port}`;
  for (let at = text.indexOf(address); at >= 0; at = text.indexOf(address, at + 1)) {
    if (!/\d/.test(text.charAt(at + address.length))) return true;
  }
  return false;
}
