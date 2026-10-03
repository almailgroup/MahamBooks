import { describe, expect, it } from 'vitest';
import type { Account } from '@/db/types';
import {
  cashAllowed,
  checkCash,
  defaultDestination,
  findPaymentAccount,
  freeAccountCode,
  kwdValue,
  offeredMethods,
  providersFor,
  takesFee,
} from './payment-methods';

describe('cash rules (MOCI Decision 32/2026)', () => {
  it('leave general trading alone', () => {
    expect(checkCash('general', 'cash', 'in', 5_000)).toEqual({ status: 'ok' });
    expect(cashAllowed('general')).toBe(true);
  });

  it('allow up to KD 10 in salons, clinics, sports clubs and pest control', () => {
    expect(checkCash('salon', 'cash', 'in', 10)).toEqual({ status: 'ok' });
    expect(checkCash('salon', 'cash', 'in', 10.001)).toEqual({ status: 'over_limit', limit: 10 });
    expect(checkCash('health', 'cod', 'in', 25)).toEqual({ status: 'over_limit', limit: 10 });
    expect(checkCash('sports_club', 'cash', 'in', null)).toEqual({ status: 'limited', limit: 10 });
    expect(cashAllowed('pest_control')).toBe(true);
  });

  it('ban cash for vehicles, gold and real estate', () => {
    expect(checkCash('vehicles', 'cash', 'in', 1)).toEqual({ status: 'banned' });
    expect(checkCash('gold_jewellery', 'cod', 'in', 1)).toEqual({ status: 'banned' });
    expect(cashAllowed('real_estate')).toBe(false);
  });

  it('only cover cash received', () => {
    expect(checkCash('vehicles', 'knet', 'in', 1_000)).toEqual({ status: 'ok' });
    expect(checkCash('vehicles', 'cash', 'out', 1_000)).toEqual({ status: 'ok' });
  });

  it('work out the dinar value of other currencies', () => {
    expect(kwdValue(12.5, 'KWD', 'USD')).toBe(12.5);
    expect(kwdValue(100, 'USD', 'KWD', 0.307)).toBe(30.7);
    expect(kwdValue(100, 'USD', 'KWD')).toBeNull();
    expect(kwdValue(100, 'USD', 'GBP', 0.8)).toBeNull();
  });
});

describe('payment methods', () => {
  it('offer the Kuwaiti methods and keep old ones only on old payments', () => {
    const received = offeredMethods('in').map((m) => m.value);
    expect(received).toEqual(
      expect.arrayContaining(['knet', 'wamd', 'link', 'bnpl', 'cod', 'cheque', 'cash']),
    );
    expect(received).not.toContain('paypal');
    expect(received).not.toContain('stripe');
    expect(received).not.toContain('mobile_money');
    expect(offeredMethods('in', { current: 'paypal' }).map((m) => m.value)).toContain('paypal');
    const made = offeredMethods('out', { creditNotes: false }).map((m) => m.value);
    expect(made).not.toContain('bnpl');
    expect(made).not.toContain('cod');
    expect(made).not.toContain('credit_note');
  });

  it('send each method to its account by default', () => {
    expect(defaultDestination('cash', 'in')).toBe('cash');
    expect(defaultDestination('cod', 'in')).toBe('cash');
    expect(defaultDestination('knet', 'in')).toBe('clearing');
    expect(defaultDestination('card', 'in')).toBe('clearing');
    expect(defaultDestination('link', 'in')).toBe('clearing');
    expect(defaultDestination('bnpl', 'in')).toBe('clearing');
    expect(defaultDestination('wamd', 'in')).toBe('bank');
    expect(defaultDestination('bank_transfer', 'in')).toBe('bank');
    expect(defaultDestination('cheque', 'in')).toBe('cheques');
    expect(defaultDestination('cheque', 'in', false)).toBe('bank');
    expect(defaultDestination('knet', 'out')).toBe('bank');
  });

  it('know which methods have providers and fees', () => {
    expect(providersFor('link').map((p) => p.value)).toEqual([
      'myfatoorah',
      'tap',
      'upayments',
      'hesabe',
      'ottu',
      'bank',
      'other',
    ]);
    expect(providersFor('bnpl').map((p) => p.value)).toEqual(['taly', 'deema', 'tabby', 'other']);
    expect(providersFor('cash')).toEqual([]);
    expect(takesFee('knet', 'in')).toBe(true);
    expect(takesFee('knet', 'out')).toBe(false);
    expect(takesFee('wamd', 'in')).toBe(false);
  });
});

describe('payment accounts', () => {
  const account = (code: string, name: string, type: Account['type'], extra = {}): Account => ({
    id: code,
    companyId: 'co',
    code,
    name,
    type,
    description: '',
    role: null,
    bank: null,
    archived: false,
    createdAt: '',
    updatedAt: '',
    ...extra,
  });

  it('are found by code in the Kuwait chart, by name elsewhere', () => {
    const renamed = [account('1020', 'KNET settlements', 'asset_current')];
    expect(findPaymentAccount(renamed, 'clearing', 'kw')?.id).toBe('1020');
    expect(findPaymentAccount(renamed, 'clearing', 'generic')).toBeUndefined();
    const training = [account('6180', 'Training', 'expense')];
    expect(findPaymentAccount(training, 'cardFees', 'generic')).toBeUndefined();
    const named = [account('6555', 'KNET and card fees', 'expense')];
    expect(findPaymentAccount(named, 'cardFees', 'uk')?.id).toBe('6555');
    const archived = [
      account('1150', 'Post-dated cheques received', 'asset_current', { archived: true }),
    ];
    expect(findPaymentAccount(archived, 'chequesReceived', 'kw')).toBeUndefined();
  });

  it('get a free code when theirs is taken', () => {
    expect(freeAccountCode([{ code: '1000' }], '1020')).toBe('1020');
    expect(freeAccountCode([{ code: '6180' }, { code: '6181' }], '6180')).toBe('6182');
    expect(freeAccountCode([{ code: '0010' }], '0010')).toBe('0011');
  });
});
