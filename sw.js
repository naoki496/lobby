// sw.js (kokugo-dojo)
// Update-safe strategy (assets/なし想定):
// - Install: best-effort precache (404が混じっても落ちない)
// - HTML navigation: Network-first (fallback to cached index.html)
// - Same-origin static: Cache-first + background revalidate
// - cards-hub manifest/json/csv (if fetched): Network-first (avoid stale STATUS-like data)
// - IMPORTANT: bump CACHE_NAME on releases

const CACHE_NAME = "hk-dojo-v2026-02-08-03";

// ✅ 存在が確実なもの中心（404でも死なないbest-effort）
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./home.js",
  "./home.css",
  "./manifest.json",

  // ✅ トップ画像（repo直下）
  "./H.K.LOBBY.png",

  // icons（無い/名前違いでも install が死なない）
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
];

// -------------------------
// helpers
// -------------------------
function toAbsUrl(u) {
  try {
    return new URL(u, self.location).toString();
  } catch {
    return u;
  }
}

function isSameOrigin(url) {
  try { return new URL(url).origin === self.location.origin; } catch { return false; }
}

// 「拡張子で雑に判定」より、将来事故りにくいホワイトリスト寄りに。
// 現状 home.js は fetchしないので、ここは“保険”。
// 必要になったらファイル名を追加。
function isCardsHubFreshTarget(url) {
  try {
    const u = new URL(url);
    if (u.origin !== self.location.origin) return false;
    if (!u.pathname.startsWith("/cards-hub/")) return false;

    const p = u.pathname;
    // 例：cards-hub の manifest / csv を読む設計にした場合にだけ効く
    if (p.endsWith("/cards-manifest.json")) return true;
    if (p.endsWith(".csv")) return true;
    return false;
  } catch {
    return false;
  }
}

async function cachePutSafe(req, res) {
  try {
    // opaque / error は入れない（事故防止）
    if (!res || res.type === "opaque" || !res.ok) return;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(req, res.clone());
  } catch (_) {}
}

// -------------------------
// best-effort precache
// -------------------------
async function precacheBestEffort(cache, urls) {
  const tasks = urls.map(async (u) => {
    try {
      const abs = toAbsUrl(u);
      const req = new Request(abs, { cache: "no-store" });
      const res = await fetch(req);
      if (!res.ok) throw new Error(`precache skip: ${res.status} ${abs}`);
      await cache.put(req, res.clone());
    } catch (_) {
      // 404等が混じっても落とさない
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
      const fb = await caches.match(toAbsUrl(fallbackUrl));
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

  // 2) cards-hub の“鮮度優先ターゲット”：network-first
  if (isCardsHubFreshTarget(req.url)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 3) 同一オリジンの静的ファイル：cache-first + 背景更新
  if (isSameOrigin(req.url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) {
        event.waitUntil(
          fetch(req)
            .then((res) => cachePutSafe(req, res))
            .catch(() => {})
        );
        return cached;
      }

      // キャッシュが無い場合：ネット優先。ただし落ちたら “せめて index.html” へ
      try {
        const res = await fetch(req);
        await cachePutSafe(req, res);
        return res;
      } catch (e) {
        const fb = await caches.match(toAbsUrl("./index.html"));
        if (fb) return fb;
        throw e;
      }
    })());
    return;
  }

  // 4) クロスオリジンは素通し（キャッシュしない）
});
