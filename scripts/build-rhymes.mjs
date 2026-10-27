/**
 * Hyperfocus rhyming dictionary: the CMU Pronouncing Dictionary (134,000+ English words and how they sound) → one JSON file.
 * Output: client/public/rhymes/rhymes.json (a static file; loaded in the background in the browser, searches work offline).
 *
 *   node scripts/build-rhymes.mjs
 *
 * Rhyme: the sounds from the last stressed vowel to the end are the same (time / rhyme / sublime).
 * Near rhyme: the same last stressed vowel and syllables after it, and the last consonant of the same kind (time / line / mine).
 * Common words first: words found in lower case in WordNet (names do not count), those with more senses first.
 *
 * Format:
 *   w: the words, separated by "|" (sorted)
 *   c: how common each word is, 0–9 (0: not in WordNet, or only a name; 9: many senses, very common)
 *   y: syllables per word (one digit; 9 for 9 or more)
 *   p: rhyme groups, as word indexes (only groups of 2+ words)
 *   n: near rhyme groups, as word indexes
 *   a: word index → [p groups], [n groups] (words with more than one pronunciation are in more than one group)
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dictionary } from 'cmu-pronouncing-dictionary';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'client/public/rhymes');

// How common: the number of WordNet senses where the word appears in lower case (names like Blenheim or Durkheim do not count).
// Inflected forms take it from their base (walked → walk).
const wn = JSON.parse(readFileSync(join(root, 'client/public/wordnet/wordnet.json'), 'utf8'));
const senses = new Map();
for (const s of wn.s) for (const w of s[1].split('|')) if (/^[a-z][a-z'-]*$/.test(w)) senses.set(w, (senses.get(w) ?? 0) + 1);
for (const [form, base] of Object.entries(wn.x)) if (senses.has(base) && !senses.has(form)) senses.set(form, senses.get(base));
const SUFFIX = [['ies', 'y'], ['es', ''], ['s', ''], ['ied', 'y'], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', ''], ['er', 'e'], ['er', ''], ['est', ''], ['ly', '']];
const senseCount = (w) => {
  if (senses.has(w)) return senses.get(w);
  for (const [a, b] of SUFFIX) if (w.endsWith(a) && w.length > a.length + 1 && senses.has(w.slice(0, -a.length) + b)) return senses.get(w.slice(0, -a.length) + b);
  return 0;
};
// 0–9: 1 sense → 1 … 30+ senses → 9
const rank = (w) => {
  const n = senseCount(w);
  return n ? Math.min(9, 1 + Math.round(Math.log2(n) * 1.9)) : 0;
};

const VOWEL = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)/;
const CLASS = { M: 'n', N: 'n', NG: 'n', P: 's', B: 's', T: 's', D: 's', K: 's', G: 's', F: 'f', V: 'f', TH: 'f', DH: 'f', S: 'f', Z: 'f', SH: 'f', ZH: 'f', HH: 'f', CH: 'a', JH: 'a', L: 'l', R: 'l', W: 'w', Y: 'w' };

function keys(pron) {
  const ph = pron.split(' ');
  let last = -1;
  for (let i = ph.length - 1; i >= 0; i--)
    if (/[12]$/.test(ph[i])) {
      last = i;
      break;
    }
  if (last < 0) for (let i = ph.length - 1; i >= 0; i--) if (VOWEL.test(ph[i])) { last = i; break; }
  if (last < 0) return null;
  const tail = ph.slice(last).map((p) => p.replace(/\d/, ''));
  const perfect = tail.join(' ');
  const end = tail[tail.length - 1];
  const vowelsAfter = tail.slice(1).filter((p) => VOWEL.test(p)).length;
  const near = `${tail[0]}|${vowelsAfter}|${VOWEL.test(end) ? 'v' : (CLASS[end] ?? end)}`;
  const syl = ph.filter((p) => /\d$/.test(p)).length;
  return { perfect, near, syl };
}

const entries = []; // [word, keys]
for (const [rawWord, pron] of Object.entries(dictionary)) {
  const word = rawWord.replace(/\(\d+\)$/, '');
  if (!/^[a-z][a-z'-]*[a-z]$|^[a-z]$/.test(word)) continue;
  const k = keys(pron);
  if (k) entries.push([word, k]);
}

const words = [...new Set(entries.map(([w]) => w))].sort();
const index = new Map(words.map((w, i) => [w, i]));
const syll = new Array(words.length).fill(0);
const perfectGroups = new Map();
const nearGroups = new Map();
for (const [w, k] of entries) {
  const i = index.get(w);
  if (!syll[i]) syll[i] = Math.min(9, Math.max(1, k.syl));
  if (!perfectGroups.has(k.perfect)) perfectGroups.set(k.perfect, new Set());
  perfectGroups.get(k.perfect).add(i);
  if (!nearGroups.has(k.near)) nearGroups.set(k.near, new Set());
  nearGroups.get(k.near).add(i);
}

const p = [];
const n = [];
const a = words.map(() => [[], []]);
for (const set of perfectGroups.values()) {
  if (set.size < 2) continue;
  const g = p.length;
  p.push([...set].sort((x, y) => x - y));
  for (const i of set) a[i][0].push(g);
}
for (const set of nearGroups.values()) {
  if (set.size < 2) continue;
  const g = n.length;
  n.push([...set].sort((x, y) => x - y));
  for (const i of set) a[i][1].push(g);
}

mkdirSync(OUT, { recursive: true });
const data = {
  w: words.join('|'),
  c: words.map((w) => String(rank(w))).join(''),
  y: syll.join(''),
  p,
  n,
  a: a.map(([x, y]) => (x.length === 1 && y.length === 1 ? [x[0], y[0]] : [x, y])),
};
const json = JSON.stringify(data);
writeFileSync(join(OUT, 'rhymes.json'), json);
copyFileSync(join(root, 'node_modules/cmu-pronouncing-dictionary/license'), join(OUT, 'LICENSE-cmudict.txt'));
console.log(`${words.length} words, ${p.length} rhyme groups, ${n.length} near groups, ${(json.length / 1e6).toFixed(1)} MB`);
