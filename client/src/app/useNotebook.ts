import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookNote, NoteTab } from '@hyperfocus/shared';
import { useAutosave } from './autosave';
import { getNotebook, notebookPayload } from './secure';

export const NOTEBOOK_KEY = ['notes'];
/** The note board's view (scroll/zoom) is the same everywhere for the same notebook. */
export const NOTEBOOK_VIEW_KEY = 'hyperfocus-notes';

interface Notebook {
  notes: BookNote[];
  tabs: NoteTab[];
}

/**
 * One notebook: the same notes and tabs on the shelf and inside every book.
 * Read fresh from the server on opening; changes save by themselves and the cache is kept up to date
 * (moving from one page to another shows the latest version).
 */
export function useNotebook() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: NOTEBOOK_KEY,
    // Notes are decrypted in the browser
    queryFn: getNotebook,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [state, setState] = useState<Notebook | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // The whole notebook is encrypted before saving
  const { queue, flush, status } = useAutosave(async () => {
    const cur = stateRef.current;
    if (!cur) throw new Error('Notes are not loaded');
    return notebookPayload(cur);
  });

  useEffect(() => {
    if (state === null && q.data && !q.isFetching) setState({ notes: q.data.notes, tabs: q.data.tabs ?? [] });
  }, [q.data, q.isFetching, state]);

  const commit = useCallback(
    (next: Notebook, patch: Record<string, unknown>) => {
      stateRef.current = next;
      setState(next);
      qc.setQueryData(NOTEBOOK_KEY, next);
      queue('/api/notes', patch);
    },
    [qc, queue],
  );

  const changeNotes = useCallback(
    (notes: BookNote[]) => {
      const cur = stateRef.current;
      if (cur) commit({ ...cur, notes }, { notes });
    },
    [commit],
  );
  const changeTabs = useCallback(
    (tabs: NoteTab[], notes?: BookNote[]) => {
      const cur = stateRef.current;
      if (cur) commit({ tabs, notes: notes ?? cur.notes }, { tabs, ...(notes ? { notes } : {}) });
    },
    [commit],
  );

  return { notes: state?.notes ?? null, tabs: state?.tabs ?? [], changeNotes, changeTabs, flush, status };
}
