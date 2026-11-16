import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watch } from "../.agents/skills/verify-lina-app/scripts/worker-notes.mjs";

type Worker = typeof globalThis & {
  registration?: unknown;
  ExtendableEvent?: unknown;
  __notes?: { pending: number; settled: number; overlaps: unknown[]; waiters: [number, () => void][] };
};
const worker = globalThis as Worker;

// A fresh class per test, so each test's watch() wraps an unwrapped waitUntil.
const eventClass = () =>
  class {
    constructor(readonly type: string) {}
    waitUntil(promise: Promise<unknown>) {
      return promise;
    }
  };
let FakeExtendableEvent = eventClass();
let drawn: (() => void)[] = [];

beforeEach(() => {
  drawn = [];
  FakeExtendableEvent = eventClass();
  worker.ExtendableEvent = FakeExtendableEvent;
  worker.registration = {
    showNotification: () => new Promise<void>((resolve) => drawn.push(resolve)),
    getNotifications: async () => [],
  };
  delete worker.__notes;
  watch();
});

afterEach(() => {
  delete worker.__notes;
  delete worker.registration;
  delete worker.ExtendableEvent;
});

describe("watch (the drive's scaffolding in the service worker)", () => {
  it("records a read that begins while a show is pending, and none after it settled", async () => {
    const registration = worker.registration as { showNotification(title: string): Promise<void>; getNotifications(filter?: { tag: string }): Promise<unknown[]> };
    const shown = registration.showNotification("항목");
    await registration.getNotifications({ tag: "ask:T2" });
    drawn[0]();
    await shown;
    await registration.getNotifications();
    expect(worker.__notes?.overlaps).toEqual([{ pending: 1, tag: "ask:T2" }]);
  });

  it("counts settled push and message handlers only, and wakes a waiter at its count", async () => {
    const woken: number[] = [];
    worker.__notes?.waiters.push([2, () => woken.push(2)]);
    await new FakeExtendableEvent("push").waitUntil(Promise.resolve());
    await new FakeExtendableEvent("notificationclick").waitUntil(Promise.resolve());
    expect([worker.__notes?.settled, woken]).toEqual([1, []]);
    await new FakeExtendableEvent("message").waitUntil(Promise.reject(new Error("close failed"))).catch(() => {});
    expect([worker.__notes?.settled, woken]).toEqual([2, [2]]);
  });
});
