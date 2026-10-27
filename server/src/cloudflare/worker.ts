/**
 * Cloudflare Pages entry point (built as _worker.js, "advanced mode").
 * Runs the same Hono app with D1 (database) and KV (uploaded images and music).
 */
import { Hono } from 'hono';
import { createApp } from '../app';
import { canReadUpload } from '../auth';
import { migrate } from '../db';
import type { Config } from '../types';
import { d1Client } from './d1';
import { kvStorage, serveKvUpload } from './storage-kv';
import type { CloudflareEnv } from './types';

/** Cloudflare free plan: KV 1 GB (images + music), D1 database 500 MB. */
const LIMITS = { media: 1e9, db: 500 * 1000 ** 2 };

let cached: Hono | null = null;
let migrated: Promise<void> | null = null;

/** The page from the Pages static server (following clean-URL redirects). */
async function readIndex(env: CloudflareEnv, origin: string): Promise<string | null> {
  let url = new URL('/index.html', origin).toString();
  for (let i = 0; i < 3; i++) {
    const res = await env.ASSETS.fetch(new Request(url, { redirect: 'manual' }));
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    return res.ok ? res.text() : null;
  }
  return null;
}

function buildApp(env: CloudflareEnv, origin: string) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    throw new Error('Set the SESSION_SECRET secret (at least 32 characters): npx wrangler pages secret put SESSION_SECRET');
  const config: Config = {
    sessionSecret: env.SESSION_SECRET,
    setupToken: env.SETUP_TOKEN || undefined,
    setupTokenRequired: true,
    storageLimits: LIMITS,
  };
  let html: string | null = null;
  const db = d1Client(env.DB);
  const root = new Hono();

  // Uploaded files only for the signed-in owner; the encrypted ones are never served from here.
  root.get('/uploads/*', async (c) => {
    const key = decodeURIComponent(c.req.path.replace(/^\/uploads\//, ''));
    if (!(await canReadUpload(db, config, key, c.req.header('cookie')))) return new Response('Not found', { status: 404 });
    return serveKvUpload(env.UPLOADS, key, c.req.header('range'));
  });
  // Built JS/CSS, fonts and dictionaries come straight from the static server (see _routes.json).
  root.get('/assets/*', (c) => env.ASSETS.fetch(c.req.raw));

  root.route(
    '/',
    createApp({
      db,
      config,
      storage: kvStorage(env.UPLOADS),
      clientIp: (c) => c.req.header('cf-connecting-ip') ?? 'unknown',
      readHtml: async () => (html ??= await readIndex(env, origin)),
    }),
  );
  return root;
}

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: unknown) {
    // A fresh D1 database sets itself up on the first request (tables are created if missing).
    migrated ??= migrate(d1Client(env.DB), { pragma: false }).catch((e) => {
      migrated = null;
      throw e;
    });
    await migrated;
    cached ??= buildApp(env, new URL(request.url).origin);
    return cached.fetch(request, env, ctx as never);
  },
};
