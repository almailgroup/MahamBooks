import { db } from './db';
import { createDocument, emptyTotals, nowStamp } from './defaults';
import { markSent, saveDocument } from './documents';
import { logActivity } from './activity';
import { accountingSettings } from './chart-setup';
import { withStockTables } from './inventory';
import type { Client, Company, ID, InvoiceDocument, ISODate, RecurringProfile } from './types';
import { addDaysISO, occurrenceDate, today } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { placeholderLocale, replaceDatePlaceholders } from '@/lib/placeholders';
import { retentionDefaults } from '@/lib/retention';
import { shortId } from '@/lib/ids';
import { interfaceLocale, msg, t } from '@/i18n';

/**
 * Builds (without saving) the invoice a profile produces for `issueDate`.
 * `locale` writes month names in the document's language (`placeholderLocale`).
 * The client's retention applies as on an invoice made by hand: its rate,
 * unless a valid clearance certificate covers the date.
 */
export function invoiceFromProfile(
  profile: RecurringProfile,
  issueDate: ISODate,
  locale: string,
  client: Client | null = null,
): InvoiceDocument {
  const template = profile.template;
  const fill = (s: string) => replaceDatePlaceholders(s, issueDate, locale);
  return createDocument(profile.companyId, 'invoice', {
    ...retentionDefaults(client, 'invoice', issueDate),
    clientId: profile.clientId,
    issueDate,
    dueDate: addDaysISO(issueDate, profile.dueDays),
    currency: template.currency,
    // Invoices in another currency are booked at the profile's rate.
    ...(template.exchangeRate ? { exchangeRate: template.exchangeRate } : {}),
    items: template.items.map((i) => ({
      ...i,
      id: shortId(),
      name: fill(i.name),
      description: fill(i.description),
    })),
    discount: template.discount,
    discountType: template.discountType,
    taxes: template.taxes,
    charges: template.charges.map((c) => ({ ...c, id: shortId(), label: fill(c.label) })),
    pricesIncludeTax: template.pricesIncludeTax,
    poNumber: fill(template.poNumber),
    notes: fill(template.notes),
    terms: fill(template.terms),
    footer: template.footer,
    privateNotes: template.privateNotes,
    templateId: template.templateId,
    recurringId: profile.id,
    totals: emptyTotals(),
  });
}

/** Moves a profile forward by one issued invoice. */
export function advanceProfile(profile: RecurringProfile): RecurringProfile {
  const issuedCount = profile.issuedCount + 1;
  const remainingCycles =
    profile.remainingCycles === null ? null : Math.max(0, profile.remainingCycles - 1);
  const done = remainingCycles === 0;
  return {
    ...profile,
    issuedCount,
    remainingCycles,
    status: done ? 'completed' : profile.status,
    nextIssueDate: done ? null : occurrenceDate(profile.startDate, profile.frequency, issuedCount),
    lastIssuedAt: nowStamp(),
    updatedAt: nowStamp(),
  };
}

export class RecurringError extends Error {}

/** Date the next invoice of a profile gets when it is created on `now`. */
function issueDateOf(
  profile: Pick<RecurringProfile, 'nextIssueDate'>,
  now: ISODate,
): ISODate | null {
  if (!profile.nextIssueDate) return null;
  return profile.nextIssueDate <= now ? profile.nextIssueDate : now;
}

/**
 * The lock date, when the profile's next invoice would be dated on or before
 * it (else null). Nothing is created then, since that period's books are
 * closed; the recurring page says so until the lock date or the schedule
 * changes.
 */
export function lockedOutBy(
  profile: Pick<RecurringProfile, 'nextIssueDate' | 'status'>,
  company: Company,
  now: ISODate = today(),
): ISODate | null {
  if (profile.status === 'completed') return null;
  const date = issueDateOf(profile, now);
  const lock = accountingSettings(company).lockDate;
  return date && lock && date <= lock ? lock : null;
}

