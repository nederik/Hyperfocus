import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BookChapter } from '@hyperfocus/shared';
import { uploadAudioSecure } from './secure';
import { toast } from '../lib/toast';
import { STORAGE_KEY } from './StorageMeter';

/** Encrypts an MP3 and uploads it (at most 20 MB). */
export const uploadAudio = (file: File): Promise<string> => uploadAudioSecure(file);

export type MusicPatch = Partial<Pick<BookChapter, 'musicUrl' | 'musicFrom' | 'musicTo'>>;

/**
 * The “Music” button in the toolbar and its small window: add/replace/remove an MP3,
 * and the pages it plays on. In the reader it fades in when the first page opens and fades out after the range.
 * Page numbers are the book's A5 pages; they are stored relative to the chapter's first page (so they do not shift when earlier chapters grow).
 */
export function MusicButton({
  url,
  from,
  to,
  startPage,
  lastPage,
  totalPages,
  onChange,
}: {
  url: string | null;
  from: number | null;
  to: number | null;
  /** The chapter's first and last page and the book's total pages (A5). 0 while the layout is not ready. */
  startPage: number;
  lastPage: number;
  totalPages: number;
  onChange: (patch: MusicPatch) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const boxRef = useRef<HTMLSpanElement>(null);

  // Closes on a click outside or with Esc
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  // When the window closes, the test playback stops
  useEffect(() => {
    if (!open) audioRef.current?.pause();
  }, [open]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange({ musicUrl: await uploadAudio(file) });
      void qc.invalidateQueries({ queryKey: STORAGE_KEY });
      toast('Chapter music added.');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => toast('Could not play the music.'));
    else a.pause();
  };

  const ready = startPage > 0;
  const fromPage = ready ? startPage + (from ?? 0) : 0;
  const toPage = ready ? (to == null ? lastPage : startPage + to) : 0;

  /** Stores the page number entered; left empty when it equals the default (start/end of the chapter). */
  const commit = (which: 'from' | 'to', raw: string) => {
    if (!ready) return;
    const v = raw.trim() === '' ? null : Math.round(Number(raw));
    if (v !== null && !Number.isFinite(v)) return;
    if (which === 'from') {
      const page = v === null ? startPage : Math.max(1, Math.min(totalPages, v));
      const patch: MusicPatch = { musicFrom: page === startPage ? null : page - startPage };
      if (page > toPage) patch.musicTo = page - startPage; // the end cannot come before the start
      onChange(patch);
    } else {
      const page = v === null ? lastPage : Math.max(fromPage, Math.min(totalPages, v));
      onChange({ musicTo: page === lastPage ? null : page - startPage });
    }
  };

  return (
    <span className="st-music-wrap" ref={boxRef}>
      <button
        type="button"
        className={`st-tool${open ? ' on' : ''}`}
        title="Chapter music: plays while reading the pages you choose"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Music{url && <span className="st-tool-dot" aria-label="(set)" />}
      </button>
      {open && (
        <div className="st-music-pop" role="dialog" aria-label="Chapter music">
          {url ? (
            <div className="st-music-row">
              <button type="button" className="st-music-btn" onClick={toggle}>
                {playing ? 'Stop' : 'Listen'}
              </button>
              <button type="button" className="st-music-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? 'Uploading…' : 'Replace'}
              </button>
              <button
                type="button"
                className="st-music-btn danger"
                onClick={() => {
                  audioRef.current?.pause();
                  onChange({ musicUrl: null, musicFrom: null, musicTo: null });
                }}
              >
                Remove
              </button>
              <audio ref={audioRef} src={url} preload="none" loop onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
            </div>
          ) : (
            <div className="st-music-row">
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? 'Uploading…' : 'Add MP3'}
              </button>
              <span className="muted">Up to 20 MB</span>
            </div>
          )}

          {url && (
            <>
              <div className="st-music-range">
                <label>
                  From page
                  <input
                    key={`f${fromPage}`}
                    type="number"
                    min={1}
                    max={totalPages || undefined}
                    defaultValue={ready ? fromPage : ''}
                    disabled={!ready}
                    onBlur={(e) => commit('from', e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </label>
                <label>
                  to page
                  <input
                    key={`t${toPage}`}
                    type="number"
                    min={1}
                    max={totalPages || undefined}
                    defaultValue={ready ? toPage : ''}
                    disabled={!ready}
                    onBlur={(e) => commit('to', e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </label>
              </div>
              <p className="st-music-note muted">
                Fades in when the reader opens page {fromPage || '…'} and fades out after page {toPage || '…'} or when they turn back.
                {(from != null || to != null) && (
                  <>
                    {' '}
                    <button type="button" className="st-link" onClick={() => onChange({ musicFrom: null, musicTo: null })}>
                      Whole chapter
                    </button>
                  </>
                )}
              </p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="audio/mpeg,.mp3"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              void pick(f);
            }}
          />
        </div>
      )}
    </span>
  );
}
