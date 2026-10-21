import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import { draftDocument, saveDocument } from './documents';
import { loadLedger } from './accounting';
import { saveClient, setupCompany } from './records';
import {
  BankingError,
  createFromTransaction,
  importStatement,
  matchTransaction,
  saveTransfer,
} from './banking';
import { bookEntries, reconciliation, suggestMatches, matchKey } from '@/lib/banking/match';
import { csvStatement, type StatementLine } from '@/lib/banking/statement';
import { rememberedFormat, statementLayout, statementTable } from '@/lib/banking/layout';
import { readStatementFile } from '@/apps/books/features/banking/read-statement';
import { statementCsv, statementWorkbook } from '@/test/bank-statements';
import type { Company } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function setup() {
  const company = await setupCompany(
    {
      name: 'Acme',
      currency: 'GBP',
      locale: 'en-GB',
      address: { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'GB' },
    },
    [{ name: 'VAT', rate: 20 }],
  );
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const role = (name: string) => accounts.find((a) => a.role === name)!;
  return { company, bank: role('bank'), cash: role('cash'), expense: role('expense') };
}

async function invoice(company: Company, unitPrice: number) {
  const client = await saveClient(createClient(company.id, { name: 'Brightside' }));
  const draft = await draftDocument(company, 'invoice', client);
  draft.items[0] = { ...draft.items[0], name: 'Work', quantity: 1, unitPrice, taxes: [] };
  return saveDocument({ ...draft, status: 'sent' });
}

const line = (
  date: string,
  amount: number,
  description: string,
  balance: number | null = null,
): StatementLine => ({
  date,
  description,
  reference: '',
  amount,
  balance,
});

describe('importing statements', () => {
  it('skips lines already imported, keeping identical lines of the same day', async () => {
    const { company, bank } = await setup();
    const lines = [
      line('2026-10-01', -3.2, 'Coffee'),
      line('2026-10-01', -3.2, 'Coffee'),
      line('2026-10-02', 100, 'Deposit'),
    ];
    expect(await importStatement(company.id, bank.id, lines, 'oct.csv')).toMatchObject({
      added: 3,
      duplicates: 0,
    });
    const overlapping = [...lines, line('2026-10-03', -10, 'Parking')];
    expect(await importStatement(company.id, bank.id, overlapping, 'oct2.csv')).toMatchObject({
      added: 1,
      duplicates: 3,
    });
  });
});

describe('importing statements read from Excel and CSV', () => {
  it('adds nothing new for the same statement in the other format', async () => {
    const { company, bank } = await setup();
    const csv = await readStatementFile(new TextEncoder().encode(statementCsv()));
    const xlsx = await readStatementFile(statementWorkbook());
    const read = (file: typeof csv) => {
      if (file.kind === 'ofx') throw new Error('Not a table');
      const layout = statementLayout(file.rows, undefined);
      return csvStatement(statementTable(file.rows, layout.start), layout.mapping).lines;
    };
    expect(await importStatement(company.id, bank.id, read(csv), 'oct.csv')).toMatchObject({
      added: 3,
    });
    expect(await importStatement(company.id, bank.id, read(xlsx), 'oct.xlsx')).toMatchObject({
      added: 0,
      duplicates: 3,
    });
    const stored = await db.bankTransactions.where('accountId').equals(bank.id).toArray();
    expect(stored.map((t) => t.valueDate).sort()).toEqual([
      '2026-10-01',
      '2026-10-03',
      '2026-10-05',
    ]);
  });

  it('remembers the layout on the account, and forgets it when asked', async () => {
    const { company, bank } = await setup();
    const rows = (
      (await readStatementFile(new TextEncoder().encode(statementCsv()))) as { rows: string[][] }
    ).rows;
    const layout = statementLayout(rows, undefined);
    const format = rememberedFormat('csv', rows, layout.start, layout.mapping);
    const lines = csvStatement(statementTable(rows, layout.start), layout.mapping).lines;
    await importStatement(company.id, bank.id, lines, 'oct.csv', format);
    const remembered = await db.accounts.get(bank.id);
    expect(remembered?.statementFormat).toEqual(format);
    // Read again with it: the same layout, found by its column names.
    expect(statementLayout(rows, remembered?.statementFormat)).toMatchObject({
      start: 5,
      remembered: true,
    });
    // Left as it is when nothing is said (OFX), forgotten with null.
    await importStatement(company.id, bank.id, lines, 'oct.ofx');
    expect((await db.accounts.get(bank.id))?.statementFormat).toEqual(format);
    await importStatement(company.id, bank.id, lines, 'oct.csv', null);
    expect(await db.accounts.get(bank.id)).not.toHaveProperty('statementFormat');
    // Lines without a value date store none.
    await importStatement(company.id, bank.id, [line('2026-11-01', -1, 'Fee')], 'nov.csv');
    const fee = await db.bankTransactions.filter((t) => t.description === 'Fee').first();
    expect(fee).not.toHaveProperty('valueDate');
  });
});

