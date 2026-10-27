/**
 * Hyperfocus page layout: lays the book out on pages line by line (with Pretext; no browser measuring).
 *
 * - Fixed font: EB Garamond. Paragraphs justified, first lines indented (no indent at the start of a chapter).
 * - Each chapter starts on a new page; the title sits a third of the way down, the text starts two lines below it.
 * - Front matter: cover, blank page, title page, blank page, contents. The first chapter starts on a right-hand (odd) page.
 * - Page numbers at the bottom centre; hidden on the cover, blank pages and front matter.
 * - Text flows around both sides of images (following the shape of a transparent PNG).
 *
 * Two editions: the A5 book (while writing and reading on desktop) and the phone edition (pages in the screen's
 * proportions, large text; images move next to their paragraphs from A5).
 */
import { clearCache } from '@chenglou/pretext';
import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  prepareRichInline,
  type PreparedRichInline,
  type RichInlineCursor,
  type RichInlineItem,
} from '@chenglou/pretext/rich-inline';
import type { BookImage } from '@hyperfocus/shared';
import type { Shape } from './shapes';

// ---- Page geometry (page units; A5 = 148 × 210 mm at 96 dpi) ----
export interface Geometry {
  w: number;
  h: number;
  top: number;
  bottom: number;
  /** Binding-side margin (on the left on odd pages). */
  inner: number;
  outer: number;
  body: number;
  lineH: number;
  indent: number;
  title: number;
  titleLineH: number;
  /** Space above the chapter title. */
  sink: number;
  /** Space between the chapter title and the first line of text. */
  titleGap: number;
  numberY: number;
  bookTitle: number;
  bookTitleLineH: number;
  author: number;
  authorLineH: number;
  /** Printed book layout: blank pages in the front matter, the first chapter on a right-hand page. Not on phones. */
  printed: boolean;
}

/** 1 pt = 4/3 px (96 dpi). Book text 11 pt, book title 48 pt, chapter title 30 pt (EB Garamond). */
const PT = 4 / 3;

export const A5: Geometry = {
  w: 559,
  h: 794,
  top: 70,
  bottom: 78,
  inner: 64,
  outer: 52,
  body: 11 * PT,
  lineH: 21, // line spacing in proportion to the text (11 pt × 1.44)
  indent: 24,
  // Chapter title 30 pt, at the top of the page; the book title (cover/title page) stays 48 pt
  title: 30 * PT,
  titleLineH: 46,
  sink: 50,
  titleGap: 84,
  numberY: 794 - 46,
  bookTitle: 48 * PT,
  bookTitleLineH: 72,
  author: 17,
  authorLineH: 26,
  printed: true,
};

/** Phone edition: width in the same units as A5 (559), height in the screen's proportions; text reads at ~16 px on a phone. */
export function phoneGeometry(aspect: number, w = 559): Geometry {
  // In portrait the page has the screen's proportions; in landscape (aspect < 1) a wide, short page, margins grow with the width.
  const h = Math.round(w * Math.max(0.4, Math.min(2.4, aspect)));
  const side = Math.round(36 + (w - 559) * 0.12);
  return {
    w,
    h,
    top: 54,
    bottom: 72,
    inner: side,
    outer: side,
    body: 25,
    lineH: 37,
    indent: 34,
    title: 38,
    titleLineH: 44,
    sink: Math.round(h * 0.06),
    titleGap: 124,
    numberY: h - 44,
    bookTitle: 58,
    bookTitleLineH: 68,
    author: 27,
    authorLineH: 38,
    printed: false,
  };
}

// A5 values (the editor uses these).
export const PAGE_W = A5.w;
export const PAGE_H = A5.h;
export const CONTENT_W = A5.w - A5.inner - A5.outer;
export const BODY_SIZE = A5.body;
export const LINE_H = A5.lineH;
export const PAGE_NUMBER_Y = A5.numberY;
export const FONT_FAMILY = '"EB Garamond", Georgia, serif';

const contentW = (g: Geometry) => g.w - g.inner - g.outer;
const contentBottom = (g: Geometry) => g.h - g.bottom;
const leftIn = (g: Geometry, n: number) => (n % 2 === 1 ? g.inner : g.outer);

