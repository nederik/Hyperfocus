/**
 * While editing, images show as images rather than text (like Obsidian): ![[image.png|300]] and ![](path).
 * With the caret on the link its text shows too, with the image below. [[Note]] links are colored
 * and open with Ctrl+click.
 */
import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { resolveLink } from '../markdown';
import { baseName, isImage, vault, type VaultItem } from '../store';
import { uploading } from './attach';

/** Notes or files changed: resolve the images again. */
export const refreshEmbeds = StateEffect.define<null>();

const EMBED = /!\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g;
const MD_IMAGE = /!\[([^\]\n]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\)/g;
const WIKI = /\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g;

class ImageWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly id: string | null,
    readonly src: string | null,
    readonly width: string | null,
    readonly pending: boolean,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.target === this.target && o.id === this.id && o.src === this.src && o.width === this.width && o.pending === this.pending;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span');
    wrap.className = 'cm-embed';
    if (!this.id && !this.src) {
      wrap.classList.add('cm-embed-note');
      wrap.textContent = this.pending ? 'Adding image…' : `Missing: ${this.target}`;
      return wrap;
    }
    const img = document.createElement('img');
    img.alt = baseName(this.target);
    if (this.width) img.style.width = `${this.width}px`;
    img.onload = () => view.requestMeasure();
    wrap.appendChild(img);
    if (this.src) img.src = this.src;
    else
      vault.fileUrl(this.id!).then(
        (u) => (img.src = u),
        () => {
          wrap.classList.add('cm-embed-note');
          wrap.textContent = `Could not open ${this.target}`;
        },
      );
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

export function embedExtension(getItems: () => VaultItem[], onOpenNote: (target: string, newTab: boolean) => void): Extension {
  const build = (view: EditorView): DecorationSet => {
    const items = getItems();
    const sel = view.state.selection.ranges;
    const touched = (a: number, b: number) => sel.some((r) => r.from <= b && r.to >= a);
    const found: { from: number; to: number; deco: Decoration }[] = [];
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      const image = (start: number, end: number, target: string, width: string | null, external: string | null) => {
        let id: string | null = null;
        if (!external) {
          const it = resolveLink(target, items, false);
          if (it && it.meta.kind === 'file' && isImage(it.meta.mime)) id = it.id;
          else if (it) return; // an embedded note: stays as text
        }
        const w = new ImageWidget(target, id, external, width, !id && uploading.has(target));
        if (touched(start, end)) found.push({ from: end, to: end, deco: Decoration.widget({ widget: w, side: 1 }) });
        else found.push({ from: start, to: end, deco: Decoration.replace({ widget: w }) });
      };
      for (const m of text.matchAll(EMBED)) {
        const opt = m[2]?.trim();
        image(from + m.index!, from + m.index! + m[0].length, m[1]!.trim(), opt && /^\d+(x\d+)?$/.test(opt) ? opt.split('x')[0]! : null, null);
      }
      for (const m of text.matchAll(MD_IMAGE)) {
        const raw = m[2]!;
        const ext = /^https?:\/\//i.test(raw) ? raw : null;
        let target = raw;
        try {
          target = decodeURI(raw);
        } catch {
          /* as it is */
        }
        image(from + m.index!, from + m.index! + m[0].length, target, null, ext);
      }
      for (const m of text.matchAll(WIKI)) {
        const start = from + m.index!;
        if (start > 0 && view.state.doc.sliceString(start - 1, start) === '!') continue;
        found.push({
          from: start,
          to: start + m[0].length,
          deco: Decoration.mark({ class: 'cm-wikilink', attributes: { 'data-target': m[1]!.trim(), title: 'Ctrl+click to open' } }),
        });
      }
    }
    found.sort((a, b) => a.from - b.from || a.to - b.to);
    const b = new RangeSetBuilder<Decoration>();
    let last = -1;
    for (const f of found) {
      // Skip overlapping decorations (e.g. both ![[...]] and [[...]])
      if (f.from < last) continue;
      b.add(f.from, f.to, f.deco);
      if (f.to > f.from) last = f.to;
    }
    return b.finish();
  };

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(refreshEmbeds))))
          this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );

  const clicks = EditorView.domEventHandlers({
    mousedown(e) {
      if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
      const link = (e.target as HTMLElement).closest<HTMLElement>('.cm-wikilink');
      if (!link?.dataset.target) return false;
      e.preventDefault();
      onOpenNote(link.dataset.target, e.shiftKey);
      return true;
    },
  });

  return [plugin, clicks];
}
