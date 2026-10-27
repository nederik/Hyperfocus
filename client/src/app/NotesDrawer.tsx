import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { BookNote, NoteTab } from '@hyperfocus/shared';
import { NoteBoard } from './NoteBoard';
import { NoteTabs } from './NoteTabs';
import type { SaveStatus } from './autosave';
import { SavePill } from './SavePill';
import { LibrarySaveSlot, LibraryTabSlot, NOTES_MODE_EVENT } from './vault/tabs';

// The library (encrypted notes) is loaded only when opened
const VaultPanel = lazy(() => import('./vault/VaultPanel'));
const MODE_KEY = 'hyperfocus-notes-mode';
type Mode = 'board' | 'library';
const readMode = (): Mode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'library' ? 'library' : 'board';
  } catch {
    return 'board';
  }
};


const MIN_VH = 22;

/** The bottom edge of the book's top bar (the notebook opens up to this line; the bar always stays visible). */
const navBottom = () => Math.max(0, Math.round(document.querySelector('.st-top')?.getBoundingClientRect().bottom ?? 0));

/**
 * Writing notes: a note board that slides up from the bottom of the browser (like Excalidraw; free text boxes).
 * In the editor it always opens full height, up to the book's top bar; drag its edge down to make it smaller.
 * Closes with the X at the top right, Alt+N or (in the editor) a tap of Alt; Tab switches between Board and Library.
 */
