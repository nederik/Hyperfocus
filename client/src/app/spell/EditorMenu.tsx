import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { toast } from '../../lib/toast';
import { WORD_RE, skipWord, speller, type Suggestion } from './speller';
import { openLookup } from '../dict/DictLookup';
import { openRhymes } from '../dict/RhymeLookup';

export interface MenuAt {
  x: number;
  y: number;
  /** The right-clicked word and its place (document positions). */
  word: string | null;
  from: number;
  to: number;
}

/** Finds the word at the right-clicked point (within the paragraph; nodes like a line break count as one character). */
export function wordAt(editor: Editor, x: number, y: number): MenuAt {
  const at: MenuAt = { x, y, word: null, from: 0, to: 0 };
  const hit = editor.view.posAtCoords({ left: x, top: y });
  if (!hit) return at;
  const $pos = editor.state.doc.resolve(hit.pos);
  if (!$pos.parent.isTextblock) return at;
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, '￼');
  const off = $pos.parentOffset;
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (off >= start && off <= end) {
      if (skipWord(m[0])) return at;
      return { x, y, word: m[0], from: $pos.start() + start, to: $pos.start() + end };
    }
  }
  return at;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

/**
 * The writing area's own right-click menu: spelling suggestions, add to dictionary, ignore,
 * cut/copy/paste, bold/italic. Words change only when a suggestion is chosen.
 */
export function EditorMenu({
  editor,
  at,
  onClose,
  onComment,
}: {
  editor: Editor;
  at: MenuAt;
  onClose: () => void;
  /** Add / edit / remove a comment (in the book editor). */
  onComment?: (action: 'add' | 'edit' | 'remove') => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  const bad = at.word ? speller.isBad(at.word) === true : false;
  const mine = at.word ? speller.inPersonal(at.word) : false;
  const [sugs, setSugs] = useState<Suggestion[] | null>(null);
  const hasSelection = !editor.state.selection.empty;
  const inComment = editor.isActive('comment');

  useEffect(() => {
    if (!bad || !at.word) return;
    let alive = true;
    void speller.suggest(at.word).then((s) => alive && setSugs(s));
    return () => {
      alive = false;
    };
  }, [bad, at.word]);

  // Keep it on screen
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, at.y + r.height > window.innerHeight - 8 ? at.y - r.height : at.y),
    });
  }, [at.x, at.y, sugs]);

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

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const replace = (s: string) =>
    run(() => {
      const { state, view } = editor;
      view.dispatch(state.tr.insertText(s, at.from, at.to));
      editor.commands.focus();
    });

  const clipboard = (cmd: 'cut' | 'copy') =>
    run(() => {
      editor.commands.focus();
      if (!document.execCommand(cmd)) toast(`Use ${mod}${cmd === 'cut' ? 'X' : 'C'} to ${cmd}.`);
    });

  const paste = run(() => {
    editor.commands.focus();
    if (!navigator.clipboard?.readText) {
      toast(`Use ${mod}V to paste.`);
      return;
    }
    navigator.clipboard.readText().then(
      (text) => text && editor.view.pasteText(text),
      () => toast(`Use ${mod}V to paste.`),
    );
  });

  return (
    <div ref={ref} className="sp-menu" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {bad && at.word && (
        <>
          {sugs === null ? (
            <div className="sp-note">Finding suggestions…</div>
          ) : sugs.length ? (
            sugs.map((s) => (
              <button key={s} type="button" role="menuitem" className="sp-item sp-sug" onClick={replace(s)}>
                <span>{s}</span>
              </button>
            ))
          ) : (
            <div className="sp-note">No suggestions</div>
          )}
          <div className="sp-sep" />
          <button type="button" role="menuitem" className="sp-item" onClick={run(() => speller.addToDictionary(at.word!))}>
            Add “{at.word}” to dictionary
          </button>
          <button type="button" role="menuitem" className="sp-item" onClick={run(() => speller.ignore(at.word!))}>
            Ignore
          </button>
          <div className="sp-sep" />
        </>
      )}
      {mine && at.word && (
        <>
          <button type="button" role="menuitem" className="sp-item" onClick={run(() => speller.removeFromDictionary(at.word!))}>
            Remove “{at.word}” from dictionary
          </button>
          <div className="sp-sep" />
        </>
      )}
      {at.word && /^[A-Za-z][A-Za-z'’-]*$/.test(at.word) && (
        <>
          <button type="button" role="menuitem" className="sp-item" onClick={run(() => openLookup(at.word!))}>
            Look up “{at.word}”
          </button>
          <button type="button" role="menuitem" className="sp-item" onClick={run(() => openRhymes(at.word!))}>
            Rhymes for “{at.word}”
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
      <button type="button" role="menuitem" className="sp-item" onClick={paste}>
        Paste<kbd>{mod}V</kbd>
      </button>
      <div className="sp-sep" />
      <button type="button" role="menuitem" className="sp-item" onClick={run(() => editor.chain().focus().toggleBold().run())}>
        <b>Bold</b>
        <kbd>{mod}B</kbd>
      </button>
      <button type="button" role="menuitem" className="sp-item" onClick={run(() => editor.chain().focus().toggleItalic().run())}>
        <i>Italic</i>
        <kbd>{mod}I</kbd>
      </button>
      {onComment && (inComment || hasSelection) && (
        <>
          <div className="sp-sep" />
          {inComment ? (
            <>
              <button type="button" role="menuitem" className="sp-item" onClick={run(() => onComment('edit'))}>
                Edit comment…<kbd>{mod}Alt+M</kbd>
              </button>
              <button type="button" role="menuitem" className="sp-item" onClick={run(() => onComment('remove'))}>
                Remove comment
              </button>
            </>
          ) : (
            <button type="button" role="menuitem" className="sp-item" onClick={run(() => onComment('add'))}>
              Add comment…<kbd>{mod}Alt+M</kbd>
            </button>
          )}
          <div className="sp-sep" />
        </>
      )}
      <button type="button" role="menuitem" className="sp-item" onClick={run(() => editor.chain().focus().selectAll().run())}>
        Select all<kbd>{mod}A</kbd>
      </button>
      {!speller.ready && !speller.failed && <div className="sp-note sp-foot">Loading the dictionary…</div>}
    </div>
  );
}