describe('matching', () => {
  it('turns statement lines into payments, expenses and transfers', async () => {
    const { company, bank, cash, expense } = await setup();
    const inv = await invoice(company, 1200);
    await importStatement(
      company.id,
      bank.id,
      [
        line('2026-10-02', 1200, `BRIGHTSIDE ${inv.number}`),
        line('2026-10-03', -45.6, 'OFFICE SUPPLIES'),
        line('2026-10-04', -200, 'CASH WITHDRAWAL'),
      ],
      '',
    );
    const [received, spent, withdrawal] = await db.bankTransactions.orderBy('date').toArray();

    await createFromTransaction(received.id, { kind: 'document', documentId: inv.id });
    expect((await db.documents.get(inv.id))?.status).toBe('paid');
    await createFromTransaction(spent.id, {
      kind: 'expense',
      accountId: expense.id,
      taxes: [{ name: 'VAT', rate: 20 }],
      vendorId: null,
    });
    const savedExpense = (await db.expenses.toArray())[0];
    expect(savedExpense).toMatchObject({ amount: 45.6, paidFromAccountId: bank.id });
    await createFromTransaction(withdrawal.id, { kind: 'transfer', otherAccountId: cash.id });

    const all = await db.bankTransactions.toArray();
    expect(all.every((t) => t.match)).toBe(true);

    // The books now show the same movements as the statement.
    const { lines } = await loadLedger((await db.companies.get(company.id))!);
    const entries = bookEntries(lines, bank.id);
    expect(entries.map((e) => e.amount).sort((a, b) => a - b)).toEqual([-20000, -4560, 120000]);
    const cashBalance = lines
      .filter((l) => l.accountId === cash.id)
      .reduce((s, l) => s + l.amount, 0);
    expect(cashBalance).toBe(20000);

    // A book entry can only be matched once.
    await importStatement(
      company.id,
      bank.id,
      [line('2026-10-05', -45.6, 'OFFICE SUPPLIES again')],
      '',
    );
    const extra = (await db.bankTransactions.toArray()).find((t) => !t.match)!;
    await expect(
      matchTransaction(extra.id, { source: 'expense', id: savedExpense.id }),
    ).rejects.toThrow(BankingError);
  });

  it('suggests entries with the same amount close in date, best first', async () => {
    const { company, bank, cash } = await setup();
    const first = await saveTransfer({
      companyId: company.id,
      from: bank.id,
      to: cash.id,
      date: '2026-10-01',
      amount: 50,
    });
    const second = await saveTransfer({
      companyId: company.id,
      from: bank.id,
      to: cash.id,
      date: '2026-10-09',
      amount: 50,
      reference: 'Float JE',
    });
    const { lines } = await loadLedger((await db.companies.get(company.id))!);
    const entries = bookEntries(lines, bank.id);
    const statementLine = { date: '2026-10-08', amount: -5000, description: 'cash', reference: '' };
    const found = suggestMatches(statementLine, entries, new Set());
    expect(found.map((c) => c.entry.id)).toEqual([second.id, first.id]);
    expect(
      suggestMatches(
        statementLine,
        entries,
        new Set([matchKey({ source: 'journal', id: second.id })]),
      ).map((c) => c.entry.id),
    ).toEqual([first.id]);
    expect(suggestMatches({ ...statementLine, amount: -4999 }, entries, new Set())).toEqual([]);
    expect(suggestMatches({ ...statementLine, date: '2026-12-01' }, entries, new Set())).toEqual(
      [],
    );
  });

  it('reconciles when the books agree with the statement balance', async () => {
    const { company, bank, cash } = await setup();
    await saveTransfer({
      companyId: company.id,
      from: bank.id,
      to: cash.id,
      date: '2026-10-01',
      amount: 50,
    });
    const { lines } = await loadLedger((await db.companies.get(company.id))!);
    const transactions = [
      {
        date: '2026-10-01',
        position: 0,
        balance: -50,
        match: { source: 'journal' as const, id: 'x' },
        ignored: false,
      },
    ];
    const r = reconciliation(transactions, lines, bank.id, (n) => Math.round(n * 100));
    expect(r).toMatchObject({
      statementBalance: -5000,
      bookBalance: -5000,
      difference: 0,
      unmatched: 0,
    });
  });
});
