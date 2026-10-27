import type { Client } from '@libsql/client';
import type { Context } from 'hono';

export interface Config {
  /** Signs the session cookie. At least 32 characters. */
  sessionSecret: string;
  /**
   * When set, creating the owner account on first start asks for this code.
   * Always set it on a server that others can reach, so nobody else can claim your installation first.
   */
  setupToken?: string;
  /** Refuse to create the account until a setup code is configured (Cloudflare: the site is public from the start). */
  setupTokenRequired?: boolean;
  /** Free-tier quotas shown in the storage meter (Cloudflare). null: no fixed quota (local / Docker). */
  storageLimits: { media: number; db: number } | null;
}

export interface StoredFile {
  key: string;
  url: string;
}

/** Where uploaded images and music are kept: a folder on disk (Node) or Cloudflare KV. */
export interface StorageAdapter {
  put(key: string, data: ArrayBuffer, contentType: string): Promise<StoredFile>;
  delete(key: string): Promise<void>;
  /** The file's bytes (null if there is none). The encrypted library files are read through the API like this. */
  get(key: string): Promise<ArrayBuffer | null>;
}

export interface Deps {
  db: Client;
  config: Config;
  storage: StorageAdapter;
  clientIp: (c: Context) => string;
  /** Returns the built index.html (production only; in development Vite serves it). */
  readHtml?: () => Promise<string | null>;
}

export type AppEnv = {
  Variables: {
    db: Client;
    config: Config;
    storage: StorageAdapter;
    clientIp: string;
  };
};
