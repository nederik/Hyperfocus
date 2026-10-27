/**
 * Colored text (ink). Stored in the note in a form Obsidian shows too: <span style="color:#c0392b">text</span>.
 * In the editor the tags are hidden and only the color shows. Everything typed with the chosen ink is in that color;
 * no edit ever leaves a tag half-done (deleting, pasting, line breaks).
 */
import { Annotation, EditorSelection, EditorState, Prec, RangeSetBuilder, Transaction, type Extension, type Text, type TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { useSyncExternalStore } from 'react';

export const INKS: { name: string; color: string | null }[] = [
  { name: 'Ink', color: null },
  { name: 'Red', color: '#c0392b' },
  { name: 'Orange', color: '#d35400' },
  { name: 'Gold', color: '#b7860b' },
  { name: 'Green', color: '#2e7d32' },
  { name: 'Blue', color: '#1f5fbf' },
  { name: 'Purple', color: '#7b3fa0' },
  { name: 'Gray', color: '#7a7268' },
];
export type Ink = string | null;

// ---- The chosen ink (remembered in this browser) ----
const KEY = 'hyperfocus-ink';
let ink: Ink = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v && INKS.some((i) => i.color === v) ? v : null;
  } catch {
    return null;
  }
})();
const listeners = new Set<() => void>();
export const getInk = () => ink;
export function setInk(c: Ink) {
  ink = c;
  try {
    if (c) localStorage.setItem(KEY, c);
    else localStorage.removeItem(KEY);
  } catch {
    /* this session only */
  }
  listeners.forEach((l) => l());
}
export const useInk = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getInk,
    getInk,
  );

/** The note editor open now (so the ink button in the sidebar can color the selected text). */
let active: EditorView | null = null;
export const setActiveEditor = (v: EditorView | null) => {
  active = v;
};
export const activeEditor = () => (active && active.dom.isConnected ? active : null);

// ---- Etiketler ----
export interface ColorSpan {
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
  color: string;
}
const OPEN = /<span\s+style\s*=\s*"\s*color\s*:\s*([^";<>]+?)\s*;?\s*"\s*>/gi;
const CLOSE = '</span>';
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%]+\))$/i;
const norm = (c: string | null) => (c ? c.trim().toLowerCase() : null);

export function parseSpans(text: string): ColorSpan[] {
  const out: ColorSpan[] = [];
  OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPEN.exec(text))) {
    const openFrom = m.index;
    const openTo = openFrom + m[0].length;
    const close = text.indexOf(CLOSE, openTo);
    if (close < 0) break;
    const inner = text.indexOf('<span', openTo);
    // Nested tags: skip the outer one (the inner one is found on its own)
    if (inner >= 0 && inner < close) {
      OPEN.lastIndex = openTo;
      continue;
    }
    out.push({ openFrom, openTo, closeFrom: close, closeTo: close + CLOSE.length, color: m[1]!.trim() });
    OPEN.lastIndex = close + CLOSE.length;
  }
  return out;
}

const cache = new WeakMap<Text, ColorSpan[]>();
export function colorSpans(doc: Text): ColorSpan[] {
  let s = cache.get(doc);
  if (!s) {
    s = parseSpans(doc.toString());
    cache.set(doc, s);
  }
  return s;
}

/** Widens [a, b] to fully include the colored parts it touches or cuts. */
function region(spans: ColorSpan[], a: number, b: number): [number, number] {
  let from = a;
  let to = b;
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of spans) {
      if (s.openFrom <= to && s.closeTo >= from && (s.openFrom < from || s.closeTo > to)) {
        from = Math.min(from, s.openFrom);
        to = Math.max(to, s.closeTo);
        changed = true;
      }
    }
  }
  return [from, to];
}

/** The region's text without tags, each character's color, and a map from document position to text position. */
function contentOf(full: string, spans: ColorSpan[], from: number, to: number) {
  let text = '';
  const colors: (string | null)[] = [];
  const pieces: { docFrom: number; docTo: number; at: number }[] = [];
  const push = (a: number, b: number, color: string | null) => {
    if (b <= a) return;
    pieces.push({ docFrom: a, docTo: b, at: text.length });
    text += full.slice(a, b);
    for (let i = a; i < b; i++) colors.push(color);
  };
  let p = from;
  for (const s of spans) {
    if (s.openFrom < from || s.closeTo > to) continue;
    push(p, s.openFrom, null);
    push(s.openTo, s.closeFrom, s.color);
    p = s.closeTo;
  }
  push(p, to, null);
  const toContent = (pos: number) => {
    for (const pc of pieces) {
      if (pos < pc.docFrom) return pc.at;
      if (pos <= pc.docTo) return pc.at + (pos - pc.docFrom);
    }
    return text.length;
  };
  return { text, colors, toContent };
}