const font = (size: number, bold?: boolean, italic?: boolean) => `${italic ? 'italic ' : ''}${bold ? '600' : '400'} ${size}px ${FONT_FAMILY}`;

/** Measuring is wrong until the font styles used in the layout have loaded. */
export async function loadBookFonts() {
  await Promise.all(
    [font(BODY_SIZE), font(BODY_SIZE, true), font(BODY_SIZE, false, true), font(BODY_SIZE, true, true), font(A5.title), font(30)].map((f) =>
      document.fonts.load(f, 'AaÉéÑñŁłŞş'),
    ),
  );
  clearCache();
  prepared.clear();
}

// ---- Input: a flat structure taken from the chapters' Tiptap content ----
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
}
export type Block = { type: 'para'; segments: Run[][] } | { type: 'empty' } | { type: 'pagebreak' } | { type: 'scene' };
export interface ChapterInput {
  id: number;
  title: string;
  blocks: Block[];
  images: BookImage[];
  /** Epigraph at the start of the chapter: under the title, narrow and centred, in italics; its author below. */
  epigraph?: { text: string; by: string } | null;
}

/** Layout input from a chapter's epigraph fields (none if both are empty). */
export const epigraphOf = (c: { epigraph?: string | null; epigraphBy?: string | null; epigraphQuotes?: boolean }) => {
  const t = c.epigraph?.trim();
  if (!t) return null;
  // If asked, the quotation goes in quotation marks: “ at the start of the first line, ” at the end of the last
  return { text: c.epigraphQuotes ? `“${t}”` : t, by: c.epigraphBy?.trim() ?? '' };
};
export type ShapeLookup = (url: string) => Shape | null;
export interface BookInput {
  title: string;
  author: string;
  coverUrl: string | null;
  chapters: ChapterInput[];
}

interface TipNode {
  type?: string;
  text?: string;
  marks?: { type: string }[];
  content?: TipNode[];
}

/** Tiptap JSON → paragraph blocks. A line break (Shift+Enter) splits the paragraph into line segments. */
export function blocksFromDoc(doc: unknown): Block[] {
  const out: Block[] = [];
  for (const node of ((doc as TipNode)?.content ?? []) as TipNode[]) {
    if (node.type === 'pageBreak') {
      out.push({ type: 'pagebreak' });
      continue;
    }
    if (node.type === 'sceneBreak') {
      out.push({ type: 'scene' });
      continue;
    }
    if (node.type !== 'paragraph') continue;
    const segments: Run[][] = [[]];
    for (const ch of node.content ?? []) {
      if (ch.type === 'hardBreak') segments.push([]);
      else if (ch.type === 'text' && ch.text) {
        const marks = ch.marks?.map((m) => m.type) ?? [];
        segments[segments.length - 1]!.push({ text: ch.text, bold: marks.includes('bold'), italic: marks.includes('italic') });
      }
    }
    const hasText = segments.some((s) => s.some((r) => r.text.trim()));
    out.push(hasText ? { type: 'para', segments } : { type: 'empty' });
  }
  return out;
}

// ---- Output ----
export interface Frag {
  text: string;
  gap: boolean; // a space before it
  bold: boolean;
  italic: boolean;
}
export interface PageLine {
  x: number;
  y: number; // top of the line box
  w: number;
  size: number;
  lineH: number;
  align: 'justify' | 'left' | 'center';
  frags: Frag[];
  /** Contents line: the page number on the right, dots in between. */
  tocPage?: number;
  tocChapter?: number;
}
/** 'back': back cover — not in the layout; the preview and the editor add it after the pages. */
export type PageKind = 'cover' | 'blank' | 'title' | 'toc' | 'chapter' | 'body' | 'back';
export interface LaidPage {
  n: number;
  kind: PageKind;
  showNumber: boolean;
  lines: PageLine[];
  chapterId?: number;
  /** On a chapter page: its place within the chapter (0 = the chapter's first page). */
  offset?: number;
  /** Images placed on this page. */
  images?: BookImage[];
  /** Scene-break dividers: centre point (page units) and scale (larger in the phone edition). */
  scenes?: { cx: number; cy: number; scale: number }[];
  /** Is it a right-hand (odd) page: binding margin on the left. */
  recto: boolean;
}
export interface LaidBook {
  geo: Geometry;
  pages: LaidPage[];
  /** Chapter id → the page number it starts on. */
  chapterStarts: Map<number, number>;
  /** `chapterId:blockIndex` → the page the block starts on (to follow the cursor on the pages). */
  blockPages: Map<string, number>;
}

