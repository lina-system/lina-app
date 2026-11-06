# Install on the Home Screen

A person can add the web app to a phone or desktop Home Screen. It opens as its own window with the LINA name and icon.

## Platforms

- `web`: shipped.
- `mac`: not planned (the Mac app installs as a native app).
- `iphone`: not planned (the iPhone app installs as a native app).

## Intended behavior

- The page, served under `/app/` like the core serves it, links `/app/manifest.webmanifest`, whose `display` is `standalone`, with the name `LINA` and a start address relative to it (`./`, so the installed app opens `/app/`).
- Every icon the manifest lists, and the Home Screen icon the page links, loads.
- After the first load, a service worker is active for the page.

## Sub-features

- `install-manifest` offers the app for install with its name and display mode.
- `install-icons` gives the Home Screen and the window an icon.
- `install-worker` registers the service worker that installable web apps need.

## How to get to it (user POV)

- Safari on iPhone: Share, then `Add to Home Screen`.
- Chrome or Edge on desktop: the install button in the address bar.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- The instance serves the production build (`launch` builds one), since the worker registers only in production.

- **Manifest.** Load `/app/?source=synthetic#/`, read the page's `link[rel="manifest"]` and fetch it. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive install`. The link is `/app/manifest.webmanifest`; the manifest names `LINA` with `display` `standalone`, and each icon (relative to the manifest) returns `200`.
- **Home Screen icon.** Fetch the page's `link[rel="apple-touch-icon"]`. It returns `200`.
- **Service worker.** Reload the page. `navigator.serviceWorker.getRegistration()` has an `active` worker.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/install/install-1280.json` and `install-390.json` record the manifest name, display, icon count and the worker state.

## Gotchas

- The browser's own install prompt and the iOS Share sheet cannot be driven headless. The driver proves what they read (manifest, icons, worker); the prompt itself needs a person or a device run.
- The worker activates after the first load. Reload before checking it, and wait for `active`, not a fixed delay.
- A dev server (`npm run dev`) registers no worker. Drive only an instance started by `launch`.
- The worker's scope is `/app/`; a worker registered at `/` by an older build is a different registration.

## Not goals

- Push notifications are their own feature ([notifications-push](./notifications-push.md)).
- No offline use: the worker passes every request to the network and caches nothing.
