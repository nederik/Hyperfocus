import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { confirmDialog, promptDialog } from '../../lib/dialog';
import { toast } from '../../lib/toast';
import { renderMarkdown, resolveLink } from './markdown';
import { baseName, folderOf, isHiddenPath, isImage, noteTitle, useVault, vault, type VaultItem } from './store';
import { SyncDialog } from './SyncDialog';
import { LibrarySaveSlot, LibraryTabSlot, newTabKey, OPEN_NOTE_EVENT, saveTabs, tabMemory, type OpenTab } from './tabs';
import { useTabStrip } from '../NoteTabs';
import { SavePill } from '../SavePill';
import { BLOCKS, blockForOffset, editingAnchor, firstVisiblePos, readingAnchor } from './scrollsync';
import { EditorView } from '@codemirror/view';
import { NoteEditor } from './editor/NoteEditor';
import { InkPicker } from './editor/InkPicker';
import { ReadMenu } from './editor/NoteMenu';

/**
 * The notebook's "Library" view: your notes (e.g. an Obsidian vault), with the same folder tree on the left.
 * Notes are encrypted and decrypted in the browser; while locked, no note is held in memory.
 */

// Folders start open; only the closed ones are remembered (while this tab stays open; never written to disk: folder names are private too)
const collapsed = new Set<string>();

export default function VaultPanel() {
  const s = useVault();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  useEffect(() => {
    void vault.load();
  }, []);
  if (recoveryKey) return <RecoveryKeyScreen keyText={recoveryKey} onDone={() => setRecoveryKey(null)} />;
  if (s.status === 'loading') return <div className="vt-center muted">Opening the library…</div>;
  if (s.status === 'error')
    return (
      <div className="vt-center">
        <p className="error-text">{s.error}</p>
        <button type="button" className="btn btn-sm" onClick={() => void vault.load()}>
          Try again
        </button>
      </div>
    );
  if (s.status === 'none') return <VaultSetup onCreated={setRecoveryKey} />;
  if (s.status === 'locked') return <VaultUnlock />;
  return <Library />;
}

// ---- Setup, unlocking, recovery ----

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="vt-center">
      <div className="vt-card">
        <div className="vt-lock-icon" aria-hidden>
          <LockIcon size={26} />
        </div>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

const MIN_PW = 10;

export function VaultSetup({ onCreated }: { onCreated: (key: string) => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < MIN_PW) return setError(`Use at least ${MIN_PW} characters.`);
    if (pw !== pw2) return setError('The two passwords are not the same.');
    setBusy(true);
    setError('');
    try {
      onCreated(await vault.create(pw));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Card title="Set up encryption">
      <p className="vt-lead">
        Your books, notes and Obsidian library are encrypted in this browser before they are saved, so nobody else can read them: not the server, not
        Cloudflare.
      </p>
      <p className="vt-lead">
        Choose an <strong>encryption password</strong>. Keep it different from your sign-in password. You will get a recovery key in the next step;
        without the password or that key, nobody can open your books, not even you.
      </p>
      <form onSubmit={submit} className="vt-form">
        <label className="field">
          <span>Encryption password</span>
          <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Repeat it</span>
          <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Turn on encryption'}
        </button>
      </form>
    </Card>
  );
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function RecoveryKeyScreen({ keyText, onDone }: { keyText: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <Card title="Save your recovery key">
      <p className="vt-lead">
        If you forget the encryption password, this key is the only way to open your books and notes. It is shown <strong>only once</strong>. Write it down or save it
        somewhere safe outside this website (a password manager is ideal).
      </p>
      <code className="vt-key">{keyText}</code>
      <div className="vt-row-btns">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void navigator.clipboard.writeText(keyText).then(() => toast('Recovery key copied'), () => toast('Could not copy'))}
        >
          Copy
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            downloadText(
              'hyperfocus-recovery-key.txt',
              `Hyperfocus recovery key\n\n${keyText}\n\nKeep this file somewhere safe. Anyone with this key and access to your account could open your books and notes.\n`,
            )
          }
        >
          Download as .txt
        </button>
      </div>
      <label className="vt-check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I saved my recovery key somewhere safe</span>
      </label>
      <button type="button" className="btn btn-primary" disabled={!saved} onClick={onDone}>
        Continue
      </button>
    </Card>
  );
}

