import { useEffect, useMemo, useState } from 'react';
import { recentChapters, type ChapterEdit } from './secure';
import { folderOf, noteTitle, useVault, isHiddenPath } from './vault/store';

/**
 * Recent edits: which chapter, library note or note board you changed, and when.
 * Not what you changed. The list is built in the browser from each document's own last edit time
 * (no separate log is kept; nothing new goes to the server).
 */
type Entry =
  | { kind: 'chapter'; at: number; title: string; where: string; bookId: number; chapterId: number }
  | { kind: 'note'; at: number; title: string; where: string; noteId: string }
  | { kind: 'board'; at: number; title: string; where: string };

const KIND_LABEL: Record<Entry['kind'], string> = { chapter: 'Chapter', note: 'Library', board: 'Board' };
const LIMIT = 40;

const dayKey = (t: number) => new Date(t).toDateString();
function dayLabel(t: number) {
  const now = new Date();
  const d = new Date(t);
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function timeLabel(t: number) {
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function HistoryDialog({
  notebookUpdatedAt,
  onClose,
  onChapter,
  onNote,
  onBoard,
}: {
  notebookUpdatedAt: string | null;
  onClose: () => void;
  onChapter: (bookId: number, chapterId: number) => void;
  onNote: (id: string) => void;
  onBoard: () => void;
}) {
  const vault = useVault();
  const [chapters, setChapters] = useState<ChapterEdit[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    recentChapters().then(
      (c) => alive && setChapters(c),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const c of chapters ?? [])
      out.push({ kind: 'chapter', at: Date.parse(c.at), title: c.chapterTitle || 'Untitled chapter', where: c.bookTitle || 'Untitled', bookId: c.bookId, chapterId: c.chapterId });
    for (const it of vault.items) {
      if (it.meta.deleted || it.meta.kind !== 'note' || isHiddenPath(it.meta.path)) continue;
      out.push({ kind: 'note', at: it.meta.mtime, title: noteTitle(it.meta.path), where: folderOf(it.meta.path) || 'Library', noteId: it.id });
    }
    if (notebookUpdatedAt) out.push({ kind: 'board', at: Date.parse(notebookUpdatedAt), title: 'Notes board', where: 'Notes' });
    return out.filter((e) => Number.isFinite(e.at)).sort((a, b) => b.at - a.at).slice(0, LIMIT);
  }, [chapters, vault.items, notebookUpdatedAt]);

  const groups = useMemo(() => {
    const g: { label: string; items: Entry[] }[] = [];
    for (const e of entries) {
      const label = dayLabel(e.at);
      const last = g[g.length - 1];
      if (last && dayKey(last.items[0]!.at) === dayKey(e.at)) last.items.push(e);
      else g.push({ label, items: [e] });
    }
    return g;
  }, [entries]);

  const pick = (e: Entry) => {
    onClose();
    if (e.kind === 'chapter') onChapter(e.bookId, e.chapterId);
    else if (e.kind === 'note') onNote(e.noteId);
    else onBoard();
  };

  return (
    <div className="dlg-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg hist-dlg" role="dialog" aria-modal="true" aria-label="Recent edits">
        <header className="vt-sync-head">
          <h2 className="dlg-title">Recent edits</h2>
          <div className="nt-spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="muted small hist-note">Which chapters and notes you changed, and when. Click one to open it.</p>
        {error ? (
          <p className="error-text">{error}</p>
        ) : chapters === null ? (
          <div className="vt-sync-busy">
            <span className="vt-spinner" aria-hidden /> Loading…
          </div>
        ) : !entries.length ? (
          <p className="muted">Nothing edited yet.</p>
        ) : (
          <div className="hist-list">
            {groups.map((g) => (
              <section key={g.label + g.items[0]!.at}>
                <h3 className="hist-day">{g.label}</h3>
                {g.items.map((e) => (
                  <button key={`${e.kind}-${'chapterId' in e ? e.chapterId : 'noteId' in e ? e.noteId : 'board'}`} type="button" className="hist-row" onClick={() => pick(e)}>
                    <span className={`hist-kind ${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                    <span className="hist-title">{e.title}</span>
                    <span className="hist-where">{e.where}</span>
                    <span className="hist-time">{timeLabel(e.at)}</span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
