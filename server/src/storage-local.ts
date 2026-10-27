import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { StorageAdapter } from './types';

/** Writes uploaded files to disk; they are served from /uploads/... */
export function localStorage(root: string): StorageAdapter {
  const base = resolve(root);
  const safe = (key: string) => {
    const p = resolve(join(base, key));
    if (!p.startsWith(base)) throw new Error('Invalid file path');
    return p;
  };
  return {
    async put(key, data) {
      const p = safe(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, new Uint8Array(data));
      return { key, url: `/uploads/${key}` };
    },
    async delete(key) {
      await unlink(safe(key)).catch(() => {});
    },
    async get(key) {
      try {
        const b = await readFile(safe(key));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      } catch {
        return null;
      }
    },
  };
}
