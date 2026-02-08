// sw.js (kokugo-dojo)
// Update-safe strategy (assets/なし想定):
// - Install: "best-effort" precache (404が混じっても落ちない)
// - HTML navigation: Network-first (fallback to cached index.html)
// - Same-origin static: Cache-first + background revalidate
// - cards-hub JSON/CSV: Network-first (avoid stale STATUS)
// - IMPORTANT: bump CACHE_NAME on releases

const CACHE_NAME = "hk-dojo-v2026-02-08-02";

// ✅ assets/ が無い前提：存在が確実なものだけ
// ※ home.css は無い運用もあるので、best-effort precache で吸収します
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./home.js",
  "./home.css",
  "./manifest.json",

  // icons が無い/名前違いでも install が死なないよう best-effort で扱う
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
];

// -------------------------
// best-effort precache
// -------------------------
async function precacheBestEffort(cache, urls) {
  // 404などが混ざっても全体を失敗させない
  const tasks = urls.map(async (u) => {
    try {
      const req = new Request(u, { cache: "no-store" });
      const res = await fetch(req);
      if (!res.ok) throw new Error(`precache skip: ${res.status} ${u}`);
      await cache.put(req, res.clone());
    } catch (e) {
      // ここで落とさないのが重要
      // console.warn("[SW] precache skipped:", e);
    }
  });
  await Promise.all(tasks);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await precacheBestEffort(cache, ASSETS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

// -------------------------
// helpers
// -------------------------
function isSameOrigin(url) {
  try { return new URL(url).origin === self.location.origin; } catch { return false; }
}

function isCardsHubJsonOrCsv(url) {
  try {
    const u = new URL(url);
    const isCardsHub = u.origin === self.location.origin && u.pathname.startsWith("/cards-hub/");
    if (!isCardsHub) return false;
    return u.pathname.endsWith(".json") || u.pathname.endsWith(".csv");
  } catch {
    return false;
  }
}

async function cachePutSafe(req, res) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(req, res.clone());
  } catch (_) {}
}

async function networkFirst(req, { fallbackUrl } = {}) {
  try {
    const res = await fetch(req, { cache: "no-store" });
    if (req.method === "GET" && isSameOrigin(req.url)) {
      await cachePutSafe(req, res);
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // 1) ナビゲーション（HTML）：network-first（更新反映優先）
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, { fallbackUrl: "./index.html" }));
    return;
  }

  // 2) STATUS用の cards-hub json/csv は network-first（古いデータ固定を防ぐ）
  if (isCardsHubJsonOrCsv(req.url)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 3) 同一オリジンの静的ファイル：cache-first + 背景更新
  if (isSameOrigin(req.url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) {
        // 背景で再取得してキャッシュ更新
        event.waitUntil(
          fetch(req)
            .then((res) => cachePutSafe(req, res))
            .catch(() => {})
        );
        return cached;
      }

      // 未キャッシュなら取りに行って保存
      const res = await fetch(req);
      await cachePutSafe(req, res);
      return res;
    })());
    return;
  }

  // 4) クロスオリジンは素通し（キャッシュしない）
});