export function NotesDrawer({
  notes,
  onChange,
  tabs,
  onTabsChange,
  title = 'Writing notes',
  viewKey,
  open: openProp,
  onOpenChange,
  status = 'saved',
  full = false,
}: {
  notes: BookNote[];
  onChange: (notes: BookNote[]) => void;
  /** Note tabs; if empty, a single “Page 1” tab is assumed. */
  tabs: NoteTab[];
  onTabsChange: (tabs: NoteTab[], notes?: BookNote[]) => void;
  title?: string;
  /** The key the board's scroll/zoom state is stored under. */
  viewKey: string;
  /** When given, open/closed is controlled from outside (e.g. the Notes notebook on the shelf). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The notes' save status (shown at the top right). */
  status?: SaveStatus;
  /** Opens full page (the Notes notebook on the shelf): no height handle, closes with the X at the top right. */
  full?: boolean;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const openRef = useRef(open);
  openRef.current = open;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(openRef.current) : v;
    setOpenState(next);
    onOpenChange?.(next);
  };
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;
  // null: full height (up to the book's top bar); a number: a height set by hand (vh)
  const [vh, setVh] = useState<number | null>(null);
  const [top, setTop] = useState(0);
  // Full height on every opening; the top bar's position is measured again when the window is resized
  useEffect(() => {
    if (!open || full) return;
    setVh(null);
    const measure = () => setTop(navBottom());
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, full]);
  // Board: the free note board; Library: your notes (with the folder tree)
  const [mode, setModeState] = useState<Mode>(readMode);
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };
  // A view asked for from outside (e.g. a Library note or the Board from History on the shelf)
  useEffect(() => {
    const onMode = (e: Event) => {
      const m = (e as CustomEvent<Mode>).detail;
      if (m === 'board' || m === 'library') setMode(m);
    };
    window.addEventListener(NOTES_MODE_EVENT, onMode);
    return () => window.removeEventListener(NOTES_MODE_EVENT, onMode);
  });
  // Library tabs are drawn in the header, where the Board tabs are
  const [libSlot, setLibSlot] = useState<HTMLDivElement | null>(null);
  const [saveSlot, setSaveSlot] = useState<HTMLSpanElement | null>(null);
  // Once opened, the library stays mounted: it slides away with its content when closing (no empty drawer)
  const [libraryMounted, setLibraryMounted] = useState(false);
  useEffect(() => {
    if (open && mode === 'library') setLibraryMounted(true);
  }, [open, mode]);

  // ---- Tabs: each tab is a separate board ----
  const allTabs: NoteTab[] = tabs.length ? tabs : [{ id: 'main', name: 'Page 1' }];
  const tabKey = `${viewKey}:tab`;
  const [activeState, setActiveState] = useState<string>(() => {
    try {
      return localStorage.getItem(tabKey) ?? '';
    } catch {
      return '';
    }
  });
  const active = allTabs.some((t) => t.id === activeState) ? activeState : allTabs[0]!.id;
  const setActive = (id: string) => {
    setActiveState(id);
    try {
      localStorage.setItem(tabKey, id);
    } catch {
      /* ignore */
    }
  };
  const tabOf = (n: BookNote) => (n.tab && allTabs.some((t) => t.id === n.tab) ? n.tab : allTabs[0]!.id);
  const boardNotes = notes.filter((n) => tabOf(n) === active);
  const changeBoard = (next: BookNote[]) => onChange([...notes.filter((n) => tabOf(n) !== active), ...next.map((n) => ({ ...n, tab: active }))]);
  const drawerRef = useRef<HTMLElement>(null);

  // Alt+N: open / close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // In the book editor a tap of Alt alone opens / closes (not with another key, a click, or a long press)
  useEffect(() => {
    if (full) return;
    let armed = 0;
    const down = (e: KeyboardEvent) => {
      armed = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.repeat ? Date.now() : e.key === 'Alt' && e.repeat ? armed : 0;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || !armed) return;
      const quick = Date.now() - armed < 800;
      armed = 0;
      if (!quick || document.querySelector('.dlg-backdrop')) return;
      e.preventDefault(); // so the browser's menu does not take focus
      setOpenRef.current((o) => !o);
    };
    const reset = () => (armed = 0);
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('mousedown', reset, true);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('mousedown', reset, true);
      window.removeEventListener('blur', reset);
    };
  }, [full]);

  // Tab: Board ↔ Library (while open; in a text field Tab does its usual job)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      if (document.querySelector('.dlg-backdrop')) return;
      e.preventDefault();
      setModeState((m) => {
        const next: Mode = m === 'board' ? 'library' : 'board';
        try {
          localStorage.setItem(MODE_KEY, next);
        } catch {
          /* ignore */
        }
        return next;
      });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  // Closes on a click outside the notebook (not counting the click that opened it, confirm dialogs and pop-up menus)
  useEffect(() => {
    if (!open) return;
    const openedAt = performance.now();
    const onDown = (e: PointerEvent) => {
      if (performance.now() - openedAt < 250) return;
      const t = e.target as Element | null;
      if (!t || drawerRef.current?.contains(t)) return;
      if (t.closest?.('.dlg-backdrop, .dlg, .nt-tab, .sp-menu, .st-toast, .toast, .eye-toggle')) return;
      setOpenRef.current(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  // On opening, focus the board (so keyboard shortcuts work)
  useEffect(() => {
    if (open) window.setTimeout(() => drawerRef.current?.querySelector<HTMLElement>('.ex-board')?.focus({ preventScroll: true }), 350);
  }, [open]);

  // Height by dragging the edge
  const startResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Flicked down fast, the notebook closes; its height goes back to what it was before the drag.
    const fullVh = ((window.innerHeight - top) / window.innerHeight) * 100;
    const startVh = vh ?? fullVh;
    const startY = e.clientY;
    const samples: { y: number; t: number }[] = [{ y: e.clientY, t: performance.now() }];
    let rawVh = startVh;
    const move = (ev: PointerEvent) => {
      const t = performance.now();
      samples.push({ y: ev.clientY, t });
      while (samples.length > 2 && t - samples[0]!.t > 80) samples.shift();
      rawVh = ((window.innerHeight - ev.clientY) / window.innerHeight) * 100;
      // Never covers the top bar
      setVh(rawVh >= fullVh - 0.5 ? null : Math.max(MIN_VH, rawVh));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const t = performance.now();
      const first = samples[0]!;
      const speed = (ev.clientY - first.y) / Math.max(1, t - first.t); // px/ms, downwards positive
      const flung = speed > 0.6 && ev.clientY - startY > 24;
      const pushedPastMin = rawVh < MIN_VH - 6;
      if (flung || pushedPastMin) {
        // It slides down from where it was let go; the old height comes back only after the close finishes (while invisible)
        setOpen(false);
        return;
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      {/* The bottom "Notes" tab only in the editor; on the shelf the notebook opens from the book itself */}
      {!full && (
        <button type="button" className={`nt-tab${open ? ' hidden' : ''}`} onClick={() => setOpen(true)} title="Open notes (Alt). Tab switches Board and Library.">
          Notes
        </button>
      )}
      <section
        ref={drawerRef}
        className={`nt-drawer${open ? ' open' : ''}${full ? ' full' : ''}`}
        style={full ? undefined : vh === null ? { top } : { height: `${vh}vh` }}
        aria-label={title}
        aria-hidden={!open}
      >
        {!full && (
          <div className="nt-grip" onPointerDown={startResize} title="Drag to resize">
            <span />
          </div>
        )}
        <header className="nt-head">
          <div className="nt-mode" role="tablist" aria-label="Notes view">
            <button type="button" role="tab" aria-selected={mode === 'board'} className={mode === 'board' ? 'on' : ''} onClick={() => setMode('board')}>
              Board
            </button>
            <button type="button" role="tab" aria-selected={mode === 'library'} className={mode === 'library' ? 'on' : ''} onClick={() => setMode('library')}>
              Library
            </button>
          </div>
          {mode === 'library' && <div className="nt-tabs nt-libtabs" ref={setLibSlot} />}
          {mode === 'board' && (
            <NoteTabs
            tabs={allTabs}
            active={active}
            counts={Object.fromEntries(allTabs.map((t) => [t.id, notes.filter((n) => tabOf(n) === t.id).length]))}
            onSelect={setActive}
            onChange={(next, removedId) => {
              // The notes of a deleted tab go too; the remaining notes keep their tab
              const kept = removedId ? notes.filter((n) => tabOf(n) !== removedId).map((n) => ({ ...n, tab: tabOf(n) })) : undefined;
              onTabsChange(next, kept);
              if (removedId === active) setActive(next[0]!.id);
            }}
            onAdd={(tab) => {
              onTabsChange([...allTabs, tab], notes.map((n) => ({ ...n, tab: tabOf(n) })));
              setActive(tab.id);
            }}
            />
          )}
          <div className="nt-spacer" />
          {mode === 'board' ? <SavePill status={status} /> : <span className="nt-saveslot" ref={setSaveSlot} />}
            <button type="button" className="nt-x" onClick={() => setOpen(false)} title="Close notes (Alt)" aria-label="Close notes">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
        </header>
        {mode === 'board' ? (
          <NoteBoard key={active} notes={boardNotes} onChange={changeBoard} viewKey={`${viewKey}:${active}`} />
        ) : open || libraryMounted ? (
          <Suspense fallback={<div className="vt-center muted">Opening the library…</div>}>
            <LibraryTabSlot.Provider value={mode === 'library' ? libSlot : null}>
              <LibrarySaveSlot.Provider value={mode === 'library' ? saveSlot : null}>
                <VaultPanel />
              </LibrarySaveSlot.Provider>
            </LibraryTabSlot.Provider>
          </Suspense>
        ) : null}
      </section>
    </>
  );
}
