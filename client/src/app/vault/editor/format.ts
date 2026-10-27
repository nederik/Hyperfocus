import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** Wraps the selection in a mark, or unwraps it if already wrapped (bold, italic…). */
export function toggleWrap(view: EditorView, mark: string) {
  const { state } = view;
  view.dispatch(
    state.changeByRange((r) => {
      const before = state.doc.sliceString(r.from - mark.length, r.from);
      const after = state.doc.sliceString(r.to, r.to + mark.length);
      if (before === mark && after === mark)
        return {
          changes: [
            { from: r.from - mark.length, to: r.from },
            { from: r.to, to: r.to + mark.length },
          ],
          range: EditorSelection.range(r.from - mark.length, r.to - mark.length),
        };
      return {
        changes: [
          { from: r.from, insert: mark },
          { from: r.to, insert: mark },
        ],
        range: EditorSelection.range(r.from + mark.length, r.to + mark.length),
      };
    }),
    { userEvent: 'input.format' },
  );
  view.focus();
}
