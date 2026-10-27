import { countInDoc, replaceInDoc, type BookChapter, type BookFull, type BookNote, type BookSummary, type FindOptions, type NoteTab, type ShelfResponse } from '@hyperfocus/shared';
import { api } from '../lib/api';
import { compress } from '../lib/upload';
import { isAssetRef, parseAssetRef, vault } from './vault/store';

/**
 * Hyperfocus's end-to-end encrypted data. The server only keeps encrypted records ("enc") and encrypted files;
 * everything is opened and closed here, in the browser, with the vault key.
 *
 * There are two forms:
 * - stored: files as "hfa:<id>:<type>" references (inside the encrypted record)
 * - live: files as temporary addresses valid in this tab (blob:); the editor, reading, 3D and exports use this.
 */

type MetaFields = Pick<BookSummary, 'title' | 'author' | 'synopsis' | 'coverUrl' | 'backCoverUrl' | 'spineUrl' | 'mapUrl'>;
type ChapterFields = Pick<BookChapter, 'title' | 'content' | 'images' | 'musicUrl' | 'musicFrom' | 'musicTo' | 'epigraph' | 'epigraphBy' | 'epigraphQuotes'>;
export interface Notebook {
  notes: BookNote[];
  tabs: NoteTab[];
}

const pickMeta = (b: MetaFields): MetaFields => ({
  title: b.title,
  author: b.author,
  synopsis: b.synopsis,
  coverUrl: b.coverUrl ?? null,
  backCoverUrl: b.backCoverUrl ?? null,
  spineUrl: b.spineUrl ?? null,
  mapUrl: b.mapUrl ?? null,
});
const pickChapter = (c: ChapterFields): ChapterFields => ({
  title: c.title,
  content: c.content,
  images: c.images ?? [],
  musicUrl: c.musicUrl ?? null,
  musicFrom: c.musicFrom ?? null,
  musicTo: c.musicTo ?? null,
  epigraph: c.epigraph ?? null,
  epigraphBy: c.epigraphBy ?? null,
  epigraphQuotes: !!c.epigraphQuotes,
});

const bookAad = (id: number) => `book:${id}`;
const chapterAad = (id: number) => `chapter:${id}`;
export const emptyDoc = () => ({ type: 'doc', content: [{ type: 'paragraph' }] });

// ---- Stored ↔ live ----
async function liveUrl(u: string | null | undefined): Promise<string | null> {
  if (!u) return null;
  if (!isAssetRef(u)) return u;
  return vault.assetUrl(u).catch(() => u);
}
const storedUrl = (u: string | null | undefined): string | null => (u ? (vault.refFor(u) ?? u) : null);
const assetIds = (urls: (string | null | undefined)[]) => urls.filter(isAssetRef).map((u) => parseAssetRef(u).id);

async function liveMeta<T extends MetaFields>(m: T): Promise<T> {
  const [coverUrl, backCoverUrl, spineUrl, mapUrl] = await Promise.all([liveUrl(m.coverUrl), liveUrl(m.backCoverUrl), liveUrl(m.spineUrl), liveUrl(m.mapUrl)]);
  return { ...m, coverUrl, backCoverUrl, spineUrl, mapUrl };
}
async function liveChapter(c: BookChapter): Promise<BookChapter> {
  const images = await Promise.all((c.images ?? []).map(async (im) => ({ ...im, url: (await liveUrl(im.url)) ?? im.url })));
  return { ...c, images, musicUrl: await liveUrl(c.musicUrl) };
}

/** Opens the book details (as they are if not encrypted). Stored form. */
export async function openMeta<T extends BookSummary>(b: T): Promise<T> {
  if (!b.enc) return b;
  return { ...b, ...pickMeta(await vault.openJson<MetaFields>(b.enc, bookAad(b.id))) };
}
export async function openChapter(c: BookChapter): Promise<BookChapter> {
  if (!c.enc) return c;
  return { ...c, ...pickChapter(await vault.openJson<ChapterFields>(c.enc, chapterAad(c.id))) };
}

/** The book in stored form (for search, replace, moving to encryption and backups). */
export async function getBookStored(id: number): Promise<BookFull> {
  const { book } = await api.get<{ book: BookFull }>(`/api/books/${id}`);
  const meta = await openMeta(book);
  return { ...meta, chapters: await Promise.all(book.chapters.map(openChapter)) };
}

