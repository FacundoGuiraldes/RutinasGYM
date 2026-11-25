// Service worker mínimo: guarda la "cáscara" de la app para que abra rápido y sin conexión.
// Los datos (/api) y los GIFs nunca se guardan acá: siempre se piden a la red.
const CACHE = "rutina-shell-v1";
const SHELL = ["/", "/styles.css", "/app.js", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/") || url.pathname.startsWith("/admin")) return;
  // Red primero (siempre la versión nueva); si no hay conexión, lo guardado
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && (SHELL.includes(url.pathname) || url.pathname.startsWith("/s/"))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(url.pathname.startsWith("/s/") ? "/" : e.request, copy));
      }
      return res;
    }).catch(() => caches.match(url.pathname.startsWith("/s/") ? "/" : e.request))
  );
});
