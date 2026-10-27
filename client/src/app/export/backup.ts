import JSZip from 'jszip';
import type { BookNote, NoteTab } from '@hyperfocus/shared';
import { getBookStored, getNotebook, getShelf } from '../secure';
import { isAssetRef, parseAssetRef, vault } from '../vault/store';

const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'audio/mpeg': 'mp3' };
import { download, fileName } from './common';
import { exportPdf } from './pdf';
import { exportDocx } from './docx';

/** Safe text for a folder name (letters with accents stay; marks file systems dislike are removed). */
const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
};

/** Notes as readable text: tab by tab, each note separately. */
function notesText(notes: BookNote[], tabs: NoteTab[]) {
  const all: NoteTab[] = tabs.length ? tabs : [{ id: 'main', name: 'Page 1' }];
  const tabOf = (n: BookNote) => (n.tab && all.some((t) => t.id === n.tab) ? n.tab : all[0]!.id);
  const out: string[] = [];
  for (const t of all) {
    const list = notes
      .filter((n) => tabOf(n) === t.id && n.text.trim())
      // By their place on the board: top to bottom, left to right
      .sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
    out.push(`# ${t.name}`, '');
    if (!list.length) out.push('(empty)', '');
    for (const n of list) out.push(n.text.trim(), '', '—', '');
  }
  return out.join('\n');
}

/**
 * Every book and the notes in one zip file:
 * for each book a PDF, a Word file, the book's full data (book.json) and the files it uses (cover, images, map, music);
 * the notes both as readable text and as full data.
 */
export async function exportEverything(onProgress?: (msg: string) => void) {
  onProgress?.('Collecting…');
  // Books and notes are decrypted in the browser; the backup downloads to your computer
  const [shelf, notebook] = await Promise.all([getShelf(), getNotebook()]);
  const books = shelf.books.map((b, i) => ({ n: i + 1, id: b.id, title: b.title }));

  const zip = new JSZip();
  const rootName = `Hyperfocus ${stamp()}`;
  const root = zip.folder(rootName)!;
  const text = { compression: 'DEFLATE' as const };
  const missing: string[] = [];

  for (let i = 0; i < books.length; i++) {
    const b = books[i]!;
    const tag = `${i + 1}/${books.length} · ${b.title || 'Untitled'}`;
    const dir = root.folder(`${String(b.n).padStart(2, '0')} ${safe(b.title)}`)!;

    onProgress?.(`${tag} · PDF`);
    const pdf = await exportPdf(b.id, undefined, false);
    dir.file(pdf.name, pdf.bytes);

    onProgress?.(`${tag} · Word`);
    const docx = await exportDocx(b.id, undefined, false);
    dir.file(docx.name, docx.blob);

    onProgress?.(`${tag} · files`);
    const book = await getBookStored(b.id);
    const urls = new Set<string>();
    for (const u of [book.coverUrl, book.backCoverUrl, book.spineUrl]) if (u) urls.add(u);
    if (book.mapUrl) urls.add(book.mapUrl);
    for (const c of book.chapters) {
      if (c.musicUrl) urls.add(c.musicUrl);
      for (const im of c.images) urls.add(im.url);
    }
    const names = new Map<string, string>();
    for (const url of urls) {
      try {
        let name: string;
        let blob: Blob;
        if (isAssetRef(url)) {
          // An encrypted file: decrypted
          const { bytes, mime } = await vault.assetBytes(url);
          name = `${parseAssetRef(url).id}.${EXT[mime] ?? 'bin'}`;
          blob = new Blob([new Uint8Array(bytes)], { type: mime });
        } else {
          const r = await fetch(url, { credentials: 'same-origin' });
          if (!r.ok) throw new Error(String(r.status));
          name = url.split('/').pop()!;
          blob = await r.blob();
        }
        dir.file(`media/${name}`, blob);
        names.set(url, `media/${name}`);
      } catch {
        missing.push(`${b.title}: ${url}`);
      }
    }
    // The book's full data: file addresses as their names in the media/ folder
    const swap = (u: string | null) => (u ? (names.get(u) ?? u) : u);
    const data = {
      ...book,
      enc: undefined,
      coverUrl: swap(book.coverUrl),
      backCoverUrl: swap(book.backCoverUrl),
      spineUrl: swap(book.spineUrl),
      mapUrl: swap(book.mapUrl),
      chapters: book.chapters.map((c) => ({ ...c, enc: undefined, musicUrl: swap(c.musicUrl), images: c.images.map((im) => ({ ...im, url: swap(im.url) ?? im.url })) })),
    };
    dir.file('book.json', JSON.stringify(data, null, 2), text);
  }

  onProgress?.('Notes…');
  const notes = root.folder('Notes')!;
  notes.file('notes.txt', notesText(notebook.notes, notebook.tabs ?? []), text);
  notes.file('notes.json', JSON.stringify({ notes: notebook.notes, tabs: notebook.tabs ?? [] }, null, 2), text);
  if (missing.length) root.file('missing-files.txt', `These files could not be downloaded:\n\n${missing.join('\n')}\n`, text);

  onProgress?.('Packing…');
  // PDF, Word, images and music are already compressed: stored as they are (fast); text is compressed
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  download(blob, fileName(rootName, 'zip'), 'application/zip');
  return { books: books.length, size: blob.size, missing: missing.length };
}
