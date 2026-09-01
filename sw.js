/* BTC Advisor service worker — cache app shell, never fake live prices. */
const CACHE = "btc-advisor-v3";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./engine.js",
  "./ui.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const liveHost = /binance\.|coinbase\.com|kraken\.com|frankfurter\.app/.test(url.hostname);
  if (liveHost) {
    e.respondWith(fetch(e.request).catch(function () { return new Response("[]", { status: 504, headers: { "Content-Type": "application/json" } }); }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      const net = fetch(e.request).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
