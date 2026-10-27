import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageFlip } from "page-flip/dist/js/page-flip.module.js";
import type { BookFull } from "@hyperfocus/shared";
import { getBook } from "./secure";
import { Loader } from "../ui/logo/Logo";
import {
  A5,
  blocksFromDoc,
  epigraphOf,
  layoutBook,
  layoutPhoneBook,
  loadBookFonts,
  phoneGeometry,
  type BookInput,
  type Geometry,
  type LaidPage,
} from "./layout";
import { PageView } from "./PageView";
import { shapeOf, useShapes } from "./shapes";
import { MapViewer } from "./MapViewer";
import { LoadingScreen, useEntryLoader } from "./LoadingScreen";
import { useChapterMusic } from "./useChapterMusic";
import { activeMusic, musicSpans } from "./musicRange";

// three.js loads only when the closed book is shown.
const Book3D = lazy(() => import("./Book3D"));

type Device = "book" | "phone";
type ReaderPage =
  { kind: "laid"; page: LaidPage } | { kind: "back" } | { kind: "filler" };
interface Size {
  pw: number;
  ph: number;
}
/** Page navigation used by the ‹ › buttons in the top bar (page-curl book or scrolling view). */
interface PageNav {
  flipNext(): void;
  flipPrev(): void;
  flip(page: number): void;
}

const NARROW = 700; // the phone edition on screens narrower than this

/** Reading preview: the book fills the screen and pages turn with a curl; on a phone, the phone edition. */
export function Reader() {
  const id = Number(useParams().id);
  const q = useQuery({
    queryKey: ["read", id],
    queryFn: () => getBook(id).then((book) => ({ book })),
    staleTime: 0,
  });
  const [ready, setReady] = useState(false);
  const loading = useEntryLoader(ready || q.isError);
  return (
    <>
      <LoadingScreen show={loading} />
      {q.isError && (
        <p className="empty-state">
          Could not open the book. <Link to="/">Back to shelf</Link>
        </p>
      )}
      {q.data && <ReaderView book={q.data.book} onReady={() => setReady(true)} />}
    </>
  );
}

/** Where the reader is right now: chapter, top-bar text and visible page numbers. */
interface ViewInfo {
  chapterId?: number;
  label: string;
  pages?: number[];
}