/** Text + colors → tagged text. Colored parts close and reopen at line breaks (paragraphs stay intact). */
function serialize(text: string, colors: (string | null)[]) {
  let out = '';
  const before: number[] = new Array(text.length + 1).fill(0);
  const after: number[] = new Array(text.length + 1).fill(0);
  let open: string | null = null;
  for (let k = 0; k < text.length; k++) {
    const c = colors[k] ?? null;
    const ch = text[k]!;
    const want = c && ch !== '\n' ? c : null;
    if (open && norm(open) !== norm(want)) {
      out += CLOSE;
      open = null;
    }
    if (want && !open) {
      out += `<span style="color:${want}">`;
      open = want;
    }
    before[k] = out.length;
    out += ch;
    after[k + 1] = out.length;
  }
  if (open) out += CLOSE;
  before[text.length] = out.length;
  return { out, before, after };
}

const inkEdit = Annotation.define<boolean>();

type Op = { kind: 'replace'; insert: string; color: Ink } | { kind: 'recolor'; color: Ink };

/** Writes or colors the range [a, b]; the result is always well tagged. */
function edit(state: EditorState, a: number, b: number, op: Op): TransactionSpec {
  const spans = colorSpans(state.doc);
  const full = state.doc.toString();
  const [rf, rt] = region(spans, a, b);
  const c = contentOf(full, spans, rf, rt);
  const f = c.toContent(a);
  const g = Math.max(f, c.toContent(b));
  let text = c.text;
  let colors = c.colors;
  let anchor: number;
  let head: number;
  const safe = op.color && SAFE_COLOR.test(op.color) ? op.color : null;
  if (op.kind === 'replace') {
    text = text.slice(0, f) + op.insert + text.slice(g);
    colors = [...colors.slice(0, f), ...new Array<string | null>(op.insert.length).fill(safe), ...colors.slice(g)];
    anchor = head = f + op.insert.length;
  } else {
    colors = colors.map((x, i) => (i >= f && i < g ? safe : x));
    anchor = f;
    head = g;
  }
  const s = serialize(text, colors);
  const startOut = (k: number) => (k < text.length ? s.before[k]! : s.out.length);
  const endOut = (k: number) => (k > 0 ? s.after[k]! : 0);
  const aOut = op.kind === 'replace' ? endOut(anchor) : startOut(anchor);
  const hOut = endOut(head) || (op.kind === 'recolor' ? startOut(head) : 0);
  // The smallest change (for undo and the caret)
  const old = full.slice(rf, rt);
  const nu = s.out;
  let pre = 0;
  while (pre < old.length && pre < nu.length && old[pre] === nu[pre]) pre++;
  let suf = 0;
  while (suf < old.length - pre && suf < nu.length - pre && old[old.length - 1 - suf] === nu[nu.length - 1 - suf]) suf++;
  return {
    changes: { from: rf + pre, to: rt - suf, insert: nu.slice(pre, nu.length - suf) },
    selection: EditorSelection.range(rf + aOut, rf + hOut),
    annotations: inkEdit.of(true),
    scrollIntoView: true,
  };
}

/** Colors the selected text (Ink: removes the color). Without a selection only the ink changes. */
export function applyInk(view: EditorView | null, color: Ink) {
  setInk(color);
  if (!view) return;
  const r = view.state.selection.main;
  if (!r.empty) view.dispatch({ ...edit(view.state, r.from, r.to, { kind: 'recolor', color }), userEvent: 'input.color' });
  view.focus();
}

const tagRanges = (spans: ColorSpan[]) => spans.flatMap((s) => [[s.openFrom, s.openTo] as const, [s.closeFrom, s.closeTo] as const]);

