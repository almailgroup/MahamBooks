import type {
  ClearanceCertificate,
  Client,
  DocumentType,
  ISODate,
  InvoiceDocument,
  RetentionKind,
} from '@/db/types';
import { msg } from '@/i18n';
import { takesRetention } from './document-calc';

/**
 * Retentions: money a customer holds back from our invoices, or that we hold
 * back from a vendor's bills, until it is released.
 *
 * - Tax retention: under the executive regulations of Law 2/2008 (art. 37)
 *   payers keep 5% of each payment to contractors and suppliers until the
 *   Ministry of Finance tax clearance certificate is shown. Nothing is held
 *   back while a valid certificate is on file.
 * - Contract retention: construction contracts keep a share (often 5–10%)
 *   of each progress billing until handover.
 */

/** The usual tax retention rate. */
export const TAX_RETENTION_PERCENT = 5;

export const RETENTION_KINDS: { value: RetentionKind; label: string; hint: string }[] = [
  {
    value: 'tax',
    label: msg('Tax retention'),
    hint: msg('Held until the Ministry of Finance clearance certificate is shown.'),
  },
  {
    value: 'contract',
    label: msg('Contract retention'),
    hint: msg('Held until handover of the work.'),
  },
];

export function retentionKindLabel(kind: RetentionKind | null | undefined): string {
  return RETENTION_KINDS.find((k) => k.value === (kind ?? 'tax'))!.label;
}

/** Whether a certificate covers a date (issued on or before it and not expired). */
export function certificateValidOn(
  certificate: Pick<ClearanceCertificate, 'issueDate' | 'expiryDate'>,
  date: ISODate,
): boolean {
  if (!certificate.issueDate || certificate.issueDate > date) return false;
  return !certificate.expiryDate || certificate.expiryDate >= date;
}

/** The contact's certificate valid on a date (the one valid the longest), or null. */
export function validCertificate(
  contact: Pick<Client, 'clearanceCertificates'> | null | undefined,
  date: ISODate,
): ClearanceCertificate | null {
  const valid = (contact?.clearanceCertificates ?? []).filter((c) => certificateValidOn(c, date));
  if (valid.length === 0) return null;
  return valid.sort((a, b) =>
    (b.expiryDate ?? '9999-12-31').localeCompare(a.expiryDate ?? '9999-12-31'),
  )[0];
}

/** The contact's retention rate, or 0 when it has none. */
export function contactRetention(
  contact: Pick<Client, 'retentionPercent'> | null | undefined,
): number {
  const percent = contact?.retentionPercent ?? 0;
  return Number.isFinite(percent) && percent > 0 ? Math.min(percent, 100) : 0;
}

/**
 * Retention for a new invoice or bill of this contact: its own rate, except
 * for a tax retention when a valid clearance certificate covers the date.
 */
export function retentionDefaults(
  contact: Pick<Client, 'retentionPercent' | 'retentionKind' | 'clearanceCertificates'> | null,
  type: DocumentType,
  issueDate: ISODate,
): Pick<InvoiceDocument, 'retentionPercent' | 'retentionKind'> {
  const percent = contactRetention(contact);
  if (!takesRetention(type) || !contact || percent === 0) {
    return { retentionPercent: 0, retentionKind: undefined };
  }
  const kind = contact.retentionKind ?? 'tax';
  if (kind === 'tax' && validCertificate(contact, issueDate)) {
    return { retentionPercent: 0, retentionKind: kind };
  }
  return { retentionPercent: percent, retentionKind: kind };
}

/** Where a retention stands, for the retention report. */
export type RetentionStatus =
  | 'certificate' // tax: a valid certificate is on file, it can be released
  | 'expired' // tax: the certificate on file has expired
  | 'awaiting_certificate' // tax: no certificate yet
  | 'awaiting_handover'; // contract

export const RETENTION_STATUS_META: Record<
  RetentionStatus,
  { label: string; tone: 'green' | 'amber' | 'red' | 'blue' }
> = {
  certificate: { label: msg('Certificate on file'), tone: 'green' },
  expired: { label: msg('Certificate expired'), tone: 'red' },
  awaiting_certificate: { label: msg('Waiting for certificate'), tone: 'amber' },
  awaiting_handover: { label: msg('Waiting for handover'), tone: 'blue' },
};

export function retentionStatus(
  kind: RetentionKind | null | undefined,
  contact: Pick<Client, 'clearanceCertificates'> | null | undefined,
  todayIso: ISODate,
): RetentionStatus {
  if ((kind ?? 'tax') === 'contract') return 'awaiting_handover';
  if (validCertificate(contact, todayIso)) return 'certificate';
  return (contact?.clearanceCertificates ?? []).length > 0 ? 'expired' : 'awaiting_certificate';
}
