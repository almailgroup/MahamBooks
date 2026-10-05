import { beforeAll, describe, expect, it } from 'vitest';
import { db } from './db';
import { seedDemoCompany } from './demo';
import { loadLedger } from './accounting';
import { heldRetention } from './retention';
import type { Company } from './types';
import { balanceSheet, trialBalance } from '@/lib/accounting/statements';
import { bookEntries, matchKey } from '@/lib/banking/match';
import { chequePayments, isOpenCheque } from '@/lib/cheques';
import { stockLevels } from '@/lib/inventory/costing';
import { balanced, payRunPostings, payRunTotals } from '@/lib/hr/payroll';
import { employeesNeedingLeaveOpening } from '@/lib/hr/leave';
import { isValidCivilId, isValidIban } from '@/lib/kuwait';
import { addDaysISO, today } from '@/lib/dates';
import { toMinor } from '@/lib/money';

const DEC = { month: 12, day: 31 };
const m = (amount: number) => toMinor(amount, 3);

let company: Company;
let seconds = 0;

beforeAll(async () => {
  await db.delete();
  await db.open();
  const started = performance.now();
  company = await seedDemoCompany();
  seconds = (performance.now() - started) / 1000;
}, 120_000);

/** Balances by account code, in fils (debit positive). */
async function balances(c: Company) {
  const { accounts, lines, problems } = await loadLedger(c);
  const byCode = new Map<string, number>();
  for (const l of lines) {
    const code = accounts.find((a) => a.id === l.accountId)!.code;
    byCode.set(code, (byCode.get(code) ?? 0) + l.amount);
  }
  return { accounts, lines, problems, byCode, of: (code: string) => byCode.get(code) ?? 0 };
}

