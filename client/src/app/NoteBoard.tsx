import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NOTE_COLORS, type BookNote, type NoteColor } from '@hyperfocus/shared';

/**
 * Note board (like Excalidraw): an endless white board with free text boxes on it.
 * - Text tool (T): click to start writing there (then it goes back to the select tool).
 * - Click text: select; drag: move; pull a corner: resize; double-click: edit.
 * - Drag an empty spot or use the wheel: move the board; Ctrl + wheel: zoom.
 * - Delete: remove the selected text, Esc: let go. V / P / H: select / pen / hand tool.
 * - Eraser (E): erases the parts of lines it is dragged over, splitting a line if needed.
 * - Pen: draw freely on the board; each line becomes a note of its own (select, move, resize, recolour, delete).
 */

export const INK: Record<NoteColor, string> = {
  black: '#1e1e1e',
  red: '#e03131',
  green: '#2f9e44',
  blue: '#1971c2',
  orange: '#f08c00',
};
const INK_NAMES: Record<NoteColor, string> = { black: 'Black', red: 'Red', green: 'Green', blue: 'Blue', orange: 'Orange' };
const SIZES = [
  { label: 'S', px: 16 },
  { label: 'M', px: 20 },
  { label: 'L', px: 28 },
  { label: 'XL', px: 36 },
];
const DEFAULT_SIZE = 20;
const LINE = 1.25;
/** Line widths for drawing */
const STROKES = [
  { label: 'Thin', px: 2 },
  { label: 'Medium', px: 4 },
  { label: 'Bold', px: 8 },
];

/** Eraser sizes (radius on screen, pixels) */
const ERASERS = [
  { label: 'S', px: 6 },
  { label: 'M', px: 12 },
  { label: 'L', px: 24 },
];

type Tool = 'select' | 'hand' | 'draw' | 'erase' | 'text';
type Pt = [number, number];

/** Takes points along the path smoothPath made (curves are sampled, so the eraser knows the exact trace of the line). */
function pathPoints(d: string): Pt[] {
  const tok = d.match(/[MQLl]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const pts: Pt[] = [];
  let i = 0;
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    const c = tok[i++];
    if (c === 'M' || c === 'L') pts.push([num(), num()]);
    else if (c === 'Q') {
      const [sx, sy] = pts[pts.length - 1] ?? [0, 0];
      const cx = num();
      const cy = num();
      const ex = num();
      const ey = num();
      for (const t of [0.25, 0.5, 0.75, 1]) {
        const u = 1 - t;
        pts.push([u * u * sx + 2 * u * t * cx + t * t * ex, u * u * sy + 2 * u * t * cy + t * t * ey]);
      }
    } else if (c === 'l') i += 2;
  }
  return pts;
}

/** Fills in points at short intervals (so the eraser also catches the middle of a straight line). */
function densify(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts;
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let j = 1; j <= n; j++) out.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
  }
  return out;
}

/** Makes a drawing note from points in world coordinates. */
function strokeNote(pts: Pt[], color: NoteColor, stroke: number, eps: number): BookNote {
  const s = simplify(pts, eps);
  const xs = s.map((p) => p[0]);
  const ys = s.map((p) => p[1]);
  const pad = stroke;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - minX + pad;
  const h = Math.max(...ys) - minY + pad;
  return {
    id: crypto.randomUUID().slice(0, 13),
    text: '',
    color,
    createdAt: new Date().toISOString(),
    x: Math.round(minX * 10) / 10,
    y: Math.round(minY * 10) / 10,
    w: Math.round(w * 10) / 10,
    h: Math.round(h * 10) / 10,
    size: 100,
    stroke: Math.round(stroke * 10) / 10,
    path: smoothPath(s.map(([x, y]) => [x - minX, y - minY])),
  };
}

