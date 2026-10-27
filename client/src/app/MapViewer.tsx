import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MAX_ZOOM = 8;

/**
 * The book's map: opens full screen. Wheel / two fingers to zoom, drag to move around,
 * double-click to zoom in, Esc to close.
 */
export function MapViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const fit = useRef(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; k: number; cx: number; cy: number; vx: number; vy: number } | null>(null);

  const reset = () => {
    const el = stage.current;
    if (!el || !natural) return;
    const k = Math.min(el.clientWidth / natural.w, el.clientHeight / natural.h);
    fit.current = k;
    setView({ k, x: (el.clientWidth - natural.w * k) / 2, y: (el.clientHeight - natural.h * k) / 2 });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(reset, [natural]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') zoomAt(1.4);
      if (e.key === '-') zoomAt(1 / 1.4);
      if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  });

  /** Zooms so that the point (cx, cy) stays where it is. */
  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const el = stage.current;
    if (!el) return;
    const px = cx ?? el.clientWidth / 2;
    const py = cy ?? el.clientHeight / 2;
    setView((v) => {
      const k = Math.max(fit.current * 0.5, Math.min(fit.current * MAX_ZOOM, v.k * factor));
      const f = k / v.k;
      return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
    });
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return createPortal(
    <div className="map-viewer" role="dialog" aria-label="Map">
      <div
        ref={stage}
        className="map-stage"
        onWheel={(e) => {
          const p = local(e);
          zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
        }}
        onDoubleClick={(e) => {
          const p = local(e);
          zoomAt(2, p.x, p.y);
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          pointers.current.set(e.pointerId, local(e));
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
            gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: view.x, vy: view.y };
          }
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId);
          if (!prev) return;
          const p = local(e);
          pointers.current.set(e.pointerId, p);
          if (pointers.current.size === 2 && gesture.current) {
            const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
            const g = gesture.current;
            const k = Math.max(fit.current * 0.5, Math.min(fit.current * MAX_ZOOM, (g.k * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist));
            const cx = (a.x + b.x) / 2;
            const cy = (a.y + b.y) / 2;
            const f = k / g.k;
            setView({ k, x: cx - (g.cx - g.vx) * f, y: cy - (g.cy - g.vy) * f });
          } else if (pointers.current.size === 1) {
            setView((v) => ({ ...v, x: v.x + p.x - prev.x, y: v.y + p.y - prev.y }));
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) gesture.current = null;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          gesture.current = null;
        }}
      >
        <img
          src={url}
          alt="Map"
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{
            width: natural?.w,
            height: natural?.h,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
            visibility: natural ? 'visible' : 'hidden',
          }}
        />
      </div>
      <div className="map-tools">
        <button type="button" onClick={() => zoomAt(1 / 1.4)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={reset} title="Fit (0)">
          Fit
        </button>
        <button type="button" onClick={() => zoomAt(1.4)} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="map-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}
