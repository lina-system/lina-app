// Reads vite preview's log. Vite colours its output when the terminal (or FORCE_COLOR, as on the
// Actions runner) asks for it, wrapping the port in ANSI codes, so the codes go before any match.

const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text) {
  return text.replace(ANSI, "");
}

export function previewReady(logText, port) {
  return new RegExp(`127\\.0\\.0\\.1:${port}(?!\\d)`).test(stripAnsi(logText));
}
