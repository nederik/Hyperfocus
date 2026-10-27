import { useEffect, useRef } from 'react';

const VOLUME = 0.8;
/** Music fades in and out slowly (ms). */
const FADE_IN_MS = 2600;
const FADE_OUT_MS = 2000;

/**
 * Chapter music while reading: a single audio element is used (so it can play on an iPhone after the first tap too).
 * When the chapter changes the old music fades out and the new one fades in; a chapter without music is silent.
 */
export function useChapterMusic(url: string | null, enabled: boolean) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const fadeTimer = useRef(0);
  const current = useRef<string | null>(null);

  const el = () => {
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.loop = true;
      audio.current.preload = 'auto';
    }
    return audio.current;
  };

  const fade = (to: number, ms: number, then?: () => void) => {
    const a = el();
    window.clearInterval(fadeTimer.current);
    const from = a.volume;
    const start = performance.now();
    fadeTimer.current = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / ms);
      try {
        a.volume = from + (to - from) * t;
      } catch {
        /* in some browsers the volume is read-only */
      }
      if (t >= 1) {
        window.clearInterval(fadeTimer.current);
        then?.();
      }
    }, 40);
  };

  useEffect(() => {
    const a = el();
    const target = enabled ? url : null;
    if (target === current.current && (!target || !a.paused)) {
      // If we came back into the range while it was fading out, the music is not cut but fades in again
      if (target && a.volume < VOLUME) fade(VOLUME, FADE_IN_MS);
      return;
    }
    const startNew = () => {
      current.current = target;
      if (!target) {
        a.pause();
        return;
      }
      // In a newly entered range the music starts from the beginning
      if (a.getAttribute('src') !== target) a.src = target;
      else a.currentTime = 0;
      a.volume = 0;
      void a.play().then(
        () => fade(VOLUME, FADE_IN_MS),
        () => {
          current.current = null; // the browser did not allow it; tried again when the reader turns the music back on
        },
      );
    };
    if (!a.paused && current.current) fade(0, FADE_OUT_MS, startNew);
    else startNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled]);

  useEffect(
    () => () => {
      window.clearInterval(fadeTimer.current);
      audio.current?.pause();
      audio.current = null;
    },
    [],
  );
}
