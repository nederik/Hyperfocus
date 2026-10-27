/**
 * The surfaces of the 3D book are drawn on a canvas: front cover, back cover (with the blurb), spine and page edges.
 * Text in EB Garamond; with a cover image the front cover is that image, and the spine and back take its average colour.
 */
export interface CoverStyle {
  bg: string;
  ink: string;
  accent: string;
  /** Front cover image (if uploaded). */
  image: HTMLImageElement | null;
  /** Book without an image: leather binding (no frame, a fine leather texture). */
  leather?: boolean;
}

/** Leather texture: a fine grain that varies the colour slightly. */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 16;
    d[i] = d[i]! + n;
    d[i + 1] = d[i + 1]! + n;
    d[i + 2] = d[i + 2]! + n;
  }
  ctx.putImageData(img, 0, 0);
}

const SERIF = '"EB Garamond", Georgia, serif';
export const COVER_W = 1024;
export const COVER_H = Math.round((1024 * 210) / 148);

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** The cover image's average colour; dark text on a light colour, light text on a dark one. */
export async function coverStyle(coverUrl: string | null): Promise<CoverStyle> {
  // Book without an image: the 3D version of the black leather cover on the shelf, a little greyer so it reads better under light
  const plain: CoverStyle = { bg: '#4a4743', ink: '#f4efe6', accent: 'rgba(244, 239, 230, 0.7)', image: null, leather: true };
  if (!coverUrl) return plain;
  const image = await loadImage(coverUrl);
  if (!image) return plain;
  const [, ctx] = canvas(8, 8);
  ctx.drawImage(image, 0, 0, 8, 8);
  let r = 0;
  let g = 0;
  let b = 0;
  try {
    const d = ctx.getImageData(0, 0, 8, 8).data;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]!;
      g += d[i + 1]!;
      b += d[i + 2]!;
    }
  } catch {
    return { ...plain, image };
  }
  const n = 64;
  // The spine and back cover are a little darker (on a real binding they look darker than the cloth cover).
  const k = 0.82;
  r = Math.round((r / n) * k);
  g = Math.round((g / n) * k);
  b = Math.round((b / n) * k);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return {
    bg: `rgb(${r},${g},${b})`,
    ink: lum > 0.55 ? '#2b2118' : '#f6efe0',
    accent: lum > 0.55 ? '#8a6a35' : '#d9bf86',
    image,
  };
}

