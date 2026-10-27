/**
 * PDF: the same A5 layout as in the editor. Lines break where Pretext broke them; justification
 * is recomputed with the metrics of the EB Garamond embedded in the PDF. Images in place, cover and back cover included.
 */
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { BookImage } from '@hyperfocus/shared';
import { A5, type LaidPage, type PageLine } from '../layout';
import { download, fileName, fontBytes, imageBytes, leatherJpeg, LEATHER_INK, loadBookForExport } from './common';

const PT_W = 419.53; // A5, points
const PT_H = 595.28;
const S = PT_H / A5.h; // page pixel → point
const INK = rgb(0x23 / 255, 0x1a / 255, 0x12 / 255);
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

interface Fonts {
  regular: PDFFont;
  italic: PDFFont;
  bold: PDFFont;
  boldItalic: PDFFont;
}
const pick = (f: Fonts, bold: boolean, italic: boolean) => (bold ? (italic ? f.boldItalic : f.bold) : italic ? f.italic : f.regular);

// Characters missing from the font (e.g. emoji) must not break the PDF.
const charsets = new WeakMap<PDFFont, Set<number>>();
function safe(font: PDFFont, text: string) {
  let set = charsets.get(font);
  if (!set) charsets.set(font, (set = new Set(font.getCharacterSet())));
  let out = '';
  for (const ch of text) out += set.has(ch.codePointAt(0)!) ? ch : ch.trim() ? '?' : ' ';
  return out;
}

/** Distance from the top of the line to the baseline (like a CSS line box: the text height centred in the line). */
function baseline(font: PDFFont, size: number, lineH: number) {
  const full = font.heightAtSize(size);
  const asc = font.heightAtSize(size, { descender: false });
  return (lineH - full) / 2 + asc;
}

interface Tok {
  text: string;
  font: PDFFont;
  space: boolean;
}

/** Draws a line word by word; widens the spaces on a justified line and narrows them on a line that overflows. */
function drawLine(page: PDFPage, fonts: Fonts, line: PageLine) {
  const toks: Tok[] = [];
  line.frags.forEach((f, i) => {
    const font = pick(fonts, f.bold, f.italic);
    if (f.gap && i > 0) toks.push({ text: ' ', font, space: true });
    for (const part of f.text.split(/( +)/)) {
      if (!part) continue;
      toks.push({ text: part.startsWith(' ') ? ' ' : safe(font, part), font, space: part.startsWith(' ') });
    }
  });
  while (toks[0]?.space) toks.shift();
  while (toks[toks.length - 1]?.space) toks.pop();
  if (!toks.length) return;
  const size = line.size;
  const width = (t: Tok) => t.font.widthOfTextAtSize(t.text, size);
  const natural = toks.reduce((s, t) => s + width(t), 0);
  const spaces = toks.filter((t) => t.space).length;
  let extra = 0;
  if (spaces && (line.align === 'justify' || natural > line.w)) extra = (line.w - natural) / spaces;
  const base = line.y + baseline(toks[0]!.font, size, line.lineH);
  let x = line.x;
  for (const t of toks) {
    const w = width(t);
    if (!t.space) page.drawText(t.text, { x: x * S, y: PT_H - base * S, size: size * S, font: t.font, color: INK });
    x += w + (t.space ? extra : 0);
  }
}

/** Contents line: title, dots, and the page number on the right. */
function drawToc(page: PDFPage, fonts: Fonts, line: PageLine) {
  const num = String(line.tocPage ?? '');
  const font = fonts.regular;
  const size = line.size;
  const base = line.y + baseline(font, size, line.lineH);
  const title = safe(font, line.frags.map((f, i) => (f.gap && i > 0 ? ' ' : '') + f.text).join(''));
  const tw = font.widthOfTextAtSize(title, size);
  const nw = font.widthOfTextAtSize(num, size);
  page.drawText(title, { x: line.x * S, y: PT_H - base * S, size: size * S, font, color: INK });
  page.drawText(num, { x: (line.x + line.w - nw) * S, y: PT_H - base * S, size: size * S, font, color: INK });
  const from = line.x + tw + 8;
  const to = line.x + line.w - nw - 8;
  for (let x = from; x < to; x += 4.5) page.drawCircle({ x: x * S, y: PT_H - (base - 1) * S, size: 0.55, color: rgb(0.35, 0.3, 0.25), opacity: 0.6 });
}

