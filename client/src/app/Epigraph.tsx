import { useEffect, useRef, useState } from 'react';

export type EpigraphPatch = { epigraph?: string | null; epigraphBy?: string | null; epigraphQuotes?: boolean };

/**
 * The “Epigraph” button in the toolbar: a quotation and its author placed at the start of the chapter (under its title).
 * Shown narrow, centred and in italics on the pages, in the reader, in PDF and in Word.
 */
export function EpigraphButton({
  text,
  by,
  quotes,
  onChange,
}: {
  text: string | null;
  by: string | null;
  /** Put “ ” around the quotation (on the pages, in PDF and in Word)? */
  quotes: boolean;
  onChange: (patch: EpigraphPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Closes on a click outside or with Esc; on opening, the quotation field gets the focus
  useEffect(() => {
    if (!open) return;
    areaRef.current?.focus();
    const down = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const has = !!text?.trim();
  return (
    <span className="st-music-wrap" ref={boxRef}>
      <button
        type="button"
        className={`st-tool${open ? ' on' : ''}`}
        title="Epigraph: a quotation at the start of the chapter, under its title"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Epigraph{has && <span className="st-tool-dot" aria-label="(set)" />}
      </button>
      {open && (
        <div className="st-music-pop st-epi-pop" role="dialog" aria-label="Chapter epigraph">
          <label className="st-epi-field">
            Quotation
            <textarea
              ref={areaRef}
              rows={4}
              value={text ?? ''}
              placeholder="The only way out is through."
              onChange={(e) => onChange({ epigraph: e.target.value })}
            />
          </label>
          <label className="st-epi-field">
            Author or source
            <input type="text" value={by ?? ''} placeholder="Robert Frost" onChange={(e) => onChange({ epigraphBy: e.target.value })} />
          </label>
          <label className="st-epi-check">
            <input type="checkbox" checked={quotes} onChange={(e) => onChange({ epigraphQuotes: e.target.checked })} />
            Add quotation marks (“ ”)
          </label>
          <div className="st-music-row st-epi-foot">
            <span className="muted">Shown under the chapter title.</span>
            {(has || by) && (
              <button type="button" className="st-music-btn danger" onClick={() => onChange({ epigraph: null, epigraphBy: null })}>
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
