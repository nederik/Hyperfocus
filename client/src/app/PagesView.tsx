import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PAGE_H, PAGE_W, type LaidPage } from './layout';
import { PageView } from './PageView';

export interface ScrollTarget {
  page: number;
  /** 'start': jump to the chapter; 'nearest': follow the cursor (scroll only if it is not visible). */
  mode: 'start' | 'nearest';
  seq: number;
}

/**
 * Live pages: two facing pages (even on the left, odd on the right) if there is room, otherwise one column.
 * Only the visible pages are drawn, so writing stays smooth even in a 500-page book.
 */
export function PagesView({
  pages,
  title,
  author,
  coverUrl,
  backCoverUrl = null,
  synopsis = '',
  current,
  target,
  onToc,
  overlay,
  onBackground,
}: {
  pages: LaidPage[];
  title: string;
  author: string;
  coverUrl: string | null;
  backCoverUrl?: string | null;
  /** Back cover text. */
  synopsis?: string;
  current: number | null;
  target: ScrollTarget | null;
  onToc: (chapterId: number) => void;
  /** Editing layer drawn on top of the page (images). */
  overlay?: (page: LaidPage, scale: number) => ReactNode;
  /** When an empty spot on the page is pressed (to drop the selection). */
  onBackground?: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = scroller.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const GAP = 28;
  const spreadScale = Math.min(1, (width - 40) / (2 * PAGE_W));
  const spreads = spreadScale >= 0.5;
  const scale = spreads ? spreadScale : Math.max(0.3, Math.min(1, (width - 32) / PAGE_W));
  const pw = Math.round(PAGE_W * scale);
  const ph = Math.round(PAGE_H * scale);

  // The back cover at the end of the book (as in the preview): a blank page in between if needed, so the back cover is on a left-hand page
  const all = useMemo(() => {
    if (!pages.length) return pages;
    const extra: LaidPage[] = [];
    let n = pages.length;
    const add = (kind: 'blank' | 'back') => {
      n++;
      extra.push({ n, kind, showNumber: false, lines: [], recto: n % 2 === 1 });
    };
    if ((pages.length + 1) % 2 === 1) add('blank');
    add('back');
    return [...pages, ...extra];
  }, [pages]);

  const rows = useMemo(() => {
    if (!spreads) return all.map((p) => [p]);
    const out: LaidPage[][] = [];
    if (all[0]) out.push([all[0]]);
    for (let i = 1; i < all.length; i += 2) out.push(all.slice(i, i + 2));
    return out;
  }, [all, spreads]);

  // Visible rows: since row heights are known, they are computed from the scroll position (with a margin above and below).
  const ROW_GAP = 26;
  const PAD_TOP = 24;
  const MARGIN = 1200;
  const [span, setSpan] = useState<[number, number]>([0, 4]);
  useEffect(() => {
    const root = scroller.current!;
    const update = () => {
      const step = ph + ROW_GAP;
      const a = Math.max(0, Math.floor((root.scrollTop - MARGIN - PAD_TOP) / step));
      const b = Math.ceil((root.scrollTop + root.clientHeight + MARGIN - PAD_TOP) / step);
      setSpan((prev) => (prev[0] === a && prev[1] === b ? prev : [a, b]));
    };
    update();
    root.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      root.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [ph]);
  const visible = useMemo(() => {
    const set = new Set<number>();
    rows.slice(span[0], span[1] + 1).forEach((row) => row.forEach((p) => set.add(p.n)));
    return set;
  }, [rows, span]);

  // Jump to a chapter / follow the cursor
  useEffect(() => {
    if (!target) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${target.page}"]`);
    if (!el) return;
    const root = scroller.current!;
    const r = el.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    if (target.mode === 'nearest' && r.top >= rr.top - 4 && r.bottom <= rr.bottom + 4) return;
    root.scrollTo({ top: root.scrollTop + r.top - rr.top - 16, behavior: target.mode === 'start' ? 'smooth' : 'auto' });
  }, [target]);

  return (
    <div className="st-pages" ref={scroller} onPointerDown={onBackground}>
      {width > 0 &&
        rows.map((row) => (
          <div
            key={row[0]!.n}
            className={`st-row${spreads ? ' spread' : ''}`}
            data-pages={row.map((p) => p.n).join(',')}
            style={{ gap: spreads ? 0 : GAP, height: ph, justifyContent: spreads && row.length === 1 ? (row[0]!.recto ? 'flex-end' : 'flex-start') : 'center', width: spreads ? pw * 2 : pw }}
          >
            {row.map((p) => (
              <div key={p.n} className={`st-cell${p.n === current ? ' current' : ''}`} data-page={p.n} style={{ width: pw, height: ph }}>
                {visible.has(p.n) ? (
                  <div className="st-scale" style={{ transform: `scale(${scale})` }}>
                    <PageView page={p} title={title} author={author} coverUrl={coverUrl} backCoverUrl={backCoverUrl} synopsis={synopsis} onToc={onToc} />
                    {overlay?.(p, scale)}
                  </div>
                ) : (
                  <div className="st-placeholder" />
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
