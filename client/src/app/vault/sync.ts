import { sha256Hex } from './crypto';
import { isNotePath, mimeOf, vault, type VaultItem } from './store';

/**
 * Comparing and syncing the library with an Obsidian folder.
 * The folder is read in the browser (and can be written to in Chrome/Edge); files are never sent anywhere unencrypted.
 * Each item keeps the hash from the last sync (base), so it is clear which side has changed.
 * Files overwritten or deleted in Obsidian are not lost: they are moved to the vault's .trash/hyperfocus folder.
 */

export interface LocalFile {
  path: string;
  size: number;
  mtime: number;
  read(): Promise<Uint8Array>;
}

export interface VaultFolder {
  name: string;
  /** false: read only (a folder opened with the file picker); nothing can be written to Obsidian. */
  canWrite: boolean;
  list(onProgress?: (n: number) => void): Promise<LocalFile[]>;
  write(path: string, data: Uint8Array): Promise<void>;
  /** Moves the file under .trash/hyperfocus/<date>/ (Obsidian's trash). */
  moveToTrash(path: string, stamp: string): Promise<void>;
  /** Backs up a copy of the existing file in the same place (before overwriting it). */
  backup(path: string, stamp: string): Promise<void>;
}

/** Hidden folders (.obsidian, .trash, .git…) and hidden files are skipped. */
const hidden = (path: string) => path.split('/').some((seg) => seg.startsWith('.'));

type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
};

export const canPickFolder = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