// ---- Pretext preparation cache (the same paragraph is not measured again) ----
const prepared = new Map<string, { p: PreparedRichInline; items: RichInlineItem[]; runs: Run[] }>();
function prepareRuns(runs: Run[], size: number) {
  const clean = runs.filter((r) => r.text.length > 0);
  const key = size + '|' + JSON.stringify(clean);
  let hit = prepared.get(key);
  if (!hit) {
    const items = clean.map((r) => ({ text: r.text, font: font(size, r.bold, r.italic) }));
    hit = { p: prepareRichInline(items), items, runs: clean };
    if (prepared.size > 6000) prepared.clear();
    prepared.set(key, hit);
  }
  return hit;
}

/** Splits a run of text (paragraph or title) into lines of the given widths. */
function breakLines(runs: Run[], size: number, widthFor: (lineIndex: number) => number) {
  const { p, runs: clean } = prepareRuns(runs, size);
  const lines: { frags: Frag[]; width: number; maxW: number }[] = [];
  if (!clean.length) return lines;
  let cursor: RichInlineCursor | undefined;
  for (let i = 0; i < 10000; i++) {
    const maxW = widthFor(i);
    const range = layoutNextRichInlineLineRange(p, maxW, cursor);
    if (!range) break;
    const line = materializeRichInlineLineRange(p, range);
    lines.push({
      width: line.width,
      maxW,
      frags: line.fragments.map((f) => ({
        text: f.text,
        gap: f.gapBefore > 0,
        bold: !!clean[f.itemIndex]?.bold,
        italic: !!clean[f.itemIndex]?.italic,
      })),
    });
    cursor = range.end;
  }
  return lines;
}

/** Left edge of the text area on an A5 page, by page number (binding margin on the left on odd pages). */
export const pageLeft = (n: number) => leftIn(A5, n);

/** Where a newly added image starts: top right of the text area (under the title on a chapter's first page), half the text width. */
export function defaultImageBox(pageN: number, chapterStart: boolean, nw: number, nh: number) {
  let w = Math.round(CONTENT_W * 0.5);
  let h = Math.round((w * nh) / Math.max(1, nw));
  const top = chapterStart ? A5.top + A5.sink + A5.titleLineH + A5.titleGap : A5.top;
  const maxH = contentBottom(A5) - top;
  if (h > maxH) {
    h = maxH;
    w = Math.round((h * nw) / Math.max(1, nh));
  }
  return { x: pageLeft(pageN) + CONTENT_W - w, y: top, w, h };
}

/** Has the paragraph ended (asking for the next line with zero width is cheap)? */
const atEnd = (p: PreparedRichInline, cursor: RichInlineCursor | undefined) => layoutNextRichInlineLineRange(p, 0, cursor) === null;

// ---- Text flowing around images ----
const WRAP_PAD = 10; // space between an image and the text
const MIN_SLOT = 80; // no text in a gap narrower than this
const NARROW_SLOT = 200; // in a gap narrower than this lines are not justified (so word spacing does not open up)

