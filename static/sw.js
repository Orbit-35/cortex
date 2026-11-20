// Cortex service worker: keeps a copy of the app shell (pages, scripts, icons) on the
// device so the app opens with no connection. It never touches /api: data goes
// through IndexedDB + sync in /core/cortex.js instead.
//
// Strategy: "cache first, one version at a time". The server stamps VERSION with a
// fingerprint of every app file, so any change produces a new service worker. The new
// worker downloads the complete new set of files, then replaces the old set in one
// step, so the app never mixes files from two versions. The page reloads itself when
// that happens (see app.js). DESIGN D36.

const VERSION = "__VERSION__"; // replaced by the server (main.py /sw.js)
const CACHE = `cortex-shell-${VERSION}`;
const SHELL = [
  "/lifting/",
  "/lifting/app.js",
  "/lifting/stats.js",
  "/lifting/units.js",
  "/lifting/library.js",
  "/lifting/workouts.js",
  "/lifting/progress.js",
  "/core/cortex.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];
const NETWORK_ONLY = ["/api/", "/docs", "/redoc", "/openapi.json"];

self.addEventListener("install", (event) => {
  // cache: "reload" skips the browser's HTTP cache, so we really get the new files.
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("cortex-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (NETWORK_ONLY.some((p) => url.pathname.startsWith(p))) return;

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true, cacheName: CACHE });
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch (err) {
      // Offline and not cached. The home URL redirects to lifting; mirror that.
      if (request.mode === "navigate") {
        const shell = await caches.match("/lifting/", { cacheName: CACHE });
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
