import { useEffect, useRef, useState } from 'react';

/**
 * Minimum display times of the loading screens. Deliberately a little long so the logo animation can be seen;
 * but this is only a LOWER limit: if the real loading takes longer, no extra wait is added.
 */
export const BOOT_MIN_MS = 2200; // the first opening of the page (from when the browser started opening it)
export const PAGE_MIN_MS = 1000; // moving from page to page inside the app

/**
 * Removes the start-up screen in the HTML (#boot): once the page data is ready AND at least BOOT_MIN_MS has passed since opening.
 * `isBusy` tells whether data requests are still running (TanStack Query).
 */
export function releaseBootWhenReady(isBusy: () => boolean) {
  const boot = document.getElementById('boot');
  if (!boot) return;
  const startedAt = performance.now();
  const tick = () => {
    // performance.now() is the time since the page started opening.
    const elapsed = performance.now();
    const pageRendered = !!document.getElementById('root')?.firstElementChild;
    const ready = pageRendered && !isBusy() && !document.querySelector('#root .page-loader');
    const giveUp = performance.now() - startedAt > 15_000; // if something gets stuck, do not hold the screen forever
    if ((ready && elapsed >= BOOT_MIN_MS) || giveUp) {
      boot.classList.add('boot-done');
      window.setTimeout(() => boot.remove(), 450);
      return;
    }
    window.setTimeout(tick, 80);
  };
  window.setTimeout(tick, 80);
}

/**
 * For an in-page loader: when `loading` ends, it stays true until the loader has been visible for at least `minMs`.
 * If loading already took longer than `minMs`, it does not wait at all.
 */
export function useMinLoading(loading: boolean, minMs = PAGE_MIN_MS) {
  const startRef = useRef<number | null>(loading ? performance.now() : null);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (loading) {
      startRef.current ??= performance.now();
      return;
    }
    if (startRef.current === null) return;
    const remaining = minMs - (performance.now() - startRef.current);
    startRef.current = null;
    if (remaining <= 0) return;
    setHold(true);
    const t = window.setTimeout(() => setHold(false), remaining);
    return () => window.clearTimeout(t);
  }, [loading, minMs]);
  return loading || hold;
}