/** The horizontal range an image covers within the height band [y0, y1) (by its shape or its box). */
function blockedInterval(im: BookImage, y0: number, y1: number, shape: ShapeLookup): [number, number] | null {
  if (im.full) return [-1e9, 1e9];
  if (y1 <= im.y || y0 >= im.y + im.h) return null;
  const s = im.wrap === 'shape' ? shape(im.url) : null;
  if (!s) return [im.x, im.x + im.w];
  const rows = s.length;
  const r0 = Math.max(0, Math.floor(((y0 - im.y) / im.h) * rows));
  const r1 = Math.min(rows - 1, Math.ceil(((y1 - im.y) / im.h) * rows));
  let l = Infinity;
  let r = -Infinity;
  for (let i = r0; i <= r1; i++) {
    const row = s[i];
    if (row) {
      l = Math.min(l, row[0]);
      r = Math.max(r, row[1]);
    }
  }
  return l === Infinity ? null : [im.x + l * im.w, im.x + r * im.w];
}

/** The gaps text can go into at the height of one line (left to right). */
function slotsAt(g: Geometry, page: LaidPage, y: number, shape: ShapeLookup): { x: number; w: number }[] {
  const left = leftIn(g, page.n);
  let free: [number, number][] = [[left, left + contentW(g)]];
  for (const im of page.images ?? []) {
    const iv = blockedInterval(im, y - WRAP_PAD, y + g.lineH + WRAP_PAD, shape);
    if (!iv) continue;
    const a = iv[0] - WRAP_PAD;
    const b = iv[1] + WRAP_PAD;
    free = free.flatMap(([s, e]): [number, number][] =>
      b <= s || a >= e ? [[s, e]] : ([[s, Math.min(e, a)], [Math.max(s, b), e]] as [number, number][]).filter(([s2, e2]) => e2 > s2),
    );
  }
  return free.filter(([s, e]) => e - s >= MIN_SLOT).map(([s, e]) => ({ x: s, w: e - s }));
}

