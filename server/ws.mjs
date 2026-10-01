// A small WebSocket server (RFC 6455) on Node's http module, so the game server needs no packages.
// Text messages only. Handles fragmented messages, ping/pong keep-alive, closing, a size limit,
// an origin check and slow readers.
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const PING_EVERY = 25000; // keeps proxies from closing a quiet connection
const DEAD_AFTER = 70000; // nothing heard for this long: the client is gone
const MAX_BUFFERED = 2 * 1024 * 1024; // a client this far behind gets dropped

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

export class Connection {
  constructor(socket, req, maxMessage) {
    this.socket = socket;
    // behind the host's web server the real address comes in X-Forwarded-For
    this.ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || socket.remoteAddress || '?';
    this.open = true;
    this.maxMessage = maxMessage;
    this.buf = Buffer.alloc(0);
    this.parts = null; // pieces of a fragmented message
    this.heard = Date.now();
    this.onmessage = null;
    this.onclose = null;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.receive(d));
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
  }

  send(msg) {
    if (!this.open) return;
    if (this.socket.writableLength > MAX_BUFFERED) { this.terminate(); return; }
    this.socket.write(frame(0x1, Buffer.from(typeof msg === 'string' ? msg : JSON.stringify(msg))));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const r = Buffer.from(reason).subarray(0, 120);
    const payload = Buffer.concat([Buffer.from([code >> 8, code & 255]), r]);
    this.socket.end(frame(0x8, payload));
    this.closed();
  }

  terminate() {
    this.socket.destroy();
    this.closed();
  }

  closed() {
    if (!this.open) return;
    this.open = false;
    this.unlink?.();
    this.onclose?.();
  }

  receive(d) {
    this.heard = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const buf = this.buf;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > this.maxMessage) { this.close(1009, 'too big'); return; }
      const maskAt = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const data = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < data.length; i++) data[i] ^= buf[maskAt + (i & 3)];
      this.buf = buf.subarray(off + len);
      if (op === 0x8) { this.close(1000); return; }
      if (op === 0x9) { this.socket.write(frame(0xa, data)); continue; }
      if (op === 0xa) continue; // pong
      if (op === 0x1 || op === 0x0) {
        if (op === 0x1) this.parts = [];
        if (!this.parts) continue; // stray continuation
        this.parts.push(data);
        if (this.parts.reduce((n, p) => n + p.length, 0) > this.maxMessage) { this.close(1009, 'too big'); return; }
        if (fin) {
          const text = Buffer.concat(this.parts).toString('utf8');
          this.parts = null;
          this.onmessage?.(text);
        }
      }
    }
  }
}

// Accept WebSocket upgrades on `path` and hand each new Connection to onConnection.
export function attachWebSocket(server, { path = '/ws', maxMessage = 256 * 1024, allowOrigin = () => true, onConnection }) {
  const conns = new Set();
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://local');
    const key = req.headers['sec-websocket-key'];
    const reject = (code, text) => socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
    if (url.pathname !== path || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') return reject(400, 'Bad Request');
    if (!allowOrigin(String(req.headers.origin || ''))) return reject(403, 'Forbidden');
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const conn = new Connection(socket, req, maxMessage);
    conns.add(conn);
    conn.unlink = () => conns.delete(conn);
    onConnection(conn);
  });
  // keep-alive pings; drop connections that went silent
  setInterval(() => {
    const now = Date.now();
    for (const c of conns) {
      if (now - c.heard > DEAD_AFTER) c.terminate();
      else if (c.open) c.socket.write(frame(0x9, Buffer.alloc(0)));
    }
  }, PING_EVERY).unref();
  return conns;
}
