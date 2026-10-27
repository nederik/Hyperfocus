/**
 * The Hyperfocus dictionary: turns the WordNet 3.1 (Princeton) database into one compact JSON file.
 * Output: client/public/wordnet/wordnet.json (a static file of the app; loaded in the background in the browser).
 *
 *   node scripts/build-wordnet.mjs
 *
 * Format:
 *   s: synonym sets (synsets) — [part of speech, "word|word", definition, "example|example", "h1,2;o3;s4;a5"]
 *      part of speech: n (noun), v (verb), a (adjective), r (adverb)
 *      links: h = broader, o = narrower, s = similar / related, a = opposite
 *   i: word (lowercase) → synset indices (the most common sense first; parts of speech ordered by frequency)
 *   x: irregular forms → base (told → tell, mice → mouse)
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WN = join(root, 'node_modules/wordnet-db/dict');
const EXC = join(root, 'node_modules/wndb-with-exceptions/dict');
const OUT = join(root, 'client/public/wordnet');

const FILES = { n: 'noun', v: 'verb', a: 'adj', r: 'adv' };
const filePos = (p) => (p === 's' ? 'a' : p);
const clean = (w) => w.replace(/\((a|p|ip)\)$/, '').replace(/_/g, ' ');

// 1) Synsets
const synsets = [];
const idOf = new Map(); // "v00954556" → index
const raw = [];
for (const [p, f] of Object.entries(FILES)) {
  for (const line of readFileSync(join(WN, `data.${f}`), 'utf8').split('\n')) {
    if (!line || line.startsWith('  ')) continue;
    const [head, gloss = ''] = line.split(' | ');
    const t = head.trim().split(' ');
    const offset = t[0];
    const wCnt = parseInt(t[3], 16);
    const words = [];
    let k = 4;
    for (let i = 0; i < wCnt; i++, k += 2) words.push(clean(t[k]));
    const pCnt = parseInt(t[k], 10);
    k++;
    const ptrs = [];
    for (let i = 0; i < pCnt; i++, k += 4) ptrs.push([t[k], t[k + 2], t[k + 1]]); // [symbol, part of speech, offset]
    idOf.set(p + offset, synsets.length);
    synsets.push(null);
    raw.push({ p, words, ptrs, gloss: gloss.trim() });
  }
}

const KIND = { '@': 'h', '@i': 'h', '~': 'o', '~i': 'o', '&': 's', '^': 's', $: 's', '\\': 's', '!': 'a' };
raw.forEach((r, idx) => {
  const examples = [...r.gloss.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean);
  const def = r.gloss.split(/;?\s*"/)[0].trim().replace(/;\s*$/, '');
  const groups = { h: new Set(), o: new Set(), s: new Set(), a: new Set() };
  for (const [sym, tpos, off] of r.ptrs) {
    const kind = KIND[sym];
    if (!kind) continue;
    const target = idOf.get(filePos(tpos) + off);
    if (target !== undefined && target !== idx) groups[kind].add(target);
  }
  const ptr = Object.entries(groups)
    .filter(([, v]) => v.size)
    .map(([k, v]) => k + [...v].join(','))
    .join(';');
  synsets[idx] = [r.p, [...new Set(r.words)].join('|'), def, examples.join('|'), ptr];
});

// 1b) Hand-written example sentences for common senses that have none (scripts/wordnet-examples/*.json; key: part of speech + offset)
const extraDir = join(root, 'scripts/wordnet-examples');
let added = 0;
for (const f of readdirSync(extraDir).filter((f) => f.endsWith('.json'))) {
  for (const [key, ex] of Object.entries(JSON.parse(readFileSync(join(extraDir, f), 'utf8')))) {
    const idx = idOf.get(key);
    if (idx === undefined || synsets[idx][3]) continue;
    synsets[idx][3] = ex;
    added++;
  }
}

// 2) Word → senses (index.sense: with the frequency count)
const senses = new Map(); // word → [{idx, pos, n, cnt}]
for (const line of readFileSync(join(WN, 'index.sense'), 'utf8').split('\n')) {
  if (!line) continue;
  const [key, offset, n, cnt] = line.split(' ');
  const [lemma, rest] = key.split('%');
  const pos = { 1: 'n', 2: 'v', 3: 'a', 4: 'r', 5: 'a' }[rest[0]];
  const idx = idOf.get(pos + offset);
  if (idx === undefined) continue;
  const w = lemma.replace(/_/g, ' ').toLowerCase();
  if (!senses.has(w)) senses.set(w, []);
  senses.get(w).push({ idx, pos, n: +n, cnt: +cnt });
}
const POS_ORDER = { n: 0, v: 1, a: 2, r: 3 };
const index = {};
for (const [w, list] of senses) {
  // Parts of speech are ordered by their most common sense; within one, WordNet's sense order
  const groups = {};
  for (const s of list) (groups[s.pos] ??= []).push(s);
  const order = Object.keys(groups).sort((a, b) => {
    const ma = Math.max(...groups[a].map((s) => s.cnt));
    const mb = Math.max(...groups[b].map((s) => s.cnt));
    return mb - ma || POS_ORDER[a] - POS_ORDER[b];
  });
  const ids = [];
  for (const p of order) for (const s of groups[p].sort((a, b) => a.n - b.n)) if (!ids.includes(s.idx)) ids.push(s.idx);
  index[w] = ids;
}

// 3) Irregular forms
const exc = {};
for (const f of ['noun', 'verb', 'adj', 'adv']) {
  for (const line of readFileSync(join(EXC, `${f}.exc`), 'utf8').split('\n')) {
    const [form, ...bases] = line.trim().split(' ');
    if (!form || !bases.length) continue;
    const key = form.replace(/_/g, ' ');
    const prev = exc[key] ? exc[key].split('|') : [];
    exc[key] = [...new Set([...prev, ...bases.map((b) => b.replace(/_/g, ' '))])].join('|');
  }
}

mkdirSync(OUT, { recursive: true });
const json = JSON.stringify({ v: '3.1', s: synsets, i: index, x: exc });
writeFileSync(join(OUT, 'wordnet.json'), json);
copyFileSync(join(WN, '..', 'LICENSE'), join(OUT, 'LICENSE-WordNet.txt'));
console.log(`added examples ${added}, synsets ${synsets.length}, words ${Object.keys(index).length}, irregular ${Object.keys(exc).length}, ${(json.length / 1e6).toFixed(1)} MB`);
