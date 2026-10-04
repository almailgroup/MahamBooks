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
