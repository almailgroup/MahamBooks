import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { seedDemoCompany } from './demo';
import { loadLedger, LockedPeriodError } from './accounting';
import { saveDocument } from './documents';
import { setupCompany } from './records';
import { createDocument } from './defaults';
import { balanceSheet, profitAndLoss, trialBalance } from '@/lib/accounting/statements';
import { today } from '@/lib/dates';
import { toMinor } from '@/lib/money';
import { heldRetention } from './retention';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const DEC = { month: 12, day: 31 };

describe('books of the demo company', () => {
  it('are complete and balanced', async () => {
    const company = await seedDemoCompany();
    expect(company.accounting?.template).toBe('kw');
    const { accounts, lines, problems } = await loadLedger(company);
    expect(problems).toEqual([]);
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(0);

    const bs = balanceSheet(lines, accounts, today(), DEC);
    expect(bs.difference).toBe(0);
    const tb = trialBalance(lines, accounts, today(), DEC);
    expect(tb.totalDebit).toBe(tb.totalCredit);

    const fils = (amount: number) => toMinor(amount, 3);
    const balanceOf = (code: string) => {
      const account = accounts.find((a) => a.code === code)!;
      return lines.filter((l) => l.accountId === account.id).reduce((s, l) => s + l.amount, 0);
    };
    const docs = await db.documents.where('companyId').equals(company.id).toArray();
    const open = (type: string) =>
      docs
        .filter((d) => d.type === type && (d.status === 'sent' || d.status === 'partial'))
        .reduce((s, d) => s + fils(d.totals.balance), 0);

    // Receivables in the ledger equal what clients still owe on invoices,
    // less open credit notes and money received that isn't applied yet.
    const payments = await db.payments.where('companyId').equals(company.id).toArray();
    const unapplied = payments
      .filter((p) => !p.voided && p.direction !== 'out' && p.method !== 'credit_note')
      .reduce(
        (s, p) => s + fils(p.amount) - p.allocations.reduce((a, x) => a + fils(x.amount), 0),
        0,
      );
    expect(balanceOf('1100')).toBe(open('invoice') - open('credit') - unapplied);
    // Retentions wait in their own account until they are released.
    const held = docs
      .filter((d) => d.type === 'invoice' && d.status !== 'void')
      .reduce((s, d) => s + fils(heldRetention(d)), 0);
    expect(balanceOf('1110')).toBe(held);

    // The dollar and dirham bills were paid at other rates: an exchange gain overall.
    expect(balanceOf('7000')).toBeLessThan(0);

    // Payables equal what is still owed on bills, less unused vendor credits.
    const openBills = open('bill');
    expect(openBills).toBeGreaterThan(0);
    expect(balanceOf('2000')).toBe(-(openBills - open('vendor_credit')));

    const year = profitAndLoss(lines, accounts, { from: '0000-01-01', to: today() });
    expect(year.income.total).toBeGreaterThan(0);
    // Rent for 13 months (two premises) and four stages of subcontracted crews.
    expect(balanceOf('6060')).toBe(fils(13 * (950 + 650)));
    expect(balanceOf('5100')).toBe(fils(2650 + 3150 + 2400 + 1250));
    // Customs and freight were added to the stock's cost (landed costs), not expensed.
    expect(balanceOf('5200')).toBe(0);
    // Seeding the demo takes seconds on a busy machine (as in demo.test.ts).
  }, 120_000);
});

describe('lock date', () => {
  it('stops changes to issued documents in closed periods', async () => {
    const company = await setupCompany({ name: 'Locked Co', currency: 'GBP' });
    await db.companies.update(company.id, {
      accounting: { ...company.accounting!, lockDate: '2026-03-31' },
    });
    const invoice = createDocument(company.id, 'invoice', {
      clientId: 'c',
      currency: 'GBP',
      status: 'sent',
      issueDate: '2026-03-15',
    });
    await expect(saveDocument(invoice)).rejects.toThrow(LockedPeriodError);
    // Drafts are not in the books, so they can still be saved.
    await expect(saveDocument({ ...invoice, status: 'draft' })).resolves.toMatchObject({
      status: 'draft',
    });
    await expect(
      saveDocument({ ...invoice, id: 'later', issueDate: '2026-04-01' }),
    ).resolves.toBeTruthy();
  });
});
