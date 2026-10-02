// Service worker: makes Emberwood installable and playable offline.
//  - The site's own code (html/js/css/manifest): network first, so a `git pull` on the server reaches
//    players at once; but when the host is slow to answer (PATIENCE), the saved copy is used and the new
//    one kept for next time (the update banner says so); offline, the saved copy.
//  - Everything from the CDNs (the game's code and models from jsDelivr, pinned to a version; three.js,
//    fonts): cache first, refreshed in the background.
const CACHE = 'emberwood-v1';
const PATIENCE = 3500; // ms
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png'];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page sends the list of everything it loaded, so the whole game is available offline.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache') return;
  const urls = (event.data.urls || []).filter(cacheable);
  event.waitUntil(caches.open(CACHE).then(async (c) => {
    for (const u of urls) {
      if (!(await c.match(u))) await c.add(u).catch(() => {});
    }
  }));
});

// (version.json says whether a newer game is out: always from the network, never kept)
function cacheable(url) {
  const u = new URL(url);
  if (u.pathname.endsWith('/version.json')) return false;
  return u.origin === self.location.origin || CDN_HOSTS.includes(u.hostname);
}

function isCode(url) {
  return url.origin === self.location.origin && (url.pathname.endsWith('/') || /\.(html|js|css|webmanifest)$/.test(url.pathname));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!cacheable(req.url)) return;

  if (isCode(url) || req.mode === 'navigate') {
    // always ask the server (cache: 'no-cache' revalidates), whatever caching headers the host sends, so
    // an update reaches players straight away; a navigation can't be re-made with options, so use its URL
    const fresh = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' });
    const saved = fresh.then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    });
    event.waitUntil(saved.catch(() => {})); // (finish saving it even if the page got the old copy)
    event.respondWith((async () => {
      const cached = (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await caches.match('./') : undefined);
      const net = saved.catch(() => cached || caches.match('./'));
      if (!cached) return net;
      return Promise.race([net, new Promise((r) => setTimeout(() => r(cached), PATIENCE))]);
    })());
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok || res.type === 'opaque') caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
