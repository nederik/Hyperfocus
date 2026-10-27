import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { toast } from '../../../lib/toast';
import { pasteFromClipboard, pickImages } from './attach';
import { applyInk, INKS, useInk } from './ink';
import { toggleWrap } from './format';

export interface NoteMenuAt {
  x: number;
  y: number;
  /** The right-clicked [[link]]. */
  link: string | null;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

/** Keeps the menu on screen; closes on a click outside, Esc or scrolling. */
function useMenu(at: { x: number; y: number }, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, at.y + r.height > window.innerHeight - 8 ? at.y - r.height : at.y),
    });
  }, [at.x, at.y]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const away = () => onClose();
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', away);
    window.addEventListener('resize', away);
    document.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', away);
      window.removeEventListener('resize', away);
      document.removeEventListener('scroll', away, true);
    };
  }, [onClose]);
  return { ref, pos };
}

/** The reading view's right-click menu. */
export function ReadMenu({ at, onEdit, onClose }: { at: { x: number; y: number }; onEdit: () => void; onClose: () => void }) {
  const { ref, pos } = useMenu(at, onClose);
  const hasSelection = !!window.getSelection()?.toString();
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <div ref={ref} className="sp-menu vt-menu" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}>
      <button type="button" role="menuitem" className="sp-item" disabled={!hasSelection} onClick={run(() => !document.execCommand('copy') && toast(`Use ${mod}C to copy.`))}>
        Copy<kbd>{mod}C</kbd>
      </button>
      <button type="button" role="menuitem" className="sp-item" onClick={run(onEdit)}>
        Edit here<kbd>{mod}E</kbd>
      </button>
    </div>
  );
}

/** A library note's right-click menu. */
export function NoteMenu({
  view,
  at,
  onOpenNote,
  onClose,
}: {
  view: EditorView;
  at: NoteMenuAt;
  onOpenNote: (target: string, newTab: boolean) => void;
  onClose: () => void;
}) {
  const { ref, pos } = useMenu(at, onClose);
  const ink = useInk();
  const hasSelection = !view.state.selection.main.empty;

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const clipboard = (cmd: 'cut' | 'copy') =>
    run(() => {
      view.focus();
      if (!document.execCommand(cmd)) toast(`Use ${mod}${cmd === 'cut' ? 'X' : 'C'} to ${cmd}.`);
    });
  const insertLink = run(() => {
    const r = view.state.selection.main;
    const text = view.state.sliceDoc(r.from, r.to);
    view.dispatch({
      changes: { from: r.from, to: r.to, insert: `[[${text}]]` },
      selection: text ? EditorSelection.range(r.from + 2, r.from + 2 + text.length) : { anchor: r.from + 2 },
      userEvent: 'input.format',
    });
    view.focus();
  });

  return (
    <div ref={ref} className="sp-menu vt-menu" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}>
      {at.link && (
        <>
          <button type="button" role="menuitem" className="sp-item" onClick={run(() => onOpenNote(at.link!, false))}>
            Open “{at.link}”
          </button>
          <button type="button" role="menuitem" className="sp-item" onClick={run(() => onOpenNote(at.link!, true))}>
            Open in new tab
          </button>
          <div className="sp-sep" />
        </>
      )}
      <button type="button" role="menuitem" className="sp-item" disabled={!hasSelection} onClick={clipboard('cut')}>
        Cut<kbd>{mod}X</kbd>
      </button>
      <button type="button" role="menuitem" className="sp-item" disabled={!hasSelection} onClick={clipboard('copy')}>
        Copy<kbd>{mod}C</kbd>
      </button>
      <button type="button" role="menuitem" className="sp-item" onClick={run(() => void pasteFromClipboard(view))}>
        Paste<kbd>{mod}V</kbd>
      </button>
      <div className="sp-sep" />
      <button type="button" role="menuitem" className="sp-item" onClick={run(() => toggleWrap(view, '**'))}>
        <b>Bold</b>
        <kbd>{mod}B</kbd>
      </button>
      <button type="button" role="menuitem" className="sp-item" onClick={run(() => toggleWrap(view, '*'))}>
        <i>Italic</i>
        <kbd>{mod}I</kbd>
      </button>
      <button type="button" role="menuitem" className="sp-item" onClick={run(() => toggleWrap(view, '~~'))}>
        <s>Strikethrough</s>
      </button>
      <button type="button" role="menuitem" className="sp-item" onClick={run(() => toggleWrap(view, '=='))}>
        <mark>Highlight</mark>
      </button>
      <div className="sp-sep" />
      <div className="sp-note vt-menu-label">{hasSelection ? 'Color the selection' : 'Ink color'}</div>
      <div className="vt-swatches" role="group" aria-label="Ink color">
        {INKS.map((i) => (
          <button
            key={i.name}
            type="button"
            className={`vt-swatch${ink === i.color ? ' on' : ''}`}
            style={{ color: i.color ?? 'var(--ink)' }}
            title={i.name}
            aria-label={i.name}
            onClick={run(() => applyInk(view, i.color))}
          />
        ))}
      </div>
      <div className="sp-sep" />
      <button type="button" role="menuitem" className="sp-item" onClick={insertLink}>
        Link to a note<kbd>[[ ]]</kbd>
      </button>
      <button type="button" role="menuitem" className="sp-item" onClick={run(() => pickImages(view))}>
        Insert image…
      </button>
      <div className="sp-sep" />
      <button
        type="button"
        role="menuitem"
        className="sp-item"
        onClick={run(() => {
          view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
          view.focus();
        })}
      >
        Select all<kbd>{mod}A</kbd>
      </button>
    </div>
  );
}