/** While typing: the chosen ink's color. */
const typing = EditorView.inputHandler.of((view, from, to, text) => {
  const state = view.state;
  if (state.selection.ranges.length > 1) return false;
  const color = getInk();
  const spans = colorSpans(state.doc);
  const touching = spans.filter((s) => s.openFrom <= to && s.closeTo >= from);
  if (!color && !touching.length) return false;
  if (color && touching.some((s) => norm(s.color) === norm(color) && s.openTo <= from && to <= s.closeFrom)) return false;
  view.dispatch({ ...edit(state, from, to, { kind: 'replace', insert: text, color }), userEvent: 'input.type' });
  return true;
});

/** Enter inside colored text: the tag closes at the line break. */
const enter = Prec.high(
  keymap.of([
    {
      key: 'Enter',
      run: (view) => {
        const state = view.state;
        if (state.selection.ranges.length > 1) return false;
        const { from, to } = state.selection.main;
        const spans = colorSpans(state.doc);
        if (!spans.some((s) => s.openFrom <= to && s.closeTo >= from)) return false;
        view.dispatch({ ...edit(state, from, to, { kind: 'replace', insert: '\n', color: getInk() }), userEvent: 'input' });
        return true;
      },
    },
  ]),
);

/** Deleting, cutting and pasting never leave a tag half-done. */
const guard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(inkEdit) || !(tr.isUserEvent('delete') || tr.isUserEvent('input') || tr.isUserEvent('move'))) return tr;
  const spans = colorSpans(tr.startState.doc);
  if (!spans.length) return tr;
  const tags = tagRanges(spans);
  const changes: { fromA: number; toA: number; text: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fb, _tb, ins) => changes.push({ fromA, toA, text: ins.toString() }));
  // A change that cuts a tag or deletes all of a colored text (no empty tag is left)
  const hit = changes.filter(
    (c) => tags.some(([a, b]) => c.fromA < b && c.toA > a) || (!c.text && spans.some((s) => c.fromA <= s.openTo && c.toA >= s.closeFrom)),
  );
  if (!hit.length || changes.length > 1) return tr;
  const ch = hit[0]!;
  let { fromA, toA } = ch;
  const state = tr.startState;
  // If only a hidden tag would be deleted: delete the real character next to it
  const onlyTags = !ch.text && (() => {
    const [rf, rt] = region(spans, fromA, toA);
    const c = contentOf(state.doc.toString(), spans, rf, rt);
    return c.toContent(fromA) === c.toContent(toA);
  })();
  if (onlyTags) {
    if (tr.isUserEvent('delete.backward')) {
      let p = fromA;
      for (let t = tags.find(([, b]) => b === p); t; t = tags.find(([, b]) => b === p)) p = t[0];
      if (p <= 0) return [];
      fromA = p - 1;
    } else if (tr.isUserEvent('delete.forward')) {
      let p = toA;
      for (let t = tags.find(([a]) => a === p); t; t = tags.find(([a]) => a === p)) p = t[1];
      if (p >= state.doc.length) return [];
      toA = p + 1;
    } else return [];
  }
  return { ...edit(state, fromA, toA, { kind: 'replace', insert: ch.text, color: ch.text ? getInk() : null }), userEvent: tr.annotation(Transaction.userEvent) };
});

/** Hides the tags and colors the text. */
class InkView {
  decorations: DecorationSet;
  tags: DecorationSet;
  constructor(view: EditorView) {
    [this.decorations, this.tags] = this.build(view);
  }
  update(u: ViewUpdate) {
    if (u.docChanged) [this.decorations, this.tags] = this.build(u.view);
  }
  build(view: EditorView): [DecorationSet, DecorationSet] {
    const all = new RangeSetBuilder<Decoration>();
    const tags = new RangeSetBuilder<Decoration>();
    const hide = Decoration.replace({});
    for (const s of colorSpans(view.state.doc)) {
      const color = SAFE_COLOR.test(s.color) ? s.color : null;
      all.add(s.openFrom, s.openTo, hide);
      tags.add(s.openFrom, s.openTo, hide);
      if (color && s.closeFrom > s.openTo) all.add(s.openTo, s.closeFrom, Decoration.mark({ attributes: { style: `color: ${color}` }, class: 'cm-ink' }));
      all.add(s.closeFrom, s.closeTo, hide);
      tags.add(s.closeFrom, s.closeTo, hide);
    }
    return [all.finish(), tags.finish()];
  }
}
const inkView = ViewPlugin.fromClass(InkView, {
  decorations: (v) => v.decorations,
  provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.tags ?? Decoration.none),
});

export function inkExtension(): Extension {
  return [typing, enter, guard, inkView];
}
