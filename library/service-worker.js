const cacheName = "book-ledger-v3";
const assets = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./vendor/zxing.min.js",
  "./BerkeleyMonoVariable-Regular.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(cacheName).then((cache) => cache.addAll(assets))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== cacheName)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const isNavigate =
    event.request.mode === "navigate" ||
    event.request.destination === "document";
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isStaticAsset = ["script", "style", "font", "image"].includes(
    event.request.destination
  );

  if (isNavigate) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(cacheName).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  if (isSameOrigin && isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const responseClone = response.clone();
          caches.open(cacheName).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(fetch(event.request));
});
