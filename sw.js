/* Service worker de Deal : app disponible hors ligne et mise à jour automatique (même mécanique que Tribu).
   - Chaque version (version.js) a son propre cache, préfixé par l'adresse du site (test et prod ne se mélangent pas).
   - Les appels à n8n et les photos LeBonCoin (autres domaines) ne passent jamais par le cache. */
importScripts('version.js');

const PREFIX = 'deal|' + self.registration.scope + '|';
const CACHE = PREFIX + self.DEAL_VERSION;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(self.location.hostname) || !/github\.io$/.test(self.location.hostname);

const ASSETS = [
  './', 'index.html', 'css/app.css', 'version.js',
  'js/scoring.js', 'js/sync.js', 'js/qr.js', 'js/app.js', 'js/liste.js', 'js/fiche.js', 'js/reglages.js',
  'manifest.webmanifest', 'manifest-test.webmanifest',
  'fonts/fredoka-latin-500-normal.woff2', 'fonts/fredoka-latin-600-normal.woff2',
  'fonts/nunito-latin-400-normal.woff2', 'fonts/nunito-latin-600-normal.woff2',
  'fonts/nunito-latin-700-normal.woff2', 'fonts/nunito-latin-800-normal.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
  'icons/test-icon.svg', 'icons/test-icon-192.png', 'icons/test-icon-512.png', 'icons/test-maskable-512.png', 'icons/test-apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  if (e.data === 'version' && e.source) e.source.postMessage({ type: 'version', version: self.DEAL_VERSION });
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (LOCAL) {   // PC (développement) : réseau d'abord
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true }).then(hit => {
    if (hit) return hit;
    if (req.mode === 'navigate') return c.match('index.html').then(r => r || fetch(req));
    return fetch(req);
  })));
});
