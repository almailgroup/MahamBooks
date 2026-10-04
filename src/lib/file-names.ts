/**
 * Names of the files the app saves (PDFs, CSV exports, backups, ZIPs).
 * Browsers save a file whose suggested name has a letter outside ASCII
 * (Arabic, "é") or an en dash as "download", so names are made of ASCII
 * only: build them from document numbers, dates and English words, and
 * pass them through `downloadName` before saving.
 */

/** The ASCII of a part of a name: other letters are dropped, dashes kept. */
function asciiPart(text: string): string {
  return (
    text
      // "é" becomes "e" plus an accent, which is dropped below.
      .normalize('NFKD')
      .replace(/[‐-―−]/g, '-')
      .replace(/[^\x20-\x7e]/g, '')
      // Characters files can't have.
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.-]+|[\s.-]+$/g, '')
  );
}

/**
 * A file name that saves the same in every browser and language: ASCII
 * parts joined with " - " (empty parts left out), then the extension.
 * `fileName(['Invoice INV-1', 'شركة الميل'], 'pdf')` is "Invoice INV-1.pdf".
 */
export function fileName(parts: string | string[], extension: string, fallback = 'file'): string {
  const base = (Array.isArray(parts) ? parts : [parts]).map(asciiPart).filter(Boolean).join(' - ');
  const ext = extension ? `.${extension.replace(/^\./, '').toLowerCase()}` : '';
  return `${base || asciiPart(fallback) || 'file'}${ext}`;
}

/** Makes a name about to be saved safe (see `fileName`), keeping its extension. */
export function downloadName(name: string, fallback = 'file'): string {
  const match = /^(.*?)(\.[A-Za-z0-9]{1,5})?$/.exec(name.trim());
  return fileName(match?.[1] ?? '', match?.[2] ?? '', fallback);
}
