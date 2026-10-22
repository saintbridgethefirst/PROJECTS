// Trawpie service worker: lets the installed app open without a connection.
// Pages: network first (always the newest version when online), cached copy when offline.
// Built files (/assets, /board, /icons): cached after first use; their names change on
// every release, so old copies are simply never asked for again.
// Team data isn't handled here: Firestore keeps its own offline copy.
const CACHE = 'tt-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/__/')) return;   // Firebase, Google, sign-in handler: leave alone
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('/index.html', copy)); return r; })
      .catch(() => caches.match('/index.html').then(r => r || caches.match('/'))));
    return;
  }
  if (/^\/(assets|board|icons)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })));
  }
});
