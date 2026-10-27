import { Hono, type Context } from 'hono';
import {
  DEFAULT_PAGE_CAPACITY,
  accountUpdateSchema,
  bookImageSchema,
  bookNoteSchema,
  bookUpdateSchema,
  chapterUpdateSchema,
  dictionaryUpdateSchema,
  loginSchema,
  notebookUpdateSchema,
  noteTabSchema,
  passwordChangeSchema,
  setupSchema,
  type BookChapter,
  type BookFull,
  type BookImage,
  type BookNote,
  type BookSummary,
  type NotebookSummary,
  type NoteTab,
  type SetupStatus,
  type ShelfResponse,
  type StorageUsage,
} from '@hyperfocus/shared';
import { z } from 'zod';
import { all, nowIso, one, run } from '../db';
import { verify } from 'hono/jwt';
import type { Client } from '@libsql/client';
import { endSession, hashPassword, rateLimiter, requireOwner, sameText, signTicket, startSession, verifyPassword } from '../auth';
import { checkTotp, newRecoveryCodes, newTotpSecret, normalizeRecovery, openSecret, otpauthUri, sealSecret, sha256Hex } from '../totp';
import { saveAudioUpload, saveImageUpload } from '../uploads';
import type { AppEnv } from '../types';

const loginLimit = rateLimiter(8, 15 * 60_000);
const codeLimit = rateLimiter(10, 15 * 60_000);
let dummyHash: Promise<string> | null = null;

/** Two-step sign-in state (owner.two_factor, JSON). On when `secret` is set. */
interface TwoFactor {
  /** The encrypted TOTP secret. */
  secret?: string;
  /** A secret waiting to be confirmed while setting up (encrypted). */
  pending?: string;
  /** SHA-256 hashes of the unused recovery codes. */
  recovery?: string[];
  /** The last 30 s step accepted (the same code is not accepted twice). */
  lastStep?: number;
  /** Wrong codes in a row; 5 locks for 15 minutes. */
  fails?: number;
  lockedUntil?: number;
}
const MAX_CODE_FAILS = 5;
const LOCK_MS = 15 * 60_000;

const parse2fa = (json: string | null | undefined): TwoFactor => {
  try {
    const v = JSON.parse(json || '{}') as TwoFactor;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

/** Writes the two-step record only if it has not changed since it was read (two requests at once cannot both win). */
async function save2fa(db: Client, prev: string | null, next: TwoFactor | null) {
  const r = await run(db, 'UPDATE owner SET two_factor = ? WHERE id = 1 AND two_factor IS ?', [next ? JSON.stringify(next) : null, prev]);
  return r.rowsAffected > 0;
}

/**
 * Checks the second step: the 6-digit app code or (when allowed) a recovery code.
 * Returns the updated record when accepted, otherwise null.
 */
async function verifyFactor(tf: TwoFactor, code: string, sessionSecret: string, allowRecovery: boolean): Promise<{ next: TwoFactor; usedRecovery: boolean } | null> {
  const secret = tf.secret ? await openSecret(sessionSecret, tf.secret) : null;
  if (secret) {
    const step = await checkTotp(secret, code, tf.lastStep ?? 0);
    if (step !== null) return { next: { ...tf, lastStep: step, fails: 0, lockedUntil: undefined }, usedRecovery: false };
  }
  if (allowRecovery) {
    const norm = normalizeRecovery(code);
    if (norm.length === 10) {
      const h = await sha256Hex(norm);
      if (tf.recovery?.includes(h))
        return { next: { ...tf, recovery: tf.recovery.filter((x) => x !== h), fails: 0, lockedUntil: undefined }, usedRecovery: true };
    }
  }
  return null;
}

/** A wrong code: the counter goes up; at 5, a 15-minute lock. */
const failed2fa = (tf: TwoFactor): TwoFactor => {
  const fails = (tf.fails ?? 0) + 1;
  return fails >= MAX_CODE_FAILS ? { ...tf, fails: 0, lockedUntil: Date.now() + LOCK_MS } : { ...tf, fails };
};
const lockedFor = (tf: TwoFactor) => Math.max(0, (tf.lockedUntil ?? 0) - Date.now());
const lockMessage = (ms: number) => `Too many wrong codes. Try again in ${Math.ceil(ms / 60_000)} minutes.`;

// ---- The library (end-to-end encrypted) ----
const VAULT_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** A D1 row can be at most 2 MB; a note's text (encrypted, base64) has to stay under it. */
const MAX_VAULT_BODY = 1_800_000;
const MAX_VAULT_BLOB = 24 * 1024 * 1024; // a single Cloudflare KV value can be at most 25 MiB
const vaultItemSchema = z.object({
  meta: z.string().min(16).max(20_000),
  body: z.string().max(MAX_VAULT_BODY).nullable().optional(),
  /** The expected version: if another tab got in between, 409 (nothing is overwritten). */
  rev: z.number().int().min(0).optional(),
});
const vaultBlobKey = (id: string) => `vault/${id}`;
const ASSET_ID = /^[A-Za-z0-9_-]{16,64}$/;
/** The plain columns emptied when the encrypted record arrives. */
const CLEAR_BOOK = "title = '', author = '', synopsis = '', cover_url = NULL, back_cover_url = NULL, spine_url = NULL, map_url = NULL";
const CLEAR_CH = "title = '', content = '', images = '[]', music_url = NULL, music_from = NULL, music_to = NULL, epigraph = NULL, epigraph_by = NULL, epigraph_quotes = 0";
const assetsJson = (ids?: string[]) => JSON.stringify([...new Set(ids ?? [])]);

interface BookRow {
  id: number;
  position: number;
  title: string;
  author: string;
  synopsis: string;
  cover_url: string | null;
  back_cover_url: string | null;
  spine_url: string | null;
  map_url: string | null;
  page_capacity: number;
  updated_at: string;
  chapter_count?: number;
  enc?: string | null;
  assets?: string | null;
}

interface ChapterRow {
  id: number;
  ord: number;
  title: string;
  content: string;
  music_url: string | null;
  music_from: number | null;
  music_to: number | null;
  epigraph: string | null;
  epigraph_by: string | null;
  epigraph_quotes: number | null;
  images: string | null;
  updated_at: string;
  enc?: string | null;
  assets?: string | null;
}

const toBook = (r: BookRow): BookSummary => ({
  id: Number(r.id),
  position: Number(r.position),
  title: r.title,
  author: r.author,
  synopsis: r.synopsis,
  coverUrl: r.cover_url,
  backCoverUrl: r.back_cover_url ?? null,
  spineUrl: r.spine_url ?? null,
  mapUrl: r.map_url,
  pageCapacity: Number(r.page_capacity),
  chapterCount: Number(r.chapter_count ?? 0),
  updatedAt: r.updated_at,
  enc: r.enc ?? null,
});

const emptyContent = () => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });

