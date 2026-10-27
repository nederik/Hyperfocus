/**
 * Node entry point (local use and Docker): SQLite database and uploads in the data folder.
 * `npm run dev`: API only (Vite serves the page and proxies /api). `npm start`: everything on one port.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createClient } from '@libsql/client';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { Hono } from 'hono';
import { createApp } from './app';
import { migrate, one } from './db';
import { localStorage } from './storage-local';
import { canReadUpload } from './auth';
import { DATA_DIR, SERVER_DIR, loadEnv, readConfig } from './config';

// "npm start" passes this flag (works on Windows too, unlike setting NODE_ENV inline).
if (process.argv.includes('--production')) process.env.NODE_ENV = 'production';
loadEnv();
const config = readConfig();
const isProd = process.env.NODE_ENV === 'production';
const uploadsDir = resolve(DATA_DIR, 'uploads');
const distDir = resolve(SERVER_DIR, '..', 'client', 'dist');
mkdirSync(uploadsDir, { recursive: true });

const db = createClient({ url: config.databaseUrl, authToken: config.databaseAuthToken });
await migrate(db);

let htmlCache: string | null = null;
const readHtml = async () => {
  if (isProd && htmlCache) return htmlCache;
  const p = resolve(distDir, 'index.html');
  if (!existsSync(p)) return null;
  const html = await readFile(p, 'utf8');
  if (isProd) htmlCache = html;
  return html;
};
const serveDist = existsSync(resolve(distDir, 'index.html'));

const root = new Hono();
// serveStatic wants paths relative to the working directory.
const rel = (p: string) => relative(process.cwd(), p).replace(/\\/g, '/') || '.';
const forever = { onFound: (_p: string, c: import('hono').Context) => c.header('Cache-Control', 'public, max-age=31536000, immutable') };

// Uploaded files only for the signed-in owner; the encrypted ones are never served from here.
root.use('/uploads/*', async (c, next) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/uploads\//, ''));
  if (!(await canReadUpload(db, config, key, c.req.header('cookie')))) return c.text('Not found', 404);
  await next();
});
root.use(
  '/uploads/*',
  serveStatic({
    root: rel(uploadsDir),
    rewriteRequestPath: (p) => p.replace(/^\/uploads/, ''),
    onFound: (_p, c) => c.header('Cache-Control', 'private, max-age=31536000, immutable'),
  }),
);
if (serveDist) {
  root.use('/assets/*', serveStatic({ root: rel(distDir), ...forever }));
  for (const dir of ['/fonts/*', '/dicts/*', '/wordnet/*', '/rhymes/*']) root.use(dir, serveStatic({ root: rel(distDir) }));
  for (const f of ['/favicon.svg', '/robots.txt']) root.get(f, serveStatic({ root: rel(distDir) }));
}

root.route(
  '/',
  createApp({
    db,
    config,
    storage: localStorage(uploadsDir),
    clientIp: (c) => {
      const fwd = c.req.header('x-forwarded-for');
      if (fwd && process.env.TRUST_PROXY === '1') return fwd.split(',')[0]!.trim();
      try {
        return getConnInfo(c).remote.address ?? 'unknown';
      } catch {
        return 'unknown';
      }
    },
    readHtml: serveDist ? readHtml : undefined,
  }),
);

serve({ fetch: root.fetch, port: config.port, hostname: config.host }, async (info) => {
  const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
  const owner = await one(db, 'SELECT 1 FROM owner WHERE id = 1');
  console.log(`\n  Hyperfocus ${isProd ? '' : 'API '}→ http://${shown}:${info.port}`);
  if (!isProd) console.log('  Open the app at http://localhost:5173');
  if (!owner) console.log(`  First start: open the app and create your account${config.setupToken ? ' (setup code required)' : ''}.`);
  if (!owner && isProd && !config.setupToken && config.host !== '127.0.0.1')
    console.warn('  Warning: SETUP_TOKEN is not set, so anyone who reaches this server first can create the account. Set it if others can reach it.');
  console.log(`  Data folder: ${DATA_DIR}\n`);
});
