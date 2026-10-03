import { db } from './db';
import { logActivity } from './activity';
import { nowStamp } from './defaults';
import {
  assertUnlocked,
  createJournal,
  ensureSpecAccount,
  newJournalLine,
  reverseJournal,
  roleMap,
  saveJournal,
} from './accounting';
import { accountingSettings } from './chart-setup';
import { applyTotals, paidAmount, RetentionError } from './documents';
import { addAttachment } from './purchases';
import type {
  ClearanceCertificate,
  Client,
  ID,
  ISODate,
  InvoiceDocument,
  RetentionRelease,
} from './types';
import { isPosted, rateOf } from '@/lib/accounting/ledger';
import { releasedRetention, takesRetention } from '@/lib/document-calc';
import { isISODate, today } from '@/lib/dates';
import { newId } from '@/lib/ids';
import { currencyPrecision, dec, fromMinor, round, toMinor } from '@/lib/money';
import { msg, t } from '@/i18n';

export { RetentionError };

/* -------------------------------------------------------------------------- */
/* Clearance certificates                                                     */
/* -------------------------------------------------------------------------- */

export function newCertificate(
  overrides: Partial<ClearanceCertificate> = {},
): ClearanceCertificate {
  return { id: newId(), number: '', issueDate: today(), expiryDate: null, notes: '', ...overrides };
}

/**
 * Adds or updates one of a contact's clearance certificates. A file (the
 * scanned certificate) replaces the one kept before.
 */
export async function saveCertificate(
  clientId: ID,
  input: ClearanceCertificate,
  file?: { name: string; type: string; dataUrl: string } | null,
): Promise<Client> {
  const certificate: ClearanceCertificate = {
    ...input,
    number: input.number.trim(),
    notes: input.notes?.trim() ?? '',
  };
  if (!certificate.number) throw new RetentionError(t('Enter the certificate number.'));
  if (!isISODate(certificate.issueDate)) throw new RetentionError(t('Enter the issue date.'));
  if (certificate.expiryDate && certificate.expiryDate < certificate.issueDate) {
    throw new RetentionError(t('The expiry date can’t be before the issue date.'));
  }
  return db.transaction('rw', [db.clients, db.attachments, db.activities], async () => {
    const client = await db.clients.get(clientId);
    if (!client) throw new RetentionError(t('Contact not found.'));
    const list = client.clearanceCertificates ?? [];
    const exists = list.some((c) => c.id === certificate.id);
    const certificates = (
      exists ? list.map((c) => (c.id === certificate.id ? certificate : c)) : [...list, certificate]
    ).sort((a, b) => b.issueDate.localeCompare(a.issueDate));
    const updated: Client = {
      ...client,
      clearanceCertificates: certificates,
      updatedAt: nowStamp(),
    };
    await db.clients.put(updated);
    if (file) {
      await db.attachments.where('ownerId').equals(certificate.id).delete();
      await addAttachment(client.companyId, certificate.id, file);
    }
    await logActivity(
      client.companyId,
      'client',
      client.id,
      exists ? 'certificate_updated' : 'certificate_added',
      {
        text: exists
          ? msg('Clearance certificate {number} updated')
          : msg('Clearance certificate {number} added'),
        vars: { number: certificate.number },
      },
      { clientId: client.id },
    );
    return updated;
  });
}

