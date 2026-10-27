/** The minimum Cloudflare runtime types this project needs (instead of adding the full type package). */

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  meta: { last_row_id?: number; changes?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface KVNamespace {
  put(key: string, value: ArrayBuffer, options?: { metadata?: Record<string, string> }): Promise<void>;
  getWithMetadata<M = Record<string, string>>(key: string, type: 'arrayBuffer'): Promise<{ value: ArrayBuffer | null; metadata: M | null }>;
  delete(key: string): Promise<void>;
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
}

export interface Fetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

export interface CloudflareEnv {
  DB: D1Database;
  UPLOADS: KVNamespace;
  ASSETS: Fetcher;
  /** Secret: signs the session cookie (at least 32 characters). */
  SESSION_SECRET: string;
  /** Secret: the code asked for when creating the owner account. Required on Cloudflare. */
  SETUP_TOKEN?: string;
}
