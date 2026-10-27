import { useEffect, useRef, useState } from 'react';
import { FloatingPanel } from '../../ui/FloatingPanel';
import type { RhymeIn, RhymeOut, RhymeResult } from './rhyme.worker';

/** The rhyming dictionary is loaded once in the background (on the first click in the box). */
const rhymer = (() => {
  let worker: Worker | null = null;
  let seq = 0;
  let failed: string | null = null;
  const waiting = new Map<number, (r: RhymeResult) => void>();
  const start = () => {
    if (worker) return;
    worker = new Worker(new URL('./rhyme.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<RhymeOut>) => {
      const m = e.data;
      if (m.type === 'failed') failed = m.message;
      else if (m.type === 'result') {
        waiting.get(m.id)?.(m.result);
        waiting.delete(m.id);
      }
    };
  };
  const find = (word: string) =>
    new Promise<RhymeResult>((resolve, reject) => {
      start();
      if (failed) return reject(new Error(failed));
      const id = ++seq;
      waiting.set(id, resolve);
      worker!.postMessage({ id, word } satisfies RhymeIn);
    });
  return { start, find };
})();

/** Opens a rhyme search from elsewhere (the right-click menu). */
export const openRhymes = (word: string) => window.dispatchEvent(new CustomEvent('hf-rhymes', { detail: word }));

/** When one of the two searches in the top bar opens, the other closes. */
export const SEARCH_SIDE_EVENT = 'hf-search-side';
export const announceSide = (side: 'dict' | 'rhyme') => window.dispatchEvent(new CustomEvent(SEARCH_SIDE_EVENT, { detail: side }));

const SYL = (n: number) => `${n} syllable${n === 1 ? '' : 's'}`;

/**
 * Rhyme search (English, offline): rhymes grouped by syllables, with near rhymes and rare words apart.
 * Clicking a word shows its rhymes (the back button returns).
 */
export function RhymeLookup() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<RhymeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [showRare, setShowRare] = useState(false);
  const box = useRef<HTMLFormElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail !== 'rhyme' && setOpen(false);
    window.addEventListener(SEARCH_SIDE_EVENT, on);
    return () => window.removeEventListener(SEARCH_SIDE_EVENT, on);
  }, []);

  const run = async (word: string, push = true) => {
    const w = word.trim();
    if (!w) return;
    const my = ++seq.current;
    setQ(w);
    setOpen(true);
    announceSide('rhyme');
    setLoading(true);
    setError(null);
    setShowRare(false);
    try {
      const r = await rhymer.find(w);
      if (my !== seq.current) return;
      setRes(r);
      if (push) setTrail((t) => (t[t.length - 1] === w ? t : [...t, w].slice(-30)));
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };
  useEffect(() => {
    const on = (e: Event) => void run((e as CustomEvent<string>).detail);
    window.addEventListener('hf-rhymes', on);
    return () => window.removeEventListener('hf-rhymes', on);
  });

  const back = () => {
    const t = trail.slice(0, -1);
    setTrail(t);
    if (t.length) void run(t[t.length - 1]!, false);
  };
  const chip = (w: string) => (
    <button key={w} type="button" className="dl-chip" onClick={() => void run(w)}>
      {w}
    </button>
  );

  const total = res && res.found ? res.perfect.reduce((s, g) => s + g.words.length, 0) : 0;

  return (
    <form
      ref={box}
      className="dl-box dl-rhyme"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        void run(q);
      }}
    >
      <svg className="dl-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {/* Ear: words that sound alike */}
        <path d="M6 10a7 7 0 1 1 13 3.6a10 10 0 0 1 -2 2a8 8 0 0 0 -2 3a4.5 4.5 0 0 1 -6.8 1.4" />
        <path d="M10 10a3 3 0 1 1 5 2.2" />
      </svg>
      <input
        type="search"
        value={q}
        placeholder="Find rhymes…"
        aria-label="Find English rhymes"
        spellCheck={false}
        autoComplete="off"
        onFocus={() => {
          rhymer.start();
          announceSide('rhyme');
          if (res) setOpen(true);
        }}
        onChange={(e) => setQ(e.target.value)}
      />
      {open && (
        <FloatingPanel anchor={box} onClose={() => setOpen(false)} className="dl-panel" width={460} role="dialog" ariaLabel="Rhymes">
          {loading && !res && <div className="dl-note">Opening the rhyming dictionary…</div>}
          {error && <div className="dl-note">{error}</div>}
          {res && (
            <div className={loading ? 'dl-dim' : undefined}>
              <div className="dl-head">
                {trail.length > 1 && (
                  <button type="button" className="dl-back" onClick={back} aria-label="Back" title="Back">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M19 12H5M11 6l-6 6 6 6" />
                    </svg>
                  </button>
                )}
                <div className="dl-word">{res.query}</div>
                {res.found && <div className="dl-from">{res.guessedFrom ? `sounds like “${res.guessedFrom}”` : `${total} rhymes`}</div>}
              </div>
              {!res.found && <p className="dl-note">No rhymes found for this word.</p>}
              {res.found && (
                <>
                  {res.perfect.length === 0 && <p className="dl-note">No common words rhyme with it exactly.</p>}
                  {res.perfect.map((g) => (
                    <section key={g.syllables} className="dl-section">
                      <h3 className="dl-pos">{SYL(g.syllables)}</h3>
                      <div className="dl-chips">{g.words.map(chip)}</div>
                    </section>
                  ))}
                  {res.near.length > 0 && (
                    <section className="dl-section">
                      <h3 className="dl-pos">Near rhymes</h3>
                      <div className="dl-chips">{res.near.flatMap((g) => g.words).map(chip)}</div>
                    </section>
                  )}
                  {res.perfectRare.length > 0 && (
                    <section className="dl-section">
                      <button type="button" className="dl-more" onClick={() => setShowRare((s) => !s)}>
                        {showRare ? 'Hide rare words' : `Show ${res.perfectRare.length} rare words and names`}
                      </button>
                      {showRare && <div className="dl-chips dl-rare">{res.perfectRare.map(chip)}</div>}
                    </section>
                  )}
                </>
              )}
              <div className="dl-foot">CMU Pronouncing Dictionary · works offline</div>
            </div>
          )}
        </FloatingPanel>
      )}
    </form>
  );
}
