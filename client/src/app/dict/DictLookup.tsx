import { useEffect, useRef, useState } from 'react';
import { FloatingPanel } from '../../ui/FloatingPanel';
import type { DictIn, DictOut, LookupResult, Pos, Similar } from './dict.worker';
import { announceSide, RhymeLookup, SEARCH_SIDE_EVENT } from './RhymeLookup';

/** The dictionary loads once in the background (on the first lookup or when the box is clicked). */
const dict = (() => {
  let worker: Worker | null = null;
  let seq = 0;
  let failed: string | null = null;
  const waiting = new Map<number, (r: LookupResult) => void>();
  const start = () => {
    if (worker) return;
    worker = new Worker(new URL('./dict.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<DictOut>) => {
      const m = e.data;
      if (m.type === 'failed') failed = m.message;
      else if (m.type === 'result') {
        waiting.get(m.id)?.(m.result);
        waiting.delete(m.id);
      }
    };
  };
  const lookup = (word: string) =>
    new Promise<LookupResult>((resolve, reject) => {
      start();
      if (failed) return reject(new Error(failed));
      const id = ++seq;
      waiting.set(id, resolve);
      worker!.postMessage({ id, word } satisfies DictIn);
    });
  return { start, lookup };
})();

/** Opens a dictionary lookup from elsewhere (e.g. the right-click menu). */
export const openLookup = (word: string) => window.dispatchEvent(new CustomEvent('hf-lookup', { detail: word }));

const POS_NAME: Record<Pos, string> = { n: 'Noun', v: 'Verb', a: 'Adjective', r: 'Adverb' };
const KIND_NAME: Record<Similar['kind'], string> = {
  synonym: 'synonym',
  similar: 'similar',
  broader: 'broader',
  narrower: 'more specific',
  related: 'related',
};

/**
 * The English dictionary in the editor's top bar: type a word to see its short definitions, example sentences,
 * similar words (with a closeness bar) and opposites. Fully offline and free (WordNet).
 */
export function DictLookup() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [more, setMore] = useState<Record<string, boolean>>({});
  const box = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const run = async (word: string, push = true) => {
    const w = word.trim();
    if (!w) return;
    const my = ++seq.current;
    setQ(w);
    setOpen(true);
    announceSide('dict');
    setLoading(true);
    setError(null);
    setMore({});
    try {
      const r = await dict.lookup(w);
      if (my !== seq.current) return;
      setRes(r);
      if (push) setTrail((t) => (t[t.length - 1] === w ? t : [...t, w].slice(-30)));
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };

  // "Look up" from the right-click menu
  useEffect(() => {
    const on = (e: Event) => void run((e as CustomEvent<string>).detail);
    window.addEventListener('hf-lookup', on);
    return () => window.removeEventListener('hf-lookup', on);
  });

  // When the rhyme search opens, the dictionary closes
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail !== 'dict' && setOpen(false);
    window.addEventListener(SEARCH_SIDE_EVENT, on);
    return () => window.removeEventListener(SEARCH_SIDE_EVENT, on);
  }, []);

  const back = () => {
    const t = trail.slice(0, -1);
    setTrail(t);
    if (t.length) void run(t[t.length - 1]!, false);
  };

  const jump = (w: string) => () => void run(w);
  const toggle = (k: string) => () => setMore((m) => ({ ...m, [k]: !m[k] }));

  // One search bar: the dictionary on the left, rhymes on the right, a thin line between
  return (
    <div className="dl-bar">
    <form
      ref={box}
      className="dl-box dl-dict"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        void run(q);
      }}
    >
      <svg className="dl-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        ref={input}
        type="search"
        value={q}
        placeholder="Look up a word…"
        aria-label="Look up an English word"
        spellCheck={false}
        autoComplete="off"
        onFocus={() => {
          dict.start();
          announceSide('dict');
          if (res) setOpen(true);
        }}
        onChange={(e) => setQ(e.target.value)}
      />
      {open && (
        <FloatingPanel anchor={box} onClose={() => setOpen(false)} className="dl-panel" width={460} role="dialog" ariaLabel="Dictionary">
          {loading && !res && <div className="dl-note">Opening the dictionary…</div>}
          {error && <div className="dl-note">{error}</div>}
          {res && !res.found && (
            <div className="dl-section">
              <div className="dl-head">
                {trail.length > 1 && (
                  <button type="button" className="dl-back" onClick={back} aria-label="Back">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M19 12H5M11 6l-6 6 6 6" />
                    </svg>
                  </button>
                )}
                <div className="dl-word">{res.query}</div>
              </div>
              <p className="dl-note">Not in the dictionary.{res.suggestions.length ? ' Did you mean:' : ''}</p>
              <div className="dl-chips">
                {res.suggestions.map((s) => (
                  <button key={s} type="button" className="dl-chip" onClick={jump(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {res && res.found && (
            <div className={loading ? 'dl-dim' : undefined}>
              <div className="dl-head">
                {trail.length > 1 && (
                  <button type="button" className="dl-back" onClick={back} aria-label="Back" title="Back">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M19 12H5M11 6l-6 6 6 6" />
                    </svg>
                  </button>
                )}
                <div className="dl-word">{res.word}</div>
                {res.from && <div className="dl-from">from “{res.from}”</div>}
              </div>

              {res.groups.map((g) => {
                const key = `pos-${g.pos}`;
                const list = more[key] ? g.senses : g.senses.slice(0, 4);
                return (
                  <section key={g.pos} className="dl-section">
                    <h3 className="dl-pos">{POS_NAME[g.pos]}</h3>
                    <ol className="dl-senses">
                      {list.map((s, i) => (
                        <li key={i}>
                          <div className="dl-def">{s.def}</div>
                          {s.examples.map((ex) => (
                            <div key={ex} className="dl-ex">
                              “{ex}”
                            </div>
                          ))}
                          {s.synonyms.length > 0 && (
                            <div className="dl-also">
                              Also:{' '}
                              {s.synonyms.slice(0, 6).map((w, j) => (
                                <span key={w}>
                                  {j > 0 && ', '}
                                  <button type="button" className="dl-link" onClick={jump(w)}>
                                    {w}
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                    {g.senses.length > 4 && (
                      <button type="button" className="dl-more" onClick={toggle(key)}>
                        {more[key] ? 'Show fewer' : `Show ${g.senses.length - 4} more`}
                      </button>
                    )}
                  </section>
                );
              })}

              {res.similar.length > 0 && (
                <section className="dl-section">
                  <h3 className="dl-pos">Similar words</h3>
                  <ul className="dl-sim">
                    {(more.sim ? res.similar : res.similar.slice(0, 14)).map((s) => (
                      <li key={s.word}>
                        <button type="button" className="dl-sim-row" onClick={jump(s.word)} title={s.def}>
                          <span className="dl-sim-top">
                            <span className="dl-sim-word">{s.word}</span>
                            <span className={`dl-kind ${s.kind}`}>{KIND_NAME[s.kind]}</span>
                            <span className="dl-meter" aria-hidden>
                              <span style={{ width: `${s.score}%` }} />
                            </span>
                            <span className="dl-score">{s.score}%</span>
                          </span>
                          <span className="dl-sim-def">{s.def}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {res.similar.length > 14 && (
                    <button type="button" className="dl-more" onClick={toggle('sim')}>
                      {more.sim ? 'Show fewer' : `Show ${res.similar.length - 14} more`}
                    </button>
                  )}
                </section>
              )}

              {res.opposites.length > 0 && (
                <section className="dl-section">
                  <h3 className="dl-pos">Opposites</h3>
                  <div className="dl-chips">
                    {res.opposites.map((w) => (
                      <button key={w} type="button" className="dl-chip" onClick={jump(w)}>
                        {w}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <div className="dl-foot">WordNet 3.1 · Princeton University · works offline</div>
            </div>
          )}
        </FloatingPanel>
      )}
    </form>
    <span className="dl-divider" aria-hidden />
    <RhymeLookup />
    </div>
  );
}
