// Service worker: makes Emberwood installable and playable offline.
//  - Code (html/js/css/manifest): network first, so a `git pull` on the server reaches players
//    immediately; the cached copy is used only when offline.
//  - Models, textures, fonts, three.js from the CDN: cache first (they rarely change), refreshed
//    in the background.
const CACHE = 'emberwood-v1';
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

function cacheable(url) {
  const u = new URL(url);
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
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./'))),
    );
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