function ReaderView({ book, onReady }: { book: BookFull; onReady: () => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [device, setDevice] = useState<Device>("book");
  const [musicOn, setMusicOn] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const [shapesWaited, setShapesWaited] = useState(false);
  const [view, setView] = useState<ViewInfo>({
    label: "",
  });
  // The preview starts with the closed (3D) book; opening it turns the pages.
  const [closed, setClosed] = useState(true);
  const flipApi = useRef<PageNav | null>(null);

  const urls = useMemo(
    () => book.chapters.flatMap((c) => c.images.map((i) => i.url)),
    [book],
  );
  const shapesVersion = useShapes(urls);
  const shapesReady = shapesWaited || urls.every((u) => shapeOf(u));

  useEffect(() => {
    let alive = true;
    loadBookFonts().finally(() => alive && setFontsReady(true));
    const t = window.setTimeout(() => setShapesWaited(true), 4000); // an image whose shape does not arrive behaves like a box
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current!;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // A real phone (touch, small screen): turned sideways it keeps the phone edition (scrolling without animation).
  const isPhone = useMemo(
    () => window.matchMedia?.("(pointer: coarse)").matches && Math.min(window.screen.width, window.screen.height) < 600,
    [],
  );
  const narrowScreen = stage.w > 0 && stage.w < NARROW;
  const phonePreview = device === "phone" && !narrowScreen && !isPhone;
  const phoneEdition = narrowScreen || phonePreview || isPhone;

  // Landscape: in the preview the phone frame turns sideways; on a real phone the screen is locked to landscape
  // (iPhone does not allow the lock, so there the page is rotated 90°).
  const [landscape, setLandscape] = useState(false);
  const [cssRotate, setCssRotate] = useState(false);
  const realLandscape = cssRotate || (isPhone && stage.w > stage.h);
  const isLandscape = phonePreview ? landscape : realLandscape;
  const toggleLandscape = async () => {
    const next = !isLandscape;
    if (phonePreview) {
      setLandscape(next);
      return;
    }
    const o = window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };
    try {
      if (next) {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
        if (!o?.lock) throw new Error("no lock");
        await o.lock("landscape");
      } else {
        o?.unlock?.();
        if (document.fullscreenElement) await document.exitFullscreen();
      }
      setCssRotate(false);
    } catch {
      setCssRotate(next);
    }
    setLandscape(next);
  };
  // When the phone is really turned sideways, no CSS rotation is needed
  useEffect(() => {
    if (!cssRotate) return;
    const onTurn = () => {
      if (window.innerWidth > window.innerHeight) setCssRotate(false);
    };
    window.addEventListener("resize", onTurn);
    return () => window.removeEventListener("resize", onTurn);
  }, [cssRotate]);

  const frame = useMemo(() => {
    if (landscape) {
      let w = Math.max(400, Math.min(stage.w - 40, 844));
      let h = Math.round(w * (390 / 844));
      if (h > stage.h - 24) {
        h = Math.max(200, stage.h - 24);
        w = Math.round(h * (844 / 390));
      }
      return { w, h };
    }
    const h = Math.max(300, Math.min(stage.h - 24, 844));
    return { w: Math.round(h * (390 / 844)), h };
  }, [stage.h, stage.w, landscape]);

  // The area a page covers in the phone edition (the phone frame's screen or the real screen).
  const area = phonePreview
    ? landscape
      ? { w: frame.w - 92, h: frame.h - 20 }
      : { w: frame.w - 20, h: frame.h - 92 }
    : { w: stage.w - 12, h: stage.h - 12 };
  const aspect =
    phoneEdition && area.w > 0 ? Math.round((area.h / area.w) * 20) / 20 : 0;
  // In landscape the page is laid out with a wider unit: text stays ~16 px on a phone and lines do not get too long.
  const unitsW =
    phoneEdition && area.w > area.h ? Math.max(559, Math.min(1100, Math.round(area.w / 0.66 / 10) * 10)) : 559;
  const geo: Geometry = useMemo(
    () => (phoneEdition ? phoneGeometry(aspect, unitsW) : A5),
    [phoneEdition, aspect, unitsW],
  );

  const input: BookInput = useMemo(
    () => ({
      title: book.title,
      author: book.author,
      coverUrl: book.coverUrl,
      chapters: book.chapters.map((c) => ({
        id: c.id,
        title: c.title,
        blocks: blocksFromDoc(c.content),
        images: c.images,
        epigraph: epigraphOf(c),
      })),
    }),
    [book],
  );
  const laid = useMemo(() => {
    if (!fontsReady || !shapesReady || !stage.w) return null;
    return geo.printed
      ? layoutBook(input, shapeOf, geo)
      : layoutPhoneBook(input, shapeOf, geo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsReady, shapesReady, input, geo, shapesVersion, stage.w > 0]);

  // The loading screen goes once the book is laid out and (when closed) the 3D book is ready to draw
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const [book3dReady, setBook3dReady] = useState(false);
  useEffect(() => {
    if (laid && (!closed || book3dReady)) readyRef.current();
  }, [laid, closed, book3dReady]);

  // The page count must be even so the back cover stands alone (a blank page in between if needed).
  const pages = useMemo<ReaderPage[]>(() => {
    if (!laid) return [];
    const out: ReaderPage[] = laid.pages.map((page) => ({
      kind: "laid",
      page,
    }));
    if (geo.printed && (out.length + 1) % 2 === 1) out.push({ kind: "filler" });
    out.push({ kind: "back" });
    return out;
  }, [laid, geo.printed]);

  const portrait = phoneEdition || stage.w / Math.max(1, stage.h) < 1.05;
  const size: Size | null = useMemo(() => {
    if (!stage.w) return null;
    const ratio = geo.w / geo.h;
    let pw: number;
    if (phoneEdition) pw = Math.min(area.w, area.h * ratio);
    else if (portrait) pw = Math.min(stage.w - 20, (stage.h - 20) * ratio);
    else pw = Math.min((stage.w - 48) / 2, (stage.h - 28) * ratio);
    pw = Math.floor(pw);
    return { pw, ph: Math.floor(pw / ratio) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, geo, phoneEdition, portrait, area.w, area.h]);

  // A5 layout: thickness and music ranges follow it (the phone edition is laid out separately).
  const a5Laid = useMemo(() => {
    if (!laid) return null;
    return laid.geo.printed ? laid : layoutBook(input, shapeOf, A5);
  }, [laid, input]);
  const a5Pages = a5Laid?.pages.length ?? 0;

  // Music: fades in when its first page opens, fades out when leaving the range.
  // On desktop, in a two-page spread, it plays if either page is in the range.
  const spans = useMemo(
    () =>
      laid && a5Laid
        ? musicSpans(book.chapters, laid, a5Laid, input.chapters.map((c) => ({ id: c.id, blockCount: c.blocks.length })))
        : [],
    [book.chapters, laid, a5Laid, input],
  );
  useChapterMusic(closed ? null : activeMusic(spans, view.pages ?? []), musicOn);
  const hasMusic = book.chapters.some((c) => c.musicUrl);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className={`rd-root${phoneEdition ? " rd-flat" : ""}${cssRotate ? " rd-rotated" : ""}`}>
      <header className="rd-bar">
        <div className="rd-left">
        <Link to={`/book/${book.id}`} className="rd-btn" title="Back to writing">
          ←<span className="rd-long"> Back to writing</span>
        </Link>
        <div className="rd-title">{book.title}</div>
        </div>
        {/* The page buttons in the middle: they stay put even when the buttons left/right change (three-column grid) */}
        <div className="rd-center">
        {closed ? (
          <button
            type="button"
            className="rd-btn on"
            onClick={() => setClosed(false)}
          >
            Open book
          </button>
        ) : (
          <>
            <button
              type="button"
              className="rd-btn rd-arrow"
              onClick={() => flipApi.current?.flipPrev()}
              aria-label="Previous page"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <span className="rd-pages">{view.label}</span>
            <button
              type="button"
              className="rd-btn rd-arrow"
              onClick={() => flipApi.current?.flipNext()}
              aria-label="Next page"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 5l7 7-7 7" /></svg>
            </button>
            <button
              type="button"
              className="rd-btn"
              onClick={() => setClosed(true)}
              title="Close the book (3D)"
            >
              Close
            </button>
          </>
        )}
        </div>
        <div className="rd-right">
        {hasMusic && (
          <button
            type="button"
            className={`rd-btn${musicOn ? " on" : ""}`}
            onClick={() => setMusicOn((m) => !m)}
            title={musicOn ? "Turn music off" : "Play chapter music"}
          >
            ♪
            <span className="rd-long">
              {" "}
              {musicOn ? "Music on" : "Play music"}
            </span>
          </button>
        )}
        {book.mapUrl && (
          <button
            type="button"
            className="rd-btn"
            onClick={() => setMapOpen(true)}
          >
            Map
          </button>
        )}
        {phoneEdition && !closed && (
          <button
            type="button"
            className={`rd-btn${isLandscape ? " on" : ""}`}
            onClick={() => void toggleLandscape()}
            title={isLandscape ? "Back to portrait" : "Turn to landscape"}
            aria-pressed={isLandscape}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x={isLandscape ? 7 : 3} y={isLandscape ? 3 : 7} width={isLandscape ? 10 : 18} height={isLandscape ? 18 : 10} rx="2" />
              <path d="M20 4a6 6 0 0 0-5-2M15 2l1.5 2.5L14 5" />
            </svg>
            <span className="rd-long">{isLandscape ? " Portrait" : " Landscape"}</span>
          </button>
        )}
        {!narrowScreen && !isPhone && !closed && (
          <div className="rd-seg" role="group" aria-label="Preview">
            <button
              type="button"
              className={device === "book" ? "on" : ""}
              onClick={() => setDevice("book")}
            >
              Desktop
            </button>
            <button
              type="button"
              className={device === "phone" ? "on" : ""}
              onClick={() => setDevice("phone")}
            >
              Phone
            </button>
          </div>
        )}
        {!narrowScreen && !isPhone && (
          <button
            type="button"
            className="rd-btn"
            onClick={fullscreen}
            title="Full screen"
          >
            ⛶
          </button>
        )}
        </div>
      </header>

      <div className="rd-stage" ref={stageRef}>
        {closed && (
          <Suspense fallback={<Loader label="Hyperfocus" />}>
            {laid ? (
              <Book3D
                title={book.title}
                author={book.author}
                synopsis={book.synopsis}
                coverUrl={book.coverUrl}
                backCoverUrl={book.backCoverUrl}
                spineUrl={book.spineUrl}
                pageCount={Math.max(a5Pages, book.pageCapacity)}
                written={a5Pages}
                onOpen={() => setClosed(false)}
                onReady={() => setBook3dReady(true)}
              />
            ) : (
              <Loader label="Hyperfocus" />
            )}
          </Suspense>
        )}
        {!closed && (
          <div
            className={phonePreview ? `rd-phone${landscape ? " land" : ""}` : "rd-desk"}
            style={
              phonePreview ? { width: frame.w, height: frame.h } : undefined
            }
          >
            {phonePreview && <div className="rd-phone-notch" aria-hidden />}
            {size && pages.length > 0 && laid && phoneEdition && (
              <ScrollBook
                key={`${geo.w}x${geo.h}`}
                book={book}
                pages={pages}
                chapterStarts={laid.chapterStarts}
                geo={geo}
                size={size}
                nav={flipApi}
                onView={setView}
                startChapter={view.chapterId}
              />
            )}
            {size && pages.length > 0 && laid && !phoneEdition && (
              <Flipbook
                book={book}
                pages={pages}
                chapterStarts={laid.chapterStarts}
                geo={geo}
                size={size}
                portrait={portrait}
                flipApi={flipApi}
                onView={setView}
              />
            )}
          </div>
        )}
      </div>

      {mapOpen && book.mapUrl && (
        <MapViewer url={book.mapUrl} onClose={() => setMapOpen(false)} />
      )}
    </div>
  );
}

function Flipbook({
  book,
  pages,
  chapterStarts,
  geo,
  size,
  portrait,
  flipApi,
  onView,
}: {
  book: BookFull;
  pages: ReaderPage[];
  chapterStarts: Map<number, number>;
  geo: Geometry;
  size: Size;
  portrait: boolean;
  flipApi: React.MutableRefObject<PageNav | null>;
  onView: (v: ViewInfo) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef(0);
  const chapterRef = useRef<number | undefined>(undefined);
  const pagesRef = useRef(pages);
  const [current, setCurrent] = useState(0);
  const scale = size.pw / geo.w;

  // Build the book: copies of the pages React drew are given to the page-turn library (it manages that DOM).
  useEffect(() => {
    if (!hostRef.current || !templateRef.current) return;
    // If the edition changed (book ↔ phone), continue from the start of the same chapter.
    if (pagesRef.current !== pages) {
      pagesRef.current = pages;
      const start =
        chapterRef.current !== undefined
          ? chapterStarts.get(chapterRef.current)
          : undefined;
      currentRef.current = start
        ? start - 1
        : Math.min(currentRef.current, pages.length - 1);
    }
    const block = document.createElement("div");
    block.className = "rd-block";
    block.style.width = `${portrait ? size.pw : size.pw * 2}px`;
    block.style.height = `${size.ph}px`;
    hostRef.current.appendChild(block);
    const items = [...templateRef.current.children].map(
      (n) => n.cloneNode(true) as HTMLElement,
    );
    const pf = new PageFlip(block, {
      width: size.pw,
      height: size.ph,
      size: "fixed",
      autoSize: false,
      usePortrait: portrait,
      showCover: true,
      startPage: Math.max(0, Math.min(currentRef.current, items.length - 1)),
      flippingTime: 850,
      maxShadowOpacity: 0.45,
      mobileScrollSupport: false,
      showPageCorners: true,
    });
    pf.loadFromHTML(items);
    pf.on("flip", (e) => {
      currentRef.current = e.data;
      setCurrent(e.data);
    });
    setCurrent(pf.getCurrentPageIndex());
    flipApi.current = pf;
    return () => {
      flipApi.current = null;
      pf.destroy();
      block.remove();
    };
  }, [size, portrait, pages, chapterStarts, flipApi]);

  // Contents: go to the chapter
  useEffect(() => {
    const host = hostRef.current!;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>("a.bk-toc");
      if (!a) return;
      e.preventDefault();
      const start = chapterStarts.get(Number(a.dataset.chapter));
      if (start) flipApi.current?.flip(start - 1);
    };
    host.addEventListener("click", onClick);
    return () => host.removeEventListener("click", onClick);
  }, [chapterStarts, flipApi]);

  // Keyboard: arrows turn the page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".map-viewer")) return;
      const pf = flipApi.current;
      if (!pf) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ")
        pf.flipNext();
      else if (e.key === "ArrowLeft" || e.key === "PageUp") pf.flipPrev();
      else if (e.key === "Home") pf.flip(0);
      else if (e.key === "End") pf.flip(pages.length - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages.length, flipApi]);

  // The visible page(s), the current chapter and the page text
  useEffect(() => {
    const visible =
      portrait || current === 0
        ? [current]
        : [current, current + 1].filter((i) => i < pages.length);
    const laidOf = (i: number) => {
      const p = pages[i];
      return p?.kind === "laid" ? p.page : null;
    };
    const chapterId = [...visible]
      .reverse()
      .map((i) => laidOf(i)?.chapterId)
      .find((c) => c !== undefined);
    chapterRef.current = chapterId;
    const shown = visible.map((i) => laidOf(i)?.n).filter((n): n is number => n !== undefined);
    const total = pages.filter((p) => p.kind === "laid").length;
    let label: string;
    if (pages[visible[visible.length - 1]!]?.kind === "back")
      label = "Back cover";
    else if (visible[0] === 0) label = "Cover";
    else {
      const ns = visible
        .map((i) => laidOf(i)?.n)
        .filter((n): n is number => n !== undefined);
      label = ns.length ? `${ns.join("–")} / ${total}` : "";
    }
    onView({ chapterId, label, pages: shown });
  }, [current, pages, portrait, onView]);

  return (
    <>
      <div className="rd-host" ref={hostRef} />
      {/* Source of the pages (invisible): its copies are the ones turned. */}
      <div ref={templateRef} className="rd-template" aria-hidden>
        {pages.map((p, i) => (
          <div
            key={i}
            className="rd-page"
            data-density={i === 0 || p.kind === "back" ? "hard" : "soft"}
          >
            <div className="rd-scale" style={{ transform: `scale(${scale})` }}>
              {p.kind === "laid" ? (
                <PageView
                  page={p.page}
                  title={book.title}
                  author={book.author}
                  coverUrl={book.coverUrl}
                  geo={geo}
                />
              ) : p.kind === "back" ? (
                <BackCover book={book} geo={geo} />
              ) : (
                <div
                  className="bk-page bk-blank"
                  style={{ width: geo.w, height: geo.h }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

const SCROLL_GAP = 12;
const SCROLL_PAD = 8;

/**
 * Reading on a phone: pages without animation, one under another; scroll up/down with a finger.
 * Only pages near the screen are drawn. ‹ › and the arrow keys go one page forward/back.
 */
function ScrollBook({
  book,
  pages,
  chapterStarts,
  geo,
  size,
  nav,
  onView,
  startChapter,
}: {
  book: BookFull;
  pages: ReaderPage[];
  chapterStarts: Map<number, number>;
  geo: Geometry;
  size: Size;
  nav: React.MutableRefObject<PageNav | null>;
  onView: (v: ViewInfo) => void;
  startChapter?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const currentRef = useRef(0);
  const scale = size.pw / geo.w;
  const step = size.ph + SCROLL_GAP;
  const [start] = useState(startChapter);

  const goTo = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(pages.length - 1, i));
    el.scrollTo({ top: SCROLL_PAD + idx * step, behavior: "auto" });
  };

  // While scrolling, the current page (the one in the top third of the screen)
  useEffect(() => {
    const el = ref.current!;
    const update = () => {
      const i = Math.max(0, Math.min(pages.length - 1, Math.floor((el.scrollTop + el.clientHeight * 0.35 - SCROLL_PAD) / step)));
      if (i !== currentRef.current) {
        currentRef.current = i;
        setCurrent(i);
      }
    };
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [pages.length, step]);

  // Coming from the book view, continue from the same chapter
  useLayoutEffect(() => {
    const s = start !== undefined ? chapterStarts.get(start) : undefined;
    if (s) goTo(s - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Top-bar buttons and keyboard
  useEffect(() => {
    nav.current = {
      flipNext: () => goTo(currentRef.current + 1),
      flipPrev: () => goTo(currentRef.current - 1),
      flip: (i) => goTo(i),
    };
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".map-viewer")) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "PageDown") goTo(currentRef.current + 1);
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "PageUp") goTo(currentRef.current - 1);
      else if (e.key === "Home") goTo(0);
      else if (e.key === "End") goTo(pages.length - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      nav.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length, step]);

  // Contents: go to the chapter
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("a.bk-toc");
    if (!a) return;
    e.preventDefault();
    const s = chapterStarts.get(Number(a.dataset.chapter));
    if (s) goTo(s - 1);
  };

  // The current chapter (music) and page text
  useEffect(() => {
    const p = pages[current];
    const total = pages.filter((x) => x.kind === "laid").length;
    const chapterId = p?.kind === "laid" ? p.page.chapterId : undefined;
    const label = p?.kind === "back" ? "Back cover" : current === 0 ? "Cover" : p?.kind === "laid" ? `${p.page.n} / ${total}` : "";
    onView({ chapterId, label, pages: p?.kind === "laid" ? [p.page.n] : [] });
  }, [current, pages, onView]);

  return (
    <div className="rd-scroll" ref={ref} onClick={onClick}>
      <div className="rd-scroll-col" style={{ paddingTop: SCROLL_PAD, gap: SCROLL_GAP }}>
        {pages.map((p, i) => (
          <div key={i} className="rd-spage" style={{ width: size.pw, height: size.ph }}>
            {Math.abs(i - current) <= 3 && (
              <div className="rd-scale" style={{ transform: `scale(${scale})` }}>
                {p.kind === "laid" ? (
                  <PageView page={p.page} title={book.title} author={book.author} coverUrl={book.coverUrl} geo={geo} onToc={(id) => {
                    const s = chapterStarts.get(id);
                    if (s) goTo(s - 1);
                  }} />
                ) : p.kind === "back" ? (
                  <BackCover book={book} geo={geo} />
                ) : (
                  <div className="bk-page bk-blank" style={{ width: geo.w, height: geo.h }} />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Back cover: its own image, or the book's title, the blurb and the author. */
function BackCover({ book, geo }: { book: BookFull; geo: Geometry }) {
  if (book.backCoverUrl)
    return (
      <div className="bk-page bk-back" style={{ width: geo.w, height: geo.h }}>
        <img className="bk-cover-img" src={book.backCoverUrl} alt="" draggable={false} />
      </div>
    );
  return (
    <div className="bk-page bk-back" style={{ width: geo.w, height: geo.h }}>
      <div className="bk-back-inner">
        <div className="bk-back-title">{book.title}</div>
        <div className="bk-cover-rule" />
        {book.synopsis && <p className="bk-back-synopsis">{book.synopsis}</p>}
        <div className="bk-back-author">{book.author}</div>
      </div>
    </div>
  );
}