/** The book in live form (editor, reading, exports). */
export async function getBook(id: number): Promise<BookFull> {
  const b = await getBookStored(id);
  return { ...(await liveMeta(b)), chapters: await Promise.all(b.chapters.map(liveChapter)) };
}

/** The shelf: with titles and covers opened. */
export async function getShelf(): Promise<ShelfResponse> {
  const raw = await api.get<ShelfResponse>('/api/books');
  const books = await Promise.all(
    raw.books.map(async (b) => {
      try {
        return await liveMeta(await openMeta(b));
      } catch {
        return { ...b, title: '(cannot be opened)', author: '' };
      }
    }),
  );
  return { ...raw, books };
}

// ---- Saving (encrypted request bodies) ----
export async function metaPayload(id: number, live: MetaFields) {
  const m = pickMeta({ ...live, coverUrl: storedUrl(live.coverUrl), backCoverUrl: storedUrl(live.backCoverUrl), spineUrl: storedUrl(live.spineUrl), mapUrl: storedUrl(live.mapUrl) });
  return { enc: await vault.sealJson(m, bookAad(id)), assets: assetIds([m.coverUrl, m.backCoverUrl, m.spineUrl, m.mapUrl]) };
}

export async function chapterPayload(ch: BookChapter) {
  const c = pickChapter({ ...ch, images: (ch.images ?? []).map((im) => ({ ...im, url: storedUrl(im.url) ?? im.url })), musicUrl: storedUrl(ch.musicUrl) });
  return { enc: await vault.sealJson(c, chapterAad(ch.id)), assets: assetIds([c.musicUrl, ...c.images.map((i) => i.url)]) };
}

/** A new book: the server opens an empty record; the title and first chapter are encrypted right away. */
export async function createBook(): Promise<number> {
  const { id } = await api.post<{ id: number }>('/api/books', {});
  const b = await getBookStored(id);
  await api.patch(`/api/books/${id}`, await metaPayload(id, b));
  for (const ch of b.chapters) await api.patch(`/api/chapters/${ch.id}`, await chapterPayload(ch));
  return id;
}

/** A new chapter (in an encrypted book the server does not even know its title). */
export async function createChapter(bookId: number, title: string): Promise<BookChapter> {
  const { id } = await api.post<{ id: number }>(`/api/books/${bookId}/chapters`, {});
  const ch: BookChapter = {
    id,
    ord: 0,
    title,
    content: emptyDoc(),
    musicUrl: null,
    musicFrom: null,
    musicTo: null,
    epigraph: null,
    epigraphBy: null,
    epigraphQuotes: false,
    images: [],
    updatedAt: new Date().toISOString(),
  };
  await api.patch(`/api/chapters/${id}`, await chapterPayload(ch));
  return ch;
}

// ---- Notebook and personal dictionary ----
export async function getNotebook(): Promise<Notebook> {
  const r = await api.get<Notebook & { enc?: string | null }>('/api/notes');
  if (r.enc) {
    const nb = await vault.openJson<Notebook>(r.enc, 'notebook');
    return { notes: nb.notes ?? [], tabs: nb.tabs ?? [] };
  }
  return { notes: r.notes ?? [], tabs: r.tabs ?? [] };
}
export async function notebookPayload(nb: Notebook) {
  return { enc: await vault.sealJson({ notes: nb.notes, tabs: nb.tabs }, 'notebook') };
}
export async function getDictionary(): Promise<string[]> {
  const r = await api.get<{ words: string[]; enc?: string | null }>('/api/dictionary');
  return r.enc ? await vault.openJson<string[]>(r.enc, 'dictionary') : (r.words ?? []);
}
export async function saveDictionary(words: string[]) {
  await api.put('/api/dictionary', { enc: await vault.sealJson([...new Set(words)].sort(), 'dictionary') });
}

// ---- Dosyalar ----
/** Shrinks, encrypts and uploads an image; returns a temporary address the editor can use right away. */
export async function uploadImageSecure(file: File, maxSide: number, quality: number): Promise<{ url: string; width: number; height: number }> {
  if (!file.type.startsWith('image/')) throw new Error('Only image files can be uploaded.');
  const { blob, width, height } = await compress(file, maxSide, quality);
  if (blob.size > 20 * 1024 * 1024) throw new Error('The image is too large.');
  const { url } = await vault.uploadAsset(new Uint8Array(await blob.arrayBuffer()), blob.type || 'image/webp');
  return { url, width, height };
}

