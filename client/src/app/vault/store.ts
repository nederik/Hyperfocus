import { useSyncExternalStore } from 'react';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { registerSaver } from '../autosave';
import * as C from './crypto';

/**
 * The library (e.g. Obsidian notes): the open copy lives only in this tab's memory.
 * On a reload, or on "Lock", the key and the decrypted notes are removed from memory.
 */

/** Meta information, stored encrypted. */
export interface VaultMeta {
  /** The path inside the vault, e.g. "Characters/Main/Mara.md". */
  path: string;
  kind: 'note' | 'file';
  mime?: string;
  /** SHA-256 hash of the content (for notes: the UTF-8 text). */
  hash: string;
  /** Size of the plain content in bytes. */
  size: number;
  mtime: number;
  /** The hash at the last Obsidian sync: to tell which side has changed. */
  base?: string | null;
  /** Deleted in Hyperfocus; removed for good after the next Obsidian sync. */
  deleted?: boolean;
  /** Highlight color in the sidebar (Hyperfocus only; not sent to Obsidian). */
  color?: string | null;
}

export interface VaultItem {
  id: string;
  meta: VaultMeta;
  rev: number;
  hasBlob: boolean;
  /** The note's text (notes only). */
  text?: string;
}

export type VaultStatus = 'loading' | 'error' | 'none' | 'locked' | 'unlocked';
export type VaultSave = 'saved' | 'saving' | 'error';

interface State {
  status: VaultStatus;
  error?: string;
  items: VaultItem[];
  save: VaultSave;
}

interface RawItem {
  id: string;
  meta: string;
  body: string | null;
  hasBlob: boolean;
  rev: number;
}

