/* Service worker: makes the app installable and lets the shell open offline.
 *
 * It deliberately NEVER touches /api. Financial data and the session must always come from the server, so nothing
 * private is ever written to a cache. Offline, the shell loads and the app shows its normal "cannot reach the server" state.
 */
const SHELL = "nw-shell-v1";   // the HTML entry point and small static files
const ASSETS = "nw-assets-v1"; // content-hashed JS/CSS (immutable, so cache-first is safe)
const MAX_ASSETS = 60;         // old builds' hashed files would otherwise pile up

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(k);
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // network only, never cached

  if (req.mode === "navigate") { // network first so a new release is picked up; cached shell only when offline
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put("/", copy)); } return res; }).catch(() => caches.match("/").then((r) => r ?? Response.error())));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.open(ASSETS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { c.put(req, res.clone()); trim(c); }
      return res;
    }));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
});
