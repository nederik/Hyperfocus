import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** The editor's three columns: left (chapters), middle (text), right (pages). Side columns can be resized by dragging, and closed. */
export interface PanelState {
  left: number;
  right: number;
  leftOpen: boolean;
  rightOpen: boolean;
}

const KEY = 'hyperfocus-panels';
const DEFAULTS: PanelState = { left: 220, right: 520, leftOpen: true, rightOpen: true };
const LEFT_MIN = 150;
const LEFT_MAX = 520;
const RIGHT_MIN = 260;
/** The writing area stays at least this wide. */
const MIDDLE_MIN = 300;
/** Dragging a panel this much below its smallest size closes it. */
const SNAP = 70;
export const HANDLE_W = 12;

function load(): PanelState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PanelState>) };
  } catch {
    /* storage may be unavailable */
  }
  return DEFAULTS;
}

export function usePanels() {
  const [state, setState] = useState<PanelState>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);
  const toggle = useCallback((side: 'left' | 'right') => {
    setState((s) => (side === 'left' ? { ...s, leftOpen: !s.leftOpen } : { ...s, rightOpen: !s.rightOpen }));
  }, []);
  return { state, setState, toggle };
}

/** CSS grid columns: left | handle | text | handle | right */
export function gridColumns(s: PanelState) {
  const l = s.leftOpen ? `${s.left}px` : '0px';
  const r = s.rightOpen ? `${s.right}px` : '0px';
  return `${l} ${HANDLE_W}px minmax(${MIDDLE_MIN}px, 1fr) ${HANDLE_W}px ${r}`;
}

/** The draggable handle between two columns; the button in its middle opens/closes the side panel. */
export function PanelHandle({
  side,
  panels,
  container,
}: {
  side: 'left' | 'right';
  panels: ReturnType<typeof usePanels>;
  container: React.RefObject<HTMLElement | null>;
}) {
  const { state, setState, toggle } = panels;
  const open = side === 'left' ? state.leftOpen : state.rightOpen;
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; w: number; moved: boolean } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const w = open ? (side === 'left' ? state.left : state.right) : 0;
    drag.current = { x: e.clientX, w, moved: false };
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 2) d.moved = true;
    const total = container.current?.clientWidth ?? window.innerWidth;
    setState((s) => {
      const want = side === 'left' ? d.w + dx : d.w - dx;
      const other = side === 'left' ? (s.rightOpen ? s.right : 0) : s.leftOpen ? s.left : 0;
      const max = Math.max(side === 'left' ? LEFT_MIN : RIGHT_MIN, Math.min(side === 'left' ? LEFT_MAX : Infinity, total - other - MIDDLE_MIN - HANDLE_W * 2));
      const min = side === 'left' ? LEFT_MIN : RIGHT_MIN;
      // When reopened after closing, it goes back to the width from before the drag
      if (want < min - SNAP) return side === 'left' ? { ...s, leftOpen: false, left: d.w || s.left } : { ...s, rightOpen: false, right: d.w || s.right };
      const w = Math.round(Math.max(min, Math.min(max, want)));
      return side === 'left' ? { ...s, left: w, leftOpen: true } : { ...s, right: w, rightOpen: true };
    });
  };

  const onPointerUp = () => {
    drag.current = null;
    setDragging(false);
  };

  // While dragging: the resize cursor on the whole page, and no text gets selected
  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add('st-resizing');
    return () => document.body.classList.remove('st-resizing');
  }, [dragging]);

  const label = side === 'left' ? 'chapters' : 'pages';
  // While open, the button points the way the panel closes
  const arrow = side === 'left' ? (open ? '‹' : '›') : open ? '›' : '‹';
  return (
    <div
      className={`st-split ${side}${dragging ? ' dragging' : ''}${open ? '' : ' closed'}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      title={`Drag to resize ${label} · double-click to ${open ? 'hide' : 'show'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest('button')) toggle(side);
      }}
    >
      <button type="button" className="st-split-btn" onClick={() => toggle(side)} title={`${open ? 'Hide' : 'Show'} ${label}`} aria-label={`${open ? 'Hide' : 'Show'} ${label}`}>
        {arrow}
      </button>
    </div>
  );
}

/** When the window gets narrower, shrinks the side panels; the writing area stays at least MIDDLE_MIN wide. */
export function useFitPanels(panels: ReturnType<typeof usePanels>, container: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const { setState } = panels;
  useEffect(() => {
    const el = container.current;
    if (!enabled || !el) return;
    const fit = () => {
      const total = el.clientWidth;
      if (!total) return;
      setState((s) => {
        const room = total - MIDDLE_MIN - HANDLE_W * 2;
        let left = s.leftOpen ? s.left : 0;
        let right = s.rightOpen ? s.right : 0;
        if (left + right <= room) return s;
        right = Math.max(s.rightOpen ? RIGHT_MIN : 0, room - left);
        if (left + right > room) left = Math.max(s.leftOpen ? LEFT_MIN : 0, room - right);
        return { ...s, left: s.leftOpen ? left : s.left, right: s.rightOpen ? right : s.right };
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [container, enabled, setState]);
}
