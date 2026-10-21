import type { SignatureInk } from '@/db/types';
import { t } from '@/i18n';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t('This file could not be read as an image.')));
    img.src = src;
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(t('Could not read the file.')));
    reader.readAsDataURL(file);
  });
}

/**
 * Re-encodes an image as PNG through a canvas, scaled to fit `maxSize`.
 * This guarantees a format the PDF renderer understands (PNG), strips
 * metadata and protects against corrupt files.
 */
export async function normalizeImage(src: string, maxSize = 800): Promise<string> {
  const img = await loadImage(src);
  const width = img.naturalWidth || img.width || maxSize;
  const height = img.naturalHeight || img.height || maxSize;
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('Your browser cannot process images.'));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** A picture's pixels (RGBA), drawn on a canvas, with its canvas. */
async function pixelsOf(src: string) {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, img.naturalWidth || img.width);
  canvas.height = Math.max(1, img.naturalHeight || img.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error(t('Your browser cannot process images.'));
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx, image: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

/** Ballpoint blue, the colour of a signature signed in blue. */
export const BLUE_INK: readonly [number, number, number] = [24, 58, 168];

/** Paper is lighter than this (0 is black, 1 white) when a picture has no paper to read. */
const PAPER = 0.8;
/** How much darker than the paper a stroke is when it prints in full ink. */
const INK_RAMP = 0.4;

/** Brightness of a pixel, from 0 (black) to 255 (white). */
const brightness = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Where paper ends and ink starts (0 black, 1 white), read from the picture:
 * a little darker than its typical pixel, which is the paper of a photo or a
 * scan, so the grey of a photographed sheet goes too. A picture that is mostly
 * transparent already has no paper.
 */
export function paperThreshold(data: Uint8ClampedArray): number {
  const counts = new Array<number>(256).fill(0);
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    counts[Math.round(brightness(data[i], data[i + 1], data[i + 2]))]++;
    opaque++;
  }
  if (opaque * 2 < data.length / 4) return PAPER;
  let seen = 0;
  let median = 255;
  for (let level = 0; level < 256; level++) {
    seen += counts[level];
    if (seen * 2 >= opaque) {
      median = level;
      break;
    }
  }
  return Math.min(0.9, Math.max(INK_RAMP + 0.1, median / 255 - 0.1));
}

/**
 * Recolours pixels (RGBA) to an ink: strokes darker than the paper take the
 * ink's colour, fully at `threshold - INK_RAMP` and fading out towards the
 * threshold, so soft edges stay soft; the paper becomes transparent.
 * 'original' leaves them as they are. Returns a new array.
 */
export function inkPixels(
  data: Uint8ClampedArray,
  ink: SignatureInk,
  threshold = paperThreshold(data),
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  if (ink !== 'blue') return out;
  const [r, g, b] = BLUE_INK;
  const paper = threshold * 255;
  const ramp = INK_RAMP * 255;
  for (let i = 0; i < out.length; i += 4) {
    const level = brightness(data[i], data[i + 1], data[i + 2]);
    const strength = Math.min(1, Math.max(0, (paper - level) / ramp));
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = Math.round(data[i + 3] * strength);
  }
  return out;
}

/**
 * Whether the visible pixels are all in blue ink, as `inkPixels` leaves them.
 * A signature replaced by an older version of the app is not.
 */
export function isBlueInk(data: Uint8ClampedArray): boolean {
  let visible = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Faint pixels lose their exact colour in the PNG.
    if (data[i + 3] < 64) continue;
    visible++;
    if (BLUE_INK.some((c, k) => Math.abs(data[i + k] - c) > 12)) return false;
  }
  return visible > 0;
}

/**
 * The image in an ink, as a PNG: for blue, dark strokes become blue and the
 * paper transparent. Done once, when a signature is added or its ink changed.
 */
export async function inkImage(src: string, ink: SignatureInk): Promise<string> {
  if (ink !== 'blue') return src;
  const { canvas, ctx, image } = await pixelsOf(src);
  image.data.set(inkPixels(image.data, ink));
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** The ink an image is in: blue when `inkImage` made it, else the original. */
export async function imageInk(src: string): Promise<SignatureInk> {
  const { image } = await pixelsOf(src);
  return isBlueInk(image.data) ? 'blue' : 'original';
}

/**
 * The box around what is drawn on a transparent canvas (pixels as RGBA, row
 * by row), with `margin` pixels around it; null when nothing is.
 */
export function inkBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  margin = 0,
): { x: number; y: number; width: number; height: number } | null {
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return null;
  const x = Math.max(0, left - margin);
  const y = Math.max(0, top - margin);
  return {
    x,
    y,
    width: Math.min(width, right + 1 + margin) - x,
    height: Math.min(height, bottom + 1 + margin) - y,
  };
}

