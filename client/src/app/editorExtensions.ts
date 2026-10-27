import { Mark, Node, mergeAttributes, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: { setPageBreak: () => ReturnType };
    sceneBreak: { setSceneBreak: () => ReturnType };
  }
}

/** Manual page break: the following text starts on a new page (Ctrl+Enter). */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'st-pagebreak' }), 'Page break'],
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run(),
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
});

/**
 * Scene break: a centred divider showing that the text moves to another scene (two short black lines, a diamond in the middle).
 * The next paragraph starts without an indent; it is never left alone at the bottom of a page (Ctrl+Shift+Enter).
 */
export const SceneBreak = Node.create({
  name: 'sceneBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-scene-break]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-scene-break': '', class: 'st-scenebreak', title: 'Scene break' }),
    ['span', { class: 'st-sb-line' }],
    ['span', { class: 'st-sb-diamond' }],
    ['span', { class: 'st-sb-line' }],
  ],
  addCommands() {
    return {
      setSceneBreak:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: 'sceneBreak' }, { type: 'paragraph' }]).run(),
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-Enter': () => this.editor.commands.setSceneBreak() };
  },
});

/**
 * Comment: a note on the selected text. Highlighted light gray in the editor; hovering shows the comment.
 * The typesetter (pages, reading, PDF, Word) only reads bold and italic, so comments never show there.
 * Typing on at the edge of the text does not extend the comment.
 */
export const Comment = Mark.create({
  name: 'comment',
  inclusive: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-comment-id') },
      text: { default: '', parseHTML: (el) => el.getAttribute('data-comment') ?? '' },
    };
  },
  parseHTML: () => [{ tag: 'span[data-comment-id]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'span',
    mergeAttributes({ class: 'st-comment', 'data-comment-id': HTMLAttributes.id, 'data-comment': HTMLAttributes.text, title: HTMLAttributes.text }),
    0,
  ],
});

/** Book text: only paragraph, bold, italic, line break, page break and scene break (font and layout are fixed). */
export function bookExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: false,
      code: false,
      codeBlock: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      horizontalRule: false,
      link: false,
      strike: false,
      underline: false,
      dropcursor: false,
      gapcursor: false,
      undoRedo: { depth: 300 },
    }),
    PageBreak,
    SceneBreak,
    Comment,
  ];
}
