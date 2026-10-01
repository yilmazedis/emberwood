// Passwords (scrypt with a per-account salt) and session tokens. A token is "<account>.<expiry>.<signature>"
// signed with the server's secret, so staying signed in survives a server restart.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 32;
const TOKEN_DAYS = 30;

export async function hashPassword(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(pass, salt, KEYLEN)).toString('hex');
  return { salt, hash };
}

export async function checkPassword(pass, salt, hash) {
  const got = await scrypt(pass, salt, KEYLEN);
  const want = Buffer.from(hash, 'hex');
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}

const sign = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('base64url');

export function makeToken(secret, lower) {
  const body = `${lower}.${Date.now() + TOKEN_DAYS * 86400000}`;
  return `${body}.${sign(secret, body)}`;
}

// The account name in a valid, unexpired token; otherwise null.
export function readToken(secret, token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [lower, expiry, sig] = parts;
  const want = sign(secret, `${lower}.${expiry}`);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (!(Number(expiry) > Date.now())) return null;
  return lower;
}
