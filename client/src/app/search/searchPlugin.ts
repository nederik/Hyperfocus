import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { findInText, type FindOptions } from '@hyperfocus/shared';

/** The searched word in the editor: all matches yellow, the current one orange. */
export interface SearchState {
  q: string;
  opts: FindOptions;
  /** Which match in the chapter is highlighted (-1: none). */
  current: number;
}
interface PluginState {
  search: SearchState | null;
  matches: { from: number; to: number }[];
  decos: DecorationSet;
}

export const searchKey = new PluginKey<PluginState>('hyperfocus-search');

/** Matches paragraph by paragraph (regardless of formatting; positions are document positions). */
export function findMatches(doc: PMNode, s: SearchState | null): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  if (!s || !s.q.trim()) return out;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    node.forEach((child) => {
      // Each inline node takes as much room in the text as it does in the document (text: its letters, others: 1)
      text += child.isText ? child.text! : child.type.name === 'hardBreak' ? '\n' : '￼';
    });
    for (const [a, b] of findInText(text, s.q, s.opts)) out.push({ from: pos + 1 + a, to: pos + 1 + b });
    return false;
  });
  return out;
}

function build(doc: PMNode, search: SearchState | null): PluginState {
  const matches = findMatches(doc, search);
  const decos = DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === search?.current ? 'sr-hit cur' : 'sr-hit' })),
  );
  return { search, matches, decos };
}

export const SearchHighlight = Extension.create({
  name: 'hyperfocusSearch',
  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: searchKey,
        state: {
          init: (_, state) => build(state.doc, null),
          apply: (tr, old) => {
            const meta = tr.getMeta(searchKey) as { search: SearchState | null } | undefined;
            if (meta) return build(tr.doc, meta.search);
            return tr.docChanged ? build(tr.doc, old.search) : old;
          },
        },
        props: { decorations: (state) => searchKey.getState(state)?.decos },
      }),
    ];
  },
});
