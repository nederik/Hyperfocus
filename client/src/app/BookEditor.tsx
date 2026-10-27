import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor as useTiptap, type Editor, type JSONContent } from '@tiptap/react';
import { countInDoc, replaceInDoc, type BookChapter, type BookFull, type BookImage, type FindOptions } from '@hyperfocus/shared';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { confirmDialog } from '../lib/dialog';
import { Loader } from '../ui/logo/Logo';
import { chapterPayload, createChapter, getBook, metaPayload, replaceInBooks, searchBooks, uploadImageSecure } from './secure';
import { bookExtensions } from './editorExtensions';
import { SpellCheck } from './spell/spellPlugin';
import { SearchHighlight, searchKey, type SearchState } from './search/searchPlugin';
import { SearchPanel, type OtherBook } from './search/SearchPanel';
import { DictLookup } from './dict/DictLookup';
import { EditorMenu, wordAt, type MenuAt } from './spell/EditorMenu';
import { CommentBox, commentAt, removeComment, startComment, type CommentState } from './CommentBox';
import { blocksFromDoc, defaultImageBox, epigraphOf, layoutBook, loadBookFonts, type Block } from './layout';
import { shapeOf, useShapes } from './shapes';
import { ImageLayer, type ImageActions } from './ImageLayer';
import { MusicButton } from './ChapterMusic';
import { EpigraphButton } from './Epigraph';
import { chapterLastPage } from './musicRange';
import { MapViewer } from './MapViewer';
import { DownloadMenu } from './DownloadMenu';
import { LoadingScreen, useEntryLoader } from './LoadingScreen';
import { NotesDrawer } from './NotesDrawer';
import { NOTEBOOK_VIEW_KEY, useNotebook } from './useNotebook';
import { PagesView, type ScrollTarget } from './PagesView';
import { STORAGE_KEY } from './StorageMeter';
import { flushAll, useAutosave, type SaveStatus } from './autosave';
import { PanelHandle, gridColumns, useFitPanels, usePanels } from './Panels';

/** Total word count of the chapters. */
function countWords(chapters: BookChapter[]) {
  let n = 0;
  const walk = (node: JSONContent) => {
    if (node.type === 'text' && node.text) n += node.text.split(/\s+/).filter(Boolean).length;
    node.content?.forEach(walk);
  };
  for (const c of chapters) walk(c.content as JSONContent);
  return n;
}

/** On narrow screens (one column) the panel settings are not applied. */
function useNarrow() {
  const q = '(max-width: 820px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** Chapter title: long titles wrap instead of being cut (the height grows with the text). */
function TitleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className="st-ch-title"
      value={value}
      placeholder="Chapter title"
      aria-label="Chapter title"
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.preventDefault();
      }}
    />
  );
}

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
/**
 * Chapter content. Page breaks before any text are ignored by the layout (the text starts on the title page),
 * so the editor does not show them either: they are removed on load.
 */
const asDoc = (c: unknown): JSONContent => {
  if (!(c && typeof c === 'object' && (c as JSONContent).type === 'doc')) return EMPTY_DOC;
  const doc = c as JSONContent;
  const nodes = doc.content ?? [];
  const firstText = nodes.findIndex((n) => n.type === 'paragraph' && (n.content ?? []).some((x) => x.type === 'text' && x.text?.trim()));
  const end = firstText < 0 ? nodes.length : firstText;
  if (!nodes.slice(0, end).some((n) => n.type === 'pageBreak')) return doc;
  const content = nodes.filter((n, i) => !(i < end && n.type === 'pageBreak'));
  return { ...doc, content: content.length ? content : [{ type: 'paragraph' }] };
};

// The same chapter content is not parsed twice.
const blockCache = new WeakMap<object, Block[]>();
const blocksOf = (content: unknown) => {
  const doc = asDoc(content);
  let b = blockCache.get(doc);
  if (!b) blockCache.set(doc, (b = blocksFromDoc(doc)));
  return b;
};

/** Cover image: A5 (148 × 210 mm) at 300 dpi is 1748 × 2480 px; at least 210 dpi (1240 × 1754). */
const COVER_PX = { w: 1748, h: 2480 };
const COVER_MIN = { w: 1240, h: 1754 };
/** Print quality: WEBP quality for page images, the cover and the map. */
const PRINT_QUALITY = 0.93;

const STATUS_TEXT: Record<SaveStatus, string> = { saved: 'Saved', dirty: 'Unsaved changes…', saving: 'Saving…', error: 'Could not save' };

export function BookEditor() {
  const id = Number(useParams().id);
  // The book is decrypted in the browser (it is stored encrypted on the server)
  const q = useQuery({ queryKey: ['book', id], queryFn: () => getBook(id).then((book) => ({ book })),
    staleTime: Infinity,
    // When the editor closes the book data is dropped; it is read fresh from the server next time.
    // (It must not be dropped while open: the editor would be rebuilt and unsaved text lost.)
    gcTime: 0,
  });
  const [ready, setReady] = useState(false);
  const loading = useEntryLoader(ready || q.isError);
  return (
    <>
      <LoadingScreen show={loading} />
      {q.isError && <p className="empty-state">Could not open the book. <Link to="/">Back to shelf</Link></p>}
      {q.data && <Workspace key={id} initial={q.data.book} onReady={() => setReady(true)} />}
    </>
  );
}