/** Lays the book out on pages in the given geometry (A5 by default). */
export function layoutBook(book: BookInput, shape: ShapeLookup = () => null, g: Geometry = A5): LaidBook {
  const CW = contentW(g);
  const BOTTOM = contentBottom(g);
  const leftOf = (n: number) => leftIn(g, n);
  // Contents take 1+ pages depending on the number of chapters; lay out the chapters first, then fill in the contents.
  const TOC_PER_PAGE = Math.max(1, Math.floor((BOTTOM - g.top - 3 * g.titleLineH) / g.lineH));
  const tocPages = Math.max(1, Math.ceil(book.chapters.length / TOC_PER_PAGE));

  const pages: LaidPage[] = [];
  const newPage = (kind: PageKind, showNumber: boolean, chapterId?: number) => {
    const n = pages.length + 1;
    const page: LaidPage = { n, kind, showNumber, lines: [], chapterId, recto: n % 2 === 1 };
    pages.push(page);
    return page;
  };

  // Front matter
  newPage('cover', false);
  if (g.printed) newPage('blank', false);
  const titlePage = newPage('title', false);
  if (g.printed) newPage('blank', false);
  const tocStart = pages.length;
  for (let i = 0; i < tocPages; i++) newPage('toc', false);
  if (g.printed && pages.length % 2 === 1) newPage('blank', false); // the first chapter starts on a right-hand page

  // Title page
  {
    let y = g.top + Math.round(g.h * 0.21);
    for (const l of breakLines([{ text: book.title || 'Untitled' }], g.bookTitle, () => CW)) {
      titlePage.lines.push({ x: leftOf(titlePage.n) + (CW - l.width) / 2, y, w: l.width + 1, size: g.bookTitle, lineH: g.bookTitleLineH, align: 'left', frags: l.frags });
      y += g.bookTitleLineH;
    }
    y += Math.round(g.authorLineH);
    for (const l of breakLines([{ text: book.author, italic: true }], g.author, () => CW)) {
      titlePage.lines.push({ x: leftOf(titlePage.n) + (CW - l.width) / 2, y, w: l.width + 1, size: g.author, lineH: g.authorLineH, align: 'left', frags: l.frags });
      y += g.authorLineH;
    }
  }

  // Chapters
  const chapterStarts = new Map<number, number>();
  const blockPages = new Map<string, number>();
  for (const ch of book.chapters) {
    let offset = 0;
    const startPage = (kind: 'chapter' | 'body') => {
      const p = newPage(kind, true, ch.id); // a page number on the chapter's first page too
      p.offset = offset;
      p.images = ch.images.filter((im) => im.page === offset);
      if (p.images.some((im) => im.full)) p.showNumber = false;
      return p;
    };
    let page = startPage('chapter');
    chapterStarts.set(ch.id, page.n);
    let y = g.top + g.sink;
    const nextPage = () => {
      offset += 1;
      page = startPage('body');
      y = g.top;
    };
    // Title (centred)
    for (const l of breakLines([{ text: ch.title || 'Untitled chapter' }], g.title, () => CW - 40)) {
      page.lines.push({ x: leftOf(page.n) + (CW - l.width) / 2, y, w: l.width + 1, size: g.title, lineH: g.titleLineH, align: 'left', frags: l.frags });
      y += g.titleLineH;
    }
    // Epigraph: under the title, narrower than the text, lines centred and in italics; "— author" below
    if (ch.epigraph) {
      const size = g.body * 0.95;
      const lh = Math.round(g.lineH * 0.95);
      const EW = Math.round(CW * 0.72);
      y += Math.round(g.titleGap * 0.45);
      const put = (runs: Run[]) => {
        for (const l of breakLines(runs, size, () => EW)) {
          if (y + lh > BOTTOM) nextPage();
          page.lines.push({ x: leftOf(page.n) + (CW - l.width) / 2, y, w: l.width + 1, size, lineH: lh, align: 'left', frags: l.frags });
          y += lh;
        }
      };
      for (const para of ch.epigraph.text.split('\n')) {
        if (para.trim()) put([{ text: para.trim(), italic: true }]);
        else y += lh;
      }
      if (ch.epigraph.by) {
        y += Math.round(lh * 0.35);
        put([{ text: '— ' + ch.epigraph.by }]);
      }
      y += Math.round(g.titleGap * 0.6);
    } else y += g.titleGap;

    let indentNext = true; // the first paragraph of a chapter is indented too
    let started = false; // no text in the chapter yet: page breaks at the start are ignored (the text starts on the title page)
    const ensureLine = () => {
      if (y + g.lineH > BOTTOM) nextPage();
    };

    ch.blocks.forEach((block, bi) => {
      const key = `${ch.id}:${bi}`;
      blockPages.set(key, page.n);
      if (block.type === 'pagebreak' && !started) return;
      if (block.type === 'pagebreak') {
        nextPage();
        indentNext = false;
        blockPages.set(key, page.n);
        return;
      }
      if (block.type === 'scene') {
        // Scene break: a divider in the middle of two lines of space; if not even one line fits under it, it moves to the next page
        const band = g.lineH * 2;
        if (y + band + g.lineH > BOTTOM) nextPage();
        page.scenes = [...(page.scenes ?? []), { cx: leftOf(page.n) + CW / 2, cy: y + band / 2, scale: g.body / A5.body }];
        blockPages.set(key, page.n);
        y += band;
        indentNext = false; // the next paragraph is not indented
        return;
      }
      if (block.type === 'empty') {
        // Empty paragraph: one line of space (scene break); the following paragraph is not indented.
        if (y > g.top) y += g.lineH;
        indentNext = false;
        return;
      }
      let firstOfBlock = true;
      block.segments.forEach((seg, si) => {
        const { p, runs: clean } = prepareRuns(seg, g.body);
        if (!clean.length) {
          ensureLine();
          y += g.lineH;
          return;
        }
        let cursor: RichInlineCursor | undefined;
        let firstLine = true;
        let last: PageLine | null = null;
        // Line by line: at each line height the gaps left by the page's images (left, right) are filled in order.
        for (let guard = 0; guard < 20000 && !atEnd(p, cursor); guard++) {
          ensureLine();
          for (const slot of slotsAt(g, page, y, shape)) {
            if (atEnd(p, cursor)) break;
            const indent = firstLine && si === 0 && indentNext ? g.indent : 0;
            const maxW = slot.w - indent;
            const range = layoutNextRichInlineLineRange(p, maxW, cursor);
            if (!range) break;
            // A word that does not fit a narrow gap must not be split: skip that gap.
            if (range.end.graphemeIndex > 0 && slot.w < CW - 1) continue;
            const line = materializeRichInlineLineRange(p, range);
            last = {
              x: slot.x + indent,
              y,
              w: maxW,
              size: g.body,
              lineH: g.lineH,
              align: slot.w < (NARROW_SLOT * g.body) / A5.body ? 'left' : 'justify',
              frags: line.fragments.map((f) => ({
                text: f.text,
                gap: f.gapBefore > 0,
                bold: !!clean[f.itemIndex]?.bold,
                italic: !!clean[f.itemIndex]?.italic,
              })),
            };
            page.lines.push(last);
            started = true;
            if (firstOfBlock) {
              blockPages.set(key, page.n);
              firstOfBlock = false;
            }
            cursor = range.end;
            firstLine = false;
          }
          y += g.lineH;
        }
        if (last) last.align = 'left'; // the last line of a paragraph is not justified
      });
      indentNext = true;
    });

    // If an image was put on a page after the chapter's text ends, those pages must exist too.
    const lastImagePage = ch.images.reduce((m, im) => Math.max(m, im.page), 0);
    while (offset < lastImagePage) nextPage();
  }

  // Contents
  {
    let tp = tocStart;
    let page = pages[tp]!;
    let y = g.top + g.titleLineH;
    for (const l of breakLines([{ text: 'Chapters' }], g.title, () => CW)) {
      page.lines.push({ x: leftOf(page.n) + (CW - l.width) / 2, y, w: l.width + 1, size: g.title, lineH: g.titleLineH, align: 'left', frags: l.frags });
      y += g.titleLineH;
    }
    y += g.titleLineH;
    book.chapters.forEach((ch) => {
      if (y + g.lineH > BOTTOM) {
        tp += 1;
        page = pages[tp]!;
        y = g.top;
      }
      const l = breakLines([{ text: ch.title || 'Untitled chapter' }], g.body, () => CW - 4 * g.body)[0];
      page.lines.push({
        x: leftOf(page.n),
        y,
        w: CW,
        size: g.body,
        lineH: g.lineH,
        align: 'left',
        frags: l?.frags ?? [],
        tocPage: chapterStarts.get(ch.id),
        tocChapter: ch.id,
      });
      y += g.lineH;
    });
  }

  return { geo: g, pages, chapterStarts, blockPages };
}

