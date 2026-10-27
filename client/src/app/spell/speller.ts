import { getDictionary, saveDictionary } from '../secure';
import { toast } from '../../lib/toast';
import type { WorkerIn, WorkerOut } from './spell.worker';

export type Suggestion = string;

/** Words that get checked: letters, an inner apostrophe (don't) and hyphens (well-known). */
export const WORD_RE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*(?:-[\p{L}\p{M}]+)*/gu;

/** Single letters and all-capital abbreviations (NASA, BBC) are not checked. */
export function skipWord(w: string) {
  if (w.length < 2) return true;
  return w.length <= 6 && w === w.toUpperCase() && w !== w.toLowerCase();
}

const lower = (w: string) => w.toLowerCase();

/**
 * The editor's spell checker (a single instance). The dictionary loads only when the editor opens, and only on screens used with a mouse.
 * Results are cached; new words are sent to the background in batches, and listeners are told when the answer comes.
 */
class Speller {
  private worker: Worker | null = null;
  private seq = 0;
  private status = new Map<string, boolean>(); // word → is it correct
  private queued = new Set<string>();
  private flushTimer = 0;
  private waiting = new Map<number, (m: WorkerOut) => void>();
  private listeners = new Set<() => void>();
  private personal = new Set<string>();
  private personalList: string[] = [];
  private ignored = new Set<string>();
  ready = false;
  failed = false;

  start() {
    if (this.worker || this.failed) return;
    // Phones have no right-click, so the dictionary is not loaded there.
    if (!window.matchMedia?.('(pointer: fine)').matches) return;
    this.worker = new Worker(new URL('./spell.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'ready') {
        this.ready = true;
        this.flush();
      } else if (m.type === 'failed') {
        this.failed = true;
        toast(`Spell check is unavailable: ${m.message}`);
      } else this.waiting.get(m.id)?.(m);
    };
    // The personal dictionary is stored encrypted too
    void getDictionary()
      .then((words) => this.setPersonal(words, false))
      .catch(() => {});
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  private ask(msg: { type: 'check'; words: string[] } | { type: 'suggest'; word: string }): Promise<WorkerOut> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(id, (m) => {
        this.waiting.delete(id);
        resolve(m);
      });
      this.worker!.postMessage({ ...msg, id } as WorkerIn);
    });
  }

  private flush() {
    window.clearTimeout(this.flushTimer);
    if (!this.ready || !this.queued.size) return;
    const words = [...this.queued];
    this.queued.clear();
    void this.ask({ type: 'check', words }).then((m) => {
      if (m.type !== 'checked') return;
      const bad = new Set(m.bad);
      for (const w of words) this.status.set(w, !bad.has(w));
      this.notify();
    });
  }

  /** true: unknown word; false: correct; undefined: not known yet (queued to be asked). */
  isBad(word: string): boolean | undefined {
    if (!this.worker || this.failed) return false;
    if (this.personal.has(lower(word)) || this.ignored.has(word)) return false;
    const s = this.status.get(word);
    if (s !== undefined) return !s;
    if (!this.queued.has(word)) {
      this.queued.add(word);
      window.clearTimeout(this.flushTimer);
      this.flushTimer = window.setTimeout(() => this.flush(), 60);
    }
    return undefined;
  }

  inPersonal(word: string) {
    return this.personal.has(lower(word));
  }

  async suggest(word: string): Promise<Suggestion[]> {
    if (!this.worker || !this.ready) return [];
    const m = await this.ask({ type: 'suggest', word });
    return m.type === 'suggested' ? m.items : [];
  }

  private setPersonal(words: string[], save: boolean) {
    this.personalList = [...new Set(words)];
    this.personal = new Set(this.personalList.map(lower));
    this.worker?.postMessage({ type: 'personal', words: this.personalList } satisfies WorkerIn);
    this.notify();
    if (save)
      void saveDictionary(this.personalList).catch(() => toast('Could not save your dictionary. Try again.'));
  }

  addToDictionary(word: string) {
    this.setPersonal([...this.personalList, word], true);
  }

  removeFromDictionary(word: string) {
    const key = lower(word);
    this.status.delete(word);
    this.setPersonal(
      this.personalList.filter((w) => lower(w) !== key),
      true,
    );
  }

  /** Do not underline this word for the rest of this session. */
  ignore(word: string) {
    this.ignored.add(word);
    this.notify();
  }
}

export const speller = new Speller();