const isMp3 = (b: Uint8Array) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0);
export async function uploadAudioSecure(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error('The music file can be at most 20 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isMp3(bytes)) throw new Error('Only MP3 files can be uploaded.');
  return (await vault.uploadAsset(bytes, 'audio/mpeg')).url;
}

// ---- Find and replace across every book (in the browser, since the server cannot read the text) ----
export interface OtherBookHit {
  id: number;
  position: number;
  title: string;
  total: number;
  chapters: { id: number; title: string; count: number }[];
}
/** Opened books are kept in memory for a while (not downloaded again on every key press). Locking reloads the page. */
const bookCache = new Map<number, { stamp: string; book: Promise<BookFull> }>();
async function storedBooks(exclude?: number) {
  const raw = await api.get<ShelfResponse>('/api/books');
  const list = raw.books.filter((b) => b.id !== exclude).map((b) => ({ position: b.position, id: b.id, stamp: b.updatedAt }));
  return Promise.all(
    list.map(async (b) => {
      let c = bookCache.get(b.id);
      if (!c || c.stamp !== b.stamp) {
        c = { stamp: b.stamp, book: getBookStored(b.id) };
        c.book.catch(() => bookCache.delete(b.id));
        bookCache.set(b.id, c);
      }
      return { position: b.position, book: await c.book };
    }),
  );
}

/** Recently edited chapters (only which chapter and when; not what changed). */
export interface ChapterEdit {
  bookId: number;
  bookTitle: string;
  chapterId: number;
  chapterTitle: string;
  at: string;
}
export async function recentChapters(): Promise<ChapterEdit[]> {
  const out: ChapterEdit[] = [];
  for (const { book } of await storedBooks())
    for (const c of book.chapters) out.push({ bookId: book.id, bookTitle: book.title, chapterId: c.id, chapterTitle: c.title, at: c.updatedAt });
  return out;
}

export async function searchBooks(q: string, opts: FindOptions, exclude?: number): Promise<OtherBookHit[]> {
  if (!q.trim()) return [];
  const out: OtherBookHit[] = [];
  for (const { position, book } of await storedBooks(exclude)) {
    const chapters = book.chapters.map((c) => ({ id: c.id, title: c.title, count: countInDoc(c.content, q, opts) })).filter((c) => c.count > 0);
    if (chapters.length) out.push({ id: book.id, position, title: book.title, total: chapters.reduce((s, c) => s + c.count, 0), chapters });
  }
  return out;
}

export async function replaceInBooks(q: string, withText: string, opts: FindOptions, exclude?: number): Promise<number> {
  let replaced = 0;
  for (const { book } of await storedBooks(exclude)) {
    for (const ch of book.chapters) {
      const r = replaceInDoc(ch.content, q, withText, opts);
      if (!r.count) continue;
      await api.patch(`/api/chapters/${ch.id}`, await chapterPayload({ ...ch, content: r.doc }));
      replaced += r.count;
    }
    bookCache.delete(book.id);
  }
  return replaced;
}

// ---- Encrypting existing (unencrypted) data ----
export interface PlainState {
  books: { id: number; title: string }[];
  notebook: boolean;
  dictionary: boolean;
}

/** Is anything not encrypted yet? */
export async function plainState(): Promise<PlainState | null> {
  const [raw, nb, dict] = await Promise.all([
    api.get<ShelfResponse>('/api/books'),
    api.get<Notebook & { enc?: string | null }>('/api/notes'),
    api.get<{ words: string[]; enc?: string | null }>('/api/dictionary'),
  ]);
  const books: PlainState['books'] = [];
  for (const b of raw.books) {
    if (!b.enc) books.push({ id: b.id, title: b.title });
    else {
      const { book } = await api.get<{ book: BookFull }>(`/api/books/${b.id}`);
      if (book.chapters.some((c) => !c.enc)) books.push({ id: b.id, title: (await openMeta(b)).title });
    }
  }
  const notebook = !nb.enc && ((nb.notes?.length ?? 0) > 0 || (nb.tabs?.length ?? 0) > 0);
  const dictionary = !dict.enc && (dict.words?.length ?? 0) > 0;
  return books.length || notebook || dictionary ? { books, notebook, dictionary } : null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Encrypts unencrypted data. The safe order:
 * 1) old files are encrypted and uploaded again; 2) encrypted records are written (the plain text is not removed yet);
 * 3) they are read back from the server, decrypted and compared exactly; 4) only if all match are the plain text and old files removed.
 */