describe('the demo company', () => {
  it('is a Kuwaiti W.L.L. in dinars, with no VAT and bilingual documents', async () => {
    expect(seconds).toBeGreaterThan(0);
    expect(company).toMatchObject({
      currency: 'KWD',
      language: 'ar-en',
      taxesEnabled: false,
      address: { country: 'KW', city: 'Shuwaikh Industrial' },
      kuwait: { legalForm: 'wll', capital: 50_000 },
    });
    expect(company.nameAr).toMatch(/روضة الخليج/);
    expect(company.accounting?.template).toBe('kw');
    expect(await db.taxRates.where('companyId').equals(company.id).count()).toBe(0);
    const docs = await db.documents.where('companyId').equals(company.id).toArray();
    expect(docs.every((d) => d.totals.taxTotal === 0)).toBe(true);
    expect(docs.every((d) => d.items.every((i) => i.taxes.length === 0))).toBe(true);
    // Every contact and item has an Arabic name.
    const clients = await db.clients.where('companyId').equals(company.id).toArray();
    expect(clients.length).toBeGreaterThanOrEqual(15);
    expect(clients.length).toBeLessThanOrEqual(25);
    expect(clients.every((c) => c.nameAr?.trim())).toBe(true);
    const products = await db.products.where('companyId').equals(company.id).toArray();
    expect(products.every((p) => p.nameAr?.trim())).toBe(true);
    // Some suppliers are abroad and bill in their own currency.
    expect(new Set(clients.filter((c) => c.isVendor).map((c) => c.address.country))).toEqual(
      new Set(['KW', 'AE', 'CN']),
    );
    expect(docs.some((d) => d.type === 'bill' && d.currency === 'USD' && d.exchangeRate)).toBe(
      true,
    );
  });

  it('reads in both languages wherever people read it', async () => {
    const arabic = /[\u0600-\u06FF]/;
    const docs = await db.documents.where('companyId').equals(company.id).toArray();
    const lines = docs.flatMap((d) => d.items).filter((i) => i.kind !== 'heading');
    expect(lines.filter((i) => !i.nameAr?.trim()).map((i) => i.name)).toEqual([]);
    const [assets, employees, warehouses] = await Promise.all([
      db.assets.where('companyId').equals(company.id).toArray(),
      db.employees.where('companyId').equals(company.id).toArray(),
      db.warehouses.where('companyId').equals(company.id).toArray(),
    ]);
    expect(assets.every((a) => a.nameAr?.trim())).toBe(true);
    expect(employees.every((e) => e.nameAr?.trim() && e.jobTitleAr?.trim())).toBe(true);
    expect(warehouses.every((w) => w.nameAr?.trim())).toBe(true);

    // Entries the demo writes itself say what they are in both languages
    // (payroll, cheques and the asset register word their own).
    const journals = await db.journals.where('companyId').equals(company.id).toArray();
    const own = journals.filter((j) => !j.kind || j.kind === 'transfer');
    expect(own.length).toBeGreaterThan(20);
    for (const j of own) {
      expect(j.reference).toMatch(arabic);
      if (!j.kind)
        for (const line of j.lines) expect(line.description, j.reference).toMatch(arabic);
    }
    const [expenses, renewals, payments] = await Promise.all([
      db.expenses.where('companyId').equals(company.id).toArray(),
      db.renewals.where('companyId').equals(company.id).toArray(),
      db.payments.where('companyId').equals(company.id).toArray(),
    ]);
    const byModules = new Set([
      ...renewals.map((r) => r.expenseId),
      ...payments.map((p) => p.cheque?.returnChargeExpenseId),
    ]);
    const english = expenses.filter((e) => !byModules.has(e.id) && !arabic.test(e.description));
    expect(english.map((e) => e.description)).toEqual([]);
  });

  it('uses valid IBANs and Civil IDs', async () => {
    const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
    const ibans = accounts.filter((a) => a.bank?.iban).map((a) => a.bank!.iban);
    expect(ibans).toHaveLength(2);
    expect(company.bankAccount?.iban && isValidIban(company.bankAccount.iban)).toBe(true);
    const employees = await db.employees.where('companyId').equals(company.id).toArray();
    for (const iban of [...ibans, ...employees.map((e) => e.iban)]) {
      expect(isValidIban(iban), iban).toBe(true);
    }
    const clients = await db.clients.where('companyId').equals(company.id).toArray();
    const civilIds = [
      ...employees.map((e) => e.civilId),
      ...clients.filter((c) => c.civilId).map((c) => c.civilId!),
    ];
    for (const id of civilIds) expect(isValidCivilId(id), id).toBe(true);
  });

  it('has books that balance to the fils', async () => {
    const { accounts, lines, problems, of } = await balances(company);
    expect(problems).toEqual([]);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
    const tb = trialBalance(lines, accounts, today(), DEC);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(balanceSheet(lines, accounts, today(), DEC).difference).toBe(0);
    // Opening balance equity is fully used by the opening stock and fixed assets.
    expect(of('3900')).toBe(0);
    // Money accounts never go overdrawn; KNET money waits in 1020 for its settlement.
    for (const code of ['1000', '1005', '1010']) expect(of(code)).toBeGreaterThan(0);
    expect(of('1020')).toBeGreaterThanOrEqual(0);
    expect(of('2050')).toBeLessThanOrEqual(0);

    // Receivables and payables agree with the open documents.
    const docs = await db.documents.where('companyId').equals(company.id).toArray();
    const open = (type: string) =>
      docs
        .filter((d) => d.type === type && ['sent', 'partial'].includes(d.status))
        .reduce((s, d) => s + m(d.totals.balance), 0);
    const kwd = docs.filter((d) => d.currency === 'KWD');
    const openKwd = (type: string) =>
      kwd
        .filter((d) => d.type === type && ['sent', 'partial'].includes(d.status))
        .reduce((s, d) => s + m(d.totals.balance), 0);
    const payments = await db.payments.where('companyId').equals(company.id).toArray();
    const unapplied = payments
      .filter((p) => !p.voided && p.direction !== 'out' && p.method !== 'credit_note')
      .reduce((s, p) => s + m(p.amount) - p.allocations.reduce((a, x) => a + m(x.amount), 0), 0);
    expect(of('1100')).toBe(openKwd('invoice') - open('credit') - unapplied);
    expect(
      docs.filter((d) => d.type === 'bill' && d.currency !== 'KWD' && d.status !== 'paid'),
    ).toEqual([]);
    expect(of('2000') + openKwd('bill') - open('vendor_credit')).toBe(0);
  });

  it('runs a profitable year with real cost of sales, payroll and depreciation', async () => {
    const { of } = await balances(company);
    const income = -(of('4000') + of('4100') + of('4150') + of('4200') + of('4500'));
    const costs = [...(await balances(company)).byCode.entries()]
      .filter(([code]) => code >= '5000' && code < '8000')
      .reduce((s, [, v]) => s + v, 0);
    expect(income).toBeGreaterThan(m(100_000));
    expect(costs).toBeGreaterThan(0);
    expect(income - costs).toBeGreaterThan(0);
    for (const code of ['5000', '6010', '6030', '6040', '6060', '6900', '6180', '7000']) {
      expect(of(code), code).not.toBe(0);
    }
  });

  it('keeps stock in hand everywhere and below the reorder level for a few items', async () => {
    const movements = await db.stockMovements.where('companyId').equals(company.id).toArray();
    // Never below zero in any warehouse, at any date.
    const running = new Map<string, number>();
    const ordered = [...movements].sort(
      (a, b) => a.date.localeCompare(b.date) || b.quantity - a.quantity,
    );
    for (const mv of ordered) {
      const key = `${mv.productId}|${mv.warehouseId}`;
      const qty = (running.get(key) ?? 0) + mv.quantity;
      running.set(key, qty);
      expect(qty, `${key} on ${mv.date}`).toBeGreaterThanOrEqual(0);
    }
    const levels = stockLevels(movements, 3);
    const products = await db.products.where('companyId').equals(company.id).toArray();
    const low = products.filter(
      (p) =>
        p.kind === 'stock' &&
        p.reorderLevel != null &&
        (levels.get(p.id)?.quantity ?? 0) <= p.reorderLevel,
    );
    expect(low.length).toBeGreaterThanOrEqual(2);
    const value = [...levels.values()].reduce((s, l) => s + m(l.value), 0);
    expect((await balances(company)).of('1200')).toBe(value);
    expect(await db.landedCosts.where('companyId').equals(company.id).count()).toBe(2);
    const warehouses = await db.warehouses.where('companyId').equals(company.id).toArray();
    expect(warehouses.map((w) => w.name).sort()).toEqual(['Al-Rai showroom', 'Shuwaikh store']);
  });

  it('has balanced pay runs, paid with PIFSS and end-of-service provisions', async () => {
    const runs = await db.payRuns.where('companyId').equals(company.id).toArray();
    const closed = runs.filter((r) => r.status !== 'draft');
    expect(closed.length).toBe(12);
    expect(closed.every((r) => r.status === 'paid' || r.period === closed.at(-1)?.period)).toBe(
      true,
    );
    for (const run of runs) {
      const totals = payRunTotals(run.lines, 3);
      expect(balanced(payRunPostings(totals, 3)), run.period).toBe(true);
      const journal = run.journalId ? await db.journals.get(run.journalId) : null;
      if (journal) {
        const debit = journal.lines.reduce((s, l) => s + m(l.debit), 0);
        const credit = journal.lines.reduce((s, l) => s + m(l.credit), 0);
        expect(debit, run.period).toBe(credit);
      }
    }
    const { of } = await balances(company);
    expect(of('2700')).toBeLessThan(0);
    expect(of('6030')).toBeGreaterThan(0);
    const settlements = await db.finalSettlements.where('companyId').equals(company.id).toArray();
    expect(settlements.map((s) => s.status)).toEqual(['paid']);
    expect(await db.staffLoans.where('companyId').equals(company.id).count()).toBe(1);
    expect(await db.leaveRecords.where('companyId').equals(company.id).count()).toBeGreaterThan(8);
  });

  it('holds post-dated cheques, cleared ones and a returned one with its replacement', async () => {
    const payments = await db.payments.where('companyId').equals(company.id).toArray();
    const received = chequePayments(payments, 'in');
    const future = received.filter((p) => isOpenCheque(p.cheque.status) && p.cheque.date > today());
    expect(future.length).toBeGreaterThanOrEqual(3);
    expect(received.filter((p) => p.cheque.status === 'cleared').length).toBeGreaterThan(5);
    const returned = received.filter((p) => p.cheque.status === 'returned');
    expect(returned).toHaveLength(1);
    expect(returned[0].voided).toBe(true);
    const replacement = payments.find((p) => p.id === returned[0].cheque.replacedById);
    expect(replacement?.cheque?.status).toBe('held');
    expect(received.some((p) => p.cheque.status === 'deposited')).toBe(true);
    const issued = chequePayments(payments, 'out');
    expect(issued.some((p) => p.cheque.status === 'held' && p.cheque.date > today())).toBe(true);
    expect(await db.securityCheques.where('companyId').equals(company.id).count()).toBe(1);
    // KNET, WAMD, links and buy-now-pay-later are all in use.
    const methods = new Set(payments.map((p) => p.method));
    for (const method of ['knet', 'wamd', 'cash', 'bank_transfer', 'link', 'bnpl']) {
      expect(methods.has(method as never), method).toBe(true);
    }
  });

  it('released the Ministry retention against a clearance certificate', async () => {
    const ministry = (await db.clients.where('companyId').equals(company.id).toArray()).find(
      (c) => c.retentionKind === 'tax',
    )!;
    expect(ministry.clearanceCertificates?.length).toBe(1);
    const invoices = (await db.documents.where('clientId').equals(ministry.id).toArray()).filter(
      (d) => d.type === 'invoice',
    );
    const released = invoices.filter((d) => d.retentionReleases?.length);
    expect(released.length).toBeGreaterThanOrEqual(3);
    expect(released.every((d) => d.retentionReleases![0].basis === 'certificate')).toBe(true);
    expect(released.every((d) => heldRetention(d) === 0)).toBe(true);
    // The contractor's 10% is still held until handover.
    const docs = await db.documents.where('companyId').equals(company.id).toArray();
    expect(docs.some((d) => d.retentionKind === 'contract' && heldRetention(d) > 0)).toBe(true);
  });

  it('tracks papers that expire soon and has fixed assets depreciated monthly', async () => {
    const employees = await db.employees.where('companyId').equals(company.id).toArray();
    const soon = addDaysISO(today(), 30);
    expect(
      employees.filter((e) => e.residencyExpiry && e.residencyExpiry <= soon).length,
    ).toBeGreaterThanOrEqual(2);
    expect(employees.some((e) => e.status === 'left')).toBe(true);
    expect(employees.filter((e) => e.category === 'kuwaiti')).toHaveLength(2);
    // Staff have their leave balances brought forward, and the joiner was added when hired.
    const leave = await db.leaveRecords.where('companyId').equals(company.id).toArray();
    expect(employeesNeedingLeaveOpening(employees, leave)).toEqual([]);
    const assets = await db.assets.where('companyId').equals(company.id).toArray();
    expect(assets.length).toBe(4);
    expect(new Set(assets.map((a) => a.source))).toEqual(new Set(['opening', 'bill', 'purchase']));
    const runs = await db.depreciationRuns.where('companyId').equals(company.id).toArray();
    expect(runs.length).toBe(12);
  });

  it('closed last year with the statutory reserve and locked it', async () => {
    const closes = await db.yearEnds.where('companyId').equals(company.id).toArray();
    expect(closes).toHaveLength(1);
    const close = closes[0];
    expect(close.yearEnd).toBe(`${Number(today().slice(0, 4)) - 1}-12-31`);
    expect(close.lines.map((l) => l.kind)).toEqual(['statutory_reserve']);
    expect(close.lines[0].amount).toBeGreaterThan(0);
    expect(company.accounting?.lockDate).toBe(close.yearEnd);
    const { of } = await balances(company);
    expect(-of('3200')).toBe(m(11_250) + m(close.lines[0].amount));
  });

  it('imported an NBK statement with three lines left to match', async () => {
    const nbk = (await db.accounts.where('companyId').equals(company.id).toArray()).find(
      (a) => a.code === '1000',
    )!;
    const transactions = await db.bankTransactions.where('accountId').equals(nbk.id).toArray();
    expect(transactions.length).toBeGreaterThan(12);
    const { lines } = await loadLedger(company);
    const keys = new Set(bookEntries(lines, nbk.id).map(matchKey));
    const unmatched = transactions.filter((t) => !t.match || !keys.has(matchKey(t.match)));
    expect(unmatched.map((t) => t.description).sort()).toEqual([
      'SWIFT CHARGES',
      'TRANSFER TO KFH ACCOUNT 0731005248',
      expect.stringMatching(/^TRF FROM SADU INTERIORS CO\. INV-\d{4}-\d{4}$/),
    ]);
    // Once those three are recorded, the books agree with the bank.
    const last = [...transactions]
      .sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position)
      .at(-1)!;
    const book = lines
      .filter((l) => l.accountId === nbk.id && l.date <= last.date)
      .reduce((s, l) => s + l.amount, 0);
    const pending = unmatched.reduce((s, t) => s + m(t.amount), 0);
    expect(m(last.balance!)).toBe(book + pending);
  });

  it('dates what it records on the day it happened', async () => {
    const docs = await db.documents.where('companyId').equals(company.id).toArray();
    const sent = docs.filter((d) => d.type === 'invoice' && d.sentAt);
    expect(sent.every((d) => d.sentAt!.slice(0, 10) >= d.issueDate)).toBe(true);
    expect(sent.some((d) => d.sentAt!.slice(0, 10) < today())).toBe(true);
    const activities = await db.activities.where('companyId').equals(company.id).toArray();
    expect(new Set(activities.map((a) => a.at.slice(0, 10))).size).toBeGreaterThan(100);
    expect(activities.every((a) => a.at <= new Date().toISOString())).toBe(true);
  });

  it('is the same every time it is created', async () => {
    const second = await seedDemoCompany();
    const summary = async (c: Company) => {
      const { byCode } = await balances(c);
      const docs = await db.documents.where('companyId').equals(c.id).toArray();
      return {
        accounts: Object.fromEntries([...byCode.entries()].sort()),
        documents: docs.map((d) => `${d.type} ${d.number} ${d.status} ${d.totals.total}`).sort(),
        payments: await db.payments.where('companyId').equals(c.id).count(),
        journals: await db.journals.where('companyId').equals(c.id).count(),
      };
    };
    expect(await summary(second)).toEqual(await summary(company));
  }, 120_000);
});
