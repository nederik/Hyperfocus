/**
 * The library's open tabs (each one a note, or empty). Kept in this browser, so they stay after a reload.
 * Only the notes' random ids are kept (not names or content).
 * A separate module so a note can be opened in a tab before the library code is loaded (e.g. from History on the shelf).
 */
import { createContext } from 'react';

/** The place left for the library tabs in the notebook's header (where the Board tabs are). */
export const LibraryTabSlot = createContext<HTMLElement | null>(null);
/** The place for the save status in the header (where the Board's "Saved" is). */
export const LibrarySaveSlot = createContext<HTMLElement | null>(null);

export interface OpenTab {
  key: string;
  id: string | null;
}

const STORE = 'hyperfocus-library-tabs';

function load(): { tabs: OpenTab[]; active: string } {
  const empty = { tabs: [{ key: 'tab-1', id: null }], active: 'tab-1' };
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null') as { tabs?: unknown; active?: unknown } | null;
    if (!v || !Array.isArray(v.tabs)) return empty;
    const tabs = v.tabs.filter(
      (t): t is OpenTab => !!t && typeof t.key === 'string' && /^tab-\d+$/.test(t.key) && (t.id === null || typeof t.id === 'string'),
    );
    if (!tabs.length) return empty;
    return { tabs, active: tabs.some((t) => t.key === v.active) ? (v.active as string) : tabs[0]!.key };
  } catch {
    return empty;
  }
}

export const tabMemory: { tabs: OpenTab[]; active: string } = load();
let seq = Math.max(1, ...tabMemory.tabs.map((t) => Number(t.key.slice(4))));
export const newTabKey = () => `tab-${++seq}`;

/** Saves the open tabs in this browser. */
export function saveTabs() {
  try {
    localStorage.setItem(STORE, JSON.stringify(tabMemory));
  } catch {
    /* private window etc.: remembered for this session only */
  }
}

export const OPEN_NOTE_EVENT = 'hyperfocus:open-note';
export const NOTES_MODE_EVENT = 'hyperfocus:notes-mode';

/** Opens a note in the library: goes to its tab if it is open, otherwise opens it in a new tab. */
export function requestOpenNote(id: string) {
  const open = tabMemory.tabs.find((t) => t.id === id);
  if (open) tabMemory.active = open.key;
  else {
    const key = newTabKey();
    // Empty tabs make room for the new note
    tabMemory.tabs = [...tabMemory.tabs.filter((t) => t.id !== null), { key, id }];
    tabMemory.active = key;
  }
  saveTabs();
  window.dispatchEvent(new CustomEvent(OPEN_NOTE_EVENT, { detail: id }));
}

/** Switches the notebook to the given view (Board / Library). */
export function requestNotesMode(mode: 'board' | 'library') {
  window.dispatchEvent(new CustomEvent(NOTES_MODE_EVENT, { detail: mode }));
}
