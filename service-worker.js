const CACHE_NAME = 'hvat-static-v4';
const ASSETS = [
  './', './index.html', './manifest.json', './styles/main.css',
  './js/init.js', './js/ui.js', './js/formulas.js', './js/finders.js',
  './js/workout-ui.js', './js/workout-db.js', './js/workout-model.js',
  './fonts/manrope-variable.ttf', './fonts/sora-variable.ttf',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(async () => (await caches.match(event.request)) ||
    (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