const parseJson = <T>(json: string | null | undefined, schema: z.ZodType<T>, fallback: T): T => {
  try {
    const parsed = schema.safeParse(JSON.parse(json || 'null'));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback; // damaged record: show it empty rather than fail
  }
};

const toChapter = (r: ChapterRow): BookChapter => {
  let content: unknown;
  try {
    content = JSON.parse(r.content || emptyContent());
  } catch {
    content = JSON.parse(emptyContent());
  }
  const images: BookImage[] = parseJson(r.images, bookImageSchema.array(), []);
  return {
    id: Number(r.id),
    ord: Number(r.ord),
    title: r.title,
    content,
    musicUrl: r.music_url,
    musicFrom: r.music_from ?? null,
    musicTo: r.music_to ?? null,
    epigraph: r.epigraph ?? null,
    epigraphBy: r.epigraph_by ?? null,
    epigraphQuotes: !!r.epigraph_quotes,
    images,
    updatedAt: r.updated_at,
    enc: r.enc ?? null,
  };
};

const parseNotes = (json: string | null | undefined): BookNote[] => parseJson(json, bookNoteSchema.array(), []);
const parseTabs = (json: string | null | undefined): NoteTab[] => parseJson(json, noteTabSchema.array(), []);

const bookExists = async (c: Context<AppEnv>, id: number) => !!(await one(c.var.db, 'SELECT 1 FROM books WHERE id = ?', [id]));
const chapterBook = (c: Context<AppEnv>, id: number) => one<{ book_id: number }>(c.var.db, 'SELECT book_id FROM book_chapters WHERE id = ?', [id]);
const touchBook = (c: Context<AppEnv>, bookId: number) => run(c.var.db, 'UPDATE books SET updated_at = ? WHERE id = ?', [nowIso(), bookId]);