export function VaultUnlock() {
  const [mode, setMode] = useState<'password' | 'recover'>('password');
  const [pw, setPw] = useState('');
  const [rk, setRk] = useState('');
  const [npw, setNpw] = useState('');
  const [npw2, setNpw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!(await vault.unlock(pw))) setError('Wrong password.');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  const recover = async (e: FormEvent) => {
    e.preventDefault();
    if (npw.length < MIN_PW) return setError(`Use at least ${MIN_PW} characters for the new password.`);
    if (npw !== npw2) return setError('The two new passwords are not the same.');
    setBusy(true);
    setError('');
    try {
      if (!(await vault.recover(rk, npw))) setError('This recovery key does not open the library.');
      else toast('Opened. Your new encryption password is set.');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  const reset = async () => {
    const typed = await promptDialog({
      title: 'Delete the Obsidian library?',
      message:
        'Only do this if you lost both the encryption password and the recovery key. Every note and file in the Obsidian library is deleted for good and a new password can be set. Books encrypted with the old password stay unreadable. The Obsidian folder on your computer is not touched.',
      label: 'Type DELETE MY LIBRARY to confirm',
      requireText: 'DELETE MY LIBRARY',
      confirmLabel: 'Delete library',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (typed !== 'DELETE MY LIBRARY') return;
    try {
      await vault.reset();
      toast('The library was deleted. You can set up a new one.');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  if (mode === 'recover')
    return (
      <Card title="Open with the recovery key">
        <form onSubmit={recover} className="vt-form">
          <label className="field">
            <span>Recovery key</span>
            <input className="input mono" value={rk} onChange={(e) => setRk(e.target.value)} autoComplete="off" spellCheck={false} autoFocus />
          </label>
          <label className="field">
            <span>New encryption password</span>
            <input className="input" type="password" autoComplete="new-password" value={npw} onChange={(e) => setNpw(e.target.value)} />
          </label>
          <label className="field">
            <span>Repeat it</span>
            <input className="input" type="password" autoComplete="new-password" value={npw2} onChange={(e) => setNpw2(e.target.value)} />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Opening…' : 'Open and set new password'}
          </button>
        </form>
        <div className="vt-links">
          <button type="button" className="vt-link" onClick={() => (setMode('password'), setError(''))}>
            Back to password
          </button>
          <button type="button" className="vt-link danger" onClick={() => void reset()}>
            Lost both? Delete the library
          </button>
        </div>
      </Card>
    );

  return (
    <Card title="Hyperfocus is locked">
      <p className="vt-lead">Enter your encryption password to open your books and notes. They stay open only in this tab.</p>
      <form onSubmit={unlock} className="vt-form">
        <label className="field">
          <span>Encryption password</span>
          <input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !pw}>
          {busy ? 'Opening…' : 'Unlock'}
        </button>
      </form>
      <div className="vt-links">
        <button type="button" className="vt-link" onClick={() => (setMode('recover'), setError(''))}>
          Forgot the password?
        </button>
      </div>
    </Card>
  );
}

// ---- Library ----

interface TreeFolder {
  name: string;
  path: string;
  folders: TreeFolder[];
  files: VaultItem[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const displayName = (it: VaultItem) => (it.meta.kind === 'note' ? noteTitle(it.meta.path) : baseName(it.meta.path));

function buildTree(items: VaultItem[]): TreeFolder {
  const root: TreeFolder = { name: '', path: '', folders: [], files: [] };
  const byPath = new Map<string, TreeFolder>([['', root]]);
  const folder = (path: string): TreeFolder => {
    let f = byPath.get(path);
    if (f) return f;
    const parent = folder(folderOf(path));
    f = { name: baseName(path), path, folders: [], files: [] };
    parent.folders.push(f);
    byPath.set(path, f);
    return f;
  };
  for (const it of items) folder(folderOf(it.meta.path)).files.push(it);
  const sort = (f: TreeFolder) => {
    f.folders.sort((a, b) => collator.compare(a.name, b.name));
    f.files.sort((a, b) => collator.compare(displayName(a), displayName(b)));
    f.folders.forEach(sort);
  };
  sort(root);
  return root;
}

const BAD_NAME = /[\\:*?"<>|]|^\/|\/$|(^|\/)\.|\.\.|\/\//;

function Library() {
  const s = useVault();
  const items = useMemo(() => s.items.filter((i) => !i.meta.deleted && !isHiddenPath(i.meta.path)), [s.items]);
  // Folder colors (read again when the settings record changes)
  const folderColors = useMemo(() => vault.folderColors(), [s.items]);
  const tree = useMemo(() => buildTree(items), [items]);
  const [tabs, setTabsState] = useState<OpenTab[]>(tabMemory.tabs);
  const [activeKey, setActiveKeyState] = useState(tabMemory.active);
  const setTabs = (t: OpenTab[]) => {
    tabMemory.tabs = t;
    saveTabs();
    setTabsState(t);
  };
  const setActiveKey = (k: string) => {
    tabMemory.active = k;
    saveTabs();
    setActiveKeyState(k);
  };
  // When a note is opened from outside (e.g. History on the shelf)
  useEffect(() => {
    const onOpen = (e: Event) => {
      setTabsState(tabMemory.tabs);
      setActiveKeyState(tabMemory.active);
      setEditing(true);
      const it = vault.getState().items.find((i) => i.id === (e as CustomEvent<string>).detail);
      if (it) {
        let f = folderOf(it.meta.path);
        while (f) {
          collapsed.delete(f);
          f = folderOf(f);
        }
      }
    };
    window.addEventListener(OPEN_NOTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTE_EVENT, onOpen);
  }, []);
  // Tabs of deleted notes become empty tabs
  const liveTabs = tabs.map((t) => (t.id && !items.some((i) => i.id === t.id) ? { ...t, id: null } : t));
  const activeTab = liveTabs.find((t) => t.key === activeKey) ?? liveTabs[0]!;
  const openId = activeTab.id;
  const [editing, setEditing] = useState(true);
  const [query, setQuery] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [, setTick] = useState(0);
  const current = items.find((i) => i.id === openId) ?? null;

  const reveal = (path: string) => {
    let f = folderOf(path);
    while (f) {
      collapsed.delete(f);
      f = folderOf(f);
    }
  };
  /**
   * Opens a note: if it is already open in a tab, goes to that tab; with `newTab` in a new tab, otherwise in the current one.
   */
  const open = (id: string | null, edit = true, newTab = false) => {
    setEditing(edit);
    const it = items.find((i) => i.id === id);
    if (it) reveal(it.meta.path);
    const existing = id ? liveTabs.find((t) => t.id === id) : undefined;
    if (existing) return setActiveKey(existing.key);
    if (newTab) {
      const key = newTabKey();
      setTabs([...liveTabs, { key, id }]);
      return setActiveKey(key);
    }
    setTabs(liveTabs.map((t) => (t.key === activeTab.key ? { ...t, id } : t)));
  };
  const selectTab = (key: string) => {
    setEditing(true);
    setActiveKey(key);
  };
  const addTab = () => {
    const key = newTabKey();
    setEditing(true);
    setTabs([...liveTabs, { key, id: null }]);
    setActiveKey(key);
  };
  const closeTab = (key: string) => {
    const i = liveTabs.findIndex((t) => t.key === key);
    const rest = liveTabs.filter((t) => t.key !== key);
    if (key === activeTab.key) setEditing(true);
    if (!rest.length) {
      const k = newTabKey();
      setTabs([{ key: k, id: null }]);
      return setActiveKey(k);
    }
    setTabs(rest);
    if (key === activeTab.key) setActiveKey(rest[Math.min(i, rest.length - 1)]!.key);
  };
  const toggle = (path: string) => {
    if (collapsed.has(path)) collapsed.delete(path);
    else collapsed.add(path);
    setTick((t) => t + 1);
  };

  /** A new note: in the given folder (otherwise in the open note's folder). */
  const newNote = async (inDir?: string) => {
    const dir = inDir ?? (current ? folderOf(current.meta.path) : '');
    const name = await promptDialog({
      title: 'New note',
      message: dir ? `In “${dir}”.` : undefined,
      label: 'Name',
      confirmLabel: 'Create',
      cancelLabel: 'Cancel',
      validate: (v) => {
        const t = v.trim();
        if (!t) return 'Enter a name';
        if (BAD_NAME.test(t)) return 'Names cannot contain \\ : * ? " < > | or start with a dot';
        const path = `${dir && !t.includes('/') ? `${dir}/` : ''}${t.replace(/\.md$/i, '')}.md`;
        return items.some((i) => i.meta.path === path) ? 'A note with this name already exists' : null;
      },
    });
    if (!name) return;
    const t = name.trim().replace(/\.md$/i, '');
    const path = `${dir && !t.includes('/') ? `${dir}/` : ''}${t}.md`;
    try {
      const id = await vault.createNote(path);
      reveal(path);
      focusNextNote = true;
      open(id, true);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return null;
    return items
      .map((it) => {
        const name = displayName(it).toLocaleLowerCase();
        const text = it.text?.toLocaleLowerCase() ?? '';
        const at = text.indexOf(q);
        if (!name.includes(q) && at < 0) return null;
        const snippet = at >= 0 ? (it.text ?? '').slice(Math.max(0, at - 40), at + q.length + 60).replace(/\s+/g, ' ') : '';
        return { it, snippet, nameHit: name.includes(q) };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => Number(b.nameHit) - Number(a.nameHit) || collator.compare(displayName(a.it), displayName(b.it)));
  }, [query, items]);

  /** Moves a note / file to another folder (drag and drop). Open tabs follow the moved note. */
  const moveTo = async (id: string, dir: string) => {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    const path = `${dir ? `${dir}/` : ''}${baseName(it.meta.path)}`;
    if (path === it.meta.path) return;
    if (items.some((i) => i.meta.path === path)) return toast(`“${dir || 'Library'}” already has “${displayName(it)}”`);
    try {
      await vault.rename(id, path);
      const moved = vault.byPath(path);
      if (moved && moved.id !== id) setTabs(tabMemory.tabs.map((t) => (t.id === id ? { ...t, id: moved.id } : t)));
      reveal(path);
      setTick((t) => t + 1);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  // The folder being hovered while dragging ('' = the top of the library)
  const [dropDir, setDropDir] = useState<string | null>(null);
  const drag: DragHandlers = {
    over: (e, dir) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (dropDir !== dir) setDropDir(dir);
    },
    drop: (e, dir) => {
      const id = e.dataTransfer.getData(DRAG_TYPE);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      setDropDir(null);
      void moveTo(id, dir);
    },
    end: () => setDropDir(null),
    dropDir,
  };

  // Right-click in the sidebar: highlight color
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const rowMenu = (e: React.MouseEvent, target: MenuTarget) => {
    e.preventDefault();
    setMenuAt({ x: e.clientX, y: e.clientY, target });
  };

  // Tabs sit in the notebook's header (where the Board tabs are); without that slot, above the note
  const tabSlot = useContext(LibraryTabSlot);
  const saveSlot = useContext(LibrarySaveSlot);
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  useTabStrip(strip, activeTab.key, liveTabs.length);
  const tabBar = (
    <>
      <div className="nt-tabscroll" ref={setStrip} role="tablist" aria-label="Open notes">
        {liveTabs.map((t) => {
          const it = items.find((i) => i.id === t.id);
          return (
            <div key={t.key} className={`nt-tabitem${t.key === activeTab.key ? ' on' : ''}`} onAuxClick={(e) => e.button === 1 && closeTab(t.key)}>
              <button
                type="button"
                role="tab"
                aria-selected={t.key === activeTab.key}
                className="nt-tabbtn"
                onClick={() => selectTab(t.key)}
                title={it?.meta.path ?? 'New tab'}
              >
                {it ? displayName(it) : 'New tab'}
              </button>
              <button type="button" className="nt-tabx" onClick={() => closeTab(t.key)} title="Close tab" aria-label="Close tab">
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="nt-tabadd" onClick={addTab} title="New tab" aria-label="New tab">
        +
      </button>
    </>
  );

  return (
    <div className="vt">
      <aside className="vt-side" aria-label="Library">
        <div className="vt-side-tools">
          <input className="vt-search" type="search" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
          <button type="button" className="vt-icon" onClick={() => void newNote()} title="New note" aria-label="New note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <path d="M14 3v6h6M12 12v6M9 15h6" />
            </svg>
          </button>
        </div>
        <div className="vt-side-actions">
          <button type="button" className="btn btn-sm" onClick={() => setSyncOpen(true)} title="Compare with your Obsidian folder and update either side">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 7h12l-3-3M17 17H5l3 3" />
            </svg>
            Obsidian
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void vault.lock()} title="Lock the library (the notes are removed from this tab)">
            <LockIcon size={14} /> Lock
          </button>
          <InkPicker />
        </div>
        <div
          className={`vt-tree${dropDir === '' ? ' drop' : ''}`}
          role="tree"
          onDragOver={(e) => drag.over(e, '')}
          onDrop={(e) => drag.drop(e, '')}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropDir(null)}
        >
          {results ? (
            results.length ? (
              results.map(({ it, snippet }) => (
                <button
                  key={it.id}
                  type="button"
                  className={`vt-result${it.id === openId ? ' on' : ''}${hlBg(it.meta.color) ? ' hl' : ''}`}
                  style={hlBg(it.meta.color) ? ({ '--hl': hlBg(it.meta.color) } as React.CSSProperties) : undefined}
                  onContextMenu={(e) => rowMenu(e, { kind: 'item', item: it })}
                  onClick={(e) => open(it.id, true, e.ctrlKey || e.metaKey)}
                  onAuxClick={(e) => e.button === 1 && open(it.id, true, true)}
                >
                  <span className="vt-result-name">{displayName(it)}</span>
                  {folderOf(it.meta.path) && <span className="vt-result-dir">{folderOf(it.meta.path)}</span>}
                  {snippet && <span className="vt-result-snip">…{snippet}…</span>}
                </button>
              ))
            ) : (
              <p className="vt-empty-small">Nothing found</p>
            )
          ) : items.length ? (
            <Tree folder={tree} depth={0} openId={openId} onOpen={(id, newTab) => open(id, true, newTab)} onToggle={toggle} onMenu={rowMenu} folderColors={folderColors} drag={drag} />
          ) : (
            <p className="vt-empty-small">No notes yet</p>
          )}
        </div>
      </aside>
      {menuAt && (
        <RowMenu at={menuAt} target={menuAt.target} onOpen={(id, newTab) => open(id, true, newTab)} onNewNote={(dir) => void newNote(dir)} onClose={() => setMenuAt(null)} />
      )}
      <main className="vt-main">
        {tabSlot ? createPortal(tabBar, tabSlot) : <div className="nt-tabs vt-tabs">{tabBar}</div>}
        {saveSlot && createPortal(<SavePill status={s.save} />, saveSlot)}
        {current ? (
          <ItemView key={current.id} item={current} items={items} editing={editing} setEditing={setEditing} onOpen={open} save={saveSlot ? null : s.save} />
        ) : (
          <div className="vt-center muted vt-blank">
            {items.length ? (
              <div>
                <p>Pick a note on the left.</p>
                <p className="small">Ctrl+click (or middle-click) opens a note in a new tab.</p>
              </div>
            ) : (
              <div>
                <p>Your library is empty.</p>
                <button type="button" className="btn btn-primary" onClick={() => setSyncOpen(true)}>
                  Bring in your Obsidian folder
                </button>
              </div>
            )}
          </div>
        )}
      </main>
      {syncOpen && <SyncDialog onClose={() => setSyncOpen(false)} />}
    </div>
  );
}

/** Sidebar highlight colors (stored encrypted with the note's details). */
export const HIGHLIGHTS: { key: string; name: string; bg: string; dot: string }[] = [
  { key: 'yellow', name: 'Yellow', bg: 'rgba(240, 200, 60, .30)', dot: '#e3b52c' },
  { key: 'orange', name: 'Orange', bg: 'rgba(235, 140, 60, .26)', dot: '#e07f2e' },
  { key: 'red', name: 'Red', bg: 'rgba(214, 80, 70, .22)', dot: '#cf4a3f' },
  { key: 'pink', name: 'Pink', bg: 'rgba(225, 110, 170, .22)', dot: '#d9629f' },
  { key: 'purple', name: 'Purple', bg: 'rgba(140, 100, 200, .22)', dot: '#8a63c4' },
  { key: 'blue', name: 'Blue', bg: 'rgba(70, 130, 210, .22)', dot: '#4a83cf' },
  { key: 'green', name: 'Green', bg: 'rgba(80, 165, 95, .24)', dot: '#4f9d5c' },
];
const hlBg = (key?: string | null) => HIGHLIGHTS.find((h) => h.key === key)?.bg;

/** Drag and drop in the sidebar: notes and files move into folders. */
const DRAG_TYPE = 'application/x-hyperfocus-item';
interface DragHandlers {
  over: (e: React.DragEvent, dir: string) => void;
  drop: (e: React.DragEvent, dir: string) => void;
  end: () => void;
  dropDir: string | null;
}

/** The right-clicked row: a note / file, or a folder. */
type MenuTarget = { kind: 'item'; item: VaultItem } | { kind: 'folder'; path: string; name: string; color: string | null };

/** The right-click menu of a sidebar row: highlight color (for a note: open in a new tab). */
function RowMenu({
  at,
  target,
  onOpen,
  onNewNote,
  onClose,
}: {
  at: { x: number; y: number };
  target: MenuTarget;
  onOpen: (id: string, newTab?: boolean) => void;
  onNewNote: (dir: string) => void;
  onClose: () => void;
}) {
  const item = target.kind === 'item' ? target.item : null;
  const name = item ? displayName(item) : target.kind === 'folder' ? target.name : '';
  const current = item ? (item.meta.color ?? null) : target.kind === 'folder' ? target.color : null;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)), top: Math.max(8, at.y + r.height > window.innerHeight - 8 ? at.y - r.height : at.y) });
  }, [at.x, at.y]);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    document.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);
  const paint = (color: string | null) => {
    onClose();
    const job = item ? vault.setColor(item.id, color) : target.kind === 'folder' ? vault.setFolderColor(target.path, color) : Promise.resolve();
    job.catch((e: Error) => toast(e.message));
  };
  return (
    <div ref={ref} className="sp-menu vt-menu" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {target.kind === 'folder' && (
        <>
          <button
            type="button"
            role="menuitem"
            className="sp-item"
            onClick={() => {
              onClose();
              onNewNote(target.path);
            }}
          >
            New note here
          </button>
          <div className="sp-sep" />
        </>
      )}
      <div className="sp-note vt-menu-label">Highlight “{name}”</div>
      <div className="vt-swatches vt-hl-swatches" role="group" aria-label="Highlight color">
        {HIGHLIGHTS.map((h) => (
          <button
            key={h.key}
            type="button"
            className={`vt-swatch${current === h.key ? ' on' : ''}`}
            style={{ color: h.dot }}
            title={h.name}
            aria-label={h.name}
            onClick={() => paint(h.key)}
          />
        ))}
      </div>
      <button type="button" role="menuitem" className="sp-item" disabled={!current} onClick={() => paint(null)}>
        No highlight
      </button>
      {item && (
        <>
          <div className="sp-sep" />
          <button
            type="button"
            role="menuitem"
            className="sp-item"
            onClick={() => {
              onClose();
              onOpen(item.id, true);
            }}
          >
            Open in new tab
          </button>
        </>
      )}
    </div>
  );
}

function Tree({
  folder,
  depth,
  openId,
  onOpen,
  onToggle,
  onMenu,
  folderColors,
  drag,
}: {
  folder: TreeFolder;
  depth: number;
  openId: string | null;
  onOpen: (id: string, newTab?: boolean) => void;
  onToggle: (path: string) => void;
  /** Right-click: the row's menu (highlight color). */
  onMenu: (e: React.MouseEvent, target: MenuTarget) => void;
  folderColors: Record<string, string>;
  drag: DragHandlers;
}) {
  // Indentation comes from the nested .vt-children boxes; depth is only for accessibility
  const pad = (extra: number) => ({ paddingLeft: 6 + extra, '--depth': depth }) as React.CSSProperties;
  return (
    <>
      {folder.folders.map((f) => {
        const isOpen = !collapsed.has(f.path);
        return (
          <div
            key={f.path}
            className={`vt-branch${drag.dropDir === f.path ? ' drop' : ''}`}
            role="treeitem"
            aria-expanded={isOpen}
            onDragOver={(e) => drag.over(e, f.path)}
            onDrop={(e) => drag.drop(e, f.path)}
          >
            <button
              type="button"
              className={`vt-row vt-folder${hlBg(folderColors[f.path]) ? ' hl' : ''}`}
              style={{ ...pad(0), ...(hlBg(folderColors[f.path]) ? ({ '--hl': hlBg(folderColors[f.path]) } as React.CSSProperties) : {}) }}
              onClick={() => onToggle(f.path)}
              onContextMenu={(e) => onMenu(e, { kind: 'folder', path: f.path, name: f.name, color: folderColors[f.path] ?? null })}
            >
              <svg className={`vt-chev${isOpen ? ' open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 6l6 6-6 6" />
              </svg>
              <span className="vt-name">{f.name}</span>
            </button>
            {isOpen && (
              <div className="vt-children">
                <Tree folder={f} depth={depth + 1} openId={openId} onOpen={onOpen} onToggle={onToggle} onMenu={onMenu} folderColors={folderColors} drag={drag} />
              </div>
            )}
          </div>
        );
      })}
      {folder.files.map((it) => (
        <button
          key={it.id}
          type="button"
          role="treeitem"
          className={`vt-row vt-file${it.id === openId ? ' on' : ''}${it.meta.kind === 'file' ? ' attach' : ''}${hlBg(it.meta.color) ? ' hl' : ''}`}
          style={{ ...pad(18), ...(hlBg(it.meta.color) ? ({ '--hl': hlBg(it.meta.color) } as React.CSSProperties) : {}) }}
          onClick={(e) => onOpen(it.id, e.ctrlKey || e.metaKey)}
          onContextMenu={(e) => onMenu(e, { kind: 'item', item: it })}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, it.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={drag.end}
          onAuxClick={(e) => e.button === 1 && onOpen(it.id, true)}
          title={it.meta.path}
        >
          <span className="vt-name">{displayName(it)}</span>
          {it.meta.kind === 'file' && <span className="vt-ext">{baseName(it.meta.path).split('.').pop()?.toUpperCase()}</span>}
        </button>
      ))}
    </>
  );
}

/** A newly created note opens ready to type in. */
let focusNextNote = false;

function ItemView({
  item,
  items,
  editing,
  setEditing,
  onOpen,
  save,
}: {
  item: VaultItem;
  items: VaultItem[];
  editing: boolean;
  setEditing: (v: boolean) => void;
  onOpen: (id: string | null, edit?: boolean, newTab?: boolean) => void;
  /** Shown here when not shown in the header (null: do not show). */
  save: 'saved' | 'saving' | 'error' | null;
}) {
  const isNote = item.meta.kind === 'note';
  const crumbs = folderOf(item.meta.path).split('/').filter(Boolean);
  const mdRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** The place kept across the switch: the character in the source, its distance from the top, (on double-click) the caret. */
  const anchor = useRef<{ offset: number; dy: number; caret?: number } | null>(null);

  /** Reading ↔ editing: the place on screen is kept (no jump to the top). */
  const switchMode = (next: boolean, clicked?: { el: HTMLElement | null; word: string }) => {
    if (next === editing) return;
    const text = item.text ?? '';
    if (next) {
      const md = mdRef.current;
      if (md) {
        const hit = readingAnchor(md, text, clicked?.el && md.contains(clicked.el) ? clicked.el : null);
        // Not found: the same place proportionally
        const offset = hit?.offset ?? Math.round((md.scrollTop / Math.max(1, md.scrollHeight - md.clientHeight)) * text.length);
        const dy = hit?.dy ?? 0;
        let caret: number | undefined;
        if (clicked?.word) {
          const w = text.indexOf(clicked.word, offset);
          if (w >= 0 && w - offset < 4000) caret = w;
        }
        anchor.current = { offset, dy, caret };
      }
    } else if (viewRef.current) anchor.current = editingAnchor(viewRef.current);
    setEditing(next);
  };
  const switchRef = useRef(switchMode);
  switchRef.current = switchMode;

  // Right after the switch, before painting: scroll to the same place
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (editing) {
      const view = viewRef.current;
      if (!view) return;
      if (a) {
        const len = view.state.doc.length;
        const offset = Math.min(a.offset, len);
        view.dispatch({ selection: { anchor: Math.min(a.caret ?? offset, len) }, effects: EditorView.scrollIntoView(offset, { y: 'start', yMargin: a.dy }) });
        // Caret: the double-clicked word or the first visible line (so typing does not scroll the screen)
        if (a.caret === undefined)
          view.requestMeasure({ read: () => firstVisiblePos(view), write: (p) => view.state.selection.main.head !== p && view.dispatch({ selection: { anchor: p } }) });
      }
      // Opening a note does not focus the editor (so Tab still switches Board / Library); switching modes and new notes do
      if (a || focusNextNote) view.focus();
      focusNextNote = false;
    } else if (a) {
      const md = mdRef.current;
      const el = md ? blockForOffset(md, item.text ?? '', a.offset) : null;
      if (md && el) md.scrollTop += el.getBoundingClientRect().top - md.getBoundingClientRect().top - a.dy;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // Ctrl+E: reading / editing; Ctrl+S: save now
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'e' && isNote) {
        e.preventDefault();
        switchRef.current(!editing);
      } else if (k === 's') {
        e.preventDefault();
        void vault.flush();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, isNote]);

  /** Opens a [[link]] (Ctrl+click or the right-click menu). */
  const openLink = (target: string, newTab: boolean) => {
    const it = resolveLink(target, items, true);
    if (it) onOpen(it.id, true, newTab);
    else toast(`There is no note called “${target}” yet`);
  };

  const rename = async () => {
    const isN = item.meta.kind === 'note';
    const cur = isN ? item.meta.path.replace(/\.md$/i, '') : item.meta.path;
    const next = await promptDialog({
      title: 'Rename or move',
      message: 'Use / for folders, e.g. Characters/Main/Name.',
      label: 'Path',
      defaultValue: cur,
      confirmLabel: 'Save',
      cancelLabel: 'Cancel',
      validate: (v) => (!v.trim() ? 'Enter a name' : BAD_NAME.test(v.trim()) ? 'Names cannot contain \\ : * ? " < > | or start with a dot' : null),
    });
    if (!next || next.trim() === cur) return;
    const path = isN ? `${next.trim().replace(/\.md$/i, '')}.md` : next.trim();
    try {
      await vault.rename(item.id, path);
      const moved = vault.byPath(path);
      if (moved) onOpen(moved.id);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete “${displayName(item)}”?`,
      message: item.meta.base
        ? 'It will be deleted here. Next time you compare with Obsidian, you can also move it to the Obsidian trash.'
        : 'This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      await vault.remove(item.id);
      onOpen(null);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="vt-item">
      <header className="vt-item-head">
        <div className="vt-crumbs" title={item.meta.path}>
          {crumbs.map((c, i) => (
            <span key={i} className="vt-crumb">
              {c}
            </span>
          ))}
          <strong>{displayName(item)}</strong>
        </div>
        {isNote && save && <span className={`vt-save ${save}`}>{save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : 'Not saved, retrying…'}</span>}
        {isNote && (
          <button type="button" className={`btn btn-sm${editing ? ' btn-primary' : ''}`} onClick={() => switchMode(!editing)} title="Ctrl+E">
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
        <button type="button" className="vt-icon" onClick={() => void rename()} title="Rename or move" aria-label="Rename or move">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
        </button>
        <button type="button" className="vt-icon danger" onClick={() => void remove()} title="Delete" aria-label="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
          </svg>
        </button>
      </header>
      {isNote ? (
        editing ? (
          <NoteEditor item={item} items={items} viewRef={viewRef} onOpenNote={openLink} />
        ) : (
          <NoteRead item={item} items={items} mdRef={mdRef} onOpen={onOpen} onEdit={(clicked) => switchMode(true, clicked)} />
        )
      ) : (
        <FileView item={item} />
      )}
    </div>
  );
}

function NoteRead({
  item,
  items,
  mdRef: ref,
  onOpen,
  onEdit,
}: {
  item: VaultItem;
  items: VaultItem[];
  mdRef: React.RefObject<HTMLDivElement | null>;
  onOpen: (id: string, edit?: boolean, newTab?: boolean) => void;
  /** Switches to editing; on double-click, the clicked block and word (the caret goes there). */
  onEdit: (clicked?: { el: HTMLElement | null; word: string }) => void;
}) {
  const html = useMemo(() => renderMarkdown(item.text ?? ''), [item.text]);
  const [menu, setMenu] = useState<{ x: number; y: number; el: HTMLElement | null } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    for (const img of el.querySelectorAll<HTMLImageElement>('img[data-vault]')) {
      const target = resolveLink(img.dataset.vault ?? '', items, false);
      if (target && target.meta.kind === 'file' && isImage(target.meta.mime)) {
        img.classList.add('loading');
        vault
          .fileUrl(target.id)
          .then((u) => {
            if (!alive) return;
            img.src = u;
            img.classList.remove('loading');
          })
          .catch(() => img.replaceWith(missing(img.dataset.vault ?? '')));
      } else if (target && target.meta.kind === 'note') {
        const a = document.createElement('a');
        a.href = '#';
        a.dataset.note = img.dataset.vault ?? '';
        a.textContent = noteTitle(target.meta.path);
        img.replaceWith(a);
      } else img.replaceWith(missing(img.dataset.vault ?? ''));
    }
    for (const a of el.querySelectorAll<HTMLAnchorElement>('a[data-note]')) {
      if (!resolveLink(a.dataset.note ?? '', items, true)) a.classList.add('unresolved');
    }
    for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href]:not([data-note])')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    return () => {
      alive = false;
    };
  }, [html, items, ref]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-note]');
    if (!a) return;
    e.preventDefault();
    const target = resolveLink(a.dataset.note ?? '', items, true);
    if (target) onOpen(target.id, true, e.ctrlKey || e.metaKey);
    else toast(`There is no note called “${a.dataset.note}” yet`);
  };

  if (!item.text?.trim())
    return (
      <div className="vt-center muted vt-blank" onDoubleClick={() => onEdit()}>
        Empty note. Press Edit (Ctrl+E) to write.
      </div>
    );
  return (
    <>
    <div
      ref={ref}
      className="vt-md"
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, el: (e.target as HTMLElement).closest<HTMLElement>(BLOCKS) });
      }}
      onDoubleClick={(e) => onEdit({ el: (e.target as HTMLElement).closest<HTMLElement>(BLOCKS), word: window.getSelection()?.toString().trim() ?? '' })}
      dangerouslySetInnerHTML={{ __html: html }}
    />
    {menu && <ReadMenu at={menu} onEdit={() => onEdit({ el: menu.el, word: '' })} onClose={() => setMenu(null)} />}
    </>
  );
}

function missing(name: string) {
  const s = document.createElement('span');
  s.className = 'vt-missing';
  s.textContent = `Missing: ${name}`;
  return s;
}

function FileView({ item }: { item: VaultItem }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const image = isImage(item.meta.mime);
  useEffect(() => {
    if (!image) return;
    let alive = true;
    vault.fileUrl(item.id).then(
      (u) => alive && setUrl(u),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [item.id, image, item.meta.hash]);
  const download = async () => {
    try {
      const u = await vault.fileUrl(item.id);
      const a = document.createElement('a');
      a.href = u;
      a.download = baseName(item.meta.path);
      a.click();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="vt-file-view">
      {image ? url ? <img src={url} alt={baseName(item.meta.path)} /> : <p className="muted">{error || 'Decrypting…'}</p> : <p className="muted">This file cannot be shown here.</p>}
      <div className="vt-file-info">
        <span className="muted">{(item.meta.size / 1024).toLocaleString('en-US', { maximumFractionDigits: 0 })} KB</span>
        <button type="button" className="btn btn-sm" onClick={() => void download()}>
          Download
        </button>
      </div>
    </div>
  );
}

export function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