/** Simplifies a line (Ramer–Douglas–Peucker): fewer points, same shape. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0]!;
  const [bx, by] = pts[pts.length - 1]!;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let max = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i]!;
    const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > max) {
      max = d;
      at = i;
    }
  }
  if (max <= eps) return [pts[0]!, pts[pts.length - 1]!];
  return [...simplify(pts.slice(0, at + 1), eps).slice(0, -1), ...simplify(pts.slice(at), eps)];
}

/** A smooth SVG path from points (quadratic curves through the midpoints). */
function smoothPath(pts: Pt[]): string {
  const r = (v: number) => Math.round(v * 10) / 10;
  if (pts.length === 1) return `M${r(pts[0]![0])} ${r(pts[0]![1])}l0.01 0`;
  let d = `M${r(pts[0]![0])} ${r(pts[0]![1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    d += `Q${r(x)} ${r(y)} ${r((x + nx) / 2)} ${r((y + ny) / 2)}`;
  }
  const [lx, ly] = pts[pts.length - 1]!;
  return d + `L${r(lx)} ${r(ly)}`;
}
interface View {
  x: number;
  y: number;
  zoom: number;
}

const readView = (key: string): View => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '') as View;
    if (Number.isFinite(v.x) && Number.isFinite(v.y) && v.zoom > 0) return v;
  } catch {
    /* ignore */
  }
  return { x: 40, y: 30, zoom: 1 };
};

export function NoteBoard({ notes, onChange, viewKey }: { notes: BookNote[]; onChange: (notes: BookNote[]) => void; viewKey: string }) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => readView(viewKey));
  const viewRef = useRef(view);
  viewRef.current = view;
  const [tool, setTool] = useState<Tool>('select');
  // Pen colour and width (the last choice is remembered)
  const [pen, setPen] = useState<{ color: NoteColor; stroke: number }>({ color: 'black', stroke: 4 });
  const penRef = useRef(pen);
  penRef.current = pen;
  const [live, setLive] = useState<Pt[] | null>(null);
  // Eraser: its size (radius in screen pixels), the cursor position and the temporary note list while erasing
  const [eraser, setEraser] = useState(12);
  const eraserRef = useRef(eraser);
  eraserRef.current = eraser;
  const [eraserAt, setEraserAt] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<BookNote[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const change = useCallback((next: BookNote[]) => {
    notesRef.current = next;
    onChange(next);
  }, [onChange]);

  // The board's view is remembered in this browser.
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(viewKey, JSON.stringify(view));
      } catch {
        /* ignore */
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [view, viewKey]);

  // Older notes (without a place) are stacked one under another
  useEffect(() => {
    if (!notes.some((n) => n.x === undefined || n.y === undefined)) return;
    // Keep them clear of the selection panel (left) and the toolbar (top)
    let y = 60;
    change(
      notes.map((n) => {
        if (n.x !== undefined && n.y !== undefined) return n;
        const placed = { ...n, x: 220, y, size: n.size ?? DEFAULT_SIZE };
        y += Math.max(1, n.text.split('\n').length) * (n.size ?? DEFAULT_SIZE) * LINE + 40;
        return placed;
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toWorld = (clientX: number, clientY: number) => {
    const r = boardRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  };

  const create = (x: number, y: number) => {
    const last = notesRef.current.find((n) => n.id === selected);
    const note: BookNote = {
      id: crypto.randomUUID().slice(0, 13),
      text: '',
      color: last?.color ?? 'black',
      size: last?.size ?? DEFAULT_SIZE,
      createdAt: new Date().toISOString(),
      x: Math.round(x),
      y: Math.round(y - ((last?.size ?? DEFAULT_SIZE) * LINE) / 2),
    };
    change([...notesRef.current, note]);
    setSelected(note.id);
    setEditing(note.id);
  };
  const patch = (id: string, p: Partial<BookNote>) => change(notesRef.current.map((n) => (n.id === id ? { ...n, ...p } : n)));
  const remove = (id: string) => {
    change(notesRef.current.filter((n) => n.id !== id));
    setSelected(null);
    setEditing(null);
  };
  const stopEditing = (id: string) => {
    setEditing((e) => (e === id ? null : e));
    const n = notesRef.current.find((x) => x.id === id);
    if (n && !n.text.trim()) remove(id); // no empty text boxes left behind
  };

  // ---- Moving / zooming the board ----
  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const r = boardRef.current!.getBoundingClientRect();
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    setView((v) => {
      const zoom = Math.max(0.2, Math.min(4, v.zoom * factor));
      const f = zoom / v.zoom;
      return { zoom, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
    });
  };
  useEffect(() => {
    const el = boardRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const drag = (e: React.PointerEvent, onMove: (dx: number, dy: number) => void, onEnd?: () => void) => {
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => onMove(ev.clientX - sx, ev.clientY - sy);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onEnd?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // ---- Pen: hold and draw; on release the line becomes a note ----
  const startDraw = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    boardRef.current?.focus({ preventScroll: true });
    if (editing) stopEditing(editing);
    setSelected(null);
    const pts: Pt[] = [];
    const add = (cx: number, cy: number) => {
      const p = toWorld(cx, cy);
      pts.push([p.x, p.y]);
    };
    add(e.clientX, e.clientY);
    setLive([...pts]);
    const move = (ev: PointerEvent) => {
      for (const c of ev.getCoalescedEvents?.() ?? [ev]) add(c.clientX, c.clientY);
      setLive([...pts]);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setLive(null);
      finishStroke(pts);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const finishStroke = (raw: Pt[]) => {
    if (!raw.length) return;
    const { color, stroke } = penRef.current;
    change([...notesRef.current, strokeNote(raw, color, stroke, 0.6 / viewRef.current.zoom)]);
  };

  // ---- Eraser: hold and drag; the parts of lines it touches are erased (a line is split in two if needed) ----
  const startErase = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    boardRef.current?.focus({ preventScroll: true });
    if (editing) stopEditing(editing);
    setSelected(null);
    const z = viewRef.current.zoom;
    const r = eraserRef.current / z; // radius in world units
    let list = notesRef.current;
    const cache = new Map<string, Pt[]>(); // note → dense points in world coordinates
    const ptsOf = (n: BookNote) => {
      let p = cache.get(n.id);
      if (!p) {
        const k = (n.size ?? 100) / 100;
        const ox = n.x ?? 0;
        const oy = n.y ?? 0;
        p = densify(pathPoints(n.path!).map(([x, y]) => [ox + x * k, oy + y * k] as Pt), Math.max(0.5, r / 3));
        cache.set(n.id, p);
      }
      return p;
    };
    const eraseAt = (cx: number, cy: number) => {
      let changed = false;
      const next: BookNote[] = [];
      for (const n of list) {
        if (!n.path) {
          next.push(n);
          continue;
        }
        const k = (n.size ?? 100) / 100;
        const half = ((n.stroke ?? 4) * k) / 2;
        const x1 = n.x ?? 0;
        const y1 = n.y ?? 0;
        // Quick rejection: leave it alone if its box is not touched at all
        if (cx < x1 - r || cy < y1 - r || cx > x1 + (n.w ?? 0) * k + r || cy > y1 + (n.h ?? 0) * k + r) {
          next.push(n);
          continue;
        }
        const pts = ptsOf(n);
        const reach = r + half;
        const parts: Pt[][] = [];
        let cur: Pt[] = [];
        let hit = false;
        for (const p of pts) {
          if (Math.hypot(p[0] - cx, p[1] - cy) <= reach) {
            hit = true;
            if (cur.length) parts.push(cur);
            cur = [];
          } else cur.push(p);
        }
        if (cur.length) parts.push(cur);
        if (!hit) {
          next.push(n);
          continue;
        }
        changed = true;
        for (const part of parts) {
          if (part.length < 2) continue; // no crumbs left behind
          const piece = strokeNote(part, n.color, (n.stroke ?? 4) * k, 0.3 / z);
          piece.tab = n.tab;
          cache.set(piece.id, part);
          next.push(piece);
        }
      }
      if (changed) {
        list = next;
        setDraft(next);
      }
    };
    let last = toWorld(e.clientX, e.clientY);
    eraseAt(last.x, last.y);
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      // When dragging fast, erase the space in between too
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / (r / 2)));
      for (let i = 1; i <= steps; i++) eraseAt(last.x + ((p.x - last.x) * i) / steps, last.y + ((p.y - last.y) * i) / steps);
      last = p;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDraft(null);
      if (list !== notesRef.current) change(list);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** With the pen/eraser selected it works anywhere on the board (on top of notes too), except the toolbar and panels. */
  const onBoardDownCapture = (e: React.PointerEvent) => {
    if ((tool !== 'draw' && tool !== 'erase') || e.button !== 0 || spaceDown.current) return;
    if ((e.target as HTMLElement).closest('.ex-toolbar, .ex-props, .ex-zoom, .ex-input')) return;
    if (tool === 'draw') startDraw(e);
    else startErase(e);
  };
  /** The eraser cursor: a circle that follows the mouse on the board */
  const onBoardMove = (e: React.PointerEvent) => {
    if (tool !== 'erase') return;
    const r = boardRef.current!.getBoundingClientRect();
    setEraserAt({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const spaceDown = useRef(false);
  const onBoardDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('ex-world')) return;
    boardRef.current?.focus({ preventScroll: true });
    if (editing) {
      stopEditing(editing);
      return;
    }
    if (tool === 'hand' || spaceDown.current || e.button === 1) {
      pan(e);
      return;
    }
    // Text tool: start writing where clicked; then back to the select tool
    if (tool === 'text' && e.button === 0) {
      e.preventDefault();
      const p = toWorld(e.clientX, e.clientY);
      create(p.x, p.y);
      setTool('select');
      return;
    }
    setSelected(null);
    pan(e);
  };
  /** Move the board by dragging. */
  const pan = (e: React.PointerEvent) => {
    const v0 = viewRef.current;
    boardRef.current?.classList.add('panning');
    drag(
      e,
      (dx, dy) => setView({ ...v0, x: v0.x + dx, y: v0.y + dy }),
      () => boardRef.current?.classList.remove('panning'),
    );
  };
  const onNoteDown = (e: React.PointerEvent, n: BookNote) => {
    if (editing === n.id || e.button !== 0) return;
    e.stopPropagation();
    boardRef.current?.focus({ preventScroll: true });
    if (editing) stopEditing(editing);
    if (tool === 'hand' || spaceDown.current) return pan(e);
    // With the text tool, clicking text edits it; clicking a drawing starts new text there
    if (tool === 'text') {
      e.preventDefault();
      if (n.path) {
        const p = toWorld(e.clientX, e.clientY);
        create(p.x, p.y);
      } else {
        setSelected(n.id);
        setEditing(n.id);
      }
      setTool('select');
      return;
    }
    setSelected(n.id);
    const x0 = n.x ?? 0;
    const y0 = n.y ?? 0;
    const z = viewRef.current.zoom;
    drag(e, (dx, dy) => patch(n.id, { x: Math.round(x0 + dx / z), y: Math.round(y0 + dy / z) }));
  };

  /** Pulling a corner resizes the text; the opposite corner stays in place. */
  const onHandleDown = (e: React.PointerEvent, n: BookNote, corner: 'nw' | 'ne' | 'sw' | 'se') => {
    e.stopPropagation();
    e.preventDefault();
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-note="${n.id}"]`);
    if (!el) return;
    const z = viewRef.current.zoom;
    const w0 = el.offsetWidth;
    const h0 = el.offsetHeight;
    // For text, size is the font size; for a drawing, the scale percentage
    const drawing = !!n.path;
    const s0 = n.size ?? (drawing ? 100 : DEFAULT_SIZE);
    const [lo, hi] = drawing ? [6, 400] : [8, 240];
    const x0 = n.x ?? 0;
    const y0 = n.y ?? 0;
    const east = corner.includes('e');
    const south = corner.includes('s');
    drag(e, (dx) => {
      const w = Math.max(10, w0 + ((east ? dx : -dx) / z));
      const k = w / w0;
      const size = Math.max(lo, Math.min(hi, Math.round(s0 * k * 10) / 10));
      const kk = size / s0;
      patch(n.id, { size, x: Math.round(east ? x0 : x0 + w0 - w0 * kk), y: Math.round(south ? y0 : y0 + h0 - h0 * kk) });
    });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === ' ') spaceDown.current = e.type === 'keydown';
    if (e.type !== 'keydown' || editing) return;
    const sel = notesRef.current.find((n) => n.id === selected);
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) remove(sel.id);
    else if (e.key === 'Escape') setSelected(null);
    else if (e.key === 'Enter' && sel) setEditing(sel.id);
    else if (e.key === 'v' || e.key === '1') setTool('select');
    else if (e.key === 'h') setTool('hand');
    else if (e.key === 't') {
      setTool('text');
      setSelected(null);
    }
    else if (e.key === 'p' || e.key === 'd') setTool('draw');
    else if (e.key === 'e') {
      setTool('erase');
      setSelected(null);
    }
    else if (sel && e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]!;
      patch(sel.id, { x: (sel.x ?? 0) + d[0]!, y: (sel.y ?? 0) + d[1]! });
    } else return;
    e.preventDefault();
  };

  /** Fit every note on screen. */
  const fit = () => {
    const els = [...(boardRef.current?.querySelectorAll<HTMLElement>('[data-note]') ?? [])];
    const r = boardRef.current!.getBoundingClientRect();
    if (!els.length) return setView({ x: 40, y: 30, zoom: 1 });
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const el of els) {
      const n = notesRef.current.find((x) => x.id === el.dataset.note);
      if (!n) continue;
      x1 = Math.min(x1, n.x ?? 0);
      y1 = Math.min(y1, n.y ?? 0);
      x2 = Math.max(x2, (n.x ?? 0) + el.offsetWidth);
      y2 = Math.max(y2, (n.y ?? 0) + el.offsetHeight);
    }
    const zoom = Math.max(0.2, Math.min(1.5, Math.min((r.width - 80) / (x2 - x1 || 1), (r.height - 100) / (y2 - y1 || 1))));
    setView({ zoom, x: (r.width - (x2 - x1) * zoom) / 2 - x1 * zoom, y: (r.height - (y2 - y1) * zoom) / 2 - y1 * zoom + 20 });
  };

  const sel = useMemo(() => notes.find((n) => n.id === selected) ?? null, [notes, selected]);

  return (
    <div
      ref={boardRef}
      className={`ex-board tool-${tool}`}
      tabIndex={0}
      onPointerDownCapture={onBoardDownCapture}
      onPointerDown={onBoardDown}
      onPointerMove={onBoardMove}
      onPointerLeave={() => setEraserAt(null)}
      onKeyDown={onKey}
      onKeyUp={onKey}
    >
      <div className="ex-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        {(draft ?? notes).map((n) =>
          n.path ? (
            <NoteDraw key={n.id} note={n} zoom={view.zoom} selected={selected === n.id} onDown={(e) => onNoteDown(e, n)} onHandle={(e, c) => onHandleDown(e, n, c)} />
          ) : (
          <NoteText
            key={n.id}
            note={n}
            zoom={view.zoom}
            selected={selected === n.id}
            editing={editing === n.id}
            onDown={(e) => onNoteDown(e, n)}
            onEdit={() => {
              setSelected(n.id);
              setEditing(n.id);
            }}
            onText={(text) => patch(n.id, { text })}
            onBlur={() => stopEditing(n.id)}
            onHandle={(e, c) => onHandleDown(e, n, c)}
          />
          ),
        )}
        {/* The line being drawn */}
        {live && (
          <svg className="ex-live" aria-hidden>
            <path d={smoothPath(live)} fill="none" stroke={INK[pen.color]} strokeWidth={pen.stroke} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {notes.length === 0 && !live && <div className="ex-welcome">{tool === 'draw' ? 'Draw anywhere' : tool === 'text' ? 'Click anywhere to write' : 'Pick T to write, or the pen to draw'}</div>}

      {/* The eraser cursor */}
      {tool === 'erase' && eraserAt && <div className="ex-eraser" style={{ left: eraserAt.x, top: eraserAt.y, width: eraser * 2, height: eraser * 2 }} aria-hidden />}

      {/* Tools */}
      <div className="ex-toolbar" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <ToolButton active={tool === 'select'} onClick={() => setTool('select')} title="Select and move — V">
          <path d="M6 3l12 9-5.5 1.2L15 20l-2.4 1-2.6-6.7L6 18z" />
        </ToolButton>
        <ToolButton
          active={tool === 'text'}
          onClick={() => {
            setTool('text');
            setSelected(null);
          }}
          title="Text — T"
        >
          <path d="M5 6V4.5h14V6 M12 4.5V19.5 M9 19.5h6" />
        </ToolButton>
        <ToolButton
          active={tool === 'draw'}
          onClick={() => {
            setTool('draw');
            setSelected(null);
          }}
          title="Draw — P"
        >
          <path d="M4 20l1.2-4.6L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z M13.5 7l3.5 3.5" />
        </ToolButton>
        <ToolButton
          active={tool === 'erase'}
          onClick={() => {
            setTool('erase');
            setSelected(null);
          }}
          title="Eraser — E"
        >
          <path d="M8.5 20H20 M8.5 20l-4.3-4.3a2 2 0 0 1 0-2.8l8.6-8.6a2 2 0 0 1 2.8 0l4.3 4.3a2 2 0 0 1 0 2.8L12 20z M9.5 9.5l5 5" />
        </ToolButton>
        <ToolButton active={tool === 'hand'} onClick={() => setTool('hand')} title="Move the board — H (or Space + drag)">
          <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7-2.5 0-4-1.2-5.5-3.5L4 14.8a1.5 1.5 0 0 1 2.4-1.8L8 15" />
        </ToolButton>
      </div>

      {/* With the pen selected (and nothing else selected): pen colour and width */}
      {tool === 'draw' && !sel && (
        <div className="ex-props" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <div className="ex-props-label">Pen color</div>
          <div className="ex-props-row">
            {NOTE_COLORS.map((c) => (
              <button key={c} type="button" title={INK_NAMES[c]} className={`ex-swatch${pen.color === c ? ' on' : ''}`} style={{ background: INK[c] }} onClick={() => setPen((p) => ({ ...p, color: c }))} />
            ))}
          </div>
          <div className="ex-props-label">Line</div>
          <div className="ex-props-row">
            {STROKES.map((s) => (
              <button key={s.label} type="button" className={`ex-size${pen.stroke === s.px ? ' on' : ''}`} onClick={() => setPen((p) => ({ ...p, stroke: s.px }))}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* With the eraser selected: the eraser size */}
      {tool === 'erase' && !sel && (
        <div className="ex-props" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <div className="ex-props-label">Eraser size</div>
          <div className="ex-props-row">
            {ERASERS.map((s) => (
              <button key={s.label} type="button" className={`ex-size${eraser === s.px ? ' on' : ''}`} onClick={() => setEraser(s.px)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="ex-props-hint">Erases drawings. Delete text with Del.</div>
        </div>
      )}

      {/* Properties of the selected drawing */}
      {sel && sel.path && (
        <div className="ex-props" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <div className="ex-props-label">Color</div>
          <div className="ex-props-row">
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={INK_NAMES[c]}
                className={`ex-swatch${sel.color === c ? ' on' : ''}`}
                style={{ background: INK[c] }}
                onClick={() => {
                  patch(sel.id, { color: c });
                  setPen((p) => ({ ...p, color: c }));
                }}
              />
            ))}
          </div>
          <div className="ex-props-label">Line</div>
          <div className="ex-props-row">
            {STROKES.map((s) => (
              <button
                key={s.label}
                type="button"
                className={`ex-size${sel.stroke === s.px ? ' on' : ''}`}
                onClick={() => {
                  patch(sel.id, { stroke: s.px });
                  setPen((p) => ({ ...p, stroke: s.px }));
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="ex-props-row">
            <button type="button" className="ex-del" onClick={() => remove(sel.id)} title="Delete — Del">
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Properties of the selected text */}
      {sel && !sel.path && (
        <div className="ex-props" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <div className="ex-props-label">Color</div>
          <div className="ex-props-row">
            {NOTE_COLORS.map((c) => (
              <button key={c} type="button" title={INK_NAMES[c]} className={`ex-swatch${sel.color === c ? ' on' : ''}`} style={{ background: INK[c] }} onClick={() => patch(sel.id, { color: c })} />
            ))}
          </div>
          <div className="ex-props-label">Size</div>
          <div className="ex-props-row">
            {SIZES.map((s) => (
              <button key={s.label} type="button" className={`ex-size${Math.round(sel.size ?? DEFAULT_SIZE) === s.px ? ' on' : ''}`} onClick={() => patch(sel.id, { size: s.px })}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="ex-props-row">
            <button type="button" className="ex-del" onClick={() => remove(sel.id)} title="Delete — Del">
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Zoom */}
      <div className="ex-zoom" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoomAt(1 / 1.2)} aria-label="Zoom out">
          −
        </button>
        <button type="button" className="ex-zoom-val" onClick={() => setView((v) => ({ ...v, zoom: 1 }))} title="%100">
          {Math.round(view.zoom * 100)}%
        </button>
        <button type="button" onClick={() => zoomAt(1.2)} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="ex-fit" onClick={fit} title="Show all notes">
          Fit
        </button>
      </div>
    </div>
  );
}

function ToolButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" className={`ex-tool${active ? ' on' : ''}`} onClick={onClick} title={title} aria-pressed={active}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/** A text on the board: no border; when selected a purple frame and corner handles, edited in place. */
function NoteText({
  note,
  zoom,
  selected,
  editing,
  onDown,
  onEdit,
  onText,
  onBlur,
  onHandle,
}: {
  note: BookNote;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onDown: (e: React.PointerEvent) => void;
  onEdit: () => void;
  onText: (t: string) => void;
  onBlur: () => void;
  onHandle: (e: React.PointerEvent, corner: 'nw' | 'ne' | 'sw' | 'se') => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!editing) return;
    const el = ta.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);
  const size = note.size ?? DEFAULT_SIZE;
  const inv = 1 / zoom;
  return (
    <div
      className={`ex-note${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
      data-note={note.id}
      style={{ left: note.x ?? 0, top: note.y ?? 0, fontSize: size, color: INK[note.color], ['--inv' as string]: inv }}
      onPointerDown={onDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
    >
      {/* An invisible copy that sets the size (while editing, the text box grows with it) */}
      <div className="ex-text">{note.text + (editing ? '​' : '') || ' '}</div>
      {editing && (
        <textarea
          ref={ta}
          className="ex-input"
          value={note.text}
          wrap="off"
          spellCheck
          onChange={(e) => onText(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      )}
      {selected && !editing && (
        <>
          <span className="ex-sel" aria-hidden />
          {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
            <span key={c} className={`ex-handle ${c}`} onPointerDown={(e) => onHandle(e, c)} aria-hidden />
          ))}
        </>
      )}
    </div>
  );
}


/** A drawing on the board: an SVG line in its own box; when selected a frame and corner handles (resize from the corners). */
function NoteDraw({
  note,
  zoom,
  selected,
  onDown,
  onHandle,
}: {
  note: BookNote;
  zoom: number;
  selected: boolean;
  onDown: (e: React.PointerEvent) => void;
  onHandle: (e: React.PointerEvent, corner: 'nw' | 'ne' | 'sw' | 'se') => void;
}) {
  const k = (note.size ?? 100) / 100;
  const vw = Math.max(1, note.w ?? 1);
  const vh = Math.max(1, note.h ?? 1);
  return (
    <div
      className={`ex-note ex-draw${selected ? ' selected' : ''}`}
      data-note={note.id}
      style={{ left: note.x ?? 0, top: note.y ?? 0, width: vw * k, height: vh * k, ['--inv' as string]: 1 / zoom }}
      onPointerDown={onDown}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg width={vw * k} height={vh * k} viewBox={`0 0 ${vw} ${vh}`} aria-hidden>
        <path d={note.path} fill="none" stroke={INK[note.color]} strokeWidth={note.stroke ?? 4} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {selected && (
        <>
          <span className="ex-sel" aria-hidden />
          {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
            <span key={c} className={`ex-handle ${c}`} onPointerDown={(e) => onHandle(e, c)} aria-hidden />
          ))}
        </>
      )}
    </div>
  );
}
