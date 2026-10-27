import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { getMarkRange } from '@tiptap/core';

/**
 * Comments in the writing area: a note on the selected text, which gets a light gray highlight.
 * Comments are only seen in the editor; never on the pages, in reading or in exports (the typesetter ignores them).
 */
export interface CommentState {
  mode: 'new' | 'edit' | 'view';
  from: number;
  to: number;
  id: string;
  text: string;
}

const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 12);

/** The comment under the caret (or selection) and the text it covers. */
export function commentAt(editor: Editor): CommentState | null {
  const type = editor.schema.marks.comment;
  if (!type) return null;
  const { $from } = editor.state.selection;
  const mark = $from.marks().find((m) => m.type === type) ?? $from.nodeAfter?.marks.find((m) => m.type === type);
  if (!mark) return null;
  const range = getMarkRange($from, type, mark.attrs) ?? getMarkRange(editor.state.doc.resolve($from.pos + 1), type, mark.attrs);
  if (!range) return null;
  return { mode: 'view', from: range.from, to: range.to, id: String(mark.attrs.id ?? ''), text: String(mark.attrs.text ?? '') };
}

/** A new comment on the selected text (null without a selection). */
export function startComment(editor: Editor): CommentState | null {
  const existing = commentAt(editor);
  if (existing) return { ...existing, mode: 'edit' };
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  return { mode: 'new', from, to, id: newId(), text: '' };
}

export function removeComment(editor: Editor, c: { from: number; to: number }) {
  editor.chain().focus().setTextSelection({ from: c.from, to: c.to }).unsetMark('comment').setTextSelection(c.to).run();
}

/** The comment card: a box for writing / editing, a short card for reading (right below the text). */
export function CommentBox({ editor, state, onClose, onEdit }: { editor: Editor; state: CommentState; onClose: () => void; onEdit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(state.text);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const writing = state.mode !== 'view';

  // Below the commented text, kept on screen
  useLayoutEffect(() => {
    const place = () => {
      if (editor.isDestroyed) return;
      const a = editor.view.coordsAtPos(Math.min(state.from, editor.state.doc.content.size));
      const b = editor.view.coordsAtPos(Math.min(state.to, editor.state.doc.content.size));
      const el = ref.current;
      const w = el?.offsetWidth ?? 300;
      const h = el?.offsetHeight ?? 120;
      let top = Math.max(a.bottom, b.bottom) + 8;
      if (top + h > window.innerHeight - 8) top = Math.min(a.top, b.top) - h - 8;
      const left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8));
      setPos({ left, top: Math.max(8, top) });
    };
    place();
    const scroller = editor.view.dom.closest('.st-editor-area') ?? window;
    scroller.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      scroller.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [editor, state.from, state.to, state.mode]);

  useEffect(() => {
    if (writing) area.current?.focus();
  }, [writing]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      // Reading card: a click inside the commented text does not close it (it refreshes when the selection changes)
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const save = () => {
    const t = text.trim();
    if (!t) {
      if (state.mode === 'edit') removeComment(editor, state);
      return onClose();
    }
    editor
      .chain()
      .focus()
      .setTextSelection({ from: state.from, to: state.to })
      .setMark('comment', { id: state.id, text: t })
      .setTextSelection(state.to)
      .run();
    onClose();
  };

  return (
    <div
      ref={ref}
      className={`st-comment-box${writing ? ' writing' : ''}`}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
      role="dialog"
      aria-label="Comment"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {writing ? (
        <>
          <textarea
            ref={area}
            className="st-comment-input"
            value={text}
            rows={3}
            maxLength={2000}
            placeholder="Write a comment…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                save();
              }
            }}
          />
          <div className="st-comment-actions">
            {state.mode === 'edit' && (
              <button
                type="button"
                className="btn btn-sm btn-ghost st-comment-del"
                onClick={() => {
                  removeComment(editor, state);
                  onClose();
                }}
              >
                Delete
              </button>
            )}
            <span className="st-spacer" />
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={save} title="Ctrl+Enter">
              {state.mode === 'new' ? 'Comment' : 'Save'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="st-comment-text">{state.text}</p>
          <div className="st-comment-actions">
            <span className="st-spacer" />
            <button type="button" className="btn btn-sm btn-ghost" onClick={onEdit}>
              Edit
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost st-comment-del"
              onClick={() => {
                removeComment(editor, state);
                onClose();
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
