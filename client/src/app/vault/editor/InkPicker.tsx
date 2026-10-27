import { useEffect, useRef, useState } from 'react';
import { activeEditor, applyInk, INKS, useInk } from './ink';

/** The ink button in the sidebar: the color of the text you type (also colors the selected text). */
export function InkPicker() {
  const ink = useInk();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = INKS.find((i) => i.color === ink) ?? INKS[0]!;

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div className="vt-ink" ref={ref}>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        // Keep the editor's selection
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        title="Ink color: the color of the text you write (also colors the selected text)"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="vt-ink-dot" style={{ background: current.color ?? 'var(--ink)' }} />
        Ink
      </button>
      {open && (
        <div className="vt-ink-pop" role="menu" onMouseDown={(e) => e.preventDefault()}>
          {INKS.map((i) => (
            <button
              key={i.name}
              type="button"
              role="menuitemradio"
              aria-checked={ink === i.color}
              className={`vt-ink-opt${ink === i.color ? ' on' : ''}`}
              onClick={() => {
                applyInk(activeEditor(), i.color);
                setOpen(false);
              }}
            >
              <span className="vt-ink-dot" style={{ background: i.color ?? 'var(--ink)' }} />
              <span style={{ color: i.color ?? 'var(--ink)' }}>{i.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
