import type { StorageAdapter } from '../types';
import type { KVNamespace } from './types';

/** Keeps uploaded images and music in Cloudflare KV (1 GB on the free plan, no card needed). */
export function kvStorage(kv: KVNamespace): StorageAdapter {
  return {
    async put(key, data, contentType) {
      await kv.put(key, data, { metadata: { contentType } });
      return { key, url: `/uploads/${key}` };
    },
    async delete(key) {
      await kv.delete(key);
    },
    async get(key) {
      return kv.get(key, 'arrayBuffer');
    },
  };
}

export async function serveKvUpload(kv: KVNamespace, key: string, range?: string | null): Promise<Response> {
  if (!key || key.includes('..')) return new Response('Not found', { status: 404 });
  const { value, metadata } = await kv.getWithMetadata<{ contentType?: string }>(key, 'arrayBuffer');
  if (!value) return new Response('Not found', { status: 404 });
  const headers: Record<string, string> = {
    'Content-Type': metadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  };
  // Range requests (audio players, Safari especially, fetch music in pieces).
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    const size = value.byteLength;
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(value.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(value, { headers });
}