export async function logoFromFile(file: File): Promise<string> {
  if (file.size > MAX_INPUT_BYTES) throw new Error(t('Please choose an image smaller than 8 MB.'));
  if (!/^image\//.test(file.type))
    throw new Error(t('Please choose an image file (PNG, JPG, SVG or WebP).'));
  return normalizeImage(await readAsDataUrl(file));
}

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/**
 * Prepares a receipt or bill scan for storage: photos are scaled to at most
 * 1600 px and saved as JPEG (readable, small); PDFs are kept as they are.
 */
export async function receiptFromFile(file: File): Promise<{ dataUrl: string; type: string }> {
  if (file.size > MAX_RECEIPT_BYTES) throw new Error(t('Please choose a file smaller than 10 MB.'));
  if (file.type === 'application/pdf') {
    return { dataUrl: await readAsDataUrl(file), type: file.type };
  }
  if (!/^image\//.test(file.type)) throw new Error(t('Please choose a photo or a PDF.'));
  const img = await loadImage(await readAsDataUrl(file));
  const width = img.naturalWidth || img.width || 1600;
  const height = img.naturalHeight || img.height || 1600;
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('Your browser cannot process images.'));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), type: 'image/jpeg' };
}

const MAX_PHOTO_INPUT_BYTES = 10 * 1024 * 1024;

/**
 * An employee photo: a square from the picture, at most 512 px, as JPEG
 * (tens of kilobytes), so a list of many employees stays light. Portraits
 * keep the top, where the face is.
 */
export async function photoFromFile(file: File, size = 512): Promise<string> {
  if (file.size > MAX_PHOTO_INPUT_BYTES) {
    throw new Error(t('Please choose a photo smaller than 10 MB.'));
  }
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error(t('Please choose a photo (JPG, PNG or WebP).'));
  }
  const img = await loadImage(await readAsDataUrl(file));
  const width = img.naturalWidth || img.width || size;
  const height = img.naturalHeight || img.height || size;
  const side = Math.min(width, height);
  const sx = (width - side) / 2;
  const sy = height > width ? (height - side) * 0.15 : 0;
  const out = Math.max(1, Math.min(size, side));
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('Your browser cannot process images.'));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out, out);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * A picture of an item: the whole picture (nothing cropped), at most `max`
 * px on its longer side, as JPEG on white (about 200 KB at 1024 px).
 */
export async function productImageFromFile(file: File, max = 1024): Promise<string> {
  if (file.size > MAX_PHOTO_INPUT_BYTES) {
    throw new Error(t('Please choose a photo smaller than 10 MB.'));
  }
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error(t('Please choose a photo (JPG, PNG or WebP).'));
  }
  return jpegOf(await loadImage(await readAsDataUrl(file)), max);
}

/** The image drawn on white, at most `max` px on its longer side, as JPEG. */
function jpegOf(img: HTMLImageElement, max: number, quality = 0.85): string {
  const width = img.naturalWidth || img.width || max;
  const height = img.naturalHeight || img.height || max;
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('Your browser cannot process images.'));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** The picture turned a quarter clockwise, as JPEG. */
export async function rotateImage(src: string): Promise<string> {
  const img = await loadImage(src);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, height);
  canvas.height = Math.max(1, width);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('Your browser cannot process images.'));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

const thumbnails = new Map<string, Promise<string>>();

/**
 * A small copy of a stored picture, for lists and printed documents, made
 * once per picture and size (a changed picture is a new attachment, so a new
 * key). Where pictures can't be drawn, the picture itself.
 */
export function imageThumbnail(key: string, src: string, size: number): Promise<string> {
  const id = `${key}:${size}`;
  let made = thumbnails.get(id);
  if (!made) {
    const canDraw = typeof document !== 'undefined' && canvasWorks();
    made = canDraw ? loadImage(src).then((img) => jpegOf(img, size, 0.8)) : Promise.resolve(src);
    made = made.catch(() => src);
    thumbnails.set(id, made);
  }
  return made;
}

let canvasSupport: boolean | null = null;

function canvasWorks(): boolean {
  if (canvasSupport === null) {
    try {
      canvasSupport = Boolean(document.createElement('canvas').getContext('2d'));
    } catch {
      canvasSupport = false;
    }
  }
  return canvasSupport;
}
