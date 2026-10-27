import { useEffect, useState } from 'react';
import { loaderSvg } from '../ui/logo/markup';

/** The loading screen shows for at least this long (so the logo animation is seen); no extra wait if loading takes longer. */
export const ENTRY_MIN_MS = 1400;

/**
 * Loading screen when a screen opens: true until the content is ready AND at least `minMs` has passed.
 * Starts again on every opening (back to the shelf, every book).
 */
export function useEntryLoader(ready: boolean, minMs = ENTRY_MIN_MS) {
  const [start] = useState(() => performance.now());
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!ready || done) return;
    const t = window.setTimeout(() => setDone(true), Math.max(0, minMs - (performance.now() - start)));
    return () => window.clearTimeout(t);
  }, [ready, done, minMs, start]);
  // If something gets stuck, do not hold the screen forever
  useEffect(() => {
    const t = window.setTimeout(() => setDone(true), 15_000);
    return () => window.clearTimeout(t);
  }, []);
  return !done;
}

/**
 * One loading screen shared by all of Hyperfocus: whichever screen asks for it, the same layer stays up.
 * When one screen closes and the next opens (e.g. unlock → shelf) the layer does not flicker and the animation does not restart.
 * While the page's start-up screen (#boot) is still up it covers everything, so this layer is not shown.
 */
let count = 0;
let el: HTMLDivElement | null = null;
let hideTimer = 0;
let removeTimer = 0;

function acquire() {
  count++;
  window.clearTimeout(hideTimer);
  window.clearTimeout(removeTimer);
  if (document.getElementById('boot')) return;
  if (!el) {
    el = document.createElement('div');
    el.className = 'st-loading';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', 'Loading');
    el.innerHTML = loaderSvg(140, 'Hyperfocus', 'Loading');
    document.body.appendChild(el);
  }
  el.classList.remove('done');
}

function release() {
  count = Math.max(0, count - 1);
  if (count) return;
  window.clearTimeout(hideTimer);
  // A short wait: if another screen asks for it at the same time (a screen change), the layer never closes
  hideTimer = window.setTimeout(() => {
    if (count || !el) return;
    el.classList.add('done');
    removeTimer = window.setTimeout(() => {
      if (count || !el) return;
      el.remove();
      el = null;
    }, 450);
  }, 80);
}

/** Is a loading screen being asked for (the start-up screen waits for it)? */
export const loadingActive = () => count > 0;

/** Keeps the shared loading screen up while `show` is true; it fades out when done. */
export function LoadingScreen({ show }: { show: boolean }) {
  useEffect(() => {
    if (!show) return;
    acquire();
    return release;
  }, [show]);
  return null;
}
