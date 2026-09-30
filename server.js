// Tiny static file server for hosting Emberwood as a Node.js app (e.g. cPanel/DirectAdmin
// "Setup Node.js App"). Only Node built-ins: no `npm install` needed.
// Usage: node server.js   (listens on $PORT, default 3000)
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.md', '.txt', '.svg', '.gltf', '.bin']);
const NO_CACHE = new Set(['.html', '.js', '.css']); // code changes on every deploy
const PRIVATE = new Set(['server.js', 'package.json']);

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function resolvePath(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const parts = rel.split('/').filter(Boolean);
  // hide dotfiles (.git, .htaccess…) and the server's own files
  if (parts.some((p) => p.startsWith('.')) || (parts.length === 1 && PRIVATE.has(parts[0]))) return null;
  const full = path.join(ROOT, ...parts);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let file = resolvePath(req.url);
  if (!file) return send(res, 404, 'Not found');

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      file = path.join(file, 'index.html');
      return fs.stat(file, (err2, st2) => serve(req, res, file, err2, st2));
    }
    serve(req, res, file, err, st);
  });
});

function serve(req, res, file, err, st) {
  if (err || !st.isFile()) return send(res, 404, 'Not found');
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': NO_CACHE.has(ext) ? 'no-cache' : 'public, max-age=604800',
    'Last-Modified': st.mtime.toUTCString(),
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const gzip = COMPRESSIBLE.has(ext) && st.size > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gzip) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  } else {
    headers['Content-Length'] = st.size;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  if (gzip) stream.pipe(zlib.createGzip()).pipe(res);
  else stream.pipe(res);
}

server.listen(PORT, () => console.log(`Emberwood running on port ${PORT}`));
