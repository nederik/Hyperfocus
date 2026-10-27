/**
 * Cloudflare Pages build: adds the server to the Vite output (client/dist) as _worker.js.
 * Build the front end first (`npm run build`); `npm run build:cf` at the root does both.
 */
import { build } from 'esbuild';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const dist = resolve(root, 'client/dist');
if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Build the front end first: npm run build');

await build({
  entryPoints: [resolve(root, 'server/src/cloudflare/worker.ts')],
  outfile: resolve(dist, '_worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'worker', 'browser'],
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
});

// Static files are served without running the worker at all (saves the free request quota).
writeFileSync(
  resolve(dist, '_routes.json'),
  JSON.stringify({ version: 1, include: ['/*'], exclude: ['/assets/*', '/fonts/*', '/dicts/*', '/wordnet/*', '/rhymes/*', '/favicon.svg', '/robots.txt'] }, null, 2),
);
console.log('✓ client/dist/_worker.js and _routes.json are ready');