type Meta = Pick<BookFull, 'title' | 'author' | 'synopsis' | 'coverUrl' | 'backCoverUrl' | 'spineUrl' | 'mapUrl'>;
type ImageField = 'coverUrl' | 'backCoverUrl' | 'spineUrl' | 'mapUrl';

function Workspace({ initial, onReady }: { initial: BookFull; onReady: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Right before saving, the whole record is encrypted: only encrypted data goes to the server.
  const { queue, flush, status } = useAutosave(async (url) => {
    const m = /\/chapters\/(\d+)$/.exec(url);
    if (m) {
      const ch = chaptersRef.current.find((c) => c.id === Number(m[1]));
      if (!ch) throw new Error('Chapter not found');
      return chapterPayload(ch);
    }
    return metaPayload(initial.id, metaRef.current);
  });
  const [meta, setMeta] = useState<Meta>(() => ({
    title: initial.title,
    author: initial.author,
    synopsis: initial.synopsis,
    coverUrl: initial.coverUrl,
    backCoverUrl: initial.backCoverUrl ?? null,
    spineUrl: initial.spineUrl ?? null,
    mapUrl: initial.mapUrl,
  }));
  const [chapters, setChaptersState] = useState<BookChapter[]>(() =>
    initial.chapters.map((c) => ({ ...c, content: asDoc(c.content), images: c.images ?? [] })),
  );
  const metaRef = useRef(meta);
  // The latest chapters (so changes arriving in quick succession while dragging do not overwrite each other).
  const chaptersRef = useRef(chapters);
  const setChapters = useCallback((next: BookChapter[] | ((cs: BookChapter[]) => BookChapter[])) => {
    chaptersRef.current = typeof next === 'function' ? next(chaptersRef.current) : next;
    setChaptersState(chaptersRef.current);
  }, []);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  // One notebook everywhere: the same notes and tabs as Notes on the shelf.
  const notebook = useNotebook();
  // Coming from a search in another book (?find=…&ch=…): that chapter opens and the word is highlighted
  const [params, setParams] = useSearchParams();
  const [fromSearch] = useState(() => ({
    q: params.get('find') ?? '',
    ch: Number(params.get('ch')) || 0,
    opts: { wholeWord: params.get('w') !== '0', matchCase: params.get('c') === '1' } as FindOptions,
  }));
  const [activeId, setActiveId] = useState(
    fromSearch.ch && initial.chapters.some((c) => c.id === fromSearch.ch) ? fromSearch.ch : (initial.chapters[0]?.id ?? 0),
  );
  const [cursorBlock, setCursorBlock] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [target, setTarget] = useState<ScrollTarget | null>(null);
  const seq = useRef(0);
  const jump = useCallback((page: number, mode: ScrollTarget['mode']) => setTarget({ page, mode, seq: ++seq.current }), []);

  useEffect(() => {
    let alive = true;
    loadBookFonts().finally(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // When the book closes, refresh the shelf (the book data is dropped by itself with gcTime: 0).
  useEffect(
    () => () => {
      void qc.invalidateQueries({ queryKey: ['shelf'] });
    },
    [qc],
  );

  const active = chapters.find((c) => c.id === activeId) ?? chapters[0]!;

  // ---- Live layout (in the background, without holding up typing) ----
  const deferredChapters = useDeferredValue(chapters);
  const deferredMeta = useDeferredValue(meta);
  const shapesVersion = useShapes(chapters.flatMap((c) => c.images.map((im) => im.url)));
  const laid = useMemo(() => {
    if (!fontsReady) return null;
    return layoutBook({
      title: deferredMeta.title,
      author: deferredMeta.author,
      coverUrl: deferredMeta.coverUrl,
      chapters: deferredChapters.map((c) => ({ id: c.id, title: c.title, blocks: blocksOf(c.content), images: c.images, epigraph: epigraphOf(c) })),
    }, shapeOf);
    // shapesVersion: lay out again when the shape of a new image has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsReady, deferredChapters, deferredMeta, shapesVersion]);

  // Once the pages are laid out, the loading screen can go.
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    if (laid) readyRef.current();
  }, [laid]);

  const currentPage = laid?.blockPages.get(`${active.id}:${cursorBlock}`) ?? laid?.chapterStarts.get(active.id) ?? null;
  // When the cursor moves to another page, show that page.
  const following = selectedImage === null;
  useEffect(() => {
    if (currentPage && following) jump(currentPage, 'nearest');
  }, [currentPage, jump, following]);

  // ---- Changes ----
  const updateChapter = (chId: number, patch: Partial<Pick<BookChapter, 'title' | 'content' | 'musicUrl' | 'musicFrom' | 'musicTo' | 'epigraph' | 'epigraphBy' | 'epigraphQuotes'>>) => {
    setChapters((cs) => cs.map((c) => (c.id === chId ? { ...c, ...patch } : c)));
    queue(`/api/chapters/${chId}`, patch);
  };

  // ---- Images ----
  const setImages = (chId: number, fn: (imgs: BookImage[]) => BookImage[]) => {
    setChapters((cs) => cs.map((c) => (c.id === chId ? { ...c, images: fn(c.images) } : c)));
    const ch = chaptersRef.current.find((c) => c.id === chId);
    if (ch) queue(`/api/chapters/${chId}`, { images: ch.images });
  };
  const imageActions: ImageActions = {
    select: setSelectedImage,
    change: (chId, id, patch) => setImages(chId, (imgs) => imgs.map((im) => (im.id === id ? { ...im, ...patch } : im))),
    remove: (chId, id) => {
      setImages(chId, (imgs) => imgs.filter((im) => im.id !== id));
      setSelectedImage(null);
    },
    shiftPage: (chId, id, dir) => {
      const im = chaptersRef.current.find((c) => c.id === chId)?.images.find((i) => i.id === id);
      if (!im) return;
      const page = Math.max(0, im.page + dir);
      setImages(chId, (imgs) => imgs.map((i) => (i.id === id ? { ...i, page } : i)));
      const start = laid?.chapterStarts.get(chId);
      if (start) jump(start + page, 'nearest');
    },
  };
  const imageRef = useRef(imageActions);
  imageRef.current = imageActions;

  /** Adds the image to the page the cursor is on. */
  const addImage = async (file: File) => {
    try {
      // Page images have the same resolution as the cover (300 dpi when they fill the A5 page)
      const up = await uploadImageSecure(file, COVER_PX.h, PRINT_QUALITY);
      void qc.invalidateQueries({ queryKey: STORAGE_KEY });
      const start = laid?.chapterStarts.get(active.id) ?? 1;
      const pageN = currentPage && laid?.pages[currentPage - 1]?.chapterId === active.id ? currentPage : start;
      const offset = pageN - start;
      const box = defaultImageBox(pageN, offset === 0, up.width, up.height);
      const im: BookImage = { id: crypto.randomUUID().slice(0, 13), url: up.url, page: offset, wrap: 'shape', ...box };
      setImages(active.id, (imgs) => [...imgs, im]);
      setSelectedImage(im.id);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  // Selected image: Delete removes it, arrows move it, Esc lets go (not while in the writing area).
  useEffect(() => {
    if (!selectedImage) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable="true"]')) return;
      const owner = chaptersRef.current.find((c) => c.images.some((i) => i.id === selectedImage));
      const im = owner?.images.find((i) => i.id === selectedImage);
      if (!owner || !im) return;
      const a = imageRef.current;
      if (e.key === 'Escape') a.select(null);
      else if (e.key === 'Delete' || e.key === 'Backspace') a.remove(owner.id, im.id);
      else {
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!d) return;
        a.change(owner.id, im.id, { x: im.x + d[0]!, y: im.y + d[1]! });
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedImage]);
  // Ctrl+S (Cmd+S on a Mac): save right away (chapters, book details and notes); a short "Saved" appears at the bottom right
  const [savedFlash, setSavedFlash] = useState(0);
  useEffect(() => {
    if (!savedFlash) return;
    const t = window.setTimeout(() => setSavedFlash(0), 1800);
    return () => window.clearTimeout(t);
  }, [savedFlash]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      e.stopPropagation();
      void flushAll().then((ok) => ok && setSavedFlash(Date.now()));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const updateMeta = (patch: Partial<Meta>) => {
    metaRef.current = { ...metaRef.current, ...patch };
    setMeta((m) => ({ ...m, ...patch }));
    queue(`/api/books/${initial.id}`, patch);
  };
  // Anything not encrypted yet (e.g. just created) is encrypted on opening
  useEffect(() => {
    if (!initial.enc) queue(`/api/books/${initial.id}`, {});
    for (const c of initial.chapters) if (!c.enc) queue(`/api/chapters/${c.id}`, {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectChapter = (chId: number) => {
    setActiveId(chId);
    setCursorBlock(0);
    const p = laid?.chapterStarts.get(chId);
    if (p) jump(p, 'start');
  };

  // ---- Find and replace (in every chapter and book) ----
  const [searchOpen, setSearchOpen] = useState(!!fromSearch.q);
  const [findQ, setFindQ] = useState(fromSearch.q);
  const [replaceWith, setReplaceWith] = useState('');
  const [findOpts, setFindOpts] = useState<FindOptions>(fromSearch.opts);
  const [current, setCurrent] = useState(0);
  const navSeq = useRef(fromSearch.q ? 1 : 0);
  const [focusMatch, setFocusMatch] = useState<{ chId: number; index: number; seq: number } | null>(() =>
    fromSearch.q && fromSearch.ch ? { chId: fromSearch.ch, index: 0, seq: 1 } : null,
  );
  const [replacing, setReplacing] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => {
    if (fromSearch.q || fromSearch.ch) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Clicking another button in the toolbar or the top bar (Epigraph, Music…) closes the search.
  // Clicks in the chapter list and in the text keep it open (so the word stays highlighted).
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest || t.closest('.sr-wrap')) return;
      if (t.closest('.st-toolbar button, .st-top button, .st-top a')) setSearchOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [searchOpen]);
  const searching = searchOpen && findQ.trim().length > 0;
  // Counts in this book's chapters (from the live content)
  const bookCounts = useMemo(
    () => deferredChapters.map((c) => ({ id: c.id, title: c.title, count: searching ? countInDoc(c.content, findQ, findOpts) : 0 })),
    [deferredChapters, searching, findQ, findOpts],
  );
  const activeCount = bookCounts.find((c) => c.id === active.id)?.count ?? 0;
  // Other books come from the server (after a pause in typing)
  const [debouncedQ, setDebouncedQ] = useState(findQ);
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(findQ), 300);
    return () => window.clearTimeout(t);
  }, [findQ]);
  const othersQ = useQuery({
    queryKey: ['search', debouncedQ, findOpts],
    // The other books are decrypted and searched in the browser (the server cannot read the text)
    queryFn: async () => ({ books: (await searchBooks(debouncedQ, findOpts, initial.id)) as OtherBook[] }),
    enabled: searchOpen && debouncedQ.trim().length > 0,
    staleTime: 0,
    gcTime: 0,
  });
  const others = (othersQ.data?.books ?? []).filter((b) => b.id !== initial.id);
  // When the word or an option changes, start from the first match
  useEffect(() => setCurrent(0), [findQ, findOpts]);
  const editorSearch = useMemo<SearchState | null>(
    () => (searching ? { q: findQ, opts: findOpts, current } : null),
    [searching, findQ, findOpts, current],
  );
  /** Go to the n-th match in a chapter (switching chapter if needed) and centre it on screen. */
  const goMatch = (chId: number, index: number) => {
    if (chId !== active.id) selectChapter(chId);
    setCurrent(index);
    setFocusMatch({ chId, index, seq: ++navSeq.current });
  };
  const step = (dir: 1 | -1) => {
    if (!bookCounts.some((c) => c.count > 0)) return;
    const n = current + dir;
    if (n >= 0 && n < activeCount) return goMatch(active.id, n);
    // End/start of the chapter: go to the next (or previous) chapter with a match; wraps around at the end
    const len = bookCounts.length;
    const at = bookCounts.findIndex((c) => c.id === active.id);
    for (let k = 1; k <= len; k++) {
      const c = bookCounts[(((at + dir * k) % len) + len) % len]!;
      if (c.count > 0) return goMatch(c.id, dir === 1 ? 0 : c.count - 1);
    }
  };
  /** Replace in the open chapter (can be undone): one match or all of them. */
  const replaceInEditor = (only?: number) => {
    const ed = editorRef.current;
    const ms = ed ? (searchKey.getState(ed.state)?.matches ?? []) : [];
    const list = only === undefined ? ms : ms[only] ? [ms[only]!] : [];
    if (!ed || !list.length) return 0;
    const tr = ed.state.tr;
    for (const m of [...list].reverse()) {
      if (replaceWith) tr.insertText(replaceWith, m.from, m.to);
      else tr.delete(m.from, m.to);
    }
    ed.view.dispatch(tr);
    return list.length;
  };
  const replaceInBook = () => {
    let n = replaceInEditor();
    for (const c of chaptersRef.current) {
      if (c.id === active.id) continue;
      const r = replaceInDoc(c.content, findQ, replaceWith, findOpts);
      if (!r.count) continue;
      updateChapter(c.id, { content: r.doc });
      n += r.count;
    }
    return n;
  };
  const replaced = (n: number, where: string) => toast(n ? `Replaced ${n} ${n === 1 ? 'time' : 'times'} ${where}.` : 'Nothing to replace.');
  const searchPanel = searchOpen ? (
    <SearchPanel
      q={findQ}
      onQ={setFindQ}
      repl={replaceWith}
      onRepl={setReplaceWith}
      opts={findOpts}
      onOpts={setFindOpts}
      current={current}
      activeCount={activeCount}
      bookChapters={bookCounts}
      activeId={active.id}
      others={others}
      othersLoading={othersQ.isFetching}
      busy={replacing}
      onPrev={() => step(-1)}
      onNext={() => step(1)}
      onChapter={(id) => goMatch(id, 0)}
      onOther={async (bookId, chId) => {
        await flush();
        navigate(`/book/${bookId}?find=${encodeURIComponent(findQ)}&ch=${chId}&w=${findOpts.wholeWord ? 1 : 0}&c=${findOpts.matchCase ? 1 : 0}`);
      }}
      onReplaceOne={() => {
        if (replaceInEditor(current)) setFocusMatch({ chId: active.id, index: current, seq: ++navSeq.current });
      }}
      onReplaceChapter={() => replaced(replaceInEditor(), 'in this chapter')}
      onReplaceBook={() => replaced(replaceInBook(), 'in this book')}
      onReplaceAll={async () => {
        const here = bookCounts.reduce((s, c) => s + c.count, 0);
        const there = others.reduce((s, b) => s + b.total, 0);
        const ok = await confirmDialog({
          title: 'Replace in all books?',
          message: `“${findQ}” will become “${replaceWith}” ${here + there} ${here + there === 1 ? 'time' : 'times'}: ${here} in this book and ${there} in ${others.length} other ${others.length === 1 ? 'book' : 'books'}. Changes in other books cannot be undone.`,
          confirmLabel: 'Replace all',
          danger: true,
        });
        if (!ok) return;
        setReplacing(true);
        try {
          const n = replaceInBook();
          await flush();
          const r = await replaceInBooks(findQ, replaceWith, findOpts, initial.id);
          replaced(n + r, 'in all books');
          void othersQ.refetch();
          void qc.invalidateQueries({ queryKey: ['shelf'] });
        } catch (e) {
          toast((e as Error).message);
        } finally {
          setReplacing(false);
        }
      }}
      onClose={() => setSearchOpen(false)}
    />
  ) : null;

  const addChapter = async () => {
    try {
      await flush();
      const fresh = await createChapter(initial.id, `Chapter ${chaptersRef.current.length + 1}`);
      setChapters((cs) => [...cs, { ...fresh, ord: cs.length, content: asDoc(fresh.content) }]);
      setActiveId(fresh.id);
      setCursorBlock(0);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const removeChapter = async (ch: BookChapter) => {
    if (chapters.length <= 1) return toast('A book needs at least one chapter.');
    const ok = await confirmDialog({
      title: 'Delete this chapter?',
      message: `“${ch.title || 'Untitled chapter'}” and all of its text will be deleted. This cannot be undone.`,
      confirmLabel: 'Delete chapter',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      await flush();
      await api.del(`/api/chapters/${ch.id}`);
      const rest = chapters.filter((c) => c.id !== ch.id);
      setChapters(rest);
      if (activeId === ch.id) setActiveId(rest[0]!.id);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const moveChapter = async (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= chapters.length) return;
    const next = [...chapters];
    [next[index], next[j]] = [next[j]!, next[index]!];
    setChapters(next);
    try {
      await api.put(`/api/books/${initial.id}/order`, { ids: next.map((c) => c.id) });
    } catch (e) {
      toast((e as Error).message);
      setChapters(chapters);
    }
  };

  const panels = usePanels();
  const narrow = useNarrow();
  const bodyRef = useRef<HTMLDivElement>(null);
  useFitPanels(panels, bodyRef, !narrow);
  const pageCount = laid?.pages.length ?? 0;
  const words = useMemo(() => countWords(deferredChapters), [deferredChapters]);

  return (
    <div className="st-workspace">
      <header className="st-top">
        <Link to="/" className="btn btn-sm btn-ghost" onClick={() => void flush()}>
          ← Shelf
        </Link>
        <div className="st-book-name" title={meta.title}>
          {meta.title || 'Untitled'}
        </div>
        <span className={`st-save ${status}`}>{STATUS_TEXT[status]}</span>
        {/* The top bar sets up its own positioning context, so this is drawn straight into the page */}
        {savedFlash > 0 &&
          createPortal(
            <div key={savedFlash} className="st-saved-flash" role="status">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
                <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Saved
            </div>,
            document.body,
          )}
        <DictLookup />
        <div className="st-spacer" />
        <div className="st-pagecount" title="Length of the book as it is laid out now (A5)">
          <strong>{pageCount.toLocaleString('en-US')}</strong> {pageCount === 1 ? 'page' : 'pages'}
          <span className="st-pc-sep">·</span>
          <strong>{words.toLocaleString('en-US')}</strong> {words === 1 ? 'word' : 'words'}
        </div>
        {meta.mapUrl && (
          <button type="button" className="btn btn-sm" onClick={() => setMapOpen(true)}>
            Map
          </button>
        )}
        <DownloadMenu bookId={initial.id} beforeExport={flush} />
        <button type="button" className="btn btn-sm" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={async () => {
            await flush();
            navigate(`/book/${initial.id}/read`);
          }}
        >
          Preview
        </button>
      </header>

      <div className="st-body" ref={bodyRef} style={narrow ? undefined : { gridTemplateColumns: gridColumns(panels.state) }}>
        {(narrow || panels.state.leftOpen) && (
        <aside className="st-chapters" aria-label="Chapters">
          <div className="st-chapters-head">Chapters</div>
          <ol>
            {chapters.map((c, i) => (
              <li key={c.id} className={c.id === active.id ? 'active' : ''}>
                <button type="button" className="st-ch-name" onClick={() => selectChapter(c.id)}>
                  <span>{c.title || 'Untitled chapter'}</span>
                  <span className="muted">p. {laid?.chapterStarts.get(c.id) ?? '…'}</span>
                </button>
                <span className="st-ch-tools">
                  <button type="button" title="Move up" disabled={i === 0} onClick={() => void moveChapter(i, -1)}>
                    ↑
                  </button>
                  <button type="button" title="Move down" disabled={i === chapters.length - 1} onClick={() => void moveChapter(i, 1)}>
                    ↓
                  </button>
                  <button type="button" title="Delete chapter" onClick={() => void removeChapter(c)}>
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-sm st-add-ch" onClick={() => void addChapter()}>
            + Add chapter
          </button>
        </aside>
        )}
        {!narrow && <PanelHandle side="left" panels={panels} container={bodyRef} />}

        <section className="st-writer">
          <TitleField value={active.title} onChange={(title) => updateChapter(active.id, { title })} />
          <ChapterEditor
            key={active.id}
            content={active.content as JSONContent}
            onChange={(doc) => updateChapter(active.id, { content: doc })}
            onCursor={setCursorBlock}
            onAddImage={(f) => void addImage(f)}
            onFocus={() => setSelectedImage(null)}
            search={editorSearch}
            focusMatch={focusMatch && focusMatch.chId === active.id ? focusMatch : null}
            onEditor={(ed) => (editorRef.current = ed)}
            toolbarEnd={
              <span className="sr-wrap">
                <button
                  type="button"
                  className={`st-tool sr-tool${searchOpen ? ' on' : ''}`}
                  title="Find and replace in every chapter and book"
                  aria-expanded={searchOpen}
                  onClick={() => setSearchOpen((o) => !o)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                    <circle cx="10.5" cy="10.5" r="6.5" />
                    <path d="M15.5 15.5L21 21" />
                  </svg>
                  Search
                </button>
                {searchPanel}
              </span>
            }
            extra={
              <>
                <MusicButton
                key={`music-${active.id}`}
                url={active.musicUrl}
                from={active.musicFrom}
                to={active.musicTo}
                startPage={laid?.chapterStarts.get(active.id) ?? 0}
                lastPage={laid ? chapterLastPage(laid, active.id) : 0}
                totalPages={laid?.pages.length ?? 0}
                onChange={(patch) => updateChapter(active.id, patch)}
                />
                <EpigraphButton
                  key={`epi-${active.id}`}
                  text={active.epigraph}
                  by={active.epigraphBy}
                  quotes={active.epigraphQuotes}
                  onChange={(patch) => updateChapter(active.id, patch)}
                />
              </>
            }
          />
        </section>

        {!narrow && <PanelHandle side="right" panels={panels} container={bodyRef} />}
        {(narrow || panels.state.rightOpen) && (
        <section className="st-preview" aria-label="Pages">
          {laid ? (
            <PagesView
              pages={laid.pages}
              title={deferredMeta.title}
              author={deferredMeta.author}
              coverUrl={deferredMeta.coverUrl}
              backCoverUrl={deferredMeta.backCoverUrl}
              synopsis={deferredMeta.synopsis}
              current={currentPage}
              target={target}
              onToc={selectChapter}
              overlay={(p, scale) => <ImageLayer page={p} scale={scale} selected={selectedImage} actions={imageRef.current} />}
              onBackground={() => setSelectedImage(null)}
            />
          ) : (
            <Loader label="Hyperfocus" />
          )}
        </section>
        )}
      </div>

      {notebook.notes && (
        <NotesDrawer notes={notebook.notes} onChange={notebook.changeNotes} tabs={notebook.tabs} onTabsChange={notebook.changeTabs} title="Notes" viewKey={NOTEBOOK_VIEW_KEY} status={notebook.status} />
      )}
      {mapOpen && meta.mapUrl && <MapViewer url={meta.mapUrl} onClose={() => setMapOpen(false)} />}
      {settingsOpen && <BookSettings meta={meta} onChange={updateMeta} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/** Chapter text: Garamond, fixed layout; only bold, italic, line break and page break. */
function ChapterEditor({
  content,
  onChange,
  onCursor,
  onAddImage,
  onFocus,
  extra,
  toolbarEnd,
  search,
  focusMatch,
  onEditor,
}: {
  content: JSONContent;
  onChange: (doc: JSONContent) => void;
  onCursor: (block: number) => void;
  onAddImage: (file: File) => void;
  onFocus: () => void;
  /** In the toolbar after the image button (e.g. the music button). */
  extra?: React.ReactNode;
  /** At the right end of the toolbar (the search button). */
  toolbarEnd?: React.ReactNode;
  /** The searched word: highlighted in the chapter. */
  search: SearchState | null;
  /** Go to this match and centre it on screen (seq grows with every jump). */
  focusMatch: { index: number; seq: number } | null;
  onEditor: (editor: Editor | null) => void;
}) {
  const cb = useRef({ onChange, onCursor, onFocus });
  cb.current = { onChange, onCursor, onFocus };
  const editor = useTiptap({
    // Spell check is ours (English); the browser's is off. Nothing ever changes by itself:
    // no formatting rules while typing or pasting (like **bold**), and the browser's autocorrect is off.
    extensions: [...bookExtensions(), SpellCheck, SearchHighlight],
    content,
    immediatelyRender: true,
    shouldRerenderOnTransaction: true,
    enableInputRules: false,
    enablePasteRules: false,
    editorProps: { attributes: { class: 'st-prose', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', autocomplete: 'off' } },
    onUpdate: ({ editor }) => cb.current.onChange(editor.getJSON()),
    onSelectionUpdate: ({ editor }) => cb.current.onCursor(editor.state.selection.$from.index(0)),
    onFocus: () => cb.current.onFocus(),
  });
  const [menu, setMenu] = useState<MenuAt | null>(null);
  // Comments: the box for writing / editing, or a reading card while the caret is in commented text
  const [comment, setComment] = useState<CommentState | null>(null);
  const writingComment = comment !== null && comment.mode !== 'view';
  const writingRef = useRef(writingComment);
  writingRef.current = writingComment;
  useEffect(() => {
    const onSel = () => {
      if (writingRef.current) return;
      const sel = editor.state.selection;
      const c = sel.empty ? commentAt(editor) : null;
      setComment((cur) => (c ? (cur && cur.mode === 'view' && cur.id === c.id && cur.from === c.from && cur.to === c.to ? cur : c) : null));
    };
    editor.on('selectionUpdate', onSel);
    return () => {
      editor.off('selectionUpdate', onSel);
    };
  }, [editor]);
  const openComment = () => {
    const c = startComment(editor);
    if (c) setComment(c);
  };
  // The workspace reaches the editor for replacing
  const editorCb = useRef(onEditor);
  editorCb.current = onEditor;
  useEffect(() => {
    editorCb.current(editor);
    return () => editorCb.current(null);
  }, [editor]);
  // Highlight the searched word (not added to the undo history)
  useEffect(() => {
    if (editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(searchKey, { search }).setMeta('addToHistory', false));
  }, [editor, search]);
  // Centre the match we jumped to
  useEffect(() => {
    if (!focusMatch || editor.isDestroyed) return;
    const el = editor.view.dom.querySelector<HTMLElement>('.sr-hit.cur');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, focusMatch?.seq]);
  return (
    <div
      className="st-editor"
      onKeyDownCapture={(e) => {
        // Ctrl+Alt+M: add / edit a comment (like in Word)
        if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyM') {
          e.preventDefault();
          openComment();
        }
      }}
    >
      <Toolbar editor={editor} onAddImage={onAddImage} extra={extra} end={toolbarEnd} />
      <EditorContent
        editor={editor}
        className="st-editor-area"
        onContextMenu={(e) => {
          // Our own menu (spelling suggestions and editing); Shift + right-click opens the browser's menu
          if (e.shiftKey) return;
          e.preventDefault();
          setMenu(wordAt(editor, e.clientX, e.clientY));
        }}
      />
      {menu && (
        <EditorMenu
          key={`${menu.x},${menu.y}`}
          editor={editor}
          at={menu}
          onClose={() => setMenu(null)}
          onComment={(action) => {
            if (action === 'remove') {
              const c = commentAt(editor);
              if (c) removeComment(editor, c);
              setComment(null);
            } else openComment();
          }}
        />
      )}
      {comment && (
        <CommentBox
          key={`${comment.id}:${comment.mode}`}
          editor={editor}
          state={comment}
          onEdit={() => setComment((c) => (c ? { ...c, mode: 'edit' } : c))}
          onClose={() => setComment(null)}
        />
      )}
    </div>
  );
}

function Toolbar({ editor, onAddImage, extra, end }: { editor: Editor; onAddImage: (file: File) => void; extra?: React.ReactNode; end?: React.ReactNode }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const btn = (label: string, title: string, active: boolean, run: () => void, cls = '') => (
    <button
      type="button"
      className={`st-tool ${cls}${active ? ' on' : ''}`}
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        run();
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="st-toolbar" role="toolbar" aria-label="Formatting">
      {btn('B', 'Bold (Ctrl+B)', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'b')}
      {btn('I', 'Italic (Ctrl+I)', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'i')}
      <span className="st-tool-sep" />
      {btn('Page break', 'Start a new page (Ctrl+Enter)', false, () => editor.chain().focus().setPageBreak().run())}
      {btn('Scene break', 'Mark a change of scene (Ctrl+Shift+Enter)', false, () => editor.chain().focus().setSceneBreak().run())}
      {btn('Image', 'Add an image to the page at the cursor (text flows around a transparent PNG)', false, () => fileRef.current?.click())}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/webp,image/jpeg,image/gif"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onAddImage(f);
        }}
      />
      {extra}
      <span className="st-tool-sep" />
      {btn('↶', 'Undo (Ctrl+Z)', false, () => editor.chain().focus().undo().run())}
      {btn('↷', 'Redo (Ctrl+Y)', false, () => editor.chain().focus().redo().run())}
      {end}
    </div>
  );
}

/** One image field in the book settings: thumbnail, upload / replace, remove and a hint. */
function ImagePick({
  label,
  empty,
  url,
  busy,
  disabled,
  spine,
  onPick,
  onRemove,
  children,
}: {
  label: string;
  empty: string;
  url: string | null;
  busy: boolean;
  disabled: boolean;
  spine?: boolean;
  onPick: (file: File | undefined) => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="st-cover-pick">
        <div className={`st-cover-thumb${spine ? ' spine' : ''}`}>{url ? <img src={url} alt="" /> : <span className="muted small">{empty}</span>}</div>
        <div className="st-cover-actions">
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => ref.current?.click()}>
            {busy ? 'Uploading…' : url ? 'Replace' : 'Upload image'}
          </button>
          {url && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onRemove}>
              Remove
            </button>
          )}
          <p className="muted small">{children}</p>
        </div>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            onPick(f);
          }}
        />
      </div>
    </div>
  );
}

function BookSettings({ meta, onChange, onClose }: { meta: Meta; onChange: (p: Partial<Meta>) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState<ImageField | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<HTMLInputElement>(null);
  const [mapOpen, setMapOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.map-viewer') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Cover, back cover, spine or map image. The map stays larger so it can be detailed. */
  const pick = async (field: ImageField, file: File | undefined) => {
    if (!file) return;
    setUploading(field);
    try {
      const up = await uploadImageSecure(file, field === 'mapUrl' ? 4096 : COVER_PX.h, PRINT_QUALITY);
      onChange({ [field]: up.url });
      // Warn if a cover is low resolution (it would print blurry)
      if ((field === 'coverUrl' || field === 'backCoverUrl') && (up.width < COVER_MIN.w || up.height < COVER_MIN.h))
        toast(`This ${field === 'coverUrl' ? 'cover' : 'back cover'} is ${up.width} × ${up.height} px. For a sharp print use at least ${COVER_MIN.w} × ${COVER_MIN.h} px (ideally ${COVER_PX.w} × ${COVER_PX.h}).`);
      void qc.invalidateQueries({ queryKey: STORAGE_KEY });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = '';
      if (mapRef.current) mapRef.current.value = '';
    }
  };

  return (
    <div className="st-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="st-drawer" role="dialog" aria-label="Settings">
        <div className="st-drawer-head">
          <h2>Settings</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <label className="field">
          <span>Title</span>
          <input className="input" value={meta.title} maxLength={200} onChange={(e) => onChange({ title: e.target.value })} />
        </label>
        <label className="field">
          <span>Author</span>
          <input className="input" value={meta.author} maxLength={120} onChange={(e) => onChange({ author: e.target.value })} />
        </label>
        <label className="field">
          <span>Back cover text</span>
          <textarea className="textarea" rows={6} value={meta.synopsis} maxLength={2000} onChange={(e) => onChange({ synopsis: e.target.value })} />
          <small className="muted">Shown on the back cover with the title and author, when there is no back cover image.</small>
        </label>
        <div className="field">
          <span>Cover image</span>
          <div className="st-cover-pick">
            <div className="st-cover-thumb">{meta.coverUrl ? <img src={meta.coverUrl} alt="" /> : <span className="muted small">Text cover</span>}</div>
            <div className="st-cover-actions">
              <button type="button" className="btn btn-sm" disabled={!!uploading} onClick={() => fileRef.current?.click()}>
                {uploading === 'coverUrl' ? 'Uploading…' : meta.coverUrl ? 'Replace' : 'Upload image'}
              </button>
              {meta.coverUrl && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange({ coverUrl: null })}>
                  Remove
                </button>
              )}
              <p className="muted small">
                Fills the whole cover. Recommended: <strong>{COVER_PX.w} × {COVER_PX.h} px</strong> (A5 at 300 dpi, ratio 148 : 210). At least {COVER_MIN.w} × {COVER_MIN.h} px.
              </p>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pick('coverUrl', e.target.files?.[0])} />
          </div>
        </div>
        <ImagePick
          label="Back cover image"
          empty="Text back"
          url={meta.backCoverUrl}
          busy={uploading === 'backCoverUrl'}
          disabled={!!uploading}
          onPick={(f) => void pick('backCoverUrl', f)}
          onRemove={() => onChange({ backCoverUrl: null })}
        >
          Fills the whole back cover, the same size as the front. Without an image, the back shows the title, the back cover text and the author.
        </ImagePick>
        <ImagePick
          label="Spine image"
          empty="Text spine"
          spine
          url={meta.spineUrl}
          busy={uploading === 'spineUrl'}
          disabled={!!uploading}
          onPick={(f) => void pick('spineUrl', f)}
          onRemove={() => onChange({ spineUrl: null })}
        >
          A tall, narrow strip shown on the spine of the 3D book (a wide image is turned to read top to bottom). Without an image, the spine shows the title and author.
        </ImagePick>
        <div className="field">
          <span>Map</span>
          <div className="st-cover-pick">
            <button type="button" className="st-map-thumb" disabled={!meta.mapUrl} onClick={() => setMapOpen(true)} title="Open the map">
              {meta.mapUrl ? <img src={meta.mapUrl} alt="" /> : <span className="muted small">No map</span>}
            </button>
            <div className="st-cover-actions">
              <button type="button" className="btn btn-sm" disabled={!!uploading} onClick={() => mapRef.current?.click()}>
                {uploading === 'mapUrl' ? 'Uploading…' : meta.mapUrl ? 'Replace' : 'Upload map'}
              </button>
              {meta.mapUrl && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange({ mapUrl: null })}>
                  Remove
                </button>
              )}
              <p className="muted small">Your own hand-drawn map. Opens full screen with one click while reading; you can zoom in.</p>
            </div>
            <input ref={mapRef} type="file" accept="image/*" hidden onChange={(e) => void pick('mapUrl', e.target.files?.[0])} />
          </div>
        </div>
        {mapOpen && meta.mapUrl && <MapViewer url={meta.mapUrl} onClose={() => setMapOpen(false)} />}
      </aside>
    </div>
  );
}
