import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookSummary, ShelfResponse } from '@hyperfocus/shared';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { confirmDialog } from '../lib/dialog';
import { Logo } from '../ui/logo/Logo';
import { StorageMeter } from './StorageMeter';
import { LoadingScreen, useEntryLoader } from './LoadingScreen';
import { NotesDrawer } from './NotesDrawer';
import { NOTEBOOK_VIEW_KEY, useNotebook } from './useNotebook';
import { flushAll } from './autosave';
import { AccountDialog } from './Account';
import { SecurityDialog } from './Security';
import { HistoryDialog } from './History';
import { EyeComfortToggle } from './EyeComfort';
import { requestNotesMode, requestOpenNote } from './vault/tabs';
import { createBook, getShelf } from './secure';
import { vault } from './vault/store';
import { LockIcon } from './vault/VaultPanel';

export const SHELF_KEY = ['shelf'];

/** The cover as it is now: the cover image if there is one, otherwise title, a thin rule and the author. */
export function MiniCover({ book }: { book: Pick<BookSummary, 'title' | 'author' | 'coverUrl'> }) {
  return (
    <div className="st-mini-cover">
      {book.coverUrl ? (
        <img src={book.coverUrl} alt="" draggable={false} />
      ) : (
        <div className="mc-type">
          <div className="mc-title">{book.title || 'Untitled'}</div>
          <div className="mc-rule" />
          {book.author && <div className="mc-author">{book.author}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * A book on the shelf, in CSS 3D: cover, spine, page edges and back cover. On hover the book turns a little
 * and the cover opens from the spine, showing the blank page inside.
 */
function ShelfBook({ book, notebook }: { book: Pick<BookSummary, 'title' | 'author' | 'coverUrl'>; notebook?: boolean }) {
  const tint = book.coverUrl ? { backgroundImage: `url("${book.coverUrl}")` } : undefined;
  return (
    <div className={`b3d${notebook ? ' notebook' : book.coverUrl ? '' : ' leather'}`} aria-hidden>
      <div className="b3d-obj">
        <div className="b3d-back" style={tint} />
        <div className="b3d-spine" style={tint} />
        <div className="b3d-fore" />
        <div className="b3d-block" />
        <div className="b3d-cover">
          <div className="b3d-cover-front">
            {notebook ? (
              <div className="nb-cover">
                <span className="nb-band" />
              </div>
            ) : (
              <MiniCover book={book} />
            )}
          </div>
          <div className="b3d-cover-inside" />
        </div>
      </div>
    </div>
  );
}

/**
 * Every book and the notes in one zip file (each book as PDF + Word + its full data and files; notes as text + data).
 * Pending changes are saved first; the export code is loaded only when clicked.
 */
function DownloadAll() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async () => {
    setBusy('Preparing…');
    try {
      if (!(await flushAll())) throw new Error('your notes are not saved yet');
      const { exportEverything } = await import('./export/backup');
      const r = await exportEverything(setBusy);
      const mb = (r.size / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 });
      toast(`Downloaded ${r.books} ${r.books === 1 ? 'book' : 'books'} and your notes (${mb} MB).${r.missing ? ` ${r.missing} file(s) could not be included; see missing-files.txt.` : ''}`);
    } catch (e) {
      console.error(e);
      toast(`Download failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <button type="button" className="btn btn-sm st-ibtn st-dl-all" disabled={!!busy} onClick={() => void run()} title="Download every book (PDF, Word and all files) and your notes as one zip file">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
      </svg>
      <span className="st-dl-label">{busy ?? 'Download'}</span>
    </button>
  );
}

/** Last change: day, month, year and hour:minute. */
const stamp = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};
/** Space used, in MB (1 MB = 1000 KB, like the storage meter). */
const mb = (bytes: number) => {
  const v = bytes / 1e6;
  if (bytes > 0 && v < 0.01) return '<0.01 MB';
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MB`;
};

/**
 * The shelf: the notebook first, then every book in order, then a "New book" card.
 * Each book can be moved left or right and deleted (the buttons appear on hover).
 */
export function Shelf() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Book titles and covers are decrypted in the browser
  const q = useQuery<ShelfResponse>({ queryKey: SHELF_KEY, queryFn: getShelf });
  const [accountOpen, setAccountOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // The notebook at the start of the shelf opens the notes full screen.
  const { notes, tabs, changeNotes, changeTabs, flush, status: notesStatus } = useNotebook();
  const [notesOpen, setNotesOpen] = useState(false);
  const notesOpenChange = (open: boolean) => {
    setNotesOpen(open);
    // On close: save, then refresh the date and size on the shelf
    if (!open) void flush().then(() => qc.invalidateQueries({ queryKey: SHELF_KEY }));
  };

  const books = q.data?.books ?? [];

  const create = async () => {
    setCreating(true);
    try {
      const id = await createBook();
      void qc.invalidateQueries({ queryKey: SHELF_KEY });
      navigate(`/book/${id}`);
    } catch (e) {
      toast((e as Error).message);
      setCreating(false);
    }
  };

  /** Moves a book one place left (-1) or right (+1). */
  const move = async (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= books.length) return;
    const order = books.map((b) => b.id);
    [order[index], order[j]] = [order[j]!, order[index]!];
    // Show the new order at once; the server follows
    qc.setQueryData<ShelfResponse>(SHELF_KEY, (d) => d && { ...d, books: order.map((id) => d.books.find((b) => b.id === id)!) });
    try {
      await api.put('/api/books/order', { ids: order });
    } catch (e) {
      toast((e as Error).message);
    }
    void qc.invalidateQueries({ queryKey: SHELF_KEY });
  };

  const remove = async (book: BookSummary) => {
    const ok = await confirmDialog({
      title: `Delete “${book.title || 'Untitled'}”?`,
      message: `The book and its ${book.chapterCount === 1 ? 'chapter' : `${book.chapterCount} chapters`} will be deleted. This cannot be undone. (Use “Download” first if you want a copy.)`,
      confirmLabel: 'Delete book',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/books/${book.id}`);
      toast('Book deleted.');
    } catch (e) {
      toast((e as Error).message);
    }
    void qc.invalidateQueries({ queryKey: SHELF_KEY });
  };

  const logout = async () => {
    // Do not sign out while notes are unsaved
    if (!(await flushAll())) {
      toast('Your notes are not saved yet. Check your connection and try again.');
      return;
    }
    await api.post('/api/logout').catch(() => {});
    qc.clear();
    window.location.reload();
  };

  const loading = useEntryLoader(!q.isLoading);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="st-shelf-page">
      <LoadingScreen show={loading} />
      <header className="st-top">
        <div className="st-brand">
          <Logo size={34} simple />
          <span>Hyperfocus</span>
        </div>
        <StorageMeter />
        <button type="button" className="btn btn-sm st-ibtn st-history-btn" onClick={() => setHistoryOpen(true)} title="Recently edited chapters and notes">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5M12 7v5l3 2" />
          </svg>
          History
        </button>
        <DownloadAll />
        <button type="button" className="btn btn-sm st-ibtn" onClick={() => setAccountOpen(true)} title="Your name and password">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
          Account
        </button>
        <button type="button" className="btn btn-sm st-ibtn" onClick={() => setSecurityOpen(true)} title="Two-step sign-in, encryption password and recovery key">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          Security
        </button>
        <button
          type="button"
          className="btn btn-sm st-ibtn st-lock"
          title="Lock: your books and notes are removed from this tab until you enter the password again"
          onClick={async () => {
            if (!(await flushAll())) return toast('Your changes are not saved yet. Check your connection and try again.');
            qc.clear();
            await vault.lock();
          }}
        >
          <LockIcon size={14} /> Lock
        </button>
        <button type="button" className="btn btn-sm st-ibtn" onClick={logout} title="Sign out of Hyperfocus">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
            <path d="M10 8l-4 4 4 4M6 12h10" />
          </svg>
          Exit
        </button>
      </header>

      <main className="st-shelf-main">
        {q.isLoading ? null : (
          <div className="st-shelf">
            <div className="st-slot-wrap">
              <button type="button" className="st-slot" onClick={() => notesOpenChange(true)}>
                <ShelfBook book={{ title: 'Notes', author: '', coverUrl: null }} notebook />
                <span className="st-slot-title">
                  <span className="st-slot-num" aria-hidden>
                    ✎
                  </span>
                  Notes
                </span>
                <span className="st-slot-meta muted">
                  {q.data?.notebook.updatedAt ? (
                    <>
                      <span className="nowrap">{stamp(q.data.notebook.updatedAt)}</span> · <span className="nowrap">{mb(q.data.notebook.sizeBytes)}</span>
                    </>
                  ) : (
                    'No notes yet'
                  )}
                </span>
              </button>
            </div>
            {books.map((book, i) => (
              <div key={book.id} className="st-slot-wrap">
                <button type="button" className="st-slot" onClick={() => navigate(`/book/${book.id}`)}>
                  <ShelfBook book={book} />
                  <span className="st-slot-title">
                    <span className="st-slot-num">{i + 1}</span>
                    {book.title}
                  </span>
                  <span className="st-slot-meta muted">
                    <span className="nowrap">{stamp(book.updatedAt)}</span> · <span className="nowrap">{mb(book.sizeBytes ?? 0)}</span>
                  </span>
                </button>
                <div className="st-slot-actions" role="group" aria-label={`${book.title} actions`}>
                  <button type="button" className="st-slot-act" title="Move left" aria-label="Move left" disabled={i === 0} onClick={() => void move(i, -1)}>
                    ←
                  </button>
                  <button type="button" className="st-slot-act" title="Move right" aria-label="Move right" disabled={i === books.length - 1} onClick={() => void move(i, 1)}>
                    →
                  </button>
                  <button type="button" className="st-slot-act danger" title="Delete book" aria-label="Delete book" onClick={() => void remove(book)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="st-slot empty" disabled={creating} onClick={() => void create()}>
              <span className="st-empty-cover">
                <span className="st-plus">+</span>
                <span>{creating ? 'Creating…' : 'New book'}</span>
              </span>
              <span className="st-slot-title muted">{books.length ? 'Add another book' : 'Start your first book'}</span>
            </button>
          </div>
        )}
      </main>
      {notes && <NotesDrawer notes={notes} onChange={changeNotes} tabs={tabs} onTabsChange={changeTabs} title="Notes" viewKey={NOTEBOOK_VIEW_KEY} status={notesStatus} open={notesOpen} onOpenChange={notesOpenChange} full />}
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
      {/* The sepia button only on the shelf (not while the notebook is open) */}
      {!notesOpen && <EyeComfortToggle />}
      {securityOpen && <SecurityDialog onClose={() => setSecurityOpen(false)} />}
      {historyOpen && (
        <HistoryDialog
          notebookUpdatedAt={q.data?.notebook.updatedAt ?? null}
          onClose={() => setHistoryOpen(false)}
          onChapter={(bookId, chapterId) => navigate(`/book/${bookId}?ch=${chapterId}`)}
          onNote={(id) => {
            requestOpenNote(id);
            requestNotesMode('library');
            notesOpenChange(true);
          }}
          onBoard={() => {
            requestNotesMode('board');
            notesOpenChange(true);
          }}
        />
      )}
    </div>
  );
}
