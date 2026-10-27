import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { WORD_RE, skipWord, speller } from './speller';

const key = new PluginKey<DecorationSet>('hyperfocus-spell');

/**
 * Underlines unknown words with a wavy line (English + personal dictionary).
 * The word under the cursor, still being typed, is not underlined. No word is ever changed.
 */
function build(doc: PMNode, state: EditorState | null) {
  const decos: Decoration[] = [];
  const sel = state?.selection;
  const caret = sel && sel.empty ? sel.from : -1;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const m of node.text.matchAll(WORD_RE)) {
      const w = m[0];
      if (skipWord(w)) continue;
      const from = pos + m.index!;
      const to = from + w.length;
      if (caret >= from && caret <= to) continue;
      if (speller.isBad(w)) decos.push(Decoration.inline(from, to, { class: 'sp-bad' }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export const SpellCheck = Extension.create({
  name: 'hyperfocusSpell',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => build(state.doc, state),
          apply: (tr, old, _prev, next) => (tr.docChanged || tr.selectionSet || tr.getMeta(key) ? build(tr.doc, next) : old),
        },
        props: { decorations: (state) => key.getState(state) },
        view(view) {
          speller.start();
          let frame = 0;
          // When the answer comes from the background (or the dictionary changes) the lines are refreshed
          const off = speller.subscribe(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
              if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true).setMeta('addToHistory', false));
            });
          });
          return {
            destroy() {
              cancelAnimationFrame(frame);
              off();
            },
          };
        },
      }),
    ];
  },
});
