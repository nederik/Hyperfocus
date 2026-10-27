/// <reference lib="webworker" />
/**
 * Spell check (in the background): the English Hunspell dictionary (nspell).
 * A word is correct if it is in the dictionary or in the personal dictionary. No word is ever changed by itself;
 * it only reports which words are unknown and, when asked, suggestions.
 */
import nspell from 'nspell';

type Dict = ReturnType<typeof nspell>;
export type WorkerIn =
  | { type: 'check'; id: number; words: string[] }
  | { type: 'suggest'; id: number; word: string }
  | { type: 'personal'; words: string[] };
export type WorkerOut =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'checked'; id: number; bad: string[] }
  | { type: 'suggested'; id: number; items: string[] };

let en: Dict | null = null;
let personal = new Set<string>();
const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

const lower = (w: string) => w.toLowerCase();
const APOS = /['’]/;

const inDict = (w: string) => !!(en?.correct(w) || en?.correct(w.replace(/’/g, "'")));

function isCorrect(word: string): boolean {
  if (personal.has(lower(word))) return true;
  if (inDict(word)) return true;
  // Start of a sentence: the lowercase form of a capitalised word
  if (/^\p{Lu}/u.test(word) && inDict(word[0]!.toLowerCase() + word.slice(1))) return true;
  // Name with an apostrophe (Mara's): the stem is enough
  if (APOS.test(word)) {
    const stem = word.split(APOS)[0]!;
    if (stem.length > 1 && (personal.has(lower(stem)) || inDict(stem) || /^\p{Lu}/u.test(stem))) return true;
  }
  // Hyphenated word: correct if every part is correct
  if (word.includes('-')) return word.split('-').every((p) => p.length < 2 || isCorrect(p));
  return false;
}

/** nspell sometimes gives suggestions in CAPITALS; they are turned to the case of the typed word. */
function matchCase(orig: string, s: string, d: Dict): string {
  const isUpper = (w: string) => w === w.toUpperCase() && w !== w.toLowerCase();
  let out = s;
  if (isUpper(s) && !isUpper(orig) && d.correct(s.toLowerCase())) out = s.toLowerCase();
  if (isUpper(orig) && orig.length > 1) return out.toUpperCase();
  if (/^\p{Lu}/u.test(orig) && !/^\p{Lu}/u.test(out)) out = out[0]!.toUpperCase() + out.slice(1);
  return out;
}

function suggest(word: string) {
  if (!en) return [];
  const items: string[] = [];
  // For a word with an apostrophe, suggestions for the stem, keeping the ending
  const parts = word.split(APOS);
  const stem = parts.length > 1 ? parts[0]! : word;
  const tail = parts.length > 1 ? word.slice(stem.length) : '';
  for (const s of en.suggest(stem)) {
    const w = matchCase(stem, s, en) + tail;
    if (w !== word && !items.includes(w)) items.push(w);
  }
  return items.slice(0, 8);
}

async function load() {
  const get = async (f: string) => {
    const r = await fetch(`/dicts/${f}`);
    if (!r.ok) throw new Error(`Could not load the ${f} dictionary.`);
    return r.text();
  };
  const [aff, dic] = await Promise.all(['en.aff', 'en.dic'].map(get));
  en = nspell(aff!, dic!);
}

const ready = load().then(
  () => post({ type: 'ready' }),
  (e: Error) => post({ type: 'failed', message: e.message }),
);

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.type === 'personal') {
    personal = new Set(m.words.map(lower));
    return;
  }
  await ready;
  if (!en) return;
  if (m.type === 'check') post({ type: 'checked', id: m.id, bad: m.words.filter((w) => !isCorrect(w)) });
  else if (m.type === 'suggest') post({ type: 'suggested', id: m.id, items: suggest(m.word) });
};