/** Why a profile's next invoice was not created (see `lockedOutBy`). */
export function lockedOutText(company: Company, date: ISODate, lock: ISODate): string {
  const format = (d: ISODate) => formatDate(d, company.dateFormat, interfaceLocale(company.locale));
  return t(
    'The invoice due on {date} was not created: the books are locked up to {lock}. Change the lock date in Settings → Accounting, or the schedule.',
    { date: format(date), lock: format(lock) },
  );
}

/**
 * Issues the next invoice of a profile right away. Saving it, marking it as
 * sent and moving the profile on happen together: when one of them fails,
 * nothing is created. An invoice that would fall in a locked period is not
 * created.
 */
export async function issueNow(profileId: ID): Promise<InvoiceDocument | null> {
  return db.transaction(
    'rw',
    withStockTables([
      db.recurring,
      db.documents,
      db.companies,
      db.clients,
      db.payments,
      db.activities,
      db.accounts,
      db.products,
      db.assets,
      db.attachments,
    ]),
    async () => {
      const profile = await db.recurring.get(profileId);
      if (!profile || profile.status === 'completed' || !profile.nextIssueDate) return null;
      const company = await db.companies.get(profile.companyId);
      if (!company) return null;
      const issueDate = issueDateOf(profile, today())!;
      const lock = lockedOutBy(profile, company);
      if (lock) throw new RecurringError(lockedOutText(company, issueDate, lock));
      const client = profile.clientId ? await db.clients.get(profile.clientId) : undefined;
      // The client's document language, else the company's.
      const locale = placeholderLocale(client?.language ?? company.language, company.locale);
      const invoice = await saveDocument(
        invoiceFromProfile(profile, issueDate, locale, client ?? null),
      );
      if (profile.markSent) await markSent(invoice.id);
      await db.recurring.put(advanceProfile(profile));
      await logActivity(
        company.id,
        'recurring',
        profile.id,
        'issued',
        profile.name
          ? {
              text: msg('Recurring invoice {number} created from “{name}”'),
              vars: { number: invoice.number, name: profile.name },
            }
          : { text: msg('Recurring invoice {number} created'), vars: { number: invoice.number } },
        {
          clientId: profile.clientId || null,
          documentId: invoice.id,
        },
      );
      return (await db.documents.get(invoice.id)) ?? invoice;
    },
  );
}

/**
 * Creates every invoice that is due (catching up missed periods) for active
 * profiles. Runs when the app opens, since there is no server to schedule it.
 * A profile whose next invoice falls in a locked period is left as it is
 * (the recurring page says why), and one that fails doesn't stop the others.
 */
export async function generateDueInvoices(
  companyId: ID,
  asOf: ISODate = today(),
): Promise<InvoiceDocument[]> {
  const created: InvoiceDocument[] = [];
  const company = await db.companies.get(companyId);
  if (!company) return created;
  const profiles = await db.recurring.where('companyId').equals(companyId).toArray();
  for (const p of profiles) {
    let profile: RecurringProfile | undefined = p;
    try {
      // Guard against runaway loops (e.g. a weekly profile left for years).
      for (let i = 0; i < 120 && profile; i++) {
        if (profile.status !== 'active' || profile.archived || !profile.clientId) break;
        if (!profile.nextIssueDate || profile.nextIssueDate > asOf) break;
        if (profile.remainingCycles !== null && profile.remainingCycles <= 0) break;
        if (lockedOutBy(profile, company)) break;
        const invoice = await issueNow(profile.id);
        if (!invoice) break;
        created.push(invoice);
        profile = await db.recurring.get(profile.id);
      }
    } catch {
      // Nothing of this profile was created; it is tried again next time.
    }
  }
  return created;
}

/** Translate where shown: `t(FREQUENCY_LABEL[frequency])`. */
export const FREQUENCY_LABEL: Record<RecurringProfile['frequency'], string> = {
  weekly: msg('Weekly'),
  biweekly: msg('Every 2 weeks'),
  monthly: msg('Monthly'),
  bimonthly: msg('Every 2 months'),
  quarterly: msg('Quarterly'),
  semiannually: msg('Every 6 months'),
  yearly: msg('Yearly'),
};
