/**
 * QR codes as PNG data URLs, drawn on the device (the `qrcode` package is
 * loaded on first use): payment links on documents, item codes on labels.
 * Nothing is stored; the same text gives the same picture.
 */

const cache = new Map<string, string>();

/** A QR code of `text`, `width` pixels wide, or null when it can't be drawn. */
export async function qrDataUrl(text: string, width = 240): Promise<string | null> {
  if (!text) return null;
  const key = `${width}:${text}`;
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const QRCode = (await import('qrcode')).default;
    const url = await QRCode.toDataURL(text, { margin: 0, width, errorCorrectionLevel: 'M' });
    cache.set(key, url);
    return url;
  } catch {
    return null;
  }
}
