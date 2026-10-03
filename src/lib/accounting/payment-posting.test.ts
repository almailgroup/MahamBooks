import { describe, expect, it } from 'vitest';
import { createPayment } from '@/db/payments';
import { createDocument } from '@/db/defaults';
import { buildLedger, postPayment, type LedgerContext, type LedgerLine } from './ledger';

/** Payments with the Kuwaiti methods, posted in fils. */
function context(): LedgerContext {
  const roles = {
    receivable: 'ar',
    payable: 'ap',
    sales: 'sales',
    bank: 'bank',
    cash: 'cash',
    fx: 'fx',
    bank_fees: 'charges',
    expense: 'expense',
  };
  return {
    companyCurrency: 'KWD',
    precision: 3,
    roles,
    accountIds: new Set([...Object.values(roles), 'knet', 'fees', 'pdc']),
    productAccounts: new Map(),
    taxExempt: () => false,
    documents: new Map(),
  };
}

const byAccount = (lines: LedgerLine[]) => {
  const out: Record<string, number> = {};
  for (const l of lines) out[l.accountId] = (out[l.accountId] ?? 0) + l.amount;
  return out;
};

const payment = (overrides = {}) =>
  createPayment('co', {
    number: 'PAY-1',
    clientId: 'client',
    date: '2026-10-03',
    amount: 250.5,
    currency: 'KWD',
    ...overrides,
  });

describe('payment postings', () => {
  it('take the provider fee out of the clearing account', () => {
    const lines = postPayment(
      payment({ method: 'knet', accountId: 'knet', fee: 2.005, feeAccountId: 'fees' }),
      context(),
    );
    expect(byAccount(lines)).toEqual({ knet: 248_495, ar: -250_500, fees: 2_005 });
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
  });

  it('fall back to the bank charges account when the fee account is gone', () => {
    const lines = postPayment(
      payment({ method: 'link', accountId: 'knet', fee: 1, feeAccountId: 'deleted' }),
      context(),
    );
    expect(byAccount(lines)).toEqual({ knet: 249_500, ar: -250_500, charges: 1_000 });
  });

  it('ignore a fee on payments made', () => {
    const lines = postPayment(
      payment({ direction: 'out', method: 'knet', fee: 1, feeAccountId: 'fees' }),
      context(),
    );
    expect(byAccount(lines)).toEqual({ bank: -250_500, ap: 250_500 });
  });

  it('book cash on delivery to cash and WAMD to the bank', () => {
    expect(byAccount(postPayment(payment({ method: 'cod' }), context()))).toEqual({
      cash: 250_500,
      ar: -250_500,
    });
    expect(byAccount(postPayment(payment({ method: 'wamd' }), context()))).toEqual({
      bank: 250_500,
      ar: -250_500,
    });
  });

  it('leave void payments out of the books', () => {
    const voided = payment({ method: 'cheque', accountId: 'pdc', voided: true, currency: 'USD' });
    expect(postPayment(voided, context())).toEqual([]);
    const invoice = createDocument('co', 'invoice', { currency: 'KWD', status: 'sent' });
    const { lines, problems } = buildLedger(
      { documents: [invoice], payments: [voided], journals: [] },
      context(),
    );
    // No "missing exchange rate" warning for a payment that doesn't count.
    expect(problems).toEqual([]);
    expect(lines.filter((l) => l.source === 'payment')).toEqual([]);
  });
});
