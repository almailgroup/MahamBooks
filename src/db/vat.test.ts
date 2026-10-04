import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import { draftDocument, saveDocument } from './documents';
import { saveClient, setupCompany } from './records';
import { deleteJournal, JournalError, loadLedger } from './accounting';
import { computeVatReturn, fileVatReturn, recordVatPayment, undoVatReturn, VatError } from './vat';
import type { Client, Company, DocumentType, TaxLine } from './types';
import { vatDueDate, vatPeriodOf } from '@/lib/accounting/vat';
import { addDaysISO, today } from '@/lib/dates';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const SCHEDULE = { frequency: 'quarterly' as const, startMonth: 1 };
const VAT: TaxLine = { name: 'VAT', rate: 20, kind: 'standard' };

/** The last quarter that has ended; the one before it is filed already. */
function latestEnded() {
  return vatPeriodOf(addDaysISO(vatPeriodOf(today(), SCHEDULE).start, -1), SCHEDULE);
}

async function issue(
  company: Company,
  contact: Client,
  type: DocumentType,
  issueDate: string,
  unitPrice: number,
) {
  const draft = await draftDocument(company, type, contact);
  return saveDocument({
    ...draft,
    issueDate,
    dueDate: addDaysISO(issueDate, 30),
    status: 'sent',
    items: [{ ...draft.items[0], name: 'Work', quantity: 1, unitPrice, taxes: [VAT] }],
  });
}

/**
 * A UK company registered for VAT (Kuwaiti companies charge no VAT): sales and
 * purchases in the last two quarters, the earlier one filed and paid.
 */
async function vatCompany(): Promise<Company> {
  const company = await setupCompany(
    {
      name: 'Northwind Mail Services',
      currency: 'GBP',
      locale: 'en-GB',
      taxIdLabel: 'VAT No.',
      taxId: 'GB 123 4567 89',
      address: {
        line1: 'Unit 4, Riverside Business Park',
        line2: '',
        city: 'Manchester',
        state: '',
        postalCode: 'M1 2AB',
        country: 'GB',
      },
    },
    [VAT],
  );
  const client = await saveClient(createClient(company.id, { name: 'Brightside Retail Group' }));
  const vendor = await saveClient(
    createClient(company.id, { name: 'PaperMill Supplies Ltd', isCustomer: false, isVendor: true }),
  );
  const latest = latestEnded();
  const earlier = vatPeriodOf(addDaysISO(latest.start, -1), SCHEDULE);
  for (const period of [earlier, latest]) {
    await issue(company, client, 'invoice', addDaysISO(period.start, 10), 1200);
    await issue(company, vendor, 'bill', addDaysISO(period.start, 20), 300);
  }
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const bank = accounts.find((a) => a.role === 'bank')!;
  const record = await fileVatReturn(company.id, earlier, {
    filedOn: addDaysISO(earlier.end, 21),
    reference: '',
    lock: false,
  });
  await recordVatPayment(record.id, { date: vatDueDate(earlier, 'uk'), accountId: bank.id });
  return (await db.companies.get(company.id))!;
}

const balance = (lines: { accountId: string; amount: number }[], accountId: string) =>
  lines.filter((l) => l.accountId === accountId).reduce((s, l) => s + l.amount, 0);

describe('filing a VAT return', () => {
  it('keeps the boxes, moves the VAT to the liability account and locks the period', async () => {
    const company = await vatCompany();
    // The last full quarter.
    const period = latestEnded();
    // The quarter before it is already filed and paid.
    const history = await db.vatReturns.toArray();
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((r) => r.periodEnd < period.start)).toBe(true);
    const live = await computeVatReturn(company, period);
    expect(live.format).toBe('uk');
    expect(live.boxes.find((b) => b.id === '1')!.amount).toBeGreaterThan(0);

    const record = await fileVatReturn(company.id, period, {
      filedOn: today(),
      reference: 'HMRC-123',
      lock: true,
    });
    expect(record).toMatchObject({
      periodStart: period.start,
      net: live.net,
      reference: 'HMRC-123',
    });
    expect(record.boxes).toEqual(
      live.boxes.map(({ id, label, amount, vat }) => ({
        id,
        label,
        amount,
        ...(vat !== undefined ? { vat } : {}),
      })),
    );

    const stored = (await db.companies.get(company.id))!;
    expect(stored.accounting?.lockDate).toBe(period.end);

    // The closing entry does not change the return, and the VAT owed sits in the liability account.
    expect((await computeVatReturn(stored, period)).net).toBe(live.net);
    const { accounts, lines } = await loadLedger(stored);
    const liability = accounts.find((a) => a.role === 'tax_settlement')!;
    expect(-balance(lines, liability.id)).toBe(live.net);
    await expect(
      fileVatReturn(company.id, period, { filedOn: today(), reference: '', lock: false }),
    ).rejects.toThrow(VatError);

    // The closing entry can only go with the return.
    await expect(deleteJournal(record.journalId!)).rejects.toThrow();
    await expect(undoVatReturn(record.id)).rejects.toThrow('This period is locked');
  });

  it('records the payment and can be undone once unlocked', async () => {
    const company = await vatCompany();
    const period = latestEnded();
    const record = await fileVatReturn(company.id, period, {
      filedOn: today(),
      reference: '',
      lock: false,
    });
    const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
    const bank = accounts.find((a) => a.role === 'bank')!;
    const liability = accounts.find((a) => a.role === 'tax_settlement')!;
    const paid = await recordVatPayment(record.id, { date: today(), accountId: bank.id });
    expect(paid.paymentJournalId).toBeTruthy();
    const { lines } = await loadLedger((await db.companies.get(company.id))!);
    expect(balance(lines, liability.id)).toBe(0);
    await expect(
      recordVatPayment(record.id, { date: today(), accountId: bank.id }),
    ).rejects.toThrow(VatError);

    await undoVatReturn(record.id);
    expect(await db.vatReturns.get(record.id)).toBeUndefined();
    expect(await db.journals.get(record.journalId!)).toBeUndefined();
    expect(await db.journals.get(paid.paymentJournalId!)).toBeUndefined();
  });

  it('refuses edits to the closing entry', async () => {
    const company = await vatCompany();
    const period = latestEnded();
    const record = await fileVatReturn(company.id, period, {
      filedOn: today(),
      reference: '',
      lock: false,
    });
    await expect(deleteJournal(record.journalId!)).rejects.toThrow(JournalError);
  });
});
