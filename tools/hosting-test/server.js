// Hosting test, not part of the game: can this host keep a Node.js program running, hold live
// WebSocket connections open and answer quickly, the way the online game server will have to?
// No dependencies. Run it as a Node.js app, then measure it with client.mjs (see README.md).
'use strict';
const http = require('http');
const crypto = require('crypto');
const os = require('os');

const started = Date.now();
const clients = new Set();
let messages = 0;
let upgrades = 0;

process.on('uncaughtException', (err) => console.error('uncaught', err));

// ---------------------------------------------------------------- a minimal WebSocket server (RFC 6455)
function frame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) head = Buffer.from([0x80 | opcode, 126, len >> 8, len & 255]);
  else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

function send(c, text) {
  if (!c.socket.destroyed) c.socket.write(frame(0x1, Buffer.from(text)));
}

function readFrames(c) {
  for (;;) {
    const buf = c.buf;
    if (buf.length < 2) return;
    const op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f, off = 2;
    if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
    const maskAt = off;
    if (masked) off += 4;
    if (buf.length < off + len) return;
    const data = Buffer.from(buf.subarray(off, off + len));
    if (masked) for (let i = 0; i < data.length; i++) data[i] ^= buf[maskAt + (i & 3)];
    c.buf = buf.subarray(off + len);
    if (op === 0x8) { c.socket.end(frame(0x8, Buffer.alloc(0))); return; } // close
    if (op === 0x9) { c.socket.write(frame(0xa, data)); continue; } // ping -> pong
    if (op === 0x1) {
      messages++;
      const text = data.toString();
      if (text.startsWith('ping:')) send(c, `pong:${text.slice(5)}:${process.pid}`);
    }
  }
}

function upgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  upgrades++;
  const c = { socket, buf: Buffer.alloc(0) };
  clients.add(c);
  socket.on('data', (d) => { c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : d; readFrames(c); });
  const drop = () => clients.delete(c);
  socket.on('close', drop);
  socket.on('error', drop);
}

// what a game server does: 20 world updates a second to everyone connected
setInterval(() => {
  const msg = JSON.stringify({ t: Date.now(), n: clients.size });
  for (const c of clients) send(c, msg);
}, 50);

// ---------------------------------------------------------------- plain HTTP: status and a CPU probe
function status() {
  return {
    ok: true, node: process.version, pid: process.pid, uptimeS: Math.round((Date.now() - started) / 1000),
    clients: clients.size, upgrades, messages, cpus: os.cpus().length, load: os.loadavg().map((v) => +v.toFixed(2)),
    rssMB: Math.round(process.memoryUsage().rss / 1048576), freeMB: Math.round(os.freemem() / 1048576), totalMB: Math.round(os.totalmem() / 1048576),
  };
}

const server = http.createServer((req, res) => {
  let body;
  if (req.url.startsWith('/cpu')) { // how much arithmetic fits in half a second on this host
    const end = Date.now() + 500;
    let rounds = 0, x = 0;
    while (Date.now() < end) { for (let i = 1; i < 100000; i++) x += Math.sqrt(i); rounds++; }
    body = { rounds, pid: process.pid, check: Math.round(x) % 7 };
  } else {
    body = status();
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
});
server.on('upgrade', upgrade);
const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`hosting test listening on ${port}`));
