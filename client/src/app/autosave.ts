import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { toast } from '../lib/toast';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export interface Saver {
  /** Are there changes not yet sent, or on their way? */
  unsaved: () => boolean;
  /** Sends what is waiting; true if everything was saved. */
  flush: () => Promise<boolean>;
}

/** Every open autosaver (book editor, notebook). All of them are saved before leaving the page. */
const savers = new Set<Saver>();

export const hasUnsaved = () => [...savers].some((s) => s.unsaved());

/** Adds another saver (e.g. the library notes) to the same "unsaved changes" check; returns a function that removes it. */
export function registerSaver(s: Saver) {
  savers.add(s);
  return () => void savers.delete(s);
}

/** Saves every pending change; true if everything was saved. */
export async function flushAll(): Promise<boolean> {
  const results = await Promise.all([...savers].map((s) => s.flush()));
  return results.every(Boolean) && !hasUnsaved();
}

/**
 * Autosave: changes to the same address are merged and sent after a pause in typing (800 ms).
 * If saving fails nothing is lost; it is retried after 5 s. Sends happen one at a time (the next one waits
 * for the previous to finish), so the answer to “is it saved?” is always right.
 * If there are unsaved changes when the tab is closed, the browser warns.
 */
/**
 * `prepare`: builds the request body right before sending (here: encrypts the whole record).
 * When given, nothing is sent at the last moment while the page closes (encryption cannot run then); the browser only warns.
 */
export function useAutosave(prepare?: (url: string, patch: Record<string, unknown>) => Promise<Record<string, unknown>>) {
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  const pending = useRef(new Map<string, Record<string, unknown>>());
  const timer = useRef(0);
  const busy = useRef(0);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const [status, setStatus] = useState<SaveStatus>('saved');

  const flush = useCallback((): Promise<boolean> => {
    window.clearTimeout(timer.current);
    const run = async (): Promise<boolean> => {
      const jobs = [...pending.current.entries()];
      pending.current.clear();
      if (!jobs.length) return true;
      busy.current++;
      setStatus('saving');
      const failed: typeof jobs = [];
      try {
        await Promise.all(
          jobs.map(([url, body]) =>
            (prepareRef.current ? prepareRef.current(url, body) : Promise.resolve(body)).then((b) => api.patch(url, b)).catch(() => {
              failed.push([url, body]);
            }),
          ),
        );
      } finally {
        busy.current--;
      }
      if (failed.length) {
        // Changes made since are written over the failed ones
        for (const [url, body] of failed) pending.current.set(url, { ...body, ...pending.current.get(url) });
        setStatus('error');
        toast('Could not save. Trying again shortly.');
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void flush(), 5000);
        return false;
      }
      setStatus(pending.current.size ? 'dirty' : 'saved');
      return true;
    };
    // The next send starts when the previous one finishes
    const p = chain.current.then(run, run);
    chain.current = p;
    return p;
  }, []);

  const queue = useCallback(
    (url: string, patch: Record<string, unknown>) => {
      pending.current.set(url, { ...pending.current.get(url), ...patch });
      setStatus('dirty');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  useEffect(() => {
    const saver: Saver = { unsaved: () => pending.current.size > 0 || busy.current > 0, flush };
    savers.add(saver);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!saver.unsaved()) return;
      // One last try: send while the page is closing too (not possible for encrypted records)
      if (!prepareRef.current) for (const [url, body] of pending.current) {
        void fetch(url, {
          method: 'PATCH',
          keepalive: true,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {});
      }
      // The browser's “Do you want to leave this page?” warning
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      savers.delete(saver);
      void flush();
    };
  }, [flush]);

  return { queue, flush, status };
}
