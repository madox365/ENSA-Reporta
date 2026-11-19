// Service worker: guarda la interfaz del cliente para que abra rápido y funcione como app.
// Los datos (API) siempre se piden al servidor; no se guardan datos personales en caché.
const CACHE = 'ensa-reporta-v3';
const ARCHIVOS = ['/', '/index.html', '/css/app.css', '/js/comun.js', '/js/cliente.js', '/manifest.webmanifest', '/img/icono.svg', '/img/icono-192.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/personal')) return;
  // Red primero; si no hay conexión, la copia guardada
  e.respondWith(fetch(e.request).then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
