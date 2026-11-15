// Cortex service worker: keeps a copy of the app shell (pages, scripts, icons) on the
// device so the app opens with no connection. It never touches /api: data goes
// through IndexedDB + sync in /core/cortex.js instead.
//
// Strategy: "stale-while-revalidate". Serve the saved copy instantly, and fetch a
// fresh copy in the background for next time. So after changing a page, the first
// reload still shows the old version and the second shows the new one.

const CACHE = "cortex-shell-v1"; // bump to throw away every cached file
const SHELL = [
  "/lifting/",
  "/core/cortex.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];
const NETWORK_ONLY = ["/api/", "/docs", "/redoc", "/openapi.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (NETWORK_ONLY.some((p) => url.pathname.startsWith(p))) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    // "no-cache" = always check with the server rather than trusting the browser's HTTP cache.
    const fresh = fetch(request.mode === "navigate" ? request : new Request(request, { cache: "no-cache" }))
      .then((res) => {
        if (res.ok && res.type === "basic") cache.put(request, res.clone());
        return res;
      });
    if (cached) {
      event.waitUntil(fresh.catch(() => {}));
      return cached;
    }
    try {
      return await fresh;
    } catch (err) {
      // Offline and not cached. The home URL redirects to lifting; mirror that.
      if (request.mode === "navigate" && url.pathname === "/") return Response.redirect("/lifting/");
      throw err;
    }
  })());
});
