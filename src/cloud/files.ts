/**
 * Attachment content: receipts and scans are kept as data URLs on the device
 * and as files in Storage, at {companyId}/{attachmentId}; the record in the
 * cloud carries only its path and a hash of the content.
 */

/** Path of an attachment's file in the bucket. */
export function filePath(companyId: string, attachmentId: string): string {
  return `${companyId}/${attachmentId}`;
}

/** Files up to this size are downloaded with the sync; larger ones when opened. */
export const EAGER_DOWNLOAD_BYTES = 1_500_000;

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const type = /^data:([^;,]+)/.exec(header)?.[1] ?? 'application/octet-stream';
  const body = dataUrl.slice(comma + 1);
  if (header.includes(';base64')) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  return new Blob([decodeURIComponent(body)], { type });
}

export async function blobToDataUrl(blob: Blob, type = blob.type): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

/** SHA-256 of the content, as hex: tells whether a file changed. */
export async function contentHash(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
