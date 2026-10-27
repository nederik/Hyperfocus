import type { EditorView } from '@codemirror/view';

/**
 * Keeping your place when switching reading ↔ editing: the paragraph at the top of the screen is found in the Markdown
 * source and the editor is scrolled so that paragraph stays at the same height (and the other way round).
 */

/** For comparing shown text with the source: Markdown marks and extra spaces are dropped. */
const MARK = /[*_=#>|[\]!`~\\]/;
const norm = (t: string) =>
  t
    .replace(/[*_=#>|[\]!`~\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** The simplified source and where each of its characters sits in the source. */
interface Plain {
  plain: string;
  map: number[];
}
function plainOf(src: string): Plain {
  let plain = '';
  const map: number[] = [];
  let space = true;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (MARK.test(ch)) continue;
    if (/\s/.test(ch)) {
      if (!space) {
        plain += ' ';
        map.push(i);
        space = true;
      }
      continue;
    }
    plain += ch.toLowerCase();
    map.push(i);
    space = false;
  }
  return { plain, map };
}

/** Where shown text starts in the source; searched after `from` (null if not found). */
function findIn(p: Plain, shown: string, from: number): number | null {
  let start = p.map.findIndex((i) => i >= from);
  if (start < 0) return null;
  const n = norm(shown);
  for (const len of [60, 32, 16, 8]) {
    const probe = n.slice(0, len);
    if (!probe) return null;
    const at = p.plain.indexOf(probe, start);
    if (at >= 0) return p.map[at]!;
    if (probe.length < len) break;
  }
  return null;
}

/** The blocks in the reading view (paragraph, heading, list item, table row…). */
export const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, tr, .vt-props';

/** Blocks with text and where each sits in the source (matched in order, so repeated text does not get mixed up). */
function mapBlocks(container: HTMLElement, src: string): { el: HTMLElement; offset: number }[] {
  const p = plainOf(src);
  const out: { el: HTMLElement; offset: number }[] = [];
  let from = 0;
  for (const el of container.querySelectorAll<HTMLElement>(BLOCKS)) {
    const text = el.textContent ?? '';
    if (!text.trim()) continue;
    const o = findIn(p, text, from);
    if (o === null) continue;
    out.push({ el, offset: o });
    from = o + 1;
  }
  return out;
}

/** While reading: the source position of the first block visible at the top, and its distance from the edge. */
export function readingAnchor(container: HTMLElement, src: string, clicked?: HTMLElement | null): { offset: number; dy: number } | null {
  const top = container.getBoundingClientRect().top;
  const blocks = mapBlocks(container, src);
  const hit = (clicked && blocks.find((b) => b.el === clicked)) || blocks.find((b) => b.el.getBoundingClientRect().bottom > top + 2);
  return hit ? { offset: hit.offset, dy: hit.el.getBoundingClientRect().top - top } : null;
}

/** Finds the block starting at `offset` in the reading view (the last block starting up to there). */
export function blockForOffset(container: HTMLElement, src: string, offset: number): HTMLElement | null {
  // Markdown marks at the start of a line (#, -, 1., >, |) are not in the shown text: compare with where the text starts
  const lead = /^[ \t]*(?:(?:#{1,6}|[-*+]|\d+[.)]|>|\|)[ \t]*)*/.exec(src.slice(offset, offset + 80));
  const at = offset + (lead?.[0].length ?? 0);
  let best: HTMLElement | null = null;
  for (const b of mapBlocks(container, src)) {
    if (b.offset > at) break;
    best = b.el;
  }
  return best;
}

/** The start of the block a line belongs to (paragraph, heading, list item, table row). */
const STARTS_BLOCK = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|```|---)/;
function blockStart(text: string, offset: number): number {
  let start = text.lastIndexOf('\n', offset - 1) + 1;
  while (start > 0) {
    const line = text.slice(start, text.indexOf('\n', start) < 0 ? text.length : text.indexOf('\n', start));
    if (STARTS_BLOCK.test(line)) break;
    const prevStart = text.lastIndexOf('\n', start - 2) + 1;
    const prev = text.slice(prevStart, start - 1);
    if (!prev.trim()) break; // an empty line: the paragraph starts here
    start = prevStart;
  }
  return start;
}

/** In the editor: the start of the first line visible at the top (a caret put here does not scroll the screen on typing). */
export function firstVisiblePos(view: EditorView): number {
  const top = view.scrollDOM.getBoundingClientRect().top;
  const left = view.contentDOM.getBoundingClientRect().left;
  return view.posAtCoords({ x: left + 1, y: top + 4 }) ?? view.lineBlockAtHeight(top - view.documentTop + 1).from;
}

/** While editing: the start of the block at the top (its source position) and its distance from the edge (negative if above). */
export function editingAnchor(view: EditorView): { offset: number; dy: number } {
  const text = view.state.doc.toString();
  let at = firstVisiblePos(view);
  // Skip empty lines at the top to the next text
  while (at < text.length && /s/.test(text[at]!)) at++;
  const offset = blockStart(text, Math.min(at, text.length));
  const top = view.scrollDOM.getBoundingClientRect().top;
  return { offset, dy: view.lineBlockAt(offset).top + view.documentTop - top };
}
