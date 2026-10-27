import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

const KEY = 'hyperfocus-sepia';

const read = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** The eye comfort setting (applies on every screen); the button only shows on the shelf. */
let on = read();
const listeners = new Set<() => void>();
const apply = () => document.documentElement.classList.toggle('eye-sepia', on);
function setOn(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
  apply();
  for (const fn of listeners) fn();
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/**
 * Eye comfort: tints the whole screen sepia and muted (lower brightness and contrast).
 * Applies on every screen; the choice is remembered in the browser.
 */
export function EyeComfort() {
  useEffect(() => {
    apply();
  }, []);
  return null;
}

/** The sepia button: bottom left, on the shelf only. */
export function EyeComfortToggle() {
  const value = useSyncExternalStore(subscribe, () => on);
  return createPortal(
    <button
      type="button"
      className={`eye-toggle${value ? ' on' : ''}`}
      onClick={() => setOn(!value)}
      aria-pressed={value}
      title={value ? 'Eye comfort is on — turn off' : 'Eye comfort: sepia, muted colors'}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="3.2" fill={value ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" />
      </svg>
      <span className="eye-label">{value ? 'Sepia on' : 'Sepia'}</span>
    </button>,
    document.body,
  );
}
