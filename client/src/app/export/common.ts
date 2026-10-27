import type { BookFull } from '@hyperfocus/shared';
import { getBook } from '../secure';
import { blocksFromDoc, epigraphOf, layoutBook, loadBookFonts, type BookInput, type LaidBook } from '../layout';
import { loadShapes, shapeOf } from '../shapes';

/** The latest version of the book and its A5 layout (the same as in the editor). */
export async function loadBookForExport(bookId: number): Promise<{ book: BookFull; input: BookInput; laid: LaidBook }> {
  const book: BookFull = await getBook(bookId);
  await loadBookFonts();
  await loadShapes(book.chapters.flatMap((c) => c.images.map((i) => i.url)));
  const input: BookInput = {
    title: book.title,
    author: book.author,
    coverUrl: book.coverUrl,
    chapters: book.chapters.map((c) => ({ id: c.id, title: c.title, blocks: blocksFromDoc(c.content), images: c.images, epigraph: epigraphOf(c) })),
  };
  return { book, input, laid: layoutBook(input, shapeOf) };
}

const fontCache = new Map<string, Promise<Uint8Array>>();
/** EB Garamond file to embed (public/fonts/ebgaramond). */
export function fontBytes(file: 'Regular' | 'Italic' | 'SemiBold' | 'SemiBoldItalic') {
  let p = fontCache.get(file);
  if (!p) {
    p = fetch(`/fonts/ebgaramond/EBGaramond-${file}.ttf`).then(async (r) => {
      if (!r.ok) throw new Error('Could not load the font.');
      return new Uint8Array(await r.arrayBuffer());
    });
    fontCache.set(file, p);
    p.catch(() => fontCache.delete(file));
  }
  return p;
}

/**
 * Converts an image to a format PDF/Word can read (uploaded images are WEBP).
 * Images with transparency become PNG, the rest JPEG. `maxSide`: the longest side at most (pixels).
 */
export async function imageBytes(url: string, maxSide: number, opaque = false): Promise<{ bytes: Uint8Array; type: 'png' | 'jpg'; w: number; h: number } | null> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = url;
  });
  if (!img) return null;
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  let hasAlpha = false;
  if (!opaque) {
    try {
      const d = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < d.length; i += 16) if (d[i]! < 250) {
        hasAlpha = true;
        break;
      }
    } catch {
      hasAlpha = true;
    }
  }
  const type = hasAlpha ? 'png' : 'jpg';
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, hasAlpha ? 'image/png' : 'image/jpeg', 0.93));
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type, w, h };
}

/** File name: accented letters are simplified, spaces become dashes. */
export function fileName(title: string, ext: string) {
  const base =
    (title || 'book')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // é → e, ñ → n
      .replace(/ı/g, 'i')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'book';
  return `${base}.${ext}`;
}

export function download(data: Uint8Array | Blob, name: string, type: string) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Cover of a book without an image: the same dark charcoal leather as on screen and on the 3D book, white text. */
export const LEATHER = '#332e27';
export const LEATHER_INK = '#f4efe6';

/** A5, 300 dpi. */
const COVER_W = 1748;
const COVER_H = Math.round((COVER_W * 794) / 559);

/** Leather: a fine random grain on a flat colour (the same every time). */
function leatherCanvas() {
  const c = document.createElement('canvas');
  c.width = COVER_W;
  c.height = COVER_H;
  const g = c.getContext('2d')!;
  g.fillStyle = LEATHER;
  g.fillRect(0, 0, COVER_W, COVER_H);
  const img = g.getImageData(0, 0, COVER_W, COVER_H);
  const d = img.data;
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 14;
    d[i] = d[i]! + n;
    d[i + 1] = d[i + 1]! + n;
    d[i + 2] = d[i + 2]! + n;
  }
  g.putImageData(img, 0, 0);
  return c;
}

const toJpeg = async (c: HTMLCanvasElement) => {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Could not draw the cover.');
  return new Uint8Array(await blob.arrayBuffer());
};

let leatherCache: Promise<Uint8Array> | null = null;
/** Just the leather texture (in the PDF the text is drawn on top separately, sharp). */
export function leatherJpeg() {
  leatherCache ??= toJpeg(leatherCanvas());
  leatherCache.catch(() => (leatherCache = null));
  return leatherCache;
}

/** The full cover image with its text (Word: a borderless cover page). Proportions match the cover on screen. */
export async function leatherCoverJpeg(title: string, author: string) {
  await document.fonts.ready;
  const c = leatherCanvas();
  const g = c.getContext('2d')!;
  const k = COVER_W / 559; // A5 unit → pixel
  const serif = '"EB Garamond", Georgia, serif';
  g.fillStyle = LEATHER_INK;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = `400 ${44 * k}px ${serif}`;
  const words = (title || 'Untitled').split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > 439 * k && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  const total = lines.length * 49 + 26 + 1 + 26 + 30;
  let y = (794 - total) / 2;
  for (const l of lines) {
    g.fillText(l, COVER_W / 2, (y + 38) * k);
    y += 49;
  }
  y += 26;
  g.globalAlpha = 0.7;
  g.fillRect(COVER_W / 2 - 35 * k, y * k, 70 * k, Math.max(2, k));
  g.globalAlpha = 0.85;
  y += 27;
  g.font = `italic 400 ${20 * k}px ${serif}`;
  g.fillText(author, COVER_W / 2, (y + 17) * k);
  g.globalAlpha = 1;
  return toJpeg(c);
}