const enc = new TextEncoder();
export const isNotePath = (p: string) => /\.md$/i.test(p);
/** Hidden paths (.hyperfocus/…, .obsidian/…): not shown in the sidebar or History, skipped by the Obsidian sync. */
export const isHiddenPath = (p: string) => p.split('/').some((seg) => seg.startsWith('.'));
/** The library's own settings (folder colors); stored encrypted like the notes. */
export const SETTINGS_PATH = '.hyperfocus/settings.json';
interface LibrarySettings {
  folderColors?: Record<string, string>;
}
export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const noteTitle = (p: string) => baseName(p).replace(/\.md$/i, '');
export const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  pdf: 'application/pdf',
  md: 'text/markdown',
};
export const mimeOf = (p: string) => MIME[p.slice(p.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
export const isImage = (mime?: string) => !!mime && mime.startsWith('image/');

export const textHash = (text: string) => C.sha256Hex(enc.encode(text));

/** An encrypted file reference: "hfa:<id>:<type>" (kept inside the book data, encrypted). */
export const isAssetRef = (s: string | null | undefined): s is `hfa:${string}` => !!s && s.startsWith("hfa:");
export function parseAssetRef(ref: string): { id: string; mime: string } {
  const [, id = '', ...rest] = ref.split(':');
  return { id, mime: rest.join(':') || 'application/octet-stream' };
}
const newId = () => crypto.randomUUID().replace(/-/g, '');

class Vault {
  private state: State = { status: 'loading', items: [], save: 'saved' };
  private listeners = new Set<() => void>();
  private dek: CryptoKey | null = null;
  private keyFile: C.KeyFile | null = null;
  private urls = new Map<string, Promise<string>>();
  /** Note texts waiting to be written (id → text). */
  private pending = new Map<string, string>();
  private timer = 0;
  private busy = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private loading: Promise<void> | null = null;

  constructor() {
    registerSaver({ unsaved: () => this.pending.size > 0 || this.busy > 0, flush: () => this.flush() });
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  private updateItem(id: string, fn: (it: VaultItem) => VaultItem | null) {
    const items: VaultItem[] = [];
    for (const it of this.state.items) {
      if (it.id !== id) items.push(it);
      else {
        const n = fn(it);
        if (n) items.push(n);
      }
    }
    this.set({ items });
  }
  private item(id: string) {
    return this.state.items.find((i) => i.id === id) ?? null;
  }
  /** Writes happen one at a time (so a note's version number never gets mixed up). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }
  private key() {
    if (!this.dek) throw new Error('The library is locked');
    return this.dek;
  }

  // ---- Unlocking / locking ----
  load(): Promise<void> {
    if (this.dek) return Promise.resolve();
    this.loading ??= api
      .get<{ data: string | null }>('/api/vault/key')
      .then((r) => {
        this.keyFile = r.data ? (JSON.parse(r.data) as C.KeyFile) : null;
        if (!this.dek) this.set({ status: this.keyFile ? 'locked' : 'none', error: undefined });
      })
      .catch((e: Error) => this.set({ status: 'error', error: e.message }))
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  /** A new vault; returns the recovery key, shown only once. */
  async create(password: string): Promise<string> {
    const { file, dek, recoveryKey } = await C.createKeyFile(password);
    await api.put('/api/vault/key', { data: JSON.stringify(file) });
    this.keyFile = file;
    this.dek = dek;
    await this.fetchItems();
    return recoveryKey;
  }

  async unlock(password: string): Promise<boolean> {
    if (!this.keyFile) await this.load();
    if (!this.keyFile) return false;
    const dek = await C.openWithPassword(this.keyFile, password);
    if (!dek) return false;
    this.dek = dek;
    await this.fetchItems();
    return true;
  }

  /** Forgot the encryption password: opens with the recovery key and sets a new password. */
  async recover(recoveryKey: string, newPassword: string): Promise<boolean> {
    if (!this.keyFile) await this.load();
    if (!this.keyFile) return false;
    const dek = await C.openWithRecovery(this.keyFile, recoveryKey, true);
    if (!dek) return false;
    const file = await C.rewrapWithPassword(this.keyFile, dek, newPassword);
    await api.put('/api/vault/key', { data: JSON.stringify(file), replace: true });
    this.keyFile = file;
    this.dek = await C.toLive(dek);
    await this.fetchItems();
    return true;
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
    if (!this.keyFile) return false;
    const dek = await C.openWithPassword(this.keyFile, oldPassword, true);
    if (!dek) return false;
    const file = await C.rewrapWithPassword(this.keyFile, dek, newPassword);
    await api.put('/api/vault/key', { data: JSON.stringify(file), replace: true });
    this.keyFile = file;
    return true;
  }

  /** A new recovery key (the old one stops working); needs the encryption password. */
  async newRecoveryKey(password: string): Promise<string | null> {
    if (!this.keyFile) return null;
    const dek = await C.openWithPassword(this.keyFile, password, true);
    if (!dek) return null;
    const { file, recoveryKey } = await C.rewrapWithNewRecovery(this.keyFile, dek);
    await api.put('/api/vault/key', { data: JSON.stringify(file), replace: true });
    this.keyFile = file;
    return recoveryKey;
  }

  async lock() {
    await this.flush();
    this.dek = null;
    for (const p of [...this.urls.values(), ...this.assetUrls.values()]) void p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    this.urls.clear();
    this.assetUrls.clear();
    this.assetRefs.clear();
    this.set({ status: this.keyFile ? 'locked' : 'none', items: [], save: 'saved' });
  }

  get unlocked() {
    return !!this.dek;
  }

  // ---- Books, chapters, notes: encrypted as JSON (aad: a label bound to the record, e.g. "chapter:12") ----
  sealJson(value: unknown, aad: string): Promise<string> {
    return C.sealText(this.key(), JSON.stringify(value), aad);
  }
  async openJson<T>(sealed: string, aad: string): Promise<T> {
    return JSON.parse(await C.unsealText(this.key(), sealed, aad)) as T;
  }

  // ---- Encrypted files (book images, music). Stored in the record as "hfa:<id>:<type>". ----
  private assetUrls = new Map<string, Promise<string>>(); // ref → temporary address
  private assetRefs = new Map<string, string>(); // temporary address → ref

  async assetBytes(ref: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const { id, mime } = parseAssetRef(ref);
    const res = await fetch(`/api/assets/${id}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Could not load a file');
    return { bytes: await C.unseal(this.key(), new Uint8Array(await res.arrayBuffer()), `asset:${id}`), mime };
  }

  /** A temporary address for the encrypted file, valid in this tab (img, audio, three.js and exports can all use it). */
  assetUrl(ref: string): Promise<string> {
    let p = this.assetUrls.get(ref);
    if (!p) {
      p = this.assetBytes(ref).then(({ bytes, mime }) => {
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
        this.assetRefs.set(url, ref);
        return url;
      });
      p.catch(() => this.assetUrls.delete(ref));
      this.assetUrls.set(ref, p);
    }
    return p;
  }

  /** Encrypts and uploads a file; returns the ref for the record and a temporary address to use right away. */
  async uploadAsset(bytes: Uint8Array, mime: string): Promise<{ ref: string; url: string }> {
    const dek = this.key();
    // The id comes first: the encrypted data is bound to it (the server cannot swap files around)
    const sealedFor = async (id: string) => C.seal(dek, bytes, `asset:${id}`);
    const tmpId = crypto.randomUUID().replace(/-/g, '');
    const sealed = await sealedFor(tmpId);
    const res = await fetch(`/api/assets?id=${tmpId}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(sealed),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !j.id) throw new Error(j.error ?? `Upload failed (${res.status})`);
    if (j.id !== tmpId) throw new Error('Upload failed: unexpected file id');
    const ref = `hfa:${j.id}:${mime}`;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
    this.assetRefs.set(url, ref);
    this.assetUrls.set(ref, Promise.resolve(url));
    return { ref, url };
  }

  /** What a temporary address is stored as in the record (anything else as it is). */
  refFor(url: string): string | undefined {
    return this.assetRefs.get(url);
  }

  /** Deletes everything (when both the encryption password and the recovery key are lost). */
  async reset() {
    await api.post('/api/vault/reset', { confirm: 'DELETE MY LIBRARY' });
    this.dek = null;
    this.keyFile = null;
    this.pending.clear();
    this.urls.clear();
    this.set({ status: 'none', items: [], save: 'saved' });
  }

  private async fetchItems() {
    const dek = this.key();
    const r = await api.get<{ items: RawItem[] }>('/api/vault/items');
    const items = (
      await Promise.all(
        r.items.map(async (raw): Promise<VaultItem | null> => {
          try {
            const meta = JSON.parse(await C.unsealText(dek, raw.meta, `${raw.id}:meta`)) as VaultMeta;
            const text = raw.body != null ? await C.unsealText(dek, raw.body, `${raw.id}:body`) : undefined;
            return { id: raw.id, meta, rev: raw.rev, hasBlob: raw.hasBlob, text };
          } catch {
            console.warn('A library item could not be decrypted and was skipped', raw.id);
            return null;
          }
        }),
      )
    ).filter((x): x is VaultItem => !!x);
    this.set({ status: 'unlocked', items, error: undefined });
  }

  /** Loads again (e.g. after changes in another tab). */
  refresh() {
    return this.enqueue(() => this.fetchItems());
  }

  // ---- Okuma ----
  /** Items that are not deleted. */
  live(): VaultItem[] {
    return this.state.items.filter((i) => !i.meta.deleted);
  }
  byPath(path: string) {
    return this.state.items.find((i) => i.meta.path === path) ?? null;
  }

  /** The file's decrypted bytes. */
  async fileBytes(id: string): Promise<Uint8Array> {
    const dek = this.key();
    const res = await fetch(`/api/vault/blobs/${id}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Could not load the file');
    return C.unseal(dek, new Uint8Array(await res.arrayBuffer()), `${id}:blob`);
  }

  /** A temporary address to show it (this tab only; removed on lock). */
  fileUrl(id: string): Promise<string> {
    let p = this.urls.get(id);
    if (!p) {
      const it = this.item(id);
      p = this.fileBytes(id).then((b) => URL.createObjectURL(new Blob([new Uint8Array(b)], { type: it?.meta.mime ?? 'application/octet-stream' })));
      p.catch(() => this.urls.delete(id));
      this.urls.set(id, p);
    }
    return p;
  }

  // ---- Yazma ----
  private async write(item: VaultItem, body?: string | null): Promise<number> {
    const dek = this.key();
    const payload: Record<string, unknown> = { meta: await C.sealText(dek, JSON.stringify(item.meta), `${item.id}:meta`) };
    if (item.rev) payload.rev = item.rev;
    if (body !== undefined) payload.body = body === null ? null : await C.sealText(dek, body, `${item.id}:body`);
    const r = await api.put<{ rev: number }>(`/api/vault/items/${item.id}`, payload);
    return r.rev;
  }

  /** The note's text changed: on screen at once, on the server after a short pause. */
  setText(id: string, text: string) {
    this.updateItem(id, (it) => ({ ...it, text }));
    this.pending.set(id, text);
    this.set({ save: 'saving' });
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 700);
  }

  flush(): Promise<boolean> {
    window.clearTimeout(this.timer);
    const jobs = [...this.pending.entries()];
    this.pending.clear();
    if (!jobs.length) return this.chain.then(() => this.state.save !== 'error');
    this.busy++;
    return this.enqueue(async () => {
      let ok = true;
      for (const [id, text] of jobs) {
        const it = this.item(id);
        if (!it) continue;
        try {
          const bytes = enc.encode(text);
          const meta: VaultMeta = { ...it.meta, hash: await C.sha256Hex(bytes), size: bytes.length, mtime: Date.now() };
          const rev = await this.write({ ...it, meta }, text);
          this.updateItem(id, (cur) => ({ ...cur, meta, rev }));
        } catch (e) {
          ok = false;
          // If no newer text is waiting, this text is tried again
          if (!this.pending.has(id)) this.pending.set(id, text);
          toast(`Could not save “${noteTitle(it.meta.path)}”: ${(e as Error).message}`);
        }
      }
      if (!ok) {
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => void this.flush(), 5000);
      }
      return ok;
    })
      .catch(() => false)
      .then((ok) => {
        this.busy--;
        this.set({ save: ok ? (this.pending.size ? 'saving' : 'saved') : 'error' });
        return ok;
      });
  }

  /** A new note, or new content for a note (for sync and new notes; written at once). */
  putNote(path: string, text: string, opts: { id?: string; base?: string | null; mtime?: number; color?: string | null } = {}): Promise<string> {
    return this.enqueue(async () => {
      const bytes = enc.encode(text);
      const hash = await C.sha256Hex(bytes);
      const cur = opts.id ? this.item(opts.id) : this.byPath(path);
      const id = cur?.id ?? newId();
      const meta: VaultMeta = {
        path,
        kind: 'note',
        mime: 'text/markdown',
        hash,
        size: bytes.length,
        mtime: opts.mtime ?? Date.now(),
        base: opts.base !== undefined ? opts.base : (cur?.meta.base ?? null),
        color: opts.color !== undefined ? opts.color : (cur?.meta.color ?? null),
      };
      this.pending.delete(id);
      const rev = await this.write({ id, meta, rev: cur?.rev ?? 0, hasBlob: false }, text);
      const next: VaultItem = { id, meta, rev, hasBlob: false, text };
      if (cur) this.updateItem(id, () => next);
      else this.set({ items: [...this.state.items, next] });
      return id;
    });
  }

  /** A new file, or new content for a file (images…). */
  putFile(path: string, bytes: Uint8Array, opts: { id?: string; base?: string | null; mtime?: number; mime?: string; color?: string | null } = {}): Promise<string> {
    return this.enqueue(async () => {
      const dek = this.key();
      const hash = await C.sha256Hex(bytes);
      const cur = opts.id ? this.item(opts.id) : this.byPath(path);
      const id = cur?.id ?? newId();
      const meta: VaultMeta = {
        path,
        kind: 'file',
        mime: opts.mime ?? mimeOf(path),
        hash,
        size: bytes.length,
        mtime: opts.mtime ?? Date.now(),
        base: opts.base !== undefined ? opts.base : (cur?.meta.base ?? null),
        color: opts.color !== undefined ? opts.color : (cur?.meta.color ?? null),
      };
      const rev = await this.write({ id, meta, rev: cur?.rev ?? 0, hasBlob: !!cur?.hasBlob }, null);
      const sealed = await C.seal(dek, bytes, `${id}:blob`);
      const res = await fetch(`/api/vault/blobs/${id}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(sealed),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Upload failed (${res.status})`);
      const old = this.urls.get(id);
      if (old) {
        void old.then((u) => URL.revokeObjectURL(u)).catch(() => {});
        this.urls.delete(id);
      }
      const next: VaultItem = { id, meta, rev, hasBlob: true };
      if (cur) this.updateItem(id, () => next);
      else this.set({ items: [...this.state.items, next] });
      return id;
    });
  }

  /** Only the meta changes (renaming, the sync hash). */
  private patchMeta(id: string, patch: Partial<VaultMeta>) {
    return this.enqueue(async () => {
      const it = this.item(id);
      if (!it) return;
      const meta = { ...it.meta, ...patch };
      const rev = await this.write({ ...it, meta });
      this.updateItem(id, (cur) => ({ ...cur, meta, rev }));
    });
  }

  /** Highlight color in the sidebar (null: none). */
  setColor(id: string, color: string | null) {
    return this.patchMeta(id, { color });
  }

  private settings(): LibrarySettings {
    try {
      return (JSON.parse(this.byPath(SETTINGS_PATH)?.text ?? '{}') as LibrarySettings) ?? {};
    } catch {
      return {};
    }
  }
  /** Folder highlight colors (folder path → color). */
  folderColors(): Record<string, string> {
    return this.settings().folderColors ?? {};
  }
  async setFolderColor(path: string, color: string | null) {
    const s = this.settings();
    const folderColors = { ...(s.folderColors ?? {}) };
    if (color) folderColors[path] = color;
    else delete folderColors[path];
    await this.putNote(SETTINGS_PATH, JSON.stringify({ ...s, folderColors }));
  }

  async createNote(path: string) {
    return this.putNote(path, '');
  }

  async rename(id: string, path: string) {
    await this.flush();
    if (this.state.items.some((i) => i.id !== id && i.meta.path === path && !i.meta.deleted)) throw new Error('A note with this name already exists');
    // Moving a note that was synced with Obsidian: the old path looks deleted, the new one looks new.
    const it = this.item(id);
    if (!it) return;
    if (it.meta.base) {
      // A deletion mark is left at the old path; a new record is made at the new path
      if (it.meta.kind === 'note') await this.putNote(path, it.text ?? '', { base: null, color: it.meta.color ?? null });
      else await this.putFile(path, await this.fileBytes(id), { base: null, mime: it.meta.mime, color: it.meta.color ?? null });
      await this.patchMeta(id, { deleted: true });
    } else await this.patchMeta(id, { path });
  }

  /** A synced item stays as a mark (so it can be deleted from Obsidian too); one never synced is deleted for good. */
  async remove(id: string) {
    this.pending.delete(id);
    const it = this.item(id);
    if (!it) return;
    if (it.meta.base) await this.patchMeta(id, { deleted: true });
    else await this.hardDelete(id);
  }

  setBase(id: string, base: string | null) {
    return this.patchMeta(id, { base });
  }

  hardDelete(id: string) {
    return this.enqueue(async () => {
      await api.del(`/api/vault/items/${id}`);
      this.urls.delete(id);
      this.updateItem(id, () => null);
    });
  }
}

export const vault = new Vault();

export function useVault() {
  return useSyncExternalStore(vault.subscribe, vault.getState);
}