export const apiRoutes = new Hono<AppEnv>()
  // ---- Account (before sign-in) ----
  .get('/status', async (c) => {
    c.header('Cache-Control', 'no-store');
    const owner = await one(c.var.db, 'SELECT 1 FROM owner WHERE id = 1');
    const status: SetupStatus = { needsSetup: !owner, tokenRequired: !!c.var.config.setupToken || !!c.var.config.setupTokenRequired };
    return c.json(status);
  })
  // First start: create the owner account (only while there is none).
  .post('/setup', async (c) => {
    if (!loginLimit(c.var.clientIp)) return c.json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
    const body = setupSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Invalid request' }, 400);
    const token = c.var.config.setupToken;
    if (c.var.config.setupTokenRequired && !token)
      return c.json({ error: 'Set the SETUP_TOKEN secret first, then create your account with it.' }, 503);
    if (token && !sameText(body.data.token ?? '', token)) return c.json({ error: 'Wrong setup code' }, 403);
    const hash = await hashPassword(body.data.password);
    // INSERT OR IGNORE + id = 1: if two requests race, only the first one creates the account.
    const r = await run(c.var.db, 'INSERT OR IGNORE INTO owner (id, username, password_hash, display_name) VALUES (1, ?, ?, ?)', [
      body.data.username.toLowerCase(),
      hash,
      body.data.displayName || body.data.username,
    ]);
    if (!r.rowsAffected) return c.json({ error: 'The account already exists. Please sign in.' }, 409);
    await startSession(c, 1);
    return c.json({ ok: true }, 201);
  })
  .post('/login', async (c) => {
    if (!loginLimit(c.var.clientIp)) return c.json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
    const body = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Username and password are required' }, 400);
    const o = await one<{ username: string; password_hash: string; session_version: number; two_factor: string | null }>(
      c.var.db,
      'SELECT username, password_hash, session_version, two_factor FROM owner WHERE id = 1',
    );
    // Same work and same answer whether or not the username exists (nothing leaks).
    dummyHash ??= hashPassword('not-a-real-password');
    const ok = await verifyPassword(body.data.password, o?.password_hash ?? (await dummyHash));
    if (!o || !ok || body.data.username.toLowerCase() !== o.username) return c.json({ error: 'Wrong username or password' }, 401);
    const tf = parse2fa(o.two_factor);
    if (tf.secret) {
      // The password is right but there is no session yet: a 5-minute ticket comes back with the code.
      const wait = lockedFor(tf);
      if (wait) return c.json({ error: lockMessage(wait) }, 429);
      return c.json({ twoFactor: true, ticket: await signTicket(c, Number(o.session_version)) });
    }
    await startSession(c, Number(o.session_version));
    return c.json({ ok: true });
  })
  // The second step: the ticket from the password step + the authenticator app's code (or a recovery code)
  .post('/login/2fa', async (c) => {
    if (!codeLimit(c.var.clientIp)) return c.json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
    const body = z.object({ ticket: z.string().max(2000), code: z.string().min(1).max(40) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Enter the code' }, 400);
    const expired = () => c.json({ error: 'This sign-in has expired. Enter your password again.', restart: true }, 401);
    let p: { sv: number; scope?: string };
    try {
      p = (await verify(body.data.ticket, c.var.config.sessionSecret, 'HS256')) as typeof p;
    } catch {
      return expired();
    }
    const o = await one<{ session_version: number; two_factor: string | null }>(c.var.db, 'SELECT session_version, two_factor FROM owner WHERE id = 1');
    if (p.scope !== '2fa' || !o || Number(o.session_version) !== p.sv) return expired();
    const tf = parse2fa(o.two_factor);
    if (!tf.secret) return expired();
    const wait = lockedFor(tf);
    if (wait) return c.json({ error: lockMessage(wait) }, 429);
    const res = await verifyFactor(tf, body.data.code, c.var.config.sessionSecret, true);
    if (!res) {
      const next = failed2fa(tf);
      await save2fa(c.var.db, o.two_factor, next);
      const lock = lockedFor(next);
      return c.json({ error: lock ? lockMessage(lock) : 'Wrong code. Check the time on your phone and try again.' }, lock ? 429 : 401);
    }
    // A code works once: the record is written only if unchanged since it was read.
    if (!(await save2fa(c.var.db, o.two_factor, res.next))) return c.json({ error: 'Try again with a new code.' }, 409);
    await startSession(c, Number(o.session_version));
    return c.json({ ok: true, recoveryLeft: res.usedRecovery ? (res.next.recovery?.length ?? 0) : undefined });
  })
  .post('/logout', (c) => {
    endSession(c);
    return c.json({ ok: true });
  })

  // ---- Everything below needs the owner to be signed in ----
  .use('*', requireOwner)
  .get('/me', async (c) => {
    c.header('Cache-Control', 'no-store');
    const o = await one<{ username: string; display_name: string }>(c.var.db, 'SELECT username, display_name FROM owner WHERE id = 1');
    return c.json({ username: o?.username ?? '', displayName: o?.display_name ?? '' });
  })
  .patch('/account', async (c) => {
    const body = accountUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Invalid request' }, 400);
    await run(c.var.db, 'UPDATE owner SET display_name = ? WHERE id = 1', [body.data.displayName]);
    return c.json({ ok: true });
  })
  // Changing the password signs out every other device (new session version); this one stays signed in.
  .post('/account/password', async (c) => {
    const body = passwordChangeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Invalid request' }, 400);
    const o = await one<{ password_hash: string; session_version: number }>(c.var.db, 'SELECT password_hash, session_version FROM owner WHERE id = 1');
    if (!o || !(await verifyPassword(body.data.current, o.password_hash))) return c.json({ error: 'The current password is wrong' }, 400);
    const sv = Number(o.session_version) + 1;
    await run(c.var.db, 'UPDATE owner SET password_hash = ?, session_version = ? WHERE id = 1', [await hashPassword(body.data.next), sv]);
    await startSession(c, sv);
    return c.json({ ok: true });
  })
  .get('/storage', async (c) => {
    c.header('Cache-Control', 'no-store');
    const media = await one<{ total: number | null }>(
      c.var.db,
      'SELECT (SELECT COALESCE(SUM(size), 0) FROM uploads) + (SELECT COALESCE(SUM(size), 0) FROM vault_items) AS total',
    );
    // D1 reports the database size after each query; locally (SQLite) it comes from the page count.
    const probe = (await c.var.db.execute('SELECT 1')) as unknown as { dbSize?: number };
    let dbUsed = Number(probe.dbSize ?? 0);
    if (!dbUsed) {
      try {
        const pc = await one<{ page_count: number }>(c.var.db, 'PRAGMA page_count');
        const ps = await one<{ page_size: number }>(c.var.db, 'PRAGMA page_size');
        dbUsed = Number(pc?.page_count ?? 0) * Number(ps?.page_size ?? 0);
      } catch {
        dbUsed = 0;
      }
    }
    const limits = c.var.config.storageLimits;
    const usage: StorageUsage = {
      media: { used: Number(media?.total ?? 0), limit: limits?.media ?? null },
      db: { used: dbUsed, limit: limits?.db ?? null },
    };
    return c.json(usage);
  })
  .post('/uploads', (c) => saveImageUpload(c))
  .post('/audio', (c) => saveAudioUpload(c))

  // ---- Security: two-step sign-in ----
  .get('/security', async (c) => {
    c.header('Cache-Control', 'no-store');
    const o = await one<{ two_factor: string | null }>(c.var.db, 'SELECT two_factor FROM owner WHERE id = 1');
    const tf = parse2fa(o?.two_factor);
    return c.json({ twoFactor: !!tf.secret, recoveryLeft: tf.recovery?.length ?? 0 });
  })
  // Starts the setup: makes a new secret (not on yet; it turns on when a right code is entered).
  .post('/2fa/setup', async (c) => {
    const o = await one<{ username: string; two_factor: string | null }>(c.var.db, 'SELECT username, two_factor FROM owner WHERE id = 1');
    if (!o) return c.json({ error: 'Please sign in' }, 401);
    const tf = parse2fa(o.two_factor);
    if (tf.secret) return c.json({ error: 'Two-step sign-in is already on' }, 409);
    const secret = newTotpSecret();
    if (!(await save2fa(c.var.db, o.two_factor, { ...tf, pending: await sealSecret(c.var.config.sessionSecret, secret) })))
      return c.json({ error: 'Try again' }, 409);
    return c.json({ secret, uri: otpauthUri(secret, o.username) });
  })
  // Turns on when the app's first code is right; returns 10 recovery codes shown once. Other devices are signed out.
  .post('/2fa/enable', async (c) => {
    const body = z.object({ code: z.string().min(6).max(12) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Enter the 6-digit code' }, 400);
    const o = await one<{ session_version: number; two_factor: string | null }>(c.var.db, 'SELECT session_version, two_factor FROM owner WHERE id = 1');
    const tf = parse2fa(o?.two_factor);
    if (!o || tf.secret) return c.json({ error: 'Two-step sign-in is already on' }, 409);
    const pending = tf.pending ? await openSecret(c.var.config.sessionSecret, tf.pending) : null;
    if (!pending) return c.json({ error: 'Start the setup again' }, 400);
    const step = await checkTotp(pending, body.data.code);
    if (step === null) return c.json({ error: 'Wrong code. Check the time on your phone and try again.' }, 400);
    const codes = newRecoveryCodes();
    const next: TwoFactor = {
      secret: tf.pending,
      recovery: await Promise.all(codes.map((x) => sha256Hex(normalizeRecovery(x)))),
      lastStep: step,
      fails: 0,
    };
    if (!(await save2fa(c.var.db, o.two_factor, next))) return c.json({ error: 'Try again' }, 409);
    // Sessions left open elsewhere end; this browser goes on with a new session.
    const sv = Number(o.session_version) + 1;
    await run(c.var.db, 'UPDATE owner SET session_version = ? WHERE id = 1', [sv]);
    await startSession(c, sv);
    return c.json({ recoveryCodes: codes });
  })
  // Turning it off needs the password and a valid code (app or recovery code).
  .post('/2fa/disable', async (c) => {
    const body = z.object({ password: z.string().min(1).max(200), code: z.string().min(1).max(40) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Enter your password and a code' }, 400);
    const o = await one<{ password_hash: string; two_factor: string | null }>(c.var.db, 'SELECT password_hash, two_factor FROM owner WHERE id = 1');
    const tf = parse2fa(o?.two_factor);
    if (!o || !tf.secret) return c.json({ error: 'Two-step sign-in is already off' }, 409);
    const wait = lockedFor(tf);
    if (wait) return c.json({ error: lockMessage(wait) }, 429);
    const pwOk = await verifyPassword(body.data.password, o.password_hash);
    const res = pwOk ? await verifyFactor(tf, body.data.code, c.var.config.sessionSecret, true) : null;
    if (!res) {
      await save2fa(c.var.db, o.two_factor, failed2fa(tf));
      return c.json({ error: pwOk ? 'Wrong code' : 'Wrong password' }, 400);
    }
    if (!(await save2fa(c.var.db, o.two_factor, null))) return c.json({ error: 'Try again' }, 409);
    return c.json({ ok: true });
  })
  // New recovery codes (all the old ones stop working); needs the app's current code.
  .post('/2fa/recovery-codes', async (c) => {
    const body = z.object({ code: z.string().min(6).max(12) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Enter the 6-digit code' }, 400);
    const o = await one<{ two_factor: string | null }>(c.var.db, 'SELECT two_factor FROM owner WHERE id = 1');
    const tf = parse2fa(o?.two_factor);
    if (!o || !tf.secret) return c.json({ error: 'Two-step sign-in is off' }, 409);
    const wait = lockedFor(tf);
    if (wait) return c.json({ error: lockMessage(wait) }, 429);
    const res = await verifyFactor(tf, body.data.code, c.var.config.sessionSecret, false);
    if (!res) {
      await save2fa(c.var.db, o.two_factor, failed2fa(tf));
      return c.json({ error: 'Wrong code' }, 400);
    }
    const codes = newRecoveryCodes();
    const next = { ...res.next, recovery: await Promise.all(codes.map((x) => sha256Hex(normalizeRecovery(x)))) };
    if (!(await save2fa(c.var.db, o.two_factor, next))) return c.json({ error: 'Try again' }, 409);
    return c.json({ recoveryCodes: codes });
  })

  // ---- End-to-end encryption ----
  // When the move to encryption is done: the plain text of everything that has an encrypted copy is cleared.
  .post('/seal', async (c) => {
    await c.var.db.batch(
      [
        { sql: `UPDATE books SET ${CLEAR_BOOK} WHERE enc IS NOT NULL`, args: [] },
        { sql: `UPDATE book_chapters SET ${CLEAR_CH} WHERE enc IS NOT NULL`, args: [] },
        { sql: "UPDATE notebook SET notes = '[]', tabs = '[]' WHERE enc IS NOT NULL", args: [] },
        { sql: "UPDATE notebook SET dictionary = '[]' WHERE dict_enc IS NOT NULL", args: [] },
      ],
      'write',
    );
    const left = await one<{ books: number; chapters: number }>(
      c.var.db,
      'SELECT (SELECT COUNT(*) FROM books WHERE enc IS NULL) AS books, (SELECT COUNT(*) FROM book_chapters WHERE enc IS NULL) AS chapters',
    );
    return c.json({ ok: true, plainBooks: Number(left?.books ?? 0), plainChapters: Number(left?.chapters ?? 0) });
  })
  // An encrypted file (image, music): bytes encrypted in the browser. Opening it needs the key.
  .post('/assets', async (c) => {
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > MAX_VAULT_BLOB) return c.json({ error: 'The file can be at most 24 MB' }, 413);
    const buf = await c.req.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_VAULT_BLOB) return c.json({ error: 'The file can be at most 24 MB' }, 413);
    // The browser picks the id: the encrypted data is bound to it. An existing file is never overwritten.
    const id = c.req.query('id') ?? '';
    if (!ASSET_ID.test(id)) return c.json({ error: 'Invalid file id' }, 400);
    const key = `assets/${id}`;
    if (await one(c.var.db, 'SELECT 1 FROM uploads WHERE key = ?', [key])) return c.json({ error: 'This file already exists' }, 409);
    await c.var.storage.put(key, buf, 'application/octet-stream');
    await run(c.var.db, 'INSERT INTO uploads (key, url, mime, size) VALUES (?, ?, ?, ?)', [key, `/api/assets/${id}`, 'application/octet-stream', buf.byteLength]);
    return c.json({ id }, 201);
  })
  .get('/assets/:id', async (c) => {
    const id = c.req.param('id');
    if (!ASSET_ID.test(id)) return c.json({ error: 'Not found' }, 404);
    const key = `assets/${id}`;
    const data = (await one(c.var.db, 'SELECT 1 FROM uploads WHERE key = ?', [key])) ? await c.var.storage.get(key) : null;
    if (!data) return c.json({ error: 'Not found' }, 404);
    return new Response(data, {
      headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
    });
  })
  // When the move is done: the old (unencrypted) files no book uses any more are deleted too.
  // Only runs when no unencrypted book is left.
  .post('/uploads/purge-plain', async (c) => {
    const left = await one<{ n: number }>(
      c.var.db,
      'SELECT (SELECT COUNT(*) FROM books WHERE enc IS NULL) + (SELECT COUNT(*) FROM book_chapters WHERE enc IS NULL) AS n',
    );
    if (Number(left?.n ?? 0) > 0) return c.json({ error: 'Some books are not encrypted yet' }, 409);
    const rows = await all<{ id: number; key: string }>(c.var.db, "SELECT id, key FROM uploads WHERE key NOT LIKE 'assets/%'");
    for (const r of rows) {
      await c.var.storage.delete(r.key);
      await run(c.var.db, 'DELETE FROM uploads WHERE id = ?', [r.id]);
    }
    return c.json({ ok: true, removed: rows.length });
  })
  // An old (unencrypted) file that was moved: deleted once its encrypted copy is uploaded.
  .post('/uploads/forget', async (c) => {
    const body = z.object({ url: z.string().max(1000) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid request' }, 400);
    const row = await one<{ id: number; key: string }>(c.var.db, "SELECT id, key FROM uploads WHERE url = ? AND key NOT LIKE 'assets/%'", [body.data.url]);
    if (!row) return c.json({ ok: true });
    await c.var.storage.delete(row.key);
    await run(c.var.db, 'DELETE FROM uploads WHERE id = ?', [row.id]);
    return c.json({ ok: true });
  })

  // ---- The library: the server only keeps encrypted data ----
  .get('/vault/key', async (c) => {
    c.header('Cache-Control', 'no-store');
    const r = await one<{ data: string; updated_at: string }>(c.var.db, 'SELECT data, updated_at FROM vault_keys WHERE id = 1');
    return c.json({ data: r?.data ?? null, updatedAt: r?.updated_at ?? null });
  })
  // Saves the (wrapped) library key. An existing library is only overwritten with `replace`
  // (a new password or a new recovery key: the same data key wrapped again).
  .put('/vault/key', async (c) => {
    const body = z.object({ data: z.string().min(20).max(8000), replace: z.boolean().optional() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid vault key' }, 400);
    const exists = await one(c.var.db, 'SELECT 1 FROM vault_keys WHERE id = 1');
    if (exists && !body.data.replace) return c.json({ error: 'A vault already exists' }, 409);
    if (!exists && body.data.replace) return c.json({ error: 'There is no vault yet' }, 409);
    await run(
      c.var.db,
      `INSERT INTO vault_keys (id, data, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [body.data.data, nowIso()],
    );
    return c.json({ ok: true });
  })
  .get('/vault/items', async (c) => {
    c.header('Cache-Control', 'no-store');
    const rows = await all<{ id: string; meta: string; body: string | null; has_blob: number; size: number; rev: number; updated_at: string }>(
      c.var.db,
      'SELECT id, meta, body, blob_key IS NOT NULL AS has_blob, size, rev, updated_at FROM vault_items',
    );
    return c.json({
      items: rows.map((r) => ({ id: r.id, meta: r.meta, body: r.body, hasBlob: !!Number(r.has_blob), size: Number(r.size), rev: Number(r.rev), updatedAt: r.updated_at })),
    });
  })
  // Creates / updates a note or file record. Without `body` the text stays; null clears it.
  .put('/vault/items/:id', async (c) => {
    const id = c.req.param('id');
    if (!VAULT_ID.test(id)) return c.json({ error: 'Invalid item' }, 400);
    const body = vaultItemSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Invalid item' }, 400);
    const cur = await one<{ rev: number }>(c.var.db, 'SELECT rev FROM vault_items WHERE id = ?', [id]);
    const now = nowIso();
    if (!cur) {
      if (body.data.rev) return c.json({ error: 'This note was deleted elsewhere', rev: 0 }, 409);
      await run(c.var.db, 'INSERT INTO vault_items (id, meta, body, rev, updated_at) VALUES (?, ?, ?, 1, ?)', [id, body.data.meta, body.data.body ?? null, now]);
      return c.json({ rev: 1 });
    }
    const expected = body.data.rev ?? Number(cur.rev);
    const sets = ['meta = ?', 'rev = rev + 1', 'updated_at = ?'];
    const args: (string | number | null)[] = [body.data.meta, now];
    if (body.data.body !== undefined) {
      sets.push('body = ?');
      args.push(body.data.body);
    }
    const r = await run(c.var.db, `UPDATE vault_items SET ${sets.join(', ')} WHERE id = ? AND rev = ?`, [...args, id, expected]);
    if (!r.rowsAffected) {
      const now2 = await one<{ rev: number }>(c.var.db, 'SELECT rev FROM vault_items WHERE id = ?', [id]);
      return c.json({ error: 'This note was changed elsewhere', rev: Number(now2?.rev ?? 0) }, 409);
    }
    return c.json({ rev: expected + 1 });
  })
  // A file's encrypted bytes (images). The record is made first with /vault/items.
  .put('/vault/blobs/:id', async (c) => {
    const id = c.req.param('id');
    if (!VAULT_ID.test(id)) return c.json({ error: 'Invalid item' }, 400);
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > MAX_VAULT_BLOB) return c.json({ error: 'The file can be at most 24 MB' }, 413);
    if (!(await one(c.var.db, 'SELECT 1 FROM vault_items WHERE id = ?', [id]))) return c.json({ error: 'Invalid item' }, 400);
    const buf = await c.req.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_VAULT_BLOB) return c.json({ error: 'The file can be at most 24 MB' }, 413);
    const key = vaultBlobKey(id);
    await c.var.storage.put(key, buf, 'application/octet-stream');
    await run(c.var.db, 'UPDATE vault_items SET blob_key = ?, size = ? WHERE id = ?', [key, buf.byteLength, id]);
    return c.json({ ok: true, size: buf.byteLength });
  })
  .get('/vault/blobs/:id', async (c) => {
    const id = c.req.param('id');
    if (!VAULT_ID.test(id)) return c.json({ error: 'Not found' }, 404);
    const item = await one<{ blob_key: string | null }>(c.var.db, 'SELECT blob_key FROM vault_items WHERE id = ?', [id]);
    const data = item?.blob_key ? await c.var.storage.get(item.blob_key) : null;
    if (!data) return c.json({ error: 'Not found' }, 404);
    return new Response(data, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  })
  .delete('/vault/items/:id', async (c) => {
    const id = c.req.param('id');
    if (!VAULT_ID.test(id)) return c.json({ error: 'Invalid item' }, 400);
    const item = await one<{ blob_key: string | null }>(c.var.db, 'SELECT blob_key FROM vault_items WHERE id = ?', [id]);
    if (!item) return c.json({ ok: true });
    if (item.blob_key) await c.var.storage.delete(item.blob_key);
    await run(c.var.db, 'DELETE FROM vault_items WHERE id = ?', [id]);
    return c.json({ ok: true });
  })
  // When both the encryption password and the recovery key are lost: the library is deleted completely (cannot be undone).
  .post('/vault/reset', async (c) => {
    const body = z.object({ confirm: z.literal('DELETE MY LIBRARY') }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Type DELETE MY LIBRARY to confirm' }, 400);
    const blobs = await all<{ blob_key: string }>(c.var.db, 'SELECT blob_key FROM vault_items WHERE blob_key IS NOT NULL');
    for (const b of blobs) await c.var.storage.delete(b.blob_key);
    await run(c.var.db, 'DELETE FROM vault_items');
    await run(c.var.db, 'DELETE FROM vault_keys');
    return c.json({ ok: true });
  })

  // ---- Shelf ----
  .get('/books', async (c) => {
    c.header('Cache-Control', 'no-store');
    const db = c.var.db;
    const rows = await all<BookRow & { own_bytes: number }>(
      db,
      `SELECT b.*, (SELECT COUNT(*) FROM book_chapters ch WHERE ch.book_id = b.id) AS chapter_count,
              length(CAST(b.title AS BLOB)) + length(CAST(b.author AS BLOB)) + length(CAST(b.synopsis AS BLOB))
                + length(CAST(COALESCE(b.enc, '') AS BLOB)) AS own_bytes
       FROM books b ORDER BY b.position, b.id`,
    );
    // Size of a book: its text (bytes) plus the uploaded files it uses (each file counted once).
    const chapters = await all<{ book_id: number; bytes: number; images: string | null; music_url: string | null; assets: string | null }>(
      db,
      `SELECT book_id, length(CAST(content AS BLOB)) + length(CAST(COALESCE(images, '') AS BLOB)) + length(CAST(title AS BLOB))
                + length(CAST(COALESCE(enc, '') AS BLOB)) AS bytes,
              images, music_url, assets
       FROM book_chapters`,
    );
    const assetUrls = (json: string | null | undefined) => parseJson(json, z.array(z.string()), []).map((id) => `/api/assets/${id}`);
    const fileSize = new Map((await all<{ url: string; size: number }>(db, 'SELECT url, size FROM uploads')).map((u) => [u.url, Number(u.size)]));
    const sizes = new Map<number, { text: number; urls: Set<string> }>();
    for (const r of rows)
      sizes.set(Number(r.id), { text: Number(r.own_bytes ?? 0), urls: new Set([r.cover_url, r.back_cover_url, r.spine_url, r.map_url, ...assetUrls(r.assets)].filter((u): u is string => !!u)) });
    for (const ch of chapters) {
      const s = sizes.get(Number(ch.book_id));
      if (!s) continue;
      s.text += Number(ch.bytes ?? 0);
      if (ch.music_url) s.urls.add(ch.music_url);
      for (const u of assetUrls(ch.assets)) s.urls.add(u);
      for (const im of parseJson(ch.images, z.array(z.object({ url: z.string().optional() })), [])) if (im.url) s.urls.add(im.url);
    }
    const sizeOf = (id: number) => {
      const s = sizes.get(id);
      if (!s) return 0;
      let total = s.text;
      for (const u of s.urls) total += fileSize.get(u) ?? 0;
      return total;
    };
    const nb = await one<{ notes: string; updated_at: string | null; bytes: number; enc: string | null }>(
      db,
      "SELECT notes, updated_at, enc, length(CAST(notes AS BLOB)) + length(CAST(COALESCE(enc, '') AS BLOB)) AS bytes FROM notebook WHERE id = 1",
    );
    const notebook: NotebookSummary = { count: parseNotes(nb?.notes).length, updatedAt: nb?.updated_at ?? null, sizeBytes: Number(nb?.bytes ?? 0) };
    const res: ShelfResponse = { books: rows.map((r) => ({ ...toBook(r), sizeBytes: sizeOf(Number(r.id)) })), notebook, notebookEncrypted: !!nb?.enc };
    return c.json(res);
  })
  // A new book goes to the end of the shelf, with one empty chapter.
  .post('/books', async (c) => {
    const body = z.object({ title: z.string().trim().max(200).optional() }).safeParse(await c.req.json().catch(() => ({})));
    const last = await one<{ m: number | null }>(c.var.db, 'SELECT MAX(position) AS m FROM books');
    const owner = await one<{ display_name: string }>(c.var.db, 'SELECT display_name FROM owner WHERE id = 1');
    const r = await run(c.var.db, 'INSERT INTO books (position, title, author, page_capacity) VALUES (?, ?, ?, ?)', [
      Number(last?.m ?? -1) + 1,
      (body.success && body.data.title) || 'Untitled',
      owner?.display_name ?? '',
      DEFAULT_PAGE_CAPACITY,
    ]);
    const id = Number(r.lastInsertRowid);
    await run(c.var.db, 'INSERT INTO book_chapters (book_id, ord, title, content) VALUES (?, 0, ?, ?)', [id, 'Chapter 1', emptyContent()]);
    return c.json({ id }, 201);
  })
  // Shelf order: the ids of every book, first to last.
  .put('/books/order', async (c) => {
    const body = z.object({ ids: z.array(z.number().int()).max(10000) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid request' }, 400);
    if (body.data.ids.length)
      await c.var.db.batch(
        body.data.ids.map((id, i) => ({ sql: 'UPDATE books SET position = ? WHERE id = ?', args: [i, id] })),
        'write',
      );
    return c.json({ ok: true });
  })
  .get('/books/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = Number(c.req.param('id'));
    const b = await one<BookRow>(c.var.db, 'SELECT * FROM books WHERE id = ?', [id]);
    if (!b) return c.json({ error: 'Book not found' }, 404);
    const chapters = (await all<ChapterRow>(c.var.db, 'SELECT * FROM book_chapters WHERE book_id = ? ORDER BY ord, id', [id])).map(toChapter);
    const book: BookFull = { ...toBook({ ...b, chapter_count: chapters.length }), chapters };
    return c.json({ book });
  })
  .patch('/books/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = bookUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Invalid request' }, 400);
    const cur = await one<{ enc: string | null }>(c.var.db, 'SELECT enc FROM books WHERE id = ?', [id]);
    if (!cur) return c.json({ error: 'Book not found' }, 404);
    if (body.data.enc !== undefined) {
      // The encrypted record: the plain columns are emptied (while moving, they can wait until checked)
      await run(c.var.db, `UPDATE books SET enc = ?, assets = ?, updated_at = ?${body.data.keepPlain ? '' : `, ${CLEAR_BOOK}`} WHERE id = ?`, [
        body.data.enc,
        assetsJson(body.data.assets),
        nowIso(),
        id,
      ]);
      return c.json({ ok: true });
    }
    if (cur.enc) return c.json({ error: 'This book is encrypted. Reload the page.' }, 409);
    const sets: string[] = ['updated_at = ?'];
    const args: (string | number | null)[] = [nowIso()];
    const map: Record<string, string> = { title: 'title', author: 'author', synopsis: 'synopsis', coverUrl: 'cover_url', backCoverUrl: 'back_cover_url', spineUrl: 'spine_url', mapUrl: 'map_url' };
    for (const [k, col] of Object.entries(map)) {
      const v = body.data[k as keyof typeof body.data];
      if (v !== undefined) {
        sets.push(`${col} = ?`);
        args.push(k === 'title' ? (v as string) || 'Untitled' : (v as string | null));
      }
    }
    args.push(id);
    await run(c.var.db, `UPDATE books SET ${sets.join(', ')} WHERE id = ?`, args);
    return c.json({ ok: true });
  })
  // Deletes the book and its chapters. Uploaded files stay (another book may use the same image).
  .delete('/books/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!(await bookExists(c, id))) return c.json({ error: 'Book not found' }, 404);
    await c.var.db.batch(
      [
        { sql: 'DELETE FROM book_chapters WHERE book_id = ?', args: [id] },
        { sql: 'DELETE FROM books WHERE id = ?', args: [id] },
      ],
      'write',
    );
    return c.json({ ok: true });
  })

  // ---- Notebook (on the shelf) ----
  .get('/notes', async (c) => {
    c.header('Cache-Control', 'no-store');
    const nb = await one<{ notes: string; tabs: string; updated_at: string | null; enc: string | null }>(c.var.db, 'SELECT notes, tabs, updated_at, enc FROM notebook WHERE id = 1');
    return c.json({ notes: parseNotes(nb?.notes), tabs: parseTabs(nb?.tabs), updatedAt: nb?.updated_at ?? null, enc: nb?.enc ?? null });
  })
  .patch('/notes', async (c) => {
    const body = notebookUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Invalid request' }, 400);
    if (body.data.enc !== undefined) {
      const clear = body.data.keepPlain ? '' : ", notes = '[]', tabs = '[]'";
      await run(
        c.var.db,
        `INSERT INTO notebook (id, notes, tabs, enc, updated_at) VALUES (1, '[]', '[]', ?, ?)
         ON CONFLICT(id) DO UPDATE SET enc = excluded.enc, updated_at = excluded.updated_at${clear}`,
        [body.data.enc, nowIso()],
      );
      return c.json({ ok: true });
    }
    if ((await one<{ enc: string | null }>(c.var.db, 'SELECT enc FROM notebook WHERE id = 1'))?.enc)
      return c.json({ error: 'Your notes are encrypted. Reload the page.' }, 409);
    const notes = body.data.notes !== undefined ? JSON.stringify(body.data.notes) : null;
    const tabs = body.data.tabs !== undefined ? JSON.stringify(body.data.tabs) : null;
    if ((notes?.length ?? 0) > 2_000_000) return c.json({ error: 'Notes are too long' }, 400);
    // A field that is not sent stays as it is
    await run(
      c.var.db,
      `INSERT INTO notebook (id, notes, tabs, updated_at) VALUES (1, COALESCE(?, '[]'), COALESCE(?, '[]'), ?)
       ON CONFLICT(id) DO UPDATE SET
         notes = COALESCE(?, notebook.notes),
         tabs = COALESCE(?, notebook.tabs),
         updated_at = excluded.updated_at`,
      [notes, tabs, nowIso(), notes, tabs],
    );
    return c.json({ ok: true });
  })
  // Spell check: the personal dictionary (kept in the notebook row; does not change the notes' date)
  .get('/dictionary', async (c) => {
    c.header('Cache-Control', 'no-store');
    const row = await one<{ dictionary: string | null; dict_enc: string | null }>(c.var.db, 'SELECT dictionary, dict_enc FROM notebook WHERE id = 1');
    return c.json({ words: parseJson(row?.dictionary, z.array(z.string()), []), enc: row?.dict_enc ?? null });
  })
  .put('/dictionary', async (c) => {
    const body = dictionaryUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Invalid request' }, 400);
    if (body.data.enc !== undefined) {
      const clear = body.data.keepPlain ? '' : ", dictionary = '[]'";
      await run(
        c.var.db,
        `INSERT INTO notebook (id, notes, tabs, dict_enc) VALUES (1, '[]', '[]', ?)
         ON CONFLICT(id) DO UPDATE SET dict_enc = excluded.dict_enc${clear}`,
        [body.data.enc],
      );
      return c.json({ ok: true });
    }
    if ((await one<{ dict_enc: string | null }>(c.var.db, 'SELECT dict_enc FROM notebook WHERE id = 1'))?.dict_enc)
      return c.json({ error: 'Your dictionary is encrypted. Reload the page.' }, 409);
    if (!body.data.words) return c.json({ error: 'Invalid request' }, 400);
    const words = JSON.stringify([...new Set(body.data.words)].sort());
    await run(
      c.var.db,
      `INSERT INTO notebook (id, notes, tabs, dictionary) VALUES (1, '[]', '[]', ?)
       ON CONFLICT(id) DO UPDATE SET dictionary = excluded.dictionary`,
      [words],
    );
    return c.json({ ok: true });
  })

  // ---- Chapters ----
  .post('/books/:id/chapters', async (c) => {
    const id = Number(c.req.param('id'));
    if (!(await bookExists(c, id))) return c.json({ error: 'Book not found' }, 404);
    const body = z.object({ title: z.string().trim().max(200).optional() }).safeParse(await c.req.json().catch(() => ({})));
    const last = await one<{ m: number | null; n: number }>(c.var.db, 'SELECT MAX(ord) AS m, COUNT(*) AS n FROM book_chapters WHERE book_id = ?', [id]);
    const r = await run(c.var.db, 'INSERT INTO book_chapters (book_id, ord, title, content) VALUES (?, ?, ?, ?)', [
      id,
      Number(last?.m ?? -1) + 1,
      // In an encrypted book the server does not even know the chapter's title
      (await one<{ enc: string | null }>(c.var.db, 'SELECT enc FROM books WHERE id = ?', [id]))?.enc
        ? ''
        : (body.success && body.data.title) || `Chapter ${Number(last?.n ?? 0) + 1}`,
      emptyContent(),
    ]);
    await touchBook(c, id);
    return c.json({ id: Number(r.lastInsertRowid) }, 201);
  })
  .put('/books/:id/order', async (c) => {
    const id = Number(c.req.param('id'));
    const body = z.object({ ids: z.array(z.number().int()).max(500) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid request' }, 400);
    if (!(await bookExists(c, id))) return c.json({ error: 'Book not found' }, 404);
    await c.var.db.batch(
      body.data.ids.map((cid, i) => ({ sql: 'UPDATE book_chapters SET ord = ? WHERE id = ? AND book_id = ?', args: [i, cid, id] })),
      'write',
    );
    await touchBook(c, id);
    return c.json({ ok: true });
  })
  .patch('/chapters/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const ch = await chapterBook(c, id);
    if (!ch) return c.json({ error: 'Chapter not found' }, 404);
    const body = chapterUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Invalid request' }, 400);
    if (body.data.enc !== undefined) {
      await run(c.var.db, `UPDATE book_chapters SET enc = ?, assets = ?, updated_at = ?${body.data.keepPlain ? '' : `, ${CLEAR_CH}`} WHERE id = ?`, [
        body.data.enc,
        assetsJson(body.data.assets),
        nowIso(),
        id,
      ]);
      await touchBook(c, Number(ch.book_id));
      return c.json({ ok: true });
    }
    if ((await one<{ enc: string | null }>(c.var.db, 'SELECT enc FROM book_chapters WHERE id = ?', [id]))?.enc)
      return c.json({ error: 'This chapter is encrypted. Reload the page.' }, 409);
    const sets: string[] = ['updated_at = ?'];
    const args: (string | number | null)[] = [nowIso()];
    const d = body.data;
    if (d.title !== undefined) sets.push('title = ?'), args.push(d.title);
    if (d.musicUrl !== undefined) sets.push('music_url = ?'), args.push(d.musicUrl);
    if (d.musicFrom !== undefined) sets.push('music_from = ?'), args.push(d.musicFrom);
    if (d.musicTo !== undefined) sets.push('music_to = ?'), args.push(d.musicTo);
    if (d.epigraph !== undefined) sets.push('epigraph = ?'), args.push(d.epigraph?.trim() || null);
    if (d.epigraphBy !== undefined) sets.push('epigraph_by = ?'), args.push(d.epigraphBy?.trim() || null);
    if (d.epigraphQuotes !== undefined) sets.push('epigraph_quotes = ?'), args.push(d.epigraphQuotes ? 1 : 0);
    if (d.images !== undefined) sets.push('images = ?'), args.push(JSON.stringify(d.images));
    if (d.content !== undefined) {
      const json = JSON.stringify(d.content);
      // A sensible limit for one chapter (~2 MB of text), well under D1's row limit.
      if (json.length > 2_000_000) return c.json({ error: 'This chapter is too long; try splitting it in two' }, 400);
      sets.push('content = ?');
      args.push(json);
    }
    args.push(id);
    await run(c.var.db, `UPDATE book_chapters SET ${sets.join(', ')} WHERE id = ?`, args);
    await touchBook(c, Number(ch.book_id));
    return c.json({ ok: true });
  })
  .delete('/chapters/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const ch = await chapterBook(c, id);
    if (!ch) return c.json({ error: 'Chapter not found' }, 404);
    const n = await one<{ n: number }>(c.var.db, 'SELECT COUNT(*) AS n FROM book_chapters WHERE book_id = ?', [ch.book_id]);
    if (Number(n?.n ?? 0) <= 1) return c.json({ error: 'A book needs at least one chapter' }, 400);
    await run(c.var.db, 'DELETE FROM book_chapters WHERE id = ?', [id]);
    await touchBook(c, Number(ch.book_id));
    return c.json({ ok: true });
  });
