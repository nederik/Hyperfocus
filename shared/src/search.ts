/**
 * Finding and replacing words in the books (the server and the editor count by the same rules).
 * Chapter content is Tiptap JSON; the search runs paragraph by paragraph, regardless of formatting (bold/italic).
 * - Not case-sensitive (unless asked). Turkish i/ı/İ/I count as the same letter.
 * - "Whole word": matches with no letter or digit right before or after them (Ali is found in Ali'nin too).
 */

export interface FindOptions {
  wholeWord: boolean;
  matchCase: boolean;
}

interface TipNode {
  type?: string;
  text?: string;
  marks?: unknown[];
  content?: TipNode[];
  [k: string]: unknown;
}

/** Removes the case from a single character; the length does not change (positions stay the same as in the text). */
const fold = (c: string) => {
  if (c === 'I' || c === 'İ' || c === 'ı') return 'i';
  const l = c.toLowerCase();
  return l.length === 1 ? l : c;
};
const foldAll = (s: string) => {
  let out = '';
  for (let i = 0; i < s.length; i++) out += fold(s[i]!);
  return out;
};
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const isWordChar = (c: string | undefined) => !!c && WORD_CHAR.test(c);

/** Matches in the text: [start, end) indices. */
export function findInText(text: string, query: string, o: FindOptions): [number, number][] {
  const q = o.matchCase ? query : foldAll(query);
  if (!q.trim()) return [];
  const t = o.matchCase ? text : foldAll(text);
  const out: [number, number][] = [];
  let i = 0;
  while ((i = t.indexOf(q, i)) !== -1) {
    const e = i + q.length;
    if (!o.wholeWord || (!isWordChar(text[i - 1]) && !isWordChar(text[e]))) {
      out.push([i, e]);
      i = e;
    } else i += 1;
  }
  return out;
}

/** Text from a paragraph's inline nodes: text as it is, a line break as "\n", any other node as one placeholder. */
const inlineText = (nodes: TipNode[]) => nodes.map((n) => (n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? '\n' : '￼')).join('');

const paragraphs = (doc: unknown): TipNode[] => ((doc as TipNode)?.content ?? []).filter((n) => n.type === 'paragraph');

/** Number of matches in a chapter. */
export function countInDoc(doc: unknown, query: string, o: FindOptions): number {
  let n = 0;
  for (const p of paragraphs(doc)) n += findInText(inlineText(p.content ?? []), query, o).length;
  return n;
}

/**
 * Replaces every match in a chapter. The new text takes the formatting (bold/italic) of the match's first letter.
 * If nothing changes, the same document is returned.
 */
export function replaceInDoc(doc: unknown, query: string, replacement: string, o: FindOptions): { doc: unknown; count: number } {
  const root = doc as TipNode;
  if (!root?.content) return { doc, count: 0 };
  let count = 0;
  const content = root.content.map((p) => {
    if (p.type !== 'paragraph' || !p.content?.length) return p;
    const nodes = p.content;
    const hits = findInText(inlineText(nodes), query, o);
    if (!hits.length) return p;
    count += hits.length;
    // Letter by letter: each letter with its own formatting; nodes other than text (line breaks etc.) are single items
    type Cell = { ch: string; marks?: unknown[] } | { node: TipNode };
    const cells: Cell[] = [];
    for (const n of nodes) {
      if (n.type === 'text') for (const ch of n.text ?? '') for (let k = 0; k < ch.length; k++) cells.push({ ch: ch[k]!, marks: n.marks });
      else cells.push({ node: n });
    }
    for (let h = hits.length - 1; h >= 0; h--) {
      const [s, e] = hits[h]!;
      const first = cells[s];
      const marks = first && 'ch' in first ? first.marks : undefined;
      cells.splice(s, e - s, ...[...replacement].flatMap((ch) => [...ch].map((c) => ({ ch: c, marks }))));
    }
    // Consecutive letters with the same formatting become one text node again
    const out: TipNode[] = [];
    for (const c of cells) {
      if ('node' in c) {
        out.push(c.node);
        continue;
      }
      const last = out[out.length - 1];
      if (last && last.type === 'text' && JSON.stringify(last.marks ?? null) === JSON.stringify(c.marks ?? null)) last.text += c.ch;
      else out.push(c.marks?.length ? { type: 'text', text: c.ch, marks: c.marks } : { type: 'text', text: c.ch });
    }
    const next: TipNode = { ...p };
    if (out.length) next.content = out;
    else delete next.content;
    return next;
  });
  return count ? { doc: { ...root, content }, count } : { doc, count: 0 };
}
