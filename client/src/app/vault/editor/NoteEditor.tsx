/**
 * The editor for library notes (CodeMirror, which Obsidian uses too). Notes stay Markdown;
 * images show as images and colored text in color. Ctrl+V pastes images; right-click opens its own menu.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Annotation, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { VaultItem } from '../store';
import { vault } from '../store';
import { attachImages, isImageFile, UPLOADS_CHANGED } from './attach';
import { embedExtension, refreshEmbeds } from './embeds';
import { toggleWrap } from './format';
import { inkExtension, setActiveEditor } from './ink';
import { NoteMenu, type NoteMenuAt } from './NoteMenu';

const external = Annotation.define<boolean>();

const style = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.6em', fontWeight: '700', fontFamily: 'var(--serif-display)' },
  { tag: t.heading2, fontSize: '1.35em', fontWeight: '700', fontFamily: 'var(--serif-display)' },
  { tag: t.heading3, fontSize: '1.18em', fontWeight: '700', fontFamily: 'var(--serif-display)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.monospace, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '.9em' },
  { tag: t.quote, color: 'var(--ink-2)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: '#a89b88' },
]);

export function NoteEditor({
  item,
  items,
  viewRef,
  onOpenNote,
}: {
  item: VaultItem;
  items: VaultItem[];
  viewRef: React.MutableRefObject<EditorView | null>;
  onOpenNote: (target: string, newTab: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const openRef = useRef(onOpenNote);
  openRef.current = onOpenNote;
  const [menu, setMenu] = useState<NoteMenuAt | null>(null);

  useLayoutEffect(() => {
    const id = item.id;
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: item.text ?? '',
        extensions: [
          history(),
          keymap.of([
            { key: 'Mod-b', run: (v) => (toggleWrap(v, '**'), true) },
            { key: 'Mod-i', run: (v) => (toggleWrap(v, '*'), true) },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(style),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': 'Markdown' }),
          inkExtension(),
          embedExtension(
            () => itemsRef.current,
            (target, newTab) => openRef.current(target, newTab),
          ),
          EditorView.domEventHandlers({
            paste(e, v) {
              const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile);
              if (!files.length) return false;
              e.preventDefault();
              return attachImages(v, files);
            },
            drop(e, v) {
              const files = [...(e.dataTransfer?.files ?? [])].filter(isImageFile);
              if (!files.length) return false;
              e.preventDefault();
              const at = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
              return attachImages(v, files, at);
            },
            contextmenu(e, v) {
              e.preventDefault();
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
              const sel = v.state.selection.main;
              // A right-click outside the selection moves the caret there
              if (pos !== null && (sel.empty || pos < sel.from || pos > sel.to)) v.dispatch({ selection: { anchor: pos } });
              const link = (e.target as HTMLElement).closest<HTMLElement>('.cm-wikilink')?.dataset.target ?? null;
              setMenu({ x: e.clientX, y: e.clientY, link });
              return true;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(external))) vault.setText(id, u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    setActiveEditor(view);
    return () => {
      setActiveEditor(null);
      viewRef.current = null;
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // The note changed elsewhere (Obsidian sync): take it into the editor
  useEffect(() => {
    const v = viewRef.current;
    const text = item.text ?? '';
    if (v && v.state.doc.toString() !== text)
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, annotations: [external.of(true), Transaction.addToHistory.of(false)] });
  }, [item.text, viewRef]);

  // Files changed or an image finished uploading: resolve the images again
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshEmbeds.of(null) });
  }, [items, viewRef]);
  useEffect(() => {
    const on = () => viewRef.current?.dispatch({ effects: refreshEmbeds.of(null) });
    window.addEventListener(UPLOADS_CHANGED, on);
    return () => window.removeEventListener(UPLOADS_CHANGED, on);
  }, [viewRef]);

  return (
    <>
      <div ref={host} className="vt-cm" />
      {menu && viewRef.current && <NoteMenu view={viewRef.current} at={menu} onOpenNote={onOpenNote} onClose={() => setMenu(null)} />}
    </>
  );
}
