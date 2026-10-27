import type { BookChapter } from '@hyperfocus/shared';
import type { LaidBook } from './layout';

export interface MusicSpan {
  chapterId: number;
  url: string;
  /** First and last page (page numbers of the laid-out book, both included). */
  from: number;
  to: number;
}

/** The chapter's last page with text (in the A5 or phone layout). */
export function chapterLastPage(laid: LaidBook, chapterId: number) {
  let last = laid.chapterStarts.get(chapterId) ?? 0;
  for (const p of laid.pages) if (p.chapterId === chapterId && p.n > last) last = p.n;
  return last;
}

/** The A5 page range of the chapter music (empty ends mean the start/end of the chapter). */
export function a5Span(ch: Pick<BookChapter, 'id' | 'musicFrom' | 'musicTo'>, a5: LaidBook): { from: number; to: number } | null {
  const start = a5.chapterStarts.get(ch.id);
  if (!start) return null;
  const total = a5.pages.length;
  const clamp = (n: number) => Math.max(1, Math.min(total, n));
  const from = clamp(start + (ch.musicFrom ?? 0));
  const to = clamp(ch.musicTo == null ? chapterLastPage(a5, ch.id) : start + ch.musicTo);
  return { from, to: Math.max(from, to) };
}

type Blocks = { id: number; blockCount: number }[];

/**
 * Pages differ in the phone edition: the paragraph at the start of the A5 page is found,
 * and the page that paragraph falls on in the phone layout is used.
 */
function phonePageOf(a5Page: number, chapters: Blocks, a5: LaidBook, phone: LaidBook): number | null {
  let carried: string | null = null;
  for (const c of chapters) {
    for (let bi = 0; bi < c.blockCount; bi++) {
      const key = `${c.id}:${bi}`;
      const p = a5.blockPages.get(key);
      if (p === undefined) continue;
      if (p === a5Page) return phone.blockPages.get(key) ?? null;
      if (p < a5Page) carried = key;
    }
  }
  // If no new paragraph starts on that page, the paragraph running over from the previous page
  if (carried) return phone.blockPages.get(carried) ?? null;
  return null;
}

/** The page range of each chapter's music in the reader's layout. */
export function musicSpans(
  chapters: BookChapter[],
  laid: LaidBook,
  a5: LaidBook,
  blocks: Blocks,
): MusicSpan[] {
  const out: MusicSpan[] = [];
  for (const ch of chapters) {
    if (!ch.musicUrl) continue;
    const span = a5Span(ch, a5);
    if (!span) continue;
    if (laid === a5) {
      out.push({ chapterId: ch.id, url: ch.musicUrl, ...span });
      continue;
    }
    // Phone: the start is the phone page of the paragraph on the A5 start page;
    // the end is the page before the first paragraph after the range.
    const start = laid.chapterStarts.get(ch.id) ?? 1;
    const from = ch.musicFrom == null ? start : (phonePageOf(span.from, blocks, a5, laid) ?? start);
    let to: number;
    if (ch.musicTo == null) to = chapterLastPage(laid, ch.id);
    else {
      const next = span.to < a5.pages.length ? phonePageOf(span.to + 1, blocks, a5, laid) : null;
      to = next == null ? laid.pages.length : next - 1;
    }
    out.push({ chapterId: ch.id, url: ch.musicUrl, from, to: Math.max(from, to) });
  }
  return out;
}

/** Of the visible pages (two in a spread), whose music should play: the right-hand page comes first. */
export function activeMusic(spans: MusicSpan[], visible: number[]): string | null {
  for (const n of [...visible].reverse()) {
    const s = spans.find((x) => n >= x.from && n <= x.to);
    if (s) return s.url;
  }
  return null;
}
