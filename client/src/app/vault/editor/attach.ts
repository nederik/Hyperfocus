/**
 * Pasted or dropped images are saved to the library (encrypted) and added to the note as ![[name]].
 * Names are like Obsidian's: "Pasted image 20250101120000.png"; a dropped file keeps its own name.
 * Files go to the top of the library (Obsidian's default attachment location).
 */
import type { EditorView } from '@codemirror/view';
import { toast } from '../../../lib/toast';
import { vault } from '../store';

/** Paths of files being uploaded ("Adding image…" shows in place of the image). */
export const uploading = new Set<string>();
export const UPLOADS_CHANGED = 'hyperfocus:vault-uploads';

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/x-icon': 'ico' };

export const isImageFile = (f: File) => f.type.startsWith('image/');

function pathFor(file: File): string {
  const ext = EXT[file.type] ?? (file.type.split('/')[1] || 'png');
  const own = file.name && !/^image\.\w+$/i.test(file.name) ? file.name : '';
  const name = (own || `Pasted image ${stamp()}.${ext}`).replace(/[\\/:*?"<>|]/g, '-').replace(/^\.+/, '');
  const taken = (p: string) => !!vault.byPath(p) || uploading.has(p);
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const [stem, tail] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 1; ; n++) if (!taken(`${stem} ${n}${tail}`)) return `${stem} ${n}${tail}`;
}

/** Saves the images and inserts their links at `at` (otherwise in place of the selection). */
export function attachImages(view: EditorView, files: File[], at?: number) {
  const imgs = files.filter(isImageFile);
  if (!imgs.length) return false;
  const paths = imgs.map((f) => {
    const p = pathFor(f);
    uploading.add(p);
    return p;
  });
  const text = paths.map((p) => `![[${p}]]`).join('\n');
  const sel = view.state.selection.main;
  const from = at ?? sel.from;
  const to = at ?? sel.to;
  // The image gets a line of its own
  const line = view.state.doc.lineAt(from);
  const lead = from > line.from && view.state.doc.sliceString(from - 1, from) !== '\n' ? '\n' : '';
  const insert = `${lead}${text}\n`;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.paste', scrollIntoView: true });
  view.focus();
  window.dispatchEvent(new Event(UPLOADS_CHANGED));
  void (async () => {
    for (let i = 0; i < imgs.length; i++) {
      const f = imgs[i]!;
      const p = paths[i]!;
      try {
        if (f.size > 24 * 1024 * 1024) throw new Error('An image can be at most 24 MB');
        await vault.putFile(p, new Uint8Array(await f.arrayBuffer()), { mime: f.type || undefined });
      } catch (e) {
        toast(`Could not add “${p}”: ${(e as Error).message}`);
      } finally {
        uploading.delete(p);
        window.dispatchEvent(new Event(UPLOADS_CHANGED));
      }
    }
  })();
  return true;
}

/** Pastes from the clipboard (right-click menu): an image if there is one, otherwise text. */
export async function pasteFromClipboard(view: EditorView) {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (type) files.push(new File([await it.getType(type)], '', { type }));
      }
      if (files.length) return void attachImages(view, files);
    }
    const text = await navigator.clipboard.readText();
    if (text) view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true });
    view.focus();
  } catch {
    toast(`Use ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'}V to paste.`);
  }
}

/** Picks image files and adds them. */
export function pickImages(view: EditorView) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => input.files && attachImages(view, [...input.files]);
  input.click();
}
