// @vitest-environment node
import { expect, test } from "vitest";
import { previewReady, stripAnsi } from "../.agents/skills/verify-lina-app/scripts/preview-log.mjs";

const coloured = "  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://127.0.0.1:\x1b[1m41279\x1b[22m/app/\x1b[39m\n";

test("finds the preview port when vite wraps it in colour codes, as on the Actions runner", () => {
  expect(previewReady(coloured, 41279)).toBe(true);
  expect(stripAnsi(coloured)).toBe("  ➜  Local:   http://127.0.0.1:41279/app/\n");
});

test("finds it without colours and does not take another port for it", () => {
  expect(previewReady("  ➜  Local:   http://127.0.0.1:41279/app/\n", 41279)).toBe(true);
  expect(previewReady(coloured, 4127)).toBe(false);
  expect(previewReady(coloured, 41280)).toBe(false);
});
