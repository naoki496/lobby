// sw.js (kokugo-dojo)
// Update-safe strategy:
// - HTML: Network-first (fallback to cache)
// - Static assets: Cache-first + stale-while-revalidate
// - cards-hub JSON/CSV: Network-first (avoid stale status bar)
// - Versioned cache name (MUST bump on release)

const CACHE_NAME = "hk-dojo-v2026-02-08-01";

// Precache: "this repo" critical files only
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./home.css",
  "./home.js",
  "./manifest.json",

  // images (adjust to your actual filenames)
  "./assets/top.jpg",

  // icons (adjust to what exists)
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
];

// ---- install: precache + activate new SW immediately
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ---- activate: remove old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k)))))
      .then(() => self.clients.claim())
  );
});

// ---- helpers
function isSameOrigin(url) {
  try { return new URL(url).origin === self.location.origin; } catch { return false; }
}
function isCardsHubJsonOrCsv(url) {
  try {
    const u = new URL(url);
    // controlled pages can fetch across paths; we only special-case cards-hub data
    const isCardsHub = u.origin === self.location.origin && u.pathname.startsWith("/cards-hub/");
    if (!isCardsHub) return false;
    return (
      u.pathname.endsWith(".json") ||
      u.pathname.endsWith(".csv")
    );
  } catch {
    return false;
  }
}

// ---- fetch strategies
async function networkFirst(req, { fallbackUrl } = {}) {
  try {
    const res = await fetch(req, { cache: "no-store" });
    // update cache for same-origin GET
    if (req.method === "GET" && isSameOrigin(req.url)) {
      const copy = res.clone();
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, copy);
    }
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (fallbackUrl) {
      const fb = await caches.match(fallbackUrl);
      if (fb) return fb;
    }
    throw e;
  }
}

async function cacheFirstStaleRevalidate(req) {
  const cached = await caches.match(req);
  const fetchPromise = (async () => {
    try {
      const res = await fetch(req);
      if (req.method === "GET" && isSameOrigin(req.url)) {
        const copy = res.clone();
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, copy);
      }
      return res;
    } catch {
      return null;
    }
  })();

  // Return cache immediately, update in background
  if (cached) {
    eventWait(fetchPromise); // best-effort background update
    return cached;
  }

  // Otherwise wait network
  const net = await fetchPromise;
  if (net) return net;

  // final fallback
  return caches.match("./index.html");
}

// Helper: keep SW alive for background update (safe no-op if no event context)
function eventWait(p) {
  try {
    // `self.___lastFetchEvent` is set below; if missing, do nothing
    if (self.___lastFetchEvent && typeof self.___lastFetchEvent.waitUntil === "function") {
      self.___lastFetchEvent.waitUntil(Promise.resolve(p));
    }
  } catch (_) {}
}

self.addEventListener("fetch", (event) => {
  self.___lastFetchEvent = event;

  const req = event.request;

  // Only handle GET
  if (req.method !== "GET") return;

  // HTML navigation: network-first, fallback to cached index.html
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, { fallbackUrl: "./index.html" }));
    return;
  }

  // Avoid staleness for cards-hub data used by STATUS BAR
  if (isCardsHubJsonOrCsv(req.url)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Same-origin static: cache-first + background refresh
  if (isSameOrigin(req.url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) {
        // background revalidate
        event.waitUntil(
          fetch(req)
            .then((res) => caches.open(CACHE_NAME).then((c) => c.put(req, res.clone())).catch(() => {}))
            .catch(() => {})
        );
        return cached;
      }
      // no cache -> fetch and store
      const res = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Cross-origin: pass-through (no caching)
  // (If you ever add external CDNs, this avoids opaque-cache gotchas)
});
