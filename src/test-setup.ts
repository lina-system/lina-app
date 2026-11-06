import { act, cleanup } from "@testing-library/preact";
import { afterAll, afterEach, beforeEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

/**
 * `LINA_TEST_CLOCK=HH:MM npm test` runs every test with the wall clock at that local time today, to prove no test
 * depends on the hour it runs at (a time read as `어제 23:33` just after midnight). A test's own fake timers start
 * from the pinned time; its useRealTimers ends the pin for the rest of that test only.
 */
const pinned = process.env.LINA_TEST_CLOCK?.match(/^(\d\d):(\d\d)$/);
if (pinned) {
  beforeEach(() => {
    const at = new Date();
    at.setHours(Number(pinned[1]), Number(pinned[2]), 0, 0);
    vi.setSystemTime(at);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

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
