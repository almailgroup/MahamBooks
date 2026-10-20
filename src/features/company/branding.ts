import type { Company } from '@/db/types';

/**
 * The most a company record may weigh after its pictures change. The cloud
 * refuses one over 3 MB; this leaves room for everything else it holds.
 */
export const MAX_COMPANY_BYTES = 2.5 * 1024 * 1024;

/** Size of a record as it is synced (JSON, UTF-8). */
export function recordBytes(record: unknown): number {
  return new TextEncoder().encode(JSON.stringify(record)).length;
}

const pictures = (c: Company) => [
  c.branding.logo,
  c.branding.stamp,
  c.branding.signature,
  c.branding.signatureOriginal,
];

/**
 * Whether new pictures (logo, stamp, signature) would make the company
 * record too heavy. Only pictures that make it heavier are refused, so a
 * company that is heavy already can still save its other settings.
 */
export function brandingTooLarge(next: Company, saved: Company): boolean {
  const before = pictures(saved);
  if (pictures(next).every((p, i) => (p ?? null) === (before[i] ?? null))) return false;
  const size = recordBytes(next);
  return size > MAX_COMPANY_BYTES && size > recordBytes(saved);
}
