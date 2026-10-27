/// <reference lib="webworker" />
/**
 * The Hyperfocus dictionary (English, offline): WordNet 3.1 + hand-written example sentences.
 * The data is loaded once from the site's own file; after that every lookup runs in memory, instantly.
 */

type Synset = [pos: string, words: string, def: string, examples: string, ptrs: string];
interface Data {
  s: Synset[];
  i: Record<string, number[]>;
  x: Record<string, string>;
}

export type Pos = 'n' | 'v' | 'a' | 'r';
export interface Sense {
  def: string;
  examples: string[];
  /** Synonyms in this sense (without the looked-up word). */
  synonyms: string[];
}
export interface Similar {
  word: string;
  /** 0–100: how close in meaning. */
  score: number;
  kind: 'synonym' | 'similar' | 'broader' | 'narrower' | 'related';
  /** Short definition of the sense it comes from (to see the difference). */
  def: string;
}
export type LookupResult =
  | { found: true; query: string; word: string; from: string | null; groups: { pos: Pos; senses: Sense[] }[]; similar: Similar[]; opposites: string[] }
  | { found: false; query: string; suggestions: string[] };

export type DictIn = { id: number; word: string };
export type DictOut = { type: 'ready' } | { type: 'failed'; message: string } | { type: 'result'; id: number; result: LookupResult };

let data: Data | null = null;
const post = (m: DictOut) => (self as unknown as Worker).postMessage(m);

const ptrCache = new Map<number, Record<string, number[]>>();
function ptrs(idx: number) {
  let p = ptrCache.get(idx);
  if (!p) {
    p = {};
    const raw = data!.s[idx]![4];
    if (raw)
      for (const part of raw.split(';')) p[part[0]!] = part.slice(1).split(',').map(Number);
    ptrCache.set(idx, p);
  }
  return p;
}
const wordsOf = (idx: number) => data!.s[idx]![1].split('|');

/** From an inflected form to the base (WordNet "morphy"): the list of irregular forms + suffix rules. */
const RULES: [string, string][] = [
  ['ies', 'y'], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'],
  ['es', 'e'], ['es', ''], ['s', ''], ['ied', 'y'], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', ''],
  ['ier', 'y'], ['iest', 'y'], ['er', 'e'], ['er', ''], ['est', 'e'], ['est', ''],
];
function baseForms(w: string): string[] {
  const out: string[] = [];
  const add = (b: string) => b && !out.includes(b) && data!.i[b] && out.push(b);
  add(w);
  for (const b of data!.x[w]?.split('|') ?? []) add(b);
  for (const [suf, rep] of RULES) if (w.endsWith(suf) && w.length > suf.length + 1) add(w.slice(0, -suf.length) + rep);
  // Double consonant: stopped → stop, running → run
  const m = w.match(/^(.*?)([b-df-hj-np-tv-z])\2(ed|ing|er|est)$/);
  if (m) add(m[1]! + m[2]!);
  return out;
}

/**
 * Does the example sentence contain the looked-up word (in any form)?
 * A sense is shared by several words (graceful = elegant); a sentence written with another synonym is not shown.
 */
function hasWord(sentence: string, base: string): boolean {
  const toks = sentence.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const parts = base.toLowerCase().split(/[ _-]+/).filter(Boolean);
  return parts.every((p) => toks.some((t) => t === p || baseForms(t).includes(p)));
}

/** When nothing is found: words starting with the same letters and words one letter away. */
function suggestions(w: string): string[] {
  const keys = Object.keys(data!.i);
  const out = new Set<string>();
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const edits: string[] = [];
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i);
    const b = w.slice(i);
    if (b) edits.push(a + b.slice(1));
    if (b.length > 1) edits.push(a + b[1] + b[0] + b.slice(2));
    for (const c of letters) {
      if (b) edits.push(a + c + b.slice(1));
      edits.push(a + c + b);
    }
  }
  for (const e of edits) if (data!.i[e]) out.add(e);
  if (out.size < 8 && w.length >= 3)
    for (const k of keys) {
      if (k.startsWith(w) && k !== w) out.add(k);
      if (out.size >= 12) break;
    }
  return [...out].slice(0, 10);
}