/** Removes a certificate and its file. Releases keep the number they were made with. */
export async function removeCertificate(clientId: ID, certificateId: ID): Promise<void> {
  await db.transaction('rw', [db.clients, db.attachments, db.activities], async () => {
    const client = await db.clients.get(clientId);
    const certificate = client?.clearanceCertificates?.find((c) => c.id === certificateId);
    if (!client || !certificate) return;
    await db.clients.put({
      ...client,
      clearanceCertificates: (client.clearanceCertificates ?? []).filter(
        (c) => c.id !== certificateId,
      ),
      updatedAt: nowStamp(),
    });
    await db.attachments.where('ownerId').equals(certificateId).delete();
    await logActivity(
      client.companyId,
      'client',
      client.id,
      'certificate_removed',
      { text: msg('Clearance certificate {number} removed'), vars: { number: certificate.number } },
      { clientId: client.id },
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Releases                                                                   */
/* -------------------------------------------------------------------------- */

/** Retention still held on a document, in its currency. */
export function heldRetention(doc: InvoiceDocument): number {
  const p = currencyPrecision(doc.currency || 'KWD');
  return round(dec(doc.totals.retention ?? 0).minus(dec(releasedRetention(doc))), p);
}

export interface ReleaseInput {
  date: ISODate;
  /** In the document currency; up to what is still held. */
  amount: number;
  basis: RetentionRelease['basis'];
  /** Certificate number (required for a certificate) or a note about the handover. */
  reference: string;
}

const TABLES = () => [
  db.documents,
  db.clients,
  db.payments,
  db.companies,
  db.accounts,
  db.journals,
  db.activities,
];

/**
 * Company-currency value of the releases so far: converted cumulatively, so
 * a retention released in parts adds up to exactly what the invoice posted.
 */
function releasedValue(doc: InvoiceDocument, amount: number, companyCurrency: string): number {
  const p = currencyPrecision(companyCurrency);
  return toMinor(dec(amount).times(rateOf(doc, { companyCurrency })), p);
}

/**
 * Releases (part of) a document's retention: an entry on the release date
 * moves it from retentions receivable to the receivable (or from retentions
 * payable to the payable), and the document's balance due grows by it, so
 * it is paid like any other amount.
 */
export async function releaseRetention(
  documentId: ID,
  input: ReleaseInput,
): Promise<InvoiceDocument> {
  return db.transaction('rw', TABLES(), async () => {
    const doc = await db.documents.get(documentId);
    if (!doc || !takesRetention(doc.type) || !isPosted(doc)) {
      throw new RetentionError(t('Only issued invoices and bills can release a retention.'));
    }
    const company = await db.companies.get(doc.companyId);
    if (!company) throw new RetentionError(t('Company not found.'));
    if (!isISODate(input.date)) throw new RetentionError(t('Enter the release date.'));
    if (input.date < doc.issueDate) {
      throw new RetentionError(t('The release date can’t be before the document date.'));
    }
    assertUnlocked(company, input.date);
    const reference = input.reference.trim();
    if (input.basis === 'certificate' && !reference) {
      throw new RetentionError(t('Enter the certificate number.'));
    }
    const p = currencyPrecision(doc.currency);
    const amount = round(input.amount, p);
    const held = heldRetention(doc);
    if (amount <= 0) throw new RetentionError(t('Enter the amount to release.'));
    if (dec(amount).gt(dec(held))) {
      throw new RetentionError(t('That is more than the retention still held.'));
    }

    const sales = doc.type === 'invoice';
    const retention = await ensureSpecAccount(
      company,
      sales ? 'retentionsReceivable' : 'retentionsPayable',
    );
    const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
    const partner = roleMap(accounts)[sales ? 'receivable' : 'payable'];
    if (!partner) throw new RetentionError(t('No account is set up for receivables or payables.'));

    const before = releasedRetention(doc);
    const minor =
      releasedValue(doc, round(dec(before).plus(dec(amount)), p), company.currency) -
      releasedValue(doc, before, company.currency);
    const value = fromMinor(minor, currencyPrecision(company.currency));
    const label = t('Retention released on {number}', { number: doc.number });
    const contactId = doc.clientId || null;
    const journal = await saveJournal(
      createJournal(company.id, {
        date: input.date,
        kind: 'retention_release',
        sourceId: doc.id,
        reference: label,
        notes: reference,
        status: 'posted',
        lines: sales
          ? [
              newJournalLine({ accountId: partner, debit: value, description: label, contactId }),
              newJournalLine({
                accountId: retention.id,
                credit: value,
                description: label,
                contactId,
              }),
            ]
          : [
              newJournalLine({
                accountId: retention.id,
                debit: value,
                description: label,
                contactId,
              }),
              newJournalLine({ accountId: partner, credit: value, description: label, contactId }),
            ],
      }),
      { system: true },
    );
    const release: RetentionRelease = {
      id: newId(),
      date: input.date,
      amount,
      basis: input.basis,
      reference,
      journalId: journal.id,
    };
    const client = doc.clientId ? await db.clients.get(doc.clientId) : undefined;
    const next = applyTotals(
      { ...doc, retentionReleases: [...(doc.retentionReleases ?? []), release] },
      await paidAmount(doc),
      client ?? null,
    );
    await db.documents.put({ ...next, updatedAt: nowStamp() });
    await logActivity(
      company.id,
      doc.type,
      doc.id,
      'retention_released',
      { text: msg('Retention released on {number}'), vars: { number: doc.number } },
      { clientId: contactId, documentId: doc.id },
    );
    return next;
  });
}

/**
 * Undoes a release with a reversing entry (the history stays). Dated like the
 * release, or today when that period is locked. A release already paid
 * can't be undone: the payment would be more than the document asks for.
 */
export async function undoRetentionRelease(
  documentId: ID,
  releaseId: ID,
): Promise<InvoiceDocument> {
  return db.transaction('rw', TABLES(), async () => {
    const doc = await db.documents.get(documentId);
    const release = doc?.retentionReleases?.find((r) => r.id === releaseId && !r.reversedOn);
    if (!doc || !release) throw new RetentionError(t('This release was already undone.'));
    const company = await db.companies.get(doc.companyId);
    if (!company) throw new RetentionError(t('Company not found.'));
    const lock = accountingSettings(company).lockDate;
    const date = lock && release.date <= lock ? today() : release.date;
    const client = doc.clientId ? await db.clients.get(doc.clientId) : undefined;
    const paid = await paidAmount(doc);
    const marked = (reversal: ID | null): InvoiceDocument => ({
      ...doc,
      retentionReleases: (doc.retentionReleases ?? []).map((r) =>
        r.id === releaseId ? { ...r, reversedOn: date, reversalJournalId: reversal } : r,
      ),
    });
    if (applyTotals(marked(null), paid, client ?? null).totals.balance < 0) {
      throw new RetentionError(
        t('This release has been paid. Remove the payment before undoing it.'),
      );
    }
    const journal = await db.journals.get(release.journalId);
    const reversal = journal
      ? await reverseJournal(journal, {
          date,
          reference: t('Retention release on {number} undone', { number: doc.number }),
        })
      : null;
    const next = applyTotals(marked(reversal?.id ?? null), paid, client ?? null);
    await db.documents.put({ ...next, updatedAt: nowStamp() });
    await logActivity(
      company.id,
      doc.type,
      doc.id,
      'retention_release_undone',
      { text: msg('Retention release on {number} undone'), vars: { number: doc.number } },
      { clientId: doc.clientId || null, documentId: doc.id },
    );
    return next;
  });
}
