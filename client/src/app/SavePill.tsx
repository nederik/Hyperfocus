import type { SaveStatus } from './autosave';

const SAVE_TEXT: Record<SaveStatus, string> = { saved: 'Saved', dirty: 'Saving…', saving: 'Saving…', error: 'Not saved, retrying…' };

/** The save status in the notebook's header (the same for Board and Library). */
export function SavePill({ status }: { status: SaveStatus }) {
  return (
    <span className={`nt-save ${status}`} role="status" aria-live="polite">
      {status === 'saved' && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      )}
      {SAVE_TEXT[status]}
    </span>
  );
}
