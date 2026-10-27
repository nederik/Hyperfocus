import type { BookImage } from '@hyperfocus/shared';
import { CONTENT_W, PAGE_H, PAGE_W, pageLeft, type LaidPage } from './layout';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
const SNAP = 6;

export interface ImageActions {
  select: (id: string | null) => void;
  change: (chapterId: number, id: string, patch: Partial<BookImage>) => void;
  remove: (chapterId: number, id: string) => void;
  shiftPage: (chapterId: number, id: string, dir: -1 | 1) => void;
}

/** Snaps a value to nearby guide lines (page edge, text area edge, centre). */
function snap(v: number, size: number, lines: number[]) {
  for (const l of lines) {
    if (Math.abs(v - l) < SNAP) return l;
    if (Math.abs(v + size - l) < SNAP) return l - size;
    if (Math.abs(v + size / 2 - l) < SNAP) return l - size / 2;
  }
  return v;
}

/**
 * The layer for placing images on a page by hand (in page pixels, inside the scaled page).
 * Click an image: select. Drag: move. Corners: resize keeping the proportions.
 */
export function ImageLayer({ page, scale, selected, actions }: { page: LaidPage; scale: number; selected: string | null; actions: ImageActions }) {
  const chapterId = page.chapterId;
  if (chapterId === undefined || !page.images?.length) return null;

  const begin = (e: React.PointerEvent, im: BookImage, mode: 'move' | Corner) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    actions.select(im.id);
    if (im.full) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const o = { ...im };
    const ratio = o.h / o.w;
    const left = pageLeft(page.n);
    const xs = [0, PAGE_W, left, left + CONTENT_W, PAGE_W / 2];
    const ys = [0, PAGE_H, PAGE_H / 2];
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale;
      const dy = (ev.clientY - sy) / scale;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      moved = true;
      if (mode === 'move') {
        const x = Math.max(-o.w + 40, Math.min(PAGE_W - 40, snap(o.x + dx, o.w, xs)));
        const y = Math.max(-o.h + 40, Math.min(PAGE_H - 40, snap(o.y + dy, o.h, ys)));
        actions.change(chapterId, im.id, { x: Math.round(x), y: Math.round(y) });
      } else {
        const east = mode === 'ne' || mode === 'se';
        const north = mode === 'nw' || mode === 'ne';
        // The direction pulled furthest along the corner's diagonal sets the size; proportions are kept.
        const byX = (east ? dx : -dx);
        const byY = (north ? -dy : dy) / ratio;
        const w = Math.max(40, Math.min(PAGE_W * 1.5, o.w + (Math.abs(byX) > Math.abs(byY) ? byX : byY)));
        const h = w * ratio;
        actions.change(chapterId, im.id, {
          w: Math.round(w),
          h: Math.round(h),
          x: Math.round(east ? o.x : o.x + o.w - w),
          y: Math.round(north ? o.y + o.h - h : o.y),
        });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <>
      {page.images.map((im) => {
        const box = im.full ? { x: 0, y: 0, w: PAGE_W, h: PAGE_H } : im;
        const isSel = selected === im.id;
        return (
          <div
            key={im.id}
            className={`st-img-box${isSel ? ' selected' : ''}${im.full ? ' full' : ''}`}
            style={{ left: box.x, top: box.y, width: box.w, height: box.h, ['--inv' as string]: 1 / scale }}
            onPointerDown={(e) => begin(e, im, 'move')}
          >
            {isSel && !im.full &&
              (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => <span key={c} className={`st-handle ${c}`} onPointerDown={(e) => begin(e, im, c)} />)}
            {isSel && (
              <div className={`st-img-tools${box.y < 60 / scale ? ' inside' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className={im.wrap === 'shape' ? 'on' : ''}
                  title="Text follows the shape of the image (transparent PNG)"
                  onClick={() => actions.change(chapterId, im.id, { wrap: 'shape' })}
                >
                  Shape
                </button>
                <button type="button" className={im.wrap === 'box' ? 'on' : ''} title="Text flows around the image box" onClick={() => actions.change(chapterId, im.id, { wrap: 'box' })}>
                  Box
                </button>
                <span className="sep" />
                <button type="button" className={im.full ? 'on' : ''} title="Cover the whole page" onClick={() => actions.change(chapterId, im.id, { full: !im.full })}>
                  Full page
                </button>
                <span className="sep" />
                <button type="button" title="Move to the previous page" disabled={im.page === 0} onClick={() => actions.shiftPage(chapterId, im.id, -1)}>
                  ◀
                </button>
                <button type="button" title="Move to the next page" onClick={() => actions.shiftPage(chapterId, im.id, 1)}>
                  ▶
                </button>
                <span className="sep" />
                <button type="button" className="danger" title="Remove the image (Delete)" onClick={() => actions.remove(chapterId, im.id)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
