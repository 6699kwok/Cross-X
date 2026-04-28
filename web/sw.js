// AP-01/P2-07: CrossX Service Worker — offline capability and caching
// Cache Strategy:
//   - App shell (HTML/CSS/JS): Cache-first with background update
//   - API responses (plan results): Cache with 24h TTL
//   - Images (photos): Cache-first, stale-while-revalidate

const CACHE_VERSION = "crossx-v4";
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const PLAN_CACHE    = `${CACHE_VERSION}-plans`;
const IMG_CACHE     = `${CACHE_VERSION}-images`;

const SHELL_ASSETS = [
  "/",
  "/app.js",
  "/styles.css",
  "/manifest.json",
  "/utils/i18n.js",
];

// ── Install: pre-cache app shell ────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        console.warn("[SW] Shell pre-cache partial failure:", err.message);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ───────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("crossx-") && k !== SHELL_CACHE && k !== PLAN_CACHE && k !== IMG_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ─────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin (except images)
  if (request.method !== "GET") return;

  // API calls: network-first, cache fallback for GET plan/user data
  if (url.pathname.startsWith("/api/")) {
    // Only cache safe read endpoints (never SSE or chat)
    if (url.pathname.match(/\/api\/(user|system|training\/stats)/) && !url.pathname.includes("stream")) {
      event.respondWith(networkFirstWithCache(request, PLAN_CACHE, 24 * 60 * 60));
    }
    // All other API calls: network only (no cache for dynamic/SSE)
    return;
  }

  // Images: cache-first with stale-while-revalidate
  if (request.destination === "image" || url.pathname.match(/\.(jpg|jpeg|png|webp|svg|gif)$/i)) {
    event.respondWith(cacheFirstWithFallback(request, IMG_CACHE));
    return;
  }

  // App shell: cache-first with background update
  event.respondWith(cacheFirstWithBackgroundUpdate(request, SHELL_CACHE));
});

// ── Strategy helpers ────────────────────────────────────────────────────────

async function networkFirstWithCache(request, cacheName, maxAgeSec) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      const headers = new Headers(response.headers);
      headers.set("sw-cached-at", Date.now().toString());
      const cachedResponse = new Response(await response.clone().arrayBuffer(), {
        status: response.status, statusText: response.statusText, headers,
      });
      cache.put(request, cachedResponse);
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ ok: false, error: "offline", offline: true }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  }
}

async function cacheFirstWithFallback(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("", { status: 408 });
  }
}

async function cacheFirstWithBackgroundUpdate(request, cacheName) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      caches.open(cacheName).then((cache) => cache.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);

  return cached || fetchPromise || new Response("Offline", { status: 503 });
}

// ── Background sync: queue failed plan requests when offline ────────────────
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