export async function pickFolder(): Promise<VaultFolder | null> {
  const w = window as unknown as { showDirectoryPicker: (o: unknown) => Promise<FileSystemDirectoryHandle> };
  try {
    const handle = await w.showDirectoryPicker({ id: 'hyperfocus-obsidian', mode: 'readwrite' });
    return folderFromHandle(handle);
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
}

export function folderFromHandle(root: FileSystemDirectoryHandle): VaultFolder {
  const dirOf = async (path: string, create: boolean) => {
    let dir = root;
    const segs = path.split('/');
    segs.pop();
    for (const s of segs) dir = await dir.getDirectoryHandle(s, { create });
    return dir;
  };
  const writeAt = async (path: string, data: Uint8Array) => {
    const dir = await dirOf(path, true);
    const fh = await dir.getFileHandle(path.split('/').pop()!, { create: true });
    const w = await fh.createWritable();
    await w.write(new Uint8Array(data));
    await w.close();
  };
  const readAt = async (path: string) => {
    const dir = await dirOf(path, false);
    const f = await (await dir.getFileHandle(path.split('/').pop()!)).getFile();
    return new Uint8Array(await f.arrayBuffer());
  };
  const exists = async (path: string) => {
    try {
      await (await dirOf(path, false)).getFileHandle(path.split('/').pop()!);
      return true;
    } catch {
      return false;
    }
  };
  return {
    name: root.name,
    canWrite: true,
    async list(onProgress) {
      const out: LocalFile[] = [];
      const walk = async (dir: DirHandle, prefix: string) => {
        for await (const [name, h] of dir.entries()) {
          const path = prefix ? `${prefix}/${name}` : name;
          if (hidden(path)) continue;
          if (h.kind === 'directory') await walk(h as DirHandle, path);
          else {
            const f = await (h as FileSystemFileHandle).getFile();
            out.push({ path, size: f.size, mtime: f.lastModified, read: async () => new Uint8Array(await f.arrayBuffer()) });
            onProgress?.(out.length);
          }
        }
      };
      await walk(root as DirHandle, '');
      return out;
    },
    write: writeAt,
    async backup(path, stamp) {
      if (!(await exists(path))) return;
      await writeAt(`.trash/hyperfocus/${stamp}/${path}`, await readAt(path));
    },
    async moveToTrash(path, stamp) {
      if (!(await exists(path))) return;
      await writeAt(`.trash/hyperfocus/${stamp}/${path}`, await readAt(path));
      await (await dirOf(path, false)).removeEntry(path.split('/').pop()!);
    },
  };
}

/** For browsers without a folder picker: read only (Obsidian → Hyperfocus). */
export function folderFromFiles(files: File[]): VaultFolder {
  const top = files[0]?.webkitRelativePath.split('/')[0] ?? 'Folder';
  const list: LocalFile[] = files
    .map((f) => ({ f, path: f.webkitRelativePath.split('/').slice(1).join('/') }))
    .filter(({ path }) => path && !hidden(path))
    .map(({ f, path }) => ({ path, size: f.size, mtime: f.lastModified, read: async () => new Uint8Array(await f.arrayBuffer()) }));
  const readOnly = async () => {
    throw new Error('This folder is read-only here. Use Chrome or Edge to write into your Obsidian folder.');
  };
  return { name: top, canWrite: false, list: async () => list, write: readOnly, moveToTrash: readOnly, backup: readOnly };
}

// ---- Comparing ----
export type SyncAction = 'import' | 'export' | 'deleteHere' | 'deleteThere' | 'skip';

export interface SyncRow {
  path: string;
  kind: 'note' | 'file';
  local?: LocalFile & { hash: string };
  item?: VaultItem;
  /** A short description (e.g. "Changed in Obsidian"). */
  status: string;
  /** The same on both sides (nothing to do). */
  same: boolean;
  /** Changed on both sides: the user decides. */
  conflict: boolean;
  suggested: SyncAction;
  /** The actions that can be picked on this row. */
  options: SyncAction[];
}

export const ACTION_LABEL: Record<SyncAction, string> = {
  import: 'Copy to Hyperfocus',
  export: 'Copy to Obsidian',
  deleteHere: 'Delete in Hyperfocus',
  deleteThere: 'Move to Obsidian trash',
  skip: 'Leave as is',
};

export async function compare(folder: VaultFolder, items: VaultItem[], onProgress?: (msg: string) => void): Promise<SyncRow[]> {
  onProgress?.('Reading the folder…');
  const files = await folder.list((n) => onProgress?.(`Reading the folder… ${n} files`));
  const local = new Map<string, LocalFile & { hash: string }>();
  let n = 0;
  for (const f of files) {
    if (++n % 10 === 0) onProgress?.(`Comparing… ${n} / ${files.length}`);
    local.set(f.path, { ...f, hash: await sha256Hex(await f.read()) });
  }
  // Hidden records (the library's settings) never go to Obsidian
  const here = new Map(items.filter((i) => !hidden(i.meta.path)).map((i) => [i.meta.path, i]));
  const paths = [...new Set([...local.keys(), ...here.keys()])].sort((a, b) => a.localeCompare(b));
  const rows: SyncRow[] = [];
  for (const path of paths) {
    const L = local.get(path);
    const it = here.get(path);
    const kind: 'note' | 'file' = it?.meta.kind ?? (isNotePath(path) ? 'note' : 'file');
    const R = it && !it.meta.deleted ? it.meta.hash : null;
    const B = it?.meta.base ?? null;
    const row = (status: string, suggested: SyncAction, options: SyncAction[], extra: Partial<SyncRow> = {}): SyncRow => ({
      path,
      kind,
      local: L,
      item: it,
      status,
      same: false,
      conflict: false,
      suggested,
      options,
      ...extra,
    });
    if (L && R) {
      if (L.hash === R) rows.push(row('Same in both', 'skip', ['skip'], { same: true }));
      else if (B && L.hash === B) rows.push(row('Changed in Hyperfocus', 'export', ['export', 'import', 'skip']));
      else if (B && R === B) rows.push(row('Changed in Obsidian', 'import', ['import', 'export', 'skip']));
      else rows.push(row(B ? 'Changed in both' : 'Different in each', 'skip', ['import', 'export', 'skip'], { conflict: true }));
    } else if (L && !it) {
      rows.push(row('New in Obsidian', 'import', ['import', 'deleteThere', 'skip']));
    } else if (L && it?.meta.deleted) {
      if (B && L.hash === B) rows.push(row('Deleted in Hyperfocus', 'deleteThere', ['deleteThere', 'import', 'skip']));
      else rows.push(row('Deleted in Hyperfocus, changed in Obsidian', 'import', ['import', 'deleteThere', 'skip'], { conflict: true }));
    } else if (!L && it && !it.meta.deleted) {
      if (B && R === B) rows.push(row('Deleted in Obsidian', 'deleteHere', ['deleteHere', 'export', 'skip']));
      else if (B) rows.push(row('Deleted in Obsidian, changed in Hyperfocus', 'export', ['export', 'deleteHere', 'skip'], { conflict: true }));
      else rows.push(row('New in Hyperfocus', 'export', ['export', 'deleteHere', 'skip']));
    } else if (!L && it?.meta.deleted) {
      // Gone on both sides: the deletion mark is cleared
      rows.push(row('Deleted in both', 'deleteHere', ['deleteHere'], { same: true }));
    }
  }
  return rows;
}

/** A time stamp (safe as a folder name). */
export const stampNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();

/** Applies the chosen actions. Rows that fail are listed; the others carry on. */
export async function applyRows(
  rows: { row: SyncRow; action: SyncAction }[],
  folder: VaultFolder,
  onProgress?: (done: number, total: number, path: string) => void,
): Promise<{ done: number; failed: { path: string; error: string }[] }> {
  const stamp = stampNow();
  const failed: { path: string; error: string }[] = [];
  let done = 0;
  const work = rows.filter((r) => r.action !== 'skip' || (r.row.same && r.row.item && r.row.local && r.row.item.meta.base !== r.row.local.hash));
  for (const { row, action } of work) {
    onProgress?.(done, work.length, row.path);
    try {
      const it = row.item;
      if (row.same && action === 'skip') {
        // Same content: only the sync hash is updated
        if (it && row.local) await vault.setBase(it.id, row.local.hash);
      } else if (action === 'import' && row.local) {
        const bytes = await row.local.read();
        if (row.kind === 'note') await vault.putNote(row.path, decoder.decode(bytes), { id: it?.id, base: row.local.hash, mtime: row.local.mtime });
        else await vault.putFile(row.path, bytes, { id: it?.id, base: row.local.hash, mtime: row.local.mtime, mime: mimeOf(row.path) });
      } else if (action === 'export' && it && !it.meta.deleted) {
        if (!folder.canWrite) throw new Error('Read-only folder');
        const bytes = it.meta.kind === 'note' ? encoder.encode(it.text ?? '') : await vault.fileBytes(it.id);
        if (row.local) await folder.backup(row.path, stamp);
        await folder.write(row.path, bytes);
        await vault.setBase(it.id, it.meta.hash);
      } else if (action === 'deleteHere' && it) {
        await vault.hardDelete(it.id);
      } else if (action === 'deleteThere' && row.local) {
        if (!folder.canWrite) throw new Error('Read-only folder');
        await folder.moveToTrash(row.path, stamp);
        if (it) await vault.hardDelete(it.id);
      }
      done++;
    } catch (e) {
      failed.push({ path: row.path, error: (e as Error).message });
    }
  }
  onProgress?.(done, work.length, '');
  return { done, failed };
}
