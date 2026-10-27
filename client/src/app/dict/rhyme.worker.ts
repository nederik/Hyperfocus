/// <reference lib="webworker" />
/**
 * The Hyperfocus rhyming dictionary (English, offline): groups built from the CMU Pronouncing Dictionary
 * (scripts/build-rhymes.mjs). The data is loaded once; searches run in memory, and words are never sent anywhere.
 */

interface Data {
  w: string;
  c: string;
  y: string;
  p: number[][];
  n: number[][];
  a: ([number, number] | [number[], number[]])[];
}

export interface RhymeGroup {
  /** Number of syllables. */
  syllables: number;
  words: string[];
}
export type RhymeResult =
  | {
      found: true;
      query: string;
      /** Not in the dictionary: guessed from the sound of the word spelled most alike. */
      guessedFrom: string | null;
      perfect: RhymeGroup[];
      /** Rare words (names, old words…), kept apart. */
      perfectRare: string[];
      near: RhymeGroup[];
    }
  | { found: false; query: string };

export type RhymeIn = { id: number; word: string };
export type RhymeOut = { type: 'ready' } | { type: 'failed'; message: string } | { type: 'result'; id: number; result: RhymeResult };

let words: string[] = [];
let index = new Map<string, number>();
let data: Data | null = null;
const post = (m: RhymeOut) => (self as unknown as Worker).postMessage(m);

const groupsOf = (i: number): [number[], number[]] => {
  const a = data!.a[i]!;
  return typeof a[0] === 'number' ? [[a[0] as number], [a[1] as number]] : [a[0] as number[], a[1] as number[]];
};
const rankOf = (i: number) => Number(data!.c[i]) || 0;
const isCommon = (i: number) => rankOf(i) > 0;
const syl = (i: number) => Number(data!.y[i]) || 1;

/** A word not in the dictionary: the word whose ending matches its spelling the longest (at least 3 letters). */
function guess(w: string): number | null {
  let best: number | null = null;
  let bestLen = 2;
  for (let i = 0; i < words.length; i++) {
    const x = words[i]!;
    let k = 0;
    while (k < x.length && k < w.length && x[x.length - 1 - k] === w[w.length - 1 - k]) k++;
    if (k > bestLen || (k === bestLen && best !== null && isCommon(i) && !isCommon(best))) {
      best = i;
      bestLen = k;
    }
  }
  return best;
}

function bySyllables(list: number[], limit: number): RhymeGroup[] {
  const map = new Map<number, string[]>();
  for (const i of list.slice(0, limit)) {
    const s = syl(i);
    if (!map.has(s)) map.set(s, []);
    map.get(s)!.push(words[i]!);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([syllables, ws]) => ({ syllables, words: ws }));
}

function rhymes(query: string): RhymeResult {
  const w = query.trim().toLowerCase().replace(/[’`]/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!w) return { found: false, query };
  let i = index.get(w) ?? index.get(w.replace(/'s$/, ''));
  let guessedFrom: string | null = null;
  if (i === undefined) {
    const g = guess(w);
    if (g === null) return { found: false, query };
    i = g;
    guessedFrom = words[g]!;
  }
  const [pg, ng] = groupsOf(i);
  // When guessed, the word it was guessed from rhymes too
  const self = new Set(guessedFrom ? [] : [i]);
  const perfectSet = new Set<number>();
  for (const g of pg) for (const j of data!.p[g]!) if (!self.has(j) && words[j] !== w) perfectSet.add(j);
  const near: number[] = [];
  for (const g of ng) for (const j of data!.n[g]!) if (!self.has(j) && !perfectSet.has(j) && words[j] !== w && isCommon(j)) near.push(j);
  // Common words first; inflections of the same word (time → times) last
  const stem = w.replace(/(es|s|ed|ing)$/, '');
  const score = (j: number) => (words[j]!.startsWith(stem) && stem.length > 2 ? 1 : 0);
  const perfect = [...perfectSet].sort((a, b) => score(a) - score(b) || rankOf(b) - rankOf(a) || words[a]!.localeCompare(words[b]!));
  return {
    found: true,
    query: w,
    guessedFrom,
    perfect: bySyllables(perfect.filter(isCommon), 400),
    perfectRare: perfect.filter((j) => !isCommon(j)).slice(0, 300).map((j) => words[j]!),
    // Near rhymes: the 80 most common words
    near: bySyllables(
      near.sort((a, b) => rankOf(b) - rankOf(a) || syl(a) - syl(b) || words[a]!.localeCompare(words[b]!)).slice(0, 80),
      80,
    ),
  };
}

const ready = fetch('/rhymes/rhymes.json')
  .then((r) => {
    if (!r.ok) throw new Error('Could not load the rhyming dictionary.');
    return r.json() as Promise<Data>;
  })
  .then(
    (d) => {
      data = d;
      words = d.w.split('|');
      index = new Map(words.map((x, i) => [x, i]));
      post({ type: 'ready' });
    },
    (e: Error) => post({ type: 'failed', message: e.message }),
  );

self.onmessage = async (e: MessageEvent<RhymeIn>) => {
  await ready;
  if (!data) return;
  post({ type: 'result', id: e.data.id, result: rhymes(e.data.word) });
};
