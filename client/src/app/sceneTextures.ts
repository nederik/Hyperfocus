/**
 * The scene of the 3D book: a dark walnut desk and out-of-focus (blurred) bookshelves behind it.
 * Both are drawn on a canvas (nothing is downloaded); with a fixed seed they look the same every time.
 */

/** Seeded random numbers (the same shelf every time). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dark walnut desk top: long grain, slight colour waves and fine pores (running horizontally). */
export function drawWalnut(w = 2048, h = 1024): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const r = rng(7);
  g.fillStyle = '#2f1d11';
  g.fillRect(0, 0, w, h);
  // Wide colour bands (the light and dark layers of the wood)
  for (let i = 0; i < 26; i++) {
    const y = r() * h;
    const bh = 20 + r() * 90;
    const light = r() < 0.5;
    g.fillStyle = light ? `rgba(110, 70, 40, ${0.05 + r() * 0.08})` : `rgba(14, 7, 3, ${0.08 + r() * 0.12})`;
    g.beginPath();
    g.moveTo(0, y);
    const f1 = 300 + r() * 200;
    const f2 = 340 + r() * 200;
    for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x / f1 + i) * 6);
    for (let x = w; x >= 0; x -= 8) g.lineTo(x, y + bh + Math.sin(x / f2 + i * 1.7) * 7);
    g.closePath();
    g.fill();
  }
  // Soften the edges of the bands
  const soft = blurInto(c, 3, 1);
  g.drawImage(soft, 0, 0);
  // Fine grain lines
  for (let i = 0; i < 420; i++) {
    const y0 = r() * h;
    const amp = 2 + r() * 9;
    const per = 120 + r() * 420;
    const ph = r() * 10;
    g.strokeStyle = r() < 0.6 ? `rgba(16, 8, 3, ${0.08 + r() * 0.22})` : `rgba(150, 100, 58, ${0.05 + r() * 0.12})`;
    g.lineWidth = 0.6 + r() * 1.8;
    g.beginPath();
    const x0 = r() * w * 0.3 - w * 0.15;
    const len = w * (0.4 + r() * 0.9);
    for (let x = x0; x <= x0 + len; x += 12) {
      const y = y0 + Math.sin(x / per + ph) * amp + Math.sin(x / (per * 0.37) + ph * 2) * amp * 0.3;
      if (x === x0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // Pores: short dark dashes
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(10, 5, 2, ${0.06 + r() * 0.12})`;
    g.fillRect(r() * w, r() * h, 2 + r() * 7, 1);
  }
  return c;
}

/** Blur: by scaling down and up (works in every browser). */
function blurInto(src: HTMLCanvasElement, factor: number, passes: number): HTMLCanvasElement {
  let cur = src;
  for (let p = 0; p < passes; p++) {
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(src.width / factor));
    small.height = Math.max(1, Math.round(src.height / factor));
    const sg = small.getContext('2d')!;
    sg.imageSmoothingEnabled = true;
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(cur, 0, 0, small.width, small.height);
    const big = document.createElement('canvas');
    big.width = src.width;
    big.height = src.height;
    const bg = big.getContext('2d')!;
    bg.imageSmoothingEnabled = true;
    bg.imageSmoothingQuality = 'high';
    bg.drawImage(small, 0, 0, big.width, big.height);
    cur = big;
  }
  return cur;
}

/**
 * Background: bookshelves up to the ceiling, blurred and dim; the warm light of the lamp on the left lights them softly.
 * The colours of the book spines only show as warm patches.
 */
export function drawShelves(w = 2048, h = 1024): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const r = rng(21);
  g.fillStyle = '#140d08';
  g.fillRect(0, 0, w, h);
  const palette = ['#5a1f1a', '#6b2a1f', '#23392b', '#1f3326', '#1f2a3a', '#2a3346', '#7a5a2a', '#8a6a35', '#4a3020', '#5c3b24', '#b9a77e', '#9c8a62', '#3a1f2a', '#2b2b2b'];
  const rows = 5;
  const rowH = h / rows;
  const board = rowH * 0.075;
  // Vertical dividers
  const bays = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.round(f * w));
  for (let row = 0; row < rows; row++) {
    const top = row * rowH;
    const bottom = top + rowH - board;
    for (let b = 0; b < bays.length - 1; b++) {
      let x = bays[b]! + 14;
      const end = bays[b + 1]! - 14;
      while (x < end - 10) {
        // Now and then a gap or a stack of books lying down
        if (r() < 0.05) {
          x += 30 + r() * 60;
          continue;
        }
        if (r() < 0.04) {
          let y = bottom;
          const stackW = 90 + r() * 70;
          for (let k = 0; k < 3 + Math.floor(r() * 4); k++) {
            const th = 12 + r() * 16;
            g.fillStyle = palette[Math.floor(r() * palette.length)]!;
            g.fillRect(x, y - th, Math.min(stackW, end - x), th);
            y -= th + 1;
          }
          x += stackW + 6;
          continue;
        }
        const bw = 12 + r() * 24;
        const bh = (rowH - board) * (0.62 + r() * 0.32);
        const col = palette[Math.floor(r() * palette.length)]!;
        g.fillStyle = col;
        g.fillRect(x, bottom - bh, bw, bh);
        // Gilt bands on the spine and a slight shadow
        if (r() < 0.55) {
          g.fillStyle = `rgba(214, 178, 102, ${0.35 + r() * 0.3})`;
          g.fillRect(x + 2, bottom - bh + bh * 0.12, bw - 4, 3);
          g.fillRect(x + 2, bottom - bh * 0.18, bw - 4, 3);
        }
        g.fillStyle = 'rgba(0, 0, 0, 0.35)';
        g.fillRect(x + bw - 3, bottom - bh, 3, bh);
        x += bw + 1 + r() * 2;
      }
    }
    // Shelf board
    g.fillStyle = '#3a2618';
    g.fillRect(0, bottom, w, board);
    g.fillStyle = 'rgba(200, 150, 90, 0.18)';
    g.fillRect(0, bottom, w, 3);
    g.fillStyle = 'rgba(0, 0, 0, 0.45)';
    g.fillRect(0, bottom - 10, w, 10);
  }
  // Uprights
  for (const x of bays) {
    g.fillStyle = '#2c1c11';
    g.fillRect(x - 12, 0, 24, h);
  }
  // Colours a little faded (far away and dim)
  g.fillStyle = 'rgba(20, 13, 8, 0.38)';
  g.fillRect(0, 0, w, h);
  const out = blurInto(c, 9, 2);
  const og = out.getContext('2d')!;
  // The warm light of the lamp on the left
  const lamp = og.createRadialGradient(w * 0.22, h * 0.72, 0, w * 0.22, h * 0.72, w * 0.62);
  lamp.addColorStop(0, 'rgba(255, 190, 110, 0.2)');
  lamp.addColorStop(0.5, 'rgba(255, 170, 90, 0.08)');
  lamp.addColorStop(1, 'rgba(255, 170, 90, 0)');
  og.fillStyle = lamp;
  og.fillRect(0, 0, w, h);
  // Edges and ceiling in the dark
  const vig = og.createRadialGradient(w * 0.45, h * 0.7, h * 0.2, w * 0.45, h * 0.6, w * 0.7);
  vig.addColorStop(0, 'rgba(8, 5, 3, 0)');
  vig.addColorStop(1, 'rgba(8, 5, 3, 0.88)');
  og.fillStyle = vig;
  og.fillRect(0, 0, w, h);
  const top = og.createLinearGradient(0, 0, 0, h);
  top.addColorStop(0, 'rgba(6, 4, 2, 0.75)');
  top.addColorStop(0.45, 'rgba(6, 4, 2, 0.15)');
  top.addColorStop(1, 'rgba(6, 4, 2, 0.35)');
  og.fillStyle = top;
  og.fillRect(0, 0, w, h);
  return out;
}
