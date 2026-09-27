/** Longest side a reference image keeps, in pixels: plenty to trace from, small enough for browser storage. */
const MAX_SIDE = 2560;

export interface LoadedImage {
  src: string;
  pxWidth: number;
  pxHeight: number;
}

const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });

const decode = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be opened. Try a PNG or JPEG.'));
    img.src = src;
  });

/** Read a picture to trace over, shrunk to fit MAX_SIDE and stored as a JPEG data URL. */
export async function readReferenceImage(file: Blob): Promise<LoadedImage> {
  if (!file.type.startsWith('image/')) throw new Error('That is not an image. Use a PNG, JPEG, WebP or GIF.');
  const img = await decode(await readAsDataUrl(file));
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot prepare images.');
  // JPEG has no transparency; a scanned chart's clear areas become paper white.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return { src: canvas.toDataURL('image/jpeg', 0.85), pxWidth: w, pxHeight: h };
}

/** The first image among dropped or pasted files, if any. */
export function firstImage(files: Iterable<File> | ArrayLike<File> | null | undefined): File | undefined {
  return files ? Array.from(files).find((f) => f.type.startsWith('image/')) : undefined;
}
