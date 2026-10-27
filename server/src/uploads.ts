import type { Context } from 'hono';
import { run } from './db';
import type { AppEnv } from './types';

/** Allowed image types. The first bytes of the file are checked too (the extension is not trusted). */
export const ALLOWED_IMAGES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/png': { ext: 'png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/webp': { ext: 'webp', magic: (b) => String.fromCharCode(...b.slice(8, 12)) === 'WEBP' },
  'image/gif': { ext: 'gif', magic: (b) => String.fromCharCode(...b.slice(0, 3)) === 'GIF' },
};
export const MAX_UPLOAD = 10 * 1024 * 1024;
export const MAX_AUDIO = 20 * 1024 * 1024; // a single Cloudflare KV value can be at most 25 MiB

const newKey = (ext: string) => {
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;
};

/** Saves the "file" image from the form (disk locally, KV on Cloudflare) and records it. */
export async function saveImageUpload(c: Context<AppEnv>) {
  const form = await c.req.parseBody();
  const file = form['file'];
  if (!(file instanceof File)) return c.json({ error: 'No file was sent' }, 400);
  if (file.size > MAX_UPLOAD) return c.json({ error: 'The file can be at most 10 MB' }, 400);
  const kind = ALLOWED_IMAGES[file.type];
  const buf = await file.arrayBuffer();
  if (!kind || !kind.magic(new Uint8Array(buf.slice(0, 16)))) return c.json({ error: 'Only JPG, PNG, WEBP or GIF can be uploaded' }, 400);
  const stored = await c.var.storage.put(newKey(kind.ext), buf, file.type);
  const width = Number(form['width']) || null;
  const height = Number(form['height']) || null;
  await run(c.var.db, 'INSERT INTO uploads (key, url, mime, size, width, height) VALUES (?, ?, ?, ?, ?, ?)', [
    stored.key,
    stored.url,
    file.type,
    file.size,
    width,
    height,
  ]);
  return c.json({ url: stored.url, width, height }, 201);
}

/** MP3: starts with an ID3 tag or directly with an MPEG audio frame. */
const isMp3 = (b: Uint8Array) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0);

/** Chapter music (MP3 only). */
export async function saveAudioUpload(c: Context<AppEnv>) {
  const form = await c.req.parseBody();
  const file = form['file'];
  if (!(file instanceof File)) return c.json({ error: 'No file was sent' }, 400);
  if (file.size > MAX_AUDIO) return c.json({ error: 'The music file can be at most 20 MB' }, 400);
  const buf = await file.arrayBuffer();
  if (!isMp3(new Uint8Array(buf.slice(0, 4)))) return c.json({ error: 'Only MP3 files can be uploaded' }, 400);
  const stored = await c.var.storage.put(newKey('mp3'), buf, 'audio/mpeg');
  await run(c.var.db, 'INSERT INTO uploads (key, url, mime, size) VALUES (?, ?, ?, ?)', [stored.key, stored.url, 'audio/mpeg', file.size]);
  return c.json({ url: stored.url, size: file.size }, 201);
}