export async function encryptEverything(onProgress: (msg: string) => void): Promise<void> {
  const legacy = new Map<string, string>(); // old /uploads address → ref
  const toRef = async (u: string | null | undefined): Promise<string | null> => {
    if (!u || isAssetRef(u) || !u.startsWith('/uploads/')) return u ?? null;
    let ref = legacy.get(u);
    if (!ref) {
      const res = await fetch(u, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Could not read a file (${u})`);
      const mime = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!;
      ref = (await vault.uploadAsset(new Uint8Array(await res.arrayBuffer()), mime)).ref;
      legacy.set(u, ref);
    }
    return ref;
  };

  const raw = await api.get<ShelfResponse>('/api/books');
  const books = raw.books;
  let n = 0;
  for (const summary of books) {
    n++;
    const b = await getBookStored(summary.id);
    const label = `Book ${n} of ${books.length}: ${b.title || 'Untitled'}`;
    onProgress(`${label} · files`);
    const meta = pickMeta({ ...b, coverUrl: await toRef(b.coverUrl), backCoverUrl: await toRef(b.backCoverUrl), spineUrl: await toRef(b.spineUrl), mapUrl: await toRef(b.mapUrl) });
    const chapters: BookChapter[] = [];
    for (const ch of b.chapters) {
      const images = [];
      for (const im of ch.images ?? []) images.push({ ...im, url: (await toRef(im.url)) ?? im.url });
      chapters.push({ ...ch, images, musicUrl: await toRef(ch.musicUrl) });
    }
    onProgress(`${label} · encrypting`);
    if (!summary.enc || !same(meta, pickMeta(b))) await api.patch(`/api/books/${b.id}`, { ...(await metaPayload(b.id, meta)), keepPlain: true });
    for (const ch of chapters) await api.patch(`/api/chapters/${ch.id}`, { ...(await chapterPayload(ch)), keepPlain: true });
    // Check: read back from the server, decrypt, compare
    onProgress(`${label} · checking`);
    const back = await api.get<{ book: BookFull }>(`/api/books/${b.id}`);
    if (!back.book.enc) throw new Error(`Check failed for “${b.title}”`);
    const backMeta = pickMeta(await openMeta(back.book));
    if (!same(backMeta, meta)) throw new Error(`Check failed for “${b.title}”`);
    for (const ch of chapters) {
      const got = back.book.chapters.find((c) => c.id === ch.id);
      if (!got?.enc || !same(pickChapter(await openChapter(got)), pickChapter(ch))) throw new Error(`Check failed for a chapter of “${b.title}”`);
    }
  }

  onProgress('Notes and dictionary…');
  const nbRaw = await api.get<Notebook & { enc?: string | null }>('/api/notes');
  if (!nbRaw.enc) {
    const nb = { notes: nbRaw.notes ?? [], tabs: nbRaw.tabs ?? [] };
    await api.patch('/api/notes', { ...(await notebookPayload(nb)), keepPlain: true });
    if (!same(await getNotebook(), nb)) throw new Error('Check failed for your notes');
  }
  const dictRaw = await api.get<{ words: string[]; enc?: string | null }>('/api/dictionary');
  if (!dictRaw.enc) {
    const words = [...new Set(dictRaw.words ?? [])].sort();
    await api.put('/api/dictionary', { enc: await vault.sealJson(words, 'dictionary'), keepPlain: true });
    if (!same(await getDictionary(), words)) throw new Error('Check failed for your dictionary');
  }

  onProgress('Removing the unencrypted copies…');
  const sealed = await api.post<{ plainBooks: number; plainChapters: number }>('/api/seal');
  if (sealed.plainBooks || sealed.plainChapters) throw new Error('Some chapters are still unencrypted. Try again.');
  for (const url of legacy.keys()) await api.post('/api/uploads/forget', { url }).catch(() => {});
  // Old unencrypted files no book uses any more (e.g. replaced covers) are removed too
  await api.post('/api/uploads/purge-plain');
  bookCache.clear();
}