/**
 * Phone edition: with large text and pages in the screen's proportions, the pages are different.
 * Each image moves with the paragraph at the start of its A5 page (its horizontal place and size stay the same).
 */
export function layoutPhoneBook(book: BookInput, shape: ShapeLookup, g: Geometry): LaidBook {
  const hasImages = book.chapters.some((c) => c.images.length);
  if (!hasImages) return layoutBook(book, shape, g);
  const a5 = layoutBook(book, shape, A5);
  const bare = layoutBook({ ...book, chapters: book.chapters.map((c) => ({ ...c, images: [] })) }, shape, g);
  const chapters = book.chapters.map((c) => {
    if (!c.images.length) return c;
    const a5Start = a5.chapterStarts.get(c.id)!;
    const phoneStart = bare.chapterStarts.get(c.id)!;
    const images = c.images.map((im) => {
      // The first paragraph starting on that page in A5; otherwise the paragraph running over from the page before.
      const target = a5Start + im.page;
      let anchor = c.blocks.findIndex((_, bi) => a5.blockPages.get(`${c.id}:${bi}`) === target);
      if (anchor < 0)
        c.blocks.forEach((_, bi) => {
          const p = a5.blockPages.get(`${c.id}:${bi}`);
          if (p !== undefined && p < target) anchor = bi;
        });
      const phonePage = anchor >= 0 ? (bare.blockPages.get(`${c.id}:${anchor}`) ?? phoneStart) : phoneStart;
      const page = Math.max(0, phonePage - phoneStart);
      const y = Math.max(0, Math.min(g.h - im.h, Math.round((im.y / A5.h) * g.h)));
      return { ...im, page, y };
    });
    return { ...c, images };
  });
  return layoutBook({ ...book, chapters }, shape, g);
}