/** Splits text into lines that fit the given width (for the covers). */
function wrap(font: PDFFont, size: number, text: string, maxW: number) {
  const lines: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxW && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function centered(page: PDFPage, font: PDFFont, size: number, text: string, top: number, color = INK, opacity = 1) {
  const t = safe(font, text);
  const w = font.widthOfTextAtSize(t, size);
  page.drawText(t, { x: ((A5.w - w) / 2) * S, y: PT_H - (top + font.heightAtSize(size, { descender: false })) * S, size: size * S, font, color, opacity });
}

/** Text on a cover without an image: white on leather (as on screen and on the 3D book). */
const COVER_INK = hex(LEATHER_INK);

/** Typeset front and back cover: the whole page is dark charcoal leather. */
function coverLeather(page: PDFPage, leather: PDFImage) {
  page.drawImage(leather, { x: 0, y: 0, width: PT_W, height: PT_H });
}

/** Draws an image fitted into a box (contain) or covering the page (cover). */
function drawImage(page: PDFPage, img: PDFImage, box: { x: number; y: number; w: number; h: number }, mode: 'contain' | 'cover') {
  const k = mode === 'cover' ? Math.max(box.w / img.width, box.h / img.height) : Math.min(box.w / img.width, box.h / img.height);
  const w = img.width * k;
  const h = img.height * k;
  const x = box.x + (box.w - w) / 2;
  const y = box.y + (box.h - h) / 2;
  page.drawImage(img, { x: x * S, y: PT_H - (y + h) * S, width: w * S, height: h * S });
}

/** Makes the book a PDF; with `save` false it does not download but returns the file (for the full backup). */
export async function exportPdf(bookId: number, onProgress?: (msg: string) => void, save = true) {
  onProgress?.('Typesetting the book…');
  const { book, laid } = await loadBookForExport(bookId);

  onProgress?.('Embedding fonts…');
  // Note: pdf-lib's subset embedding loses some letters of this font, so the whole font is embedded.
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [r, i, b, bi] = await Promise.all([fontBytes('Regular'), fontBytes('Italic'), fontBytes('SemiBold'), fontBytes('SemiBoldItalic')]);
  const fonts: Fonts = {
    regular: await doc.embedFont(r),
    italic: await doc.embedFont(i),
    bold: await doc.embedFont(b),
    boldItalic: await doc.embedFont(bi),
  };
  doc.setTitle(book.title || 'Untitled');
  doc.setAuthor(book.author);
  doc.setSubject(book.synopsis.slice(0, 500));
  doc.setLanguage('en');
  doc.setCreator('Hyperfocus');
  doc.setProducer('Hyperfocus');

  // The leather texture (front/back cover without an image) is embedded once
  let leatherImg: Promise<PDFImage> | null = null;
  const leather = () => (leatherImg ??= leatherJpeg().then((bytes) => doc.embedJpg(bytes)));

  // Images are embedded once
  const embedded = new Map<string, Promise<PDFImage | null>>();
  const embed = (url: string, maxSide: number, opaque = false) => {
    let p = embedded.get(url);
    if (!p) {
      p = imageBytes(url, maxSide, opaque).then((im) => (im ? (im.type === 'png' ? doc.embedPng(im.bytes) : doc.embedJpg(im.bytes)) : null));
      embedded.set(url, p);
    }
    return p;
  };

  const pages: (LaidPage | 'back' | 'blank')[] = [...laid.pages];
  if ((pages.length + 1) % 2 === 1) pages.push('blank'); // the back cover is at the back of the book, not on a right-hand page
  pages.push('back');

  for (let n = 0; n < pages.length; n++) {
    if (n % 10 === 0) onProgress?.(`Drawing pages… ${n + 1} / ${pages.length}`);
    const lp = pages[n]!;
    const page = doc.addPage([PT_W, PT_H]);
    if (lp === 'blank') continue;
    if (lp === 'back') {
      const backImg = book.backCoverUrl ? await embed(book.backCoverUrl, 2480, true) : null;
      if (backImg) {
        drawImage(page, backImg, { x: 0, y: 0, w: A5.w, h: A5.h }, 'cover');
        continue;
      }
      coverLeather(page, await leather());
      const f = fonts;
      const titleLines = wrap(f.regular, 28, book.title || 'Untitled', 419);
      const body = book.synopsis ? wrap(f.italic, 17, book.synopsis, 419) : [];
      const total = titleLines.length * 34 + 24 + 1 + 24 + body.length * 27 + (body.length ? 24 : 0) + 24;
      let y = (A5.h - total) / 2;
      for (const l of titleLines) {
        centered(page, f.regular, 28, l, y, COVER_INK);
        y += 34;
      }
      y += 24;
      page.drawRectangle({ x: ((A5.w - 70) / 2) * S, y: PT_H - y * S, width: 70 * S, height: 1 * S, color: COVER_INK, opacity: 0.7 });
      y += 25;
      for (const l of body) {
        centered(page, f.italic, 17, l, y, COVER_INK, 0.85);
        y += 27;
      }
      if (body.length) y += 24;
      centered(page, f.regular, 16, book.author.toUpperCase(), y, COVER_INK, 0.7);
      continue;
    }

    if (lp.kind === 'cover') {
      const img = book.coverUrl ? await embed(book.coverUrl, 2480, true) : null;
      if (img) {
        drawImage(page, img, { x: 0, y: 0, w: A5.w, h: A5.h }, 'cover');
      } else {
        coverLeather(page, await leather());
        const lines = wrap(fonts.regular, 44, book.title || 'Untitled', 439);
        const total = lines.length * 49 + 26 + 1 + 26 + 30;
        let y = (A5.h - total) / 2;
        for (const l of lines) {
          centered(page, fonts.regular, 44, l, y, COVER_INK);
          y += 49;
        }
        y += 26;
        page.drawRectangle({ x: ((A5.w - 70) / 2) * S, y: PT_H - y * S, width: 70 * S, height: 1 * S, color: COVER_INK, opacity: 0.7 });
        y += 27;
        centered(page, fonts.italic, 20, book.author, y, COVER_INK, 0.85);
      }
      continue;
    }

    // Scene breaks: ── ◆ ── fully black
    for (const sc of lp.scenes ?? []) {
      const k = sc.scale;
      const black = rgb(0, 0, 0);
      for (const dir of [-1, 1]) {
        const a = sc.cx + dir * 14.25 * k;
        const b = sc.cx + dir * 58.25 * k;
        page.drawLine({ start: { x: a * S, y: PT_H - sc.cy * S }, end: { x: b * S, y: PT_H - sc.cy * S }, thickness: 1 * S * k, color: black });
      }
      page.drawSvgPath('M 0 -4.24 L 4.24 0 L 0 4.24 L -4.24 0 Z', { x: sc.cx * S, y: PT_H - sc.cy * S, scale: S * k, color: black, borderWidth: 0 });
    }
    // Page images under the text
    for (const im of lp.images ?? []) {
      const pdfImg = await embed(im.url, imageSide(im));
      if (!pdfImg) continue;
      if (im.full) drawImage(page, pdfImg, { x: 0, y: 0, w: A5.w, h: A5.h }, 'cover');
      else drawImage(page, pdfImg, im, 'contain');
    }
    for (const line of lp.lines) {
      if (line.tocPage !== undefined) drawToc(page, fonts, line);
      else drawLine(page, fonts, line);
    }
    if (lp.showNumber) {
      const t = String(lp.n);
      const w = fonts.regular.widthOfTextAtSize(t, 13);
      page.drawText(t, { x: ((A5.w - w) / 2) * S, y: PT_H - (A5.numberY + 14) * S, size: 13 * S, font: fonts.regular, color: hex('#4a3d30') });
    }
  }

  onProgress?.('Saving the PDF…');
  const bytes = await doc.save();
  const name = fileName(book.title, 'pdf');
  if (save) download(bytes, name, 'application/pdf');
  return { pages: pages.length, bytes, name };
}

/** 300 dpi in print: since a page pixel is 96 dpi, about 3 times the box (at most 2480 px = the A5 height). */
const imageSide = (im: BookImage) => Math.min(2480, Math.round(Math.max(im.full ? A5.h : Math.max(im.w, im.h), 200) * 3.2));
