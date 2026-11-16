// The service worker's notifications as a drive reads them (lina-app#234). Chromium's getNotifications() deletes
// every stored notification it does not find on screen yet (content/browser/notifications/
// platform_notification_context_impl.cc, DoReadAllNotificationDataForServiceWorkerRegistration), so a read that
// starts while showNotification() is still drawing one loses it for good. A drive therefore never reads while a
// show is pending: it waits until the worker's push and message handlers settled, then reads once.

// Runs in the service worker (worker.evaluate(watch)). Scaffolding around the worker's own calls; public/sw.js is
// unchanged. Counts shows still pending and push and message handlers settled, and records every read that began
// while a show was pending.
export function watch() {
  if (self.__notes) return;
  const notes = { pending: 0, settled: 0, overlaps: [], waiters: [] };
  const registration = self.registration;
  const show = registration.showNotification.bind(registration);
  registration.showNotification = async (...args) => {
    notes.pending += 1;
    try {
      return await show(...args);
    } finally {
      notes.pending -= 1;
    }
  };
  const read = registration.getNotifications.bind(registration);
  registration.getNotifications = (...args) => {
    if (notes.pending) notes.overlaps.push({ pending: notes.pending, tag: (args[0] && args[0].tag) || null });
    return read(...args);
  };
  const waitUntil = ExtendableEvent.prototype.waitUntil;
  ExtendableEvent.prototype.waitUntil = function (promise) {
    if (this.type !== "push" && this.type !== "message") return waitUntil.call(this, promise);
    const done = Promise.resolve(promise).finally(() => {
      notes.settled += 1;
      notes.waiters = notes.waiters.filter(([count, resolve]) => (notes.settled >= count ? (resolve(), false) : true));
    });
    return waitUntil.call(this, done);
  };
  self.__notes = notes;
}

// The drive's side: one watched worker.
export async function watchWorker(worker, timeout = 5_000) {
  await worker.evaluate(watch);
  const settled = () => worker.evaluate(() => self.__notes.settled);
  return {
    settled,
    // Resolves once `count` push and message handlers have settled; reads no notification while it waits.
    async until(count) {
      let timer;
      const late = new Promise((resolve, reject) => {
        timer = setTimeout(async () => reject(new Error(`the worker settled ${await settled().catch(() => "?")} of ${count} handlers in ${timeout} ms`)), timeout);
      });
      try {
        await Promise.race([worker.evaluate((count) => (self.__notes.settled >= count ? null : new Promise((resolve) => self.__notes.waiters.push([count, resolve]))), count), late]);
      } finally {
        clearTimeout(timer);
      }
    },
    read: (tag) =>
      worker.evaluate(
        async (tag) => (await self.registration.getNotifications(tag ? { tag } : undefined)).map((note) => ({ tag: note.tag, title: note.title, body: note.body, data: note.data })),
        tag ?? null,
      ),
    overlaps: () => worker.evaluate(() => self.__notes.overlaps),
  };
}
