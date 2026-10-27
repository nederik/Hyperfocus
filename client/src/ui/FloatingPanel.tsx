import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const GAP = 6;
const EDGE = 8;

/**
 * A pop-up panel tied to a button. It opens in the top layer of the page (in body), so it is not cut off
 * inside cards/panels that hide overflow. It opens upwards if there is no room below, never spills off the screen,
 * and stays next to its button when the page scrolls or the window resizes. Closes on a click outside or with Esc.
 */
export function FloatingPanel({
  anchor,
  onClose,
  children,
  className,
  width,
  matchWidth,
  prefer = 'down',
  role,
  ariaLabel,
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Fixed width (px). */
  width?: number;
  /** As wide as the button. */
  matchWidth?: boolean;
  /** Open downwards or upwards by preference (it flips if it does not fit). */
  prefer?: 'down' | 'up';
  role?: string;
  ariaLabel?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: -9999, left: -9999, visibility: 'hidden' });
  const close = useRef(onClose);
  close.current = onClose;

  const last = useRef('');
  const place = () => {
    const a = anchor.current?.getBoundingClientRect();
    const p = panel.current;
    if (!a || !p) return;
    const w = matchWidth ? a.width : width ?? p.offsetWidth;
    // The height must be the natural height before it is limited (including the scroll area).
    const h = p.scrollHeight;
    const below = window.innerHeight - a.bottom - GAP - EDGE;
    const above = a.top - GAP - EDGE;
    const down = prefer === 'down' ? below >= h || below >= above : !(above >= h || above >= below);
    const top = Math.round(down ? a.bottom + GAP : a.top - GAP - Math.min(h, above));
    const left = Math.round(Math.min(Math.max(EDGE, a.left), window.innerWidth - w - EDGE));
    // If it does not fit, the panel itself scrolls.
    const maxHeight = Math.round(Math.max(120, down ? below : above));
    // No change, no redraw (otherwise it would loop draw → position → draw).
    const key = `${top}|${left}|${w}|${maxHeight}`;
    if (key === last.current) return;
    last.current = key;
    setStyle({ position: 'fixed', top, left, width: w, maxHeight, visibility: 'visible' });
  };

  // Place it on opening; place it again when its content/size changes (e.g. a list getting shorter while searching).
  useLayoutEffect(() => {
    place();
    const ro = new ResizeObserver(() => place());
    if (panel.current) ro.observe(panel.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    const reflow = () => place();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', reflow);
      window.removeEventListener('scroll', reflow, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div ref={panel} className={`floating-panel${className ? ` ${className}` : ''}`} style={style} role={role} aria-label={ariaLabel}>
      {children}
    </div>,
    document.body,
  );
}