function lookup(q: string): LookupResult {
  const query = q.trim().replace(/\s+/g, ' ');
  const w = query.toLowerCase();
  const base = baseForms(w)[0];
  if (!base) return { found: false, query, suggestions: suggestions(w) };
  const ids = data!.i[base]!;
  const lower = (s: string) => s.toLowerCase();

  // Senses: grouped by part of speech (the most common first)
  const groups: { pos: Pos; senses: Sense[] }[] = [];
  // Spelling shown: the lowercase form if there is one (tell, not Tell); otherwise the spelling of the first sense (Paris)
  let display = '';
  for (const idx of ids) {
    const [pos, words, def, ex] = data!.s[idx]!;
    const list = words.split('|');
    const own = list.find((x) => lower(x) === base);
    if (own && (!display || own === base)) display = own;
    let g = groups.find((x) => x.pos === pos);
    if (!g) groups.push((g = { pos: pos as Pos, senses: [] }));
    const examples = ex ? ex.split('|').filter((e) => hasWord(e, base)).slice(0, 2) : [];
    g.senses.push({ def, examples, synonyms: list.filter((x) => lower(x) !== base) });
  }

  // Similar words: synonym → similar → broader → narrower → sibling (others under the same broader idea).
  // The score falls with the sense's frequency rank; a word reached by several paths counts as a little closer.
  const found = new Map<string, Similar & { hits: number }>();
  const opposites = new Set<string>();
  // British/American spellings count as one (verbalise = verbalize)
  const norm = (w: string) => lower(w).replace(/is(e|es|ed|ing|ation|ations)\b/g, 'iz$1').replace(/([a-z]{2,})our\b/g, '$1or');
  const add = (word: string, score: number, kind: Similar['kind'], def: string) => {
    const key = norm(word);
    if (key === norm(base)) return;
    const cur = found.get(key);
    if (!cur) found.set(key, { word, score, kind, def, hits: 1 });
    else {
      cur.hits++;
      if (score > cur.score) Object.assign(cur, { word, score, kind, def });
    }
  };
  ids.slice(0, 10).forEach((idx, k) => {
    const r = Math.pow(0.88, k);
    const def = data!.s[idx]![2];
    const p = ptrs(idx);
    for (const x of wordsOf(idx)) add(x, 96 * r, 'synonym', def);
    // For adjectives/adverbs the "similar" link is very close; for nouns/verbs (related sense group) it is looser
    const pos = data!.s[idx]![0];
    const adj = pos === 'a' || pos === 'r';
    for (const t of p.s ?? []) {
      for (const x of wordsOf(t)) add(x, (adj ? 84 : 60) * r, 'similar', data!.s[t]![2]);
      if (adj) for (const t2 of (ptrs(t).s ?? []).slice(0, 20)) if (t2 !== idx) for (const x of wordsOf(t2)) add(x, 70 * r, 'similar', data!.s[t2]![2]);
      for (const a of ptrs(t).a ?? []) for (const x of wordsOf(a)) opposites.add(x);
    }
    for (const h of p.h ?? []) {
      for (const x of wordsOf(h)) add(x, 70 * r, 'broader', data!.s[h]![2]);
      for (const c of (ptrs(h).o ?? []).slice(0, 30)) if (c !== idx) for (const x of wordsOf(c)) add(x, 56 * r, 'related', data!.s[c]![2]);
    }
    for (const o of (p.o ?? []).slice(0, 30)) for (const x of wordsOf(o)) add(x, 63 * r, 'narrower', data!.s[o]![2]);
    for (const a of p.a ?? []) for (const x of wordsOf(a)) opposites.add(x);
  });
  const similar = [...found.values()]
    .map(({ hits, ...s }) => ({ ...s, score: Math.min(99, Math.round(s.score + Math.min(6, (hits - 1) * 2))) }))
    .sort((a, b) => b.score - a.score || a.word.length - b.word.length)
    .slice(0, 40);

  if (!display) display = base;
  return {
    found: true,
    query,
    word: display,
    from: base !== w ? query : null,
    groups,
    similar,
    opposites: [...opposites].filter((x) => lower(x) !== base).slice(0, 12),
  };
}

const ready = fetch('/wordnet/wordnet.json')
  .then((r) => {
    if (!r.ok) throw new Error('Could not load the dictionary.');
    return r.json() as Promise<Data>;
  })
  .then(
    (d) => {
      data = d;
      post({ type: 'ready' });
    },
    (e: Error) => post({ type: 'failed', message: e.message }),
  );

self.onmessage = async (e: MessageEvent<DictIn>) => {
  await ready;
  if (!data) return;
  post({ type: 'result', id: e.data.id, result: lookup(e.data.word) });
};
