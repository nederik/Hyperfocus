import { sign, verify } from 'hono/jwt';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Client } from '@libsql/client';
import type { Context, MiddlewareHandler } from 'hono';
import { one } from './db';
import type { AppEnv, Config } from './types';

// Cloudflare Workers caps PBKDF2 at 100,000 iterations, so the same number is used everywhere
// (a database can move between Node and Cloudflare).
const ITERATIONS = 100_000;
const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const got = new Uint8Array(await pbkdf2(password, unb64(salt), Number(iter)));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ want[i]!;
  return diff === 0;
}

/** Compares two strings in constant time (for the setup code). */
export function sameText(a: string, b: string) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export const COOKIE = 'hyperfocus_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** Is the request over HTTPS (directly, or through a proxy/tunnel that terminates TLS)? */
const isHttps = (c: Context) => new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';

/**
 * Signs the owner in. Changing the password bumps session_version, which signs out every other device.
 * The cookie is marked Secure whenever the site is reached over HTTPS (plain http://localhost works too).
 */
export async function startSession(c: Context<AppEnv>, sessionVersion: number) {
  const token = await sign(
    { sv: sessionVersion, scope: 'session', exp: Math.floor(Date.now() / 1000) + MAX_AGE },
    c.var.config.sessionSecret,
    'HS256',
  );
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Strict', secure: isHttps(c), path: '/', maxAge: MAX_AGE });
}

export function endSession(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE, { path: '/' });
}

/**
 * A short-lived ticket after the password, when two-step sign-in is on. It is not a session:
 * the code from the authenticator app (or a recovery code) has to come with it.
 */
export const signTicket = (c: Context<AppEnv>, sessionVersion: number) =>
  sign({ sv: sessionVersion, scope: '2fa', exp: Math.floor(Date.now() / 1000) + 300 }, c.var.config.sessionSecret, 'HS256');

/** Is this a valid session token of the owner (not a two-step ticket)? */
export async function isOwnerToken(db: Client, config: Config, token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const p = (await verify(token, config.sessionSecret, 'HS256')) as { sv: number; scope?: string };
    // Sessions made before scopes existed have none; the two-step ticket is never a session
    if (p.scope && p.scope !== 'session') return false;
    const o = await one<{ session_version: number }>(db, 'SELECT session_version FROM owner WHERE id = 1');
    return !!o && Number(o.session_version) === p.sv;
  } catch {
    return false; // expired or tampered: treat as signed out
  }
}

/** Lets the request through only for the signed-in owner. */
export const requireOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (await isOwnerToken(c.var.db, c.var.config, getCookie(c, COOKIE))) return next();
  return c.json({ error: 'Please sign in' }, 401);
};

/** Reads one cookie from a Cookie header. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * May this /uploads/... request be served? Every uploaded file belongs to the owner, so only their session can read it.
 * The library's and the books' encrypted files (vault/…, assets/…) are never served from this address.
 */
export async function canReadUpload(db: Client, config: Config, key: string, cookieHeader: string | null | undefined) {
  if (!key || key.includes('..') || key.startsWith('vault/') || key.startsWith('assets/')) return false;
  return isOwnerToken(db, config, readCookie(cookieHeader, COOKIE));
}

/** Simple in-memory rate limiter (enough for one server). */
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return true;
    }
    h.n++;
    return h.n <= limit;
  };
}
