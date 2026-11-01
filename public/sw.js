// Penteint Projects service worker: lets the installed app open without a connection.
// Pages: network first (always the newest version when online), cached copy when offline.
// Built files (/assets, /board, /icons): cached after first use; their names change on
// every release, so old copies are simply never asked for again.
// Team data isn't handled here: Firestore keeps its own offline copy.
const CACHE = 'tt-shell-v5';   // v5: drops any page saved by mistake in place of a script (see below)
const SHELL = ['/', '/index.html', '/boot/theme.js', '/boot/loading.js', '/boot/landing.js', '/manifest.webmanifest', '/icons/icon-192.png'];

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
    // Only the app itself is kept for offline use: a blog post, the demo page or a landing page
    // must never become the cached copy of the app.
    const app = url.pathname === '/' || url.pathname === '/index.html';
    e.respondWith(fetch(req).then(r => { if (app && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put('/index.html', copy)); } return r; })
      .catch(() => caches.match('/index.html').then(r => r || caches.match('/'))));
    return;
  }
  // The page's start-up scripts (/boot: theme, landing page) keep their names: network first, like pages.
  if (url.pathname.startsWith('/boot/')) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; }).catch(() => caches.match(req)));
    return;
  }
  if (/^\/(assets|board|icons)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    // Only keep real files: after a deploy an old file's name can come back as a page (or a 404), and keeping
    // that would break the app until the cache was cleared.
    const keep = (r) => r.ok && !/text\/html/.test(r.headers.get('content-type') || '');
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (keep(r)) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })));
  }
});
