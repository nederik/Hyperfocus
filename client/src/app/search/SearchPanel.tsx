import { useEffect, useRef } from 'react';
import type { FindOptions } from '@hyperfocus/shared';

export interface OtherBook {
  id: number;
  position: number;
  title: string;
  total: number;
  chapters: { id: number; title: string; count: number }[];
}

/**
 * Find and replace: how many times the word appears in this chapter, in this book's chapters and in the other books.
 * Clicking a chapter goes there and highlights the word; replace in the chapter, the book or every book.
 */
export function SearchPanel({
  q,
  onQ,
  repl,
  onRepl,
  opts,
  onOpts,
  current,
  activeCount,
  bookChapters,
  activeId,
  others,
  othersLoading,
  busy,
  onPrev,
  onNext,
  onChapter,
  onOther,
  onReplaceOne,
  onReplaceChapter,
  onReplaceBook,
  onReplaceAll,
  onClose,
}: {
  q: string;
  onQ: (v: string) => void;
  repl: string;
  onRepl: (v: string) => void;
  opts: FindOptions;
  onOpts: (o: FindOptions) => void;
  current: number;
  activeCount: number;
  /** This book's chapters and the number of matches in each (in book order). */
  bookChapters: { id: number; title: string; count: number }[];
  activeId: number;
  others: OtherBook[];
  othersLoading: boolean;
  busy: boolean;
  onPrev: () => void;
  onNext: () => void;
  onChapter: (id: number) => void;
  onOther: (bookId: number, chapterId: number) => void;
  onReplaceOne: () => void;
  onReplaceChapter: () => void;
  onReplaceBook: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}) {
  const findRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
  }, []);

  const has = q.trim().length > 0;
  const bookTotal = bookChapters.reduce((s, c) => s + c.count, 0);
  const otherTotal = others.reduce((s, b) => s + b.total, 0);
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="sr-pop" role="dialog" aria-label="Find and replace" onKeyDown={keys}>
      <div className="sr-row">
        <input
          ref={findRef}
          className="sr-input"
          type="text"
          value={q}
          placeholder="Find a word…"
          spellCheck={false}
          onChange={(e) => onQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) onPrev();
              else onNext();
            }
          }}
        />
        <button type="button" className="sr-icon" onClick={onClose} title="Close (Esc)" aria-label="Close search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="sr-row">
        <input className="sr-input" type="text" value={repl} placeholder="Replace with…" spellCheck={false} onChange={(e) => onRepl(e.target.value)} />
      </div>
      <div className="sr-row sr-opts">
        <label>
          <input type="checkbox" checked={opts.wholeWord} onChange={(e) => onOpts({ ...opts, wholeWord: e.target.checked })} />
          Whole word
        </label>
        <label>
          <input type="checkbox" checked={opts.matchCase} onChange={(e) => onOpts({ ...opts, matchCase: e.target.checked })} />
          Match case
        </label>
      </div>

      {!has ? (
        <p className="sr-hint muted">Type a word to find it in every chapter of every book.</p>
      ) : (
        <>
          <div className="sr-row sr-nav">
            <span>
              This chapter: <strong>{activeCount ? `${Math.min(current + 1, activeCount)} of ${activeCount}` : 'none'}</strong>
            </span>
            <span className="sr-navbtns">
              <button type="button" className="sr-icon" onClick={onPrev} disabled={!bookTotal} title="Previous (Shift+Enter)" aria-label="Previous match">
                ↑
              </button>
              <button type="button" className="sr-icon" onClick={onNext} disabled={!bookTotal} title="Next (Enter)" aria-label="Next match">
                ↓
              </button>
            </span>
          </div>
          <div className="sr-row sr-replace">
            <button type="button" className="sr-btn" disabled={busy || !activeCount} onClick={onReplaceOne} title="Replace the highlighted one and go to the next">
              Replace
            </button>
            <button type="button" className="sr-btn" disabled={busy || !activeCount} onClick={onReplaceChapter}>
              All in chapter
            </button>
            <button type="button" className="sr-btn" disabled={busy || !bookTotal} onClick={onReplaceBook}>
              All in book
            </button>
            <button type="button" className="sr-btn danger" disabled={busy || !(bookTotal + otherTotal)} onClick={onReplaceAll}>
              All books
            </button>
          </div>

          <div className="sr-list">
            <div className="sr-head">
              This book <span className="sr-count">{bookTotal}</span>
            </div>
            {bookChapters.filter((c) => c.count).length === 0 && <div className="sr-empty muted">Not found in this book.</div>}
            {bookChapters
              .filter((c) => c.count)
              .map((c) => (
                <button key={c.id} type="button" className={`sr-item${c.id === activeId ? ' on' : ''}`} onClick={() => onChapter(c.id)}>
                  <span className="sr-name">{c.title || 'Untitled chapter'}</span>
                  <span className="sr-count">{c.count}</span>
                </button>
              ))}

            <div className="sr-head">
              Other books <span className="sr-count">{othersLoading ? '…' : otherTotal}</span>
            </div>
            {!othersLoading && others.length === 0 && <div className="sr-empty muted">Not found in other books.</div>}
            {others.map((b) => (
              <div key={b.id} className="sr-book">
                <div className="sr-bookname">
                  <span className="sr-name">{b.title || 'Untitled'}</span>
                  <span className="sr-count">{b.total}</span>
                </div>
                {b.chapters.map((c) => (
                  <button key={c.id} type="button" className="sr-item sub" onClick={() => onOther(b.id, c.id)} title="Open this chapter">
                    <span className="sr-name">{c.title || 'Untitled chapter'}</span>
                    <span className="sr-count">{c.count}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
