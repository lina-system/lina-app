# Push notifications

The owner can get a notification on the iPhone Home Screen web app or a desktop browser when something needs him: a decision to make, an agent's reply to his comment, or a work card stopped for him. He turns it on from the `알림 받기` row in the bell; the core (lina#244) sends one notification per item and closes it when the item is answered, read or unblocked.

## Platforms

- `web`: shipped (this repository: the row, the subscription, the service worker). A real run on an iPhone Home Screen web app and a desktop browser is still open (lina-app#38).
- `mac`: planned (M1, through APNs).
- `iphone`: planned (M1, through APNs).

## Intended behavior

- The bell's dialog ends with the row `알림 받기`. Nothing asks for notification permission on load; only the row's switch asks, once.
- Push off in the core (no VAPID key): the row reads `푸시 설정 안 됨`, with no switch.
- iPhone or iPad Safari outside the Home Screen: the row reads `공유 › 홈 화면에 추가 후 켤 수 있음`, with no switch. Opened from the Home Screen, it shows the switch.
- A browser without Web Push reads `이 브라우저는 받을 수 없음`; notifications blocked in the browser read `브라우저에서 알림 막힘`; neither has a switch.
- Ready: the switch `알림 받기`, off. Turning it on asks for permission if the browser has not been asked, subscribes with the core's public key and sends the subscription to the core; the switch is on. Turning it off removes the subscription in the core, then in the browser.
- On a later visit a subscription the browser holds is sent to the core again, so a changed endpoint reaches it. A refused subscription is dropped again and the row reads `켜지 못함`; a failed removal reads `끄지 못함` and stays on.
- A notification's title is the item's checked title; its body is `결정 필요`, `답글` or `멈춤 · 기다림`, then the core's sentence when it is a readable one (the timeline's rule). No ids, paths or English.
- One notification per item: a later message for the same item replaces it; a `close` closes it; a `close` with nothing open shows nothing.
- Choosing a notification brings the open app window to the item (`#/inbox` for a decision, the goal or to-do for a reply, the card for a stopped card); with none open, a new window opens there.
- A notice read in the bell, `모두 읽음`, or an answer closes the matching notification on this device at once; the core's `close` clears the other devices.
- No quiet hours: when to stay silent is the device's Focus or Do Not Disturb.

## Sub-features

- `push-row-off` shows that push is not set up in the core
- `push-row-home` shows how to add the app to the Home Screen on iOS
- `push-row-ready` offers the switch without asking for anything on load
- `push-subscribe` turns push on and off for this device in the core
- `push-show` shows, replaces by tag and closes notifications in the service worker
- `push-open` routes a chosen notification to its item
- `push-read-closes` closes a notification here when its notice is read

## How to get to it (user POV)

- Open the bell (the toolbar on a wide window, the navigation bar on a phone); the row is under the notices.
- iPhone: Share, then `Add to Home Screen`, then open LINA from the Home Screen and the bell.
- A notification on the lock screen, in Notification Center or the desktop's notification list.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The driver starts its own full Chromium (`channel: "chromium"`, installed by `npx playwright install chromium`), because the headless shell the other drivers use denies notifications.
- The page is `/app/?source=synthetic`; `&push=off` is the core without push. The synthetic push service stands in for Google's (headless Chromium has none): the endpoint is on `fcm.googleapis.com`, and `window.__linaPush` reads the synthetic core's subscriptions.

- **Off in the core.** Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive notifications-push`. On `&push=off`, the bell's row reads `푸시 설정 안 됨` and has no switch.
- **Not on the Home Screen.** With an iPhone Safari user agent, the row reads `공유 › 홈 화면에 추가 후 켤 수 있음` and has no switch.
- **Ready.** With `navigator.standalone` true (the Home Screen app), and on a desktop browser, the row has the switch `알림 받기`, `aria-checked="false"`, and `Notification.requestPermission` was called 0 times on load. On the desktop, the switch calls it once; the headless prompt answers denied and the row reads `브라우저에서 알림 막힘`.
- **On and off.** With notifications granted, the switch turns on, `aria-checked="true"`, and `__linaPush.subscriptions` holds one `https://fcm.googleapis.com/…` endpoint; the switch again turns it off, the core keeps 0 and counted 1 removal.
- **The service worker.** Messages sent through `ServiceWorker.deliverPushMessage` (DevTools protocol): a `show` draws one notification (`결정 필요` and the sentence); the same tag again replaces it (an unreadable sentence leaves the kind line only); another tag adds one; a `close` closes it; a `close` with nothing open changes nothing. One notification per unread notice, then the first unread notice chosen in the bell: its notification closes, the others stay.
- **Choosing a notification.** A click on a decision, a reply on `T4` and a stopped `k-101` takes the open window from `#/due` to `#/inbox`, `#/items/T4` and `#/cards/k-101`.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/notifications-push/notifications-push-<width>.{png,aria.yml,json}`, and `notifications-push-{off,home,ready,on}-<width>.png` for the row in each state, at 1280 and 390.

## Gotchas

- The headless shell (Playwright's default) reports `Notification.permission` as denied, so on the other drivers' pages the row reads `브라우저에서 알림 막힘`; that is the browser, not a defect.
- A click dispatched from a script is not a user's: `clients.openWindow` is refused and `focus` may be. The driver proves the route in an open window; a new window on the item is held by `src/sw.test.ts` and needs a real device to see.
- Headless Chromium has no push service, so `pushManager.subscribe` fails there; the synthetic scene swaps in its own push manager. A real subscription needs a real browser and the hub's key.
- Safari revokes a subscription whose pushes show nothing (WebKit, "Meet Web Push"); a `close` with nothing to close is such a push. The core sends a `close` only for an item it showed.
- Never turn the switch on against the owner's live core in a read-only pass: it stores a subscription there.

## Not goals

- No quiet hours and no per-kind settings in the app.
- No badge count on the Home Screen icon.
- No notification for progress, finished work or the owner's own to-dos (the core sends none).
