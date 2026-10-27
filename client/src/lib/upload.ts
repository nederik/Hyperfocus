import { api } from './api';

const MAX_SIDE = 2400;

/** Shrinks an image before upload and converts it to WEBP (GIFs are sent as they are, so animations survive). */
export async function compress(file: File, maxSide: number, quality: number): Promise<{ blob: Blob; width: number; height: number; name: string }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('This file could not be read. Try JPG, PNG, WEBP or GIF.');
  const { width, height } = bitmap;
  if (file.type === 'image/gif') {
    bitmap.close();
    return { blob: file, width, height, name: file.name };
  }
  const ratio = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.round(width * ratio);
  const h = Math.round(height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', quality));
  if (!blob || blob.type !== 'image/webp') {
    const jpg = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', Math.min(0.95, quality + 0.02)));
    return { blob: jpg ?? file, width: w, height: h, name: 'image.jpg' };
  }
  return { blob, width: w, height: h, name: 'image.webp' };
}

export interface Uploaded {
  url: string;
  width: number;
  height: number;
}

/** Uploads an image. `quality`: WEBP quality (covers and pages use a high value for print). */
export async function uploadImage(file: File, maxSide = MAX_SIDE, quality = 0.86): Promise<Uploaded> {
  if (!file.type.startsWith('image/')) throw new Error('Only image files can be uploaded.');
  const { blob, width, height, name } = await compress(file, maxSide, quality);
  if (blob.size > 10 * 1024 * 1024) throw new Error('The image is too large (at most 10 MB).');
  const form = new FormData();
  form.append('file', new File([blob], name, { type: blob.type }));
  form.append('width', String(width));
  form.append('height', String(height));
  const r = await api.post<{ url: string }>('/api/uploads', form);
  return { url: r.url, width, height };
}
