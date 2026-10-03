import { describe, expect, it } from 'vitest';
import {
  agingBucket,
  buildStatement,
  creditCheck,
  customerExposure,
  exposureIncrease,
  isOpeningDocument,
  statementRange,
} from './statements';
import { doc, history, payment } from '@/test/statement-fixtures';

describe('statement of account', () => {
  it('brings the balance forward and runs it through credits and a returned cheque', () => {
    const s = buildStatement({
      side: 'customer',
      ...history(),
      from: '2026-08-01',
      to: '2026-08-31',
      currency: 'KWD',
    });
    // 200 + 1,234.567 − 61.728 retention − 500 paid in July.
    expect(s.opening).toBe(872_839);
    expect(s.entries.map((e) => [e.date, e.kind, e.number, e.debit, e.credit, e.balance])).toEqual([
      ['2026-08-05', 'invoice', 'INV-2', 300_000, 0, 1_172_839],
      ['2026-08-10', 'credit', 'CN-1', 0, 50_000, 1_122_839],
      ['2026-08-12', 'payment', 'PAY-2', 0, 250_000, 872_839],
      ['2026-08-25', 'payment_void', 'PAY-2', 250_000, 0, 1_122_839],
      ['2026-08-26', 'payment', 'PAY-3', 0, 250_000, 872_839],
    ]);
    expect(s.entries[2]).toMatchObject({ voided: true, reference: '000777' });
    expect(s.entries[3]).toMatchObject({ voidKind: 'returned' });
    expect(s.closing).toBe(872_839);
    expect(s.debits).toBe(550_000);
    expect(s.credits).toBe(550_000);
    expect(s.retentionHeld).toBe(61_728);
    // The replacement cheque is listed apart: paid on paper, not cleared yet.
    expect(s.cheques).toEqual([
      expect.objectContaining({ chequeNumber: '000778', amount: 250_000, status: 'held' }),
    ]);
    expect(s.chequesTotal).toBe(250_000);
  });

  it('shows the retention right under its invoice', () => {
    const s = buildStatement({
      side: 'customer',
      ...history(),
      from: '2026-07-01',
      to: '2026-07-31',
      currency: 'KWD',
    });
    expect(s.opening).toBe(200_000);
    expect(s.entries.map((e) => [e.kind, e.reference, e.debit, e.credit, e.balance])).toEqual([
      ['invoice', 'PO-77', 1_234_567, 0, 1_434_567],
      ['retention', '', 0, 61_728, 1_372_839],
      ['payment', '', 0, 500_000, 872_839],
    ]);
    expect(s.entries[1].percent).toBe(5);
  });

  it('marks opening balances and releases', () => {
    const { documents, payments } = history();
    expect(isOpeningDocument(documents[0])).toBe(true);
    expect(isOpeningDocument(documents[1])).toBe(false);
    documents[1].retentionReleases = [
      {
        id: 'r1',
        date: '2026-09-10',
        amount: 61.728,
        basis: 'certificate',
        reference: 'TC-9',
        journalId: 'j1',
      },
      {
        id: 'r2',
        date: '2026-09-11',
        amount: 0,
        basis: 'handover',
        reference: '',
        journalId: 'j2',
        reversedOn: '2026-09-12',
      },
    ];
    const s = buildStatement({
      side: 'customer',
      documents,
      payments,
      from: '2026-06-01',
      to: '2026-09-30',
      currency: 'KWD',
    });
    expect(s.opening).toBe(0);
    expect(s.entries[0]).toMatchObject({ kind: 'opening', number: 'OB-1', debit: 200_000 });
    const release = s.entries.find((e) => e.kind === 'release' && e.number === 'INV-1')!;
    expect(release).toMatchObject({ date: '2026-09-10', debit: 61_728, reference: 'TC-9' });
    expect(s.closing).toBe(872_839 + 61_728);
    expect(s.retentionHeld).toBe(0);
  });

  it('ages what was open on the statement date', () => {
    const s = buildStatement({
      side: 'customer',
      ...history(),
      from: '2026-08-01',
      to: '2026-08-31',
      currency: 'KWD',
    });
    // OB-1 is 47 days late, INV-1 31 days; INV-2 is paid by the credit and the new cheque.
    expect(s.aging.buckets).toEqual([0, 0, 872_839, 0, 0]);
    expect(s.aging.unapplied).toBe(0);
    expect(s.aging.total).toBe(s.closing);

    // Before the cheque came back, INV-2 was settled and that cheque was in hand.
    const mid = buildStatement({
      side: 'customer',
      ...history(),
      from: '2026-08-01',
      to: '2026-08-20',
      currency: 'KWD',
    });
    expect(mid.cheques.map((c) => [c.chequeNumber, c.status])).toEqual([['000777', 'held']]);
    expect(mid.closing).toBe(872_839);

    // An unapplied payment shows as credit to apply.
    const { documents, payments } = history();
    payments.push(payment('PAY-4', '2026-08-30', 100, []));
    const later = buildStatement({
      side: 'customer',
      documents,
      payments,
      from: '2026-08-01',
      to: '2026-08-31',
      currency: 'KWD',
    });
    expect(later.closing).toBe(772_839);
    expect(later.aging.unapplied).toBe(100_000);
  });

  it('puts days past due in the usual buckets', () => {
    const asOf = '2026-10-31';
    expect(agingBucket(null, asOf)).toBe(0);
    expect(agingBucket('2026-10-31', asOf)).toBe(0);
    expect(agingBucket('2026-10-30', asOf)).toBe(1);
    expect(agingBucket('2026-10-01', asOf)).toBe(1);
    expect(agingBucket('2026-09-30', asOf)).toBe(2);
    expect(agingBucket('2026-09-01', asOf)).toBe(2);
    expect(agingBucket('2026-08-31', asOf)).toBe(3);
    expect(agingBucket('2026-08-02', asOf)).toBe(3);
    expect(agingBucket('2026-08-01', asOf)).toBe(4);
  });

  it('leaves out documents in other currencies and says which', () => {
    const { documents, payments } = history();
    documents.push(doc('invoice', 'INV-USD', '2026-08-15', 100, { currency: 'USD' }));
    const s = buildStatement({
      side: 'customer',
      documents,
      payments,
      from: '2026-08-01',
      to: '2026-08-31',
      currency: 'KWD',
    });
    expect(s.otherCurrencies).toEqual(['USD']);
    expect(s.entries.some((e) => e.number === 'INV-USD')).toBe(false);
  });

  it('shows a vendor what the company owes them', () => {
    const bill = doc('bill', 'BILL-1', '2026-08-01', 2000, {
      vendorReference: 'SUP-55',
      retentionPercent: 10,
      totals: {
        subtotal: 2000,
        discount: 0,
        taxTotal: 0,
        total: 2000,
        paid: 1800,
        balance: 0,
        retention: 200,
      },
    });
    const paid = payment('PM-1', '2026-08-15', 1800, [{ documentId: 'BILL-1', amount: 1800 }], {
      direction: 'out',
    });
    const s = buildStatement({
      side: 'vendor',
      documents: [bill],
      payments: [paid, payment('PAY-IN', '2026-08-16', 5, [])],
      from: '2026-08-01',
      to: '2026-08-31',
      currency: 'KWD',
    });
    expect(s.entries.map((e) => [e.kind, e.reference, e.debit, e.credit, e.balance])).toEqual([
      ['bill', 'SUP-55', 0, 2_000_000, 2_000_000],
      ['retention', '', 200_000, 0, 1_800_000],
      ['payment', '', 1_800_000, 0, 0],
    ]);
    expect(s.retentionHeld).toBe(200_000);
  });

  it('works out the period dates', () => {
    expect(statementRange('this-month', '2026-10-03')).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(statementRange('last-month', '2026-10-03')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(statementRange('this-quarter', '2026-10-03')).toEqual({
      from: '2026-10-01',
      to: '2026-12-31',
    });
    expect(
      statementRange('custom', '2026-10-03', { from: '2026-09-30', to: '2026-01-01' }),
    ).toEqual({ from: '2026-01-01', to: '2026-09-30' });
  });
});

describe('credit control', () => {
  it('counts uncleared cheques in the exposure and checks the limit', () => {
    const { documents, payments } = history();
    const exposure = customerExposure({
      client: { creditLimit: 1000 },
      documents,
      payments,
      companyCurrency: 'KWD',
      todayIso: '2026-09-15',
    });
    expect(exposure).toMatchObject({
      balance: 872_839,
      // Everything open is past due on 15 September.
      overdue: 872_839,
      uncleared: 250_000,
      unclearedCount: 1,
      exposure: 1_122_839,
      retentionHeld: 61_728,
      limit: 1_000_000,
      available: -122_839,
      lastPayment: { date: '2026-08-26', amount: 250_000, number: 'PAY-3', id: 'PAY-3' },
    });

    const roomy = { ...exposure, limit: 5_000_000 };
    expect(creditCheck({}, roomy, 100_000, true)).toEqual({ status: 'ok' });
    expect(creditCheck({}, exposure, 1, true)).toEqual({
      status: 'over_limit',
      projected: 1_122_840,
      limit: 1_000_000,
      over: 122_840,
    });
    // Lowering an invoice is never blocked; a hold blocks anything new.
    expect(creditCheck({ creditHold: true }, exposure, -5, false)).toEqual({ status: 'ok' });
    expect(creditCheck({ creditHold: true }, exposure, 0, true)).toMatchObject({ status: 'hold' });
    const noLimit = { ...exposure, limit: null };
    expect(creditCheck({}, noLimit, 9_999_999, true)).toEqual({ status: 'ok' });
  });

  it('adds only the change of an edited invoice', () => {
    const saved = doc('invoice', 'INV-9', '2026-09-01', 1000, {
      retentionPercent: 5,
      totals: {
        subtotal: 1000,
        discount: 0,
        taxTotal: 0,
        total: 1000,
        paid: 0,
        balance: 950,
        retention: 50,
      },
    });
    const edited = { ...saved, items: [{ ...saved.items[0], unitPrice: 1200 }] };
    // 1,200 less its 60 retention, less the 950 already counted.
    expect(exposureIncrease(edited, saved, 'KWD')).toBe(190_000);
    expect(exposureIncrease(edited, { ...saved, status: 'draft' }, 'KWD')).toBe(1_140_000);
    const order = doc('sales_order', 'SO-1', '2026-09-01', 400);
    expect(exposureIncrease(order, null, 'KWD')).toBe(400_000);
  });
});