/** Splits text into lines that fit the given width. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const lines: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxW && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function frame(ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(46, 46, w - 92, h - 92);
  ctx.lineWidth = 1;
  ctx.strokeRect(58, 58, w - 116, h - 116);
}

/** Draws an image so it fills w × h (centred, cropped). */
function fillImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  ctx.drawImage(img, (w - img.naturalWidth * s) / 2, (h - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
}

/** Front cover: the image (centred and cropped to A5) or a typeset cover. */
export function drawFront(style: CoverStyle, title: string, author: string) {
  const [c, ctx] = canvas(COVER_W, COVER_H);
  if (style.image) {
    fillImage(ctx, style.image, COVER_W, COVER_H);
    return c;
  }
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, COVER_W, COVER_H);
  if (style.leather) grain(ctx, COVER_W, COVER_H);
  else frame(ctx, COVER_W, COVER_H, style.accent);
  ctx.fillStyle = style.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 92px ${SERIF}`;
  const lines = wrap(ctx, title || 'Untitled', COVER_W - 220);
  const lh = 104;
  let y = COVER_H / 2 - ((lines.length - 1) * lh) / 2 - 40;
  for (const l of lines) {
    ctx.fillText(l, COVER_W / 2, y);
    y += lh;
  }
  ctx.fillStyle = style.accent;
  ctx.fillRect(COVER_W / 2 - 70, y - 40, 140, 3);
  ctx.fillStyle = style.ink;
  ctx.font = `italic 400 44px ${SERIF}`;
  ctx.fillText(author, COVER_W / 2, y + 40);
  return c;
}

/** Back cover: its own image, or the book's title, the blurb and the author. */
export function drawBack(style: CoverStyle, title: string, author: string, synopsis: string, image: HTMLImageElement | null = null) {
  const [c, ctx] = canvas(COVER_W, COVER_H);
  if (image) {
    fillImage(ctx, image, COVER_W, COVER_H);
    return c;
  }
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, COVER_W, COVER_H);
  if (style.leather) grain(ctx, COVER_W, COVER_H);
  else frame(ctx, COVER_W, COVER_H, style.accent);
  ctx.fillStyle = style.ink;
  ctx.textAlign = 'center';
  ctx.font = `400 58px ${SERIF}`;
  const titleLines = wrap(ctx, title || 'Untitled', COVER_W - 260);
  ctx.font = `italic 400 40px ${SERIF}`;
  const body = wrap(ctx, synopsis, COVER_W - 280).slice(0, 18);
  const total = titleLines.length * 66 + 60 + body.length * 58 + 90;
  let y = Math.max(170, COVER_H / 2 - total / 2);
  ctx.font = `400 58px ${SERIF}`;
  for (const l of titleLines) {
    ctx.fillText(l, COVER_W / 2, y);
    y += 66;
  }
  ctx.fillStyle = style.accent;
  ctx.fillRect(COVER_W / 2 - 60, y - 22, 120, 3);
  y += 50;
  ctx.fillStyle = style.ink;
  ctx.font = `italic 400 40px ${SERIF}`;
  for (const l of body) {
    ctx.fillText(l, COVER_W / 2, y);
    y += 58;
  }
  ctx.font = `400 30px ${SERIF}`;
  ctx.globalAlpha = 0.8;
  ctx.fillText(author.toUpperCase().split('').join(' '), COVER_W / 2, Math.min(COVER_H - 120, y + 60));
  ctx.globalAlpha = 1;
  return c;
}

/**
 * Spine: its own image, or the title and author reading top to bottom (larger when the book is thick).
 * A wide image is turned a quarter so it reads top to bottom too.
 */
export function drawSpine(style: CoverStyle, title: string, author: string, ratio: number, image: HTMLImageElement | null = null) {
  const h = 2048;
  const w = Math.max(48, Math.round(h * ratio));
  const [c, ctx] = canvas(w, h);
  if (image) {
    if (image.naturalWidth > image.naturalHeight) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.rotate(Math.PI / 2);
      fillImage(ctx, image, h, w);
      ctx.restore();
    } else fillImage(ctx, image, w, h);
    return c;
  }
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, w, h);
  if (style.leather) grain(ctx, w, h);
  // Spine bands
  ctx.fillStyle = style.accent;
  ctx.fillRect(0, 90, w, 4);
  ctx.fillRect(0, 104, w, 2);
  ctx.fillRect(0, h - 106, w, 2);
  ctx.fillRect(0, h - 94, w, 4);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = style.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = Math.max(18, Math.min(76, w * 0.42));
  ctx.font = `400 ${size}px ${SERIF}`;
  let t = title || 'Untitled';
  while (ctx.measureText(t).width > h * 0.56 && t.length > 4) t = t.slice(0, -2).trimEnd() + '…';
  const authorSize = size * 0.62;
  ctx.fillText(t, -h * 0.08, 0);
  ctx.font = `italic 400 ${authorSize}px ${SERIF}`;
  ctx.globalAlpha = 0.85;
  ctx.fillText(author, h * 0.34, 0);
  ctx.restore();
  return c;
}

/** Page edges: fine paper lines. `vertical`: vertical lines (fore edge), otherwise horizontal (top/bottom). */
export function drawEdges(vertical: boolean) {
  const n = 512;
  const [c, ctx] = canvas(n, n);
  ctx.fillStyle = '#efe6d1';
  ctx.fillRect(0, 0, n, n);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i += 2) {
    const shade = 200 + Math.floor(rand() * 40);
    ctx.fillStyle = `rgba(${shade - 30},${shade - 40},${shade - 70},${0.18 + rand() * 0.25})`;
    if (vertical) ctx.fillRect(i, 0, 1, n);
    else ctx.fillRect(0, i, n, 1);
  }
  return c;
}
