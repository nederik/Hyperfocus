import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Config } from './types';

export const SERVER_DIR = resolve(import.meta.dirname, '..');
export const ENV_FILE = resolve(SERVER_DIR, '.env');
/** Database and uploaded files (local / Docker). Override with DATA_DIR. */
export const DATA_DIR = resolve(process.env.DATA_DIR ?? resolve(SERVER_DIR, 'data'));

export function loadEnv() {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
}

/**
 * Session secret: SESSION_SECRET if set, otherwise a random one created on first start
 * and kept in the data folder (so sign-ins survive restarts).
 */
function sessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET ?? '';
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters long.');
    return fromEnv;
  }
  mkdirSync(DATA_DIR, { recursive: true });
  const file = resolve(DATA_DIR, '.session-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  const secret = btoa(String.fromCharCode(...bytes));
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function readConfig(): Config & { port: number; host: string; databaseUrl: string; databaseAuthToken?: string } {
  const isProd = process.env.NODE_ENV === 'production';
  // Production: PORT (set by most hosts). Development: API_PORT, which the Vite dev server proxies to.
  const port = Number((isProd ? process.env.PORT : process.env.API_PORT) ?? (isProd ? 3000 : 8787));
  return {
    sessionSecret: sessionSecret(),
    setupToken: process.env.SETUP_TOKEN || undefined,
    storageLimits: null,
    port,
    host: process.env.HOST ?? (isProd ? '0.0.0.0' : '127.0.0.1'),
    databaseUrl: process.env.DATABASE_URL ?? `file:${resolve(DATA_DIR, 'hyperfocus.db').replace(/\\/g, '/')}`,
    databaseAuthToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  };
}
