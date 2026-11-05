import { act, cleanup } from "@testing-library/preact";
import { afterAll, afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

/**
 * Flush preact's pending after-paint effects before the file's jsdom
 * environment is torn down.
 *
 * preact runs after-paint effects from `requestAnimationFrame` with a 35 ms
 * `setTimeout` fallback (`afterNextFrame` in preact/hooks). When that fallback
 * fires after vitest has deleted the jsdom globals, its `cancelAnimationFrame`
 * call throws `ReferenceError: cancelAnimationFrame is not defined`, which
 * vitest counts as an unhandled error even though every test passed.
 *
 * `act` sends `requestAnimationFrame` into a synchronous flush, and the wait
 * lets a fallback timer that is already pending run while the globals are
 * still installed. Effects flushed during the wait cannot start another
 * fallback timer, because `act` is still routing `requestAnimationFrame`.
 */
export async function flushAfterPaint(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

// The setup file's afterAll runs after the test file's own afterAll hooks and
// immediately before vitest tears the environment down.
afterAll(flushAfterPaint);
