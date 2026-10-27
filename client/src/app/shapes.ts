import { useEffect, useState } from 'react';

/**
 * An image's shape: in evenly spaced rows from top to bottom, the left and right ends of the non-transparent part
 * (as a 0–1 fraction of the image width). A fully transparent row is `null`. Text flows around both sides of this shape.
 */
export type Shape = (readonly [number, number] | null)[];

const ROWS = 200;
const ALPHA_MIN = 28; // below this counts as transparent (so soft edge shadows do not push the text away)

const shapes = new Map<string, Shape>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

export const shapeOf = (url: string): Shape | null => shapes.get(url) ?? null;

function load(url: string) {
  if (shapes.has(url) || loading.has(url)) return;
  loading.add(url);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = () => {
    const w = Math.max(1, Math.min(400, img.naturalWidth));
    const h = ROWS;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch {
      shapes.set(url, Array.from({ length: ROWS }, () => [0, 1] as const));
      return done(url);
    }
    const shape: Shape = [];
    for (let y = 0; y < h; y++) {
      let l = -1;
      let r = -1;
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3]! >= ALPHA_MIN) {
          if (l < 0) l = x;
          r = x;
        }
      }
      shape.push(l < 0 ? null : ([l / w, (r + 1) / w] as const));
    }
    shapes.set(url, shape);
    done(url);
  };
  img.onerror = () => {
    shapes.set(url, Array.from({ length: ROWS }, () => [0, 1] as const));
    done(url);
  };
  img.src = url;
}

function done(url: string) {
  loading.delete(url);
  listeners.forEach((l) => l());
}

/** Loads the shapes of the given images; the version number grows with every new shape (so the layout refreshes). */
export function useShapes(urls: string[]) {
  const [version, setVersion] = useState(0);
  const key = [...new Set(urls)].sort().join('\n');
  useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    listeners.add(l);
    for (const u of key.split('\n')) if (u) load(u);
    return () => {
      listeners.delete(l);
    };
  }, [key]);
  return version;
}

/** Resolves once the images' shapes have loaded (or after `timeout` ms at the latest); for the export layout. */
export function loadShapes(urls: string[], timeout = 8000): Promise<void> {
  const want = [...new Set(urls)].filter((u) => !shapes.has(u));
  if (!want.length) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (want.every((u) => shapes.has(u))) finish();
    };
    const finish = () => {
      listeners.delete(check);
      window.clearTimeout(t);
      resolve();
    };
    const t = window.setTimeout(finish, timeout);
    listeners.add(check);
    want.forEach(load);
    check();
  });
}
