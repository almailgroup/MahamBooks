import { describe, expect, it } from 'vitest';
import type { Account, Company } from '@/db/types';
import { createClient } from '@/db/defaults';
import { createPayment, newCheque } from '@/db/payments';
import { createExpense } from '@/db/purchases';
import { sampleCompany } from '../sample';
import {
  buildVoucherModel,
  hasVoucher,
  STANDARD_VOUCHER_LINES,
  type VoucherInput,
  type VoucherModel,
  type VoucherRow,
} from './model';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const STAMP = PNG.replace('CYII=', 'CYII=#stamp');

function company(overrides: Partial<Company> = {}): Company {
  const c = sampleCompany();
  return {
    ...c,
    branding: { ...c.branding, signature: PNG, stamp: STAMP },
    ...overrides,
  };
}

const customer = createClient('sample-company', {
  id: 'customer',
  name: 'Gulf Contracting Co.',
  nameAr: 'شركة الخليج للمقاولات',
});
const vendor = createClient('sample-company', {
  id: 'vendor',
  name: 'Sample Paper Supplies',
  isCustomer: false,
  isVendor: true,
});

const received = createPayment('sample-company', {
  number: 'PAY-2026-0007',
  date: '2026-10-20',
  clientId: customer.id,
  amount: 1250.75,
  method: 'bank_transfer',
  reference: 'TRX-55120',
});

const cash: Pick<Account, 'name' | 'nameAr'> = { name: 'Cash in hand', nameAr: 'النقدية' };
const stationery: Pick<Account, 'name' | 'nameAr'> = {
  name: 'Stationery and printing',
  nameAr: 'القرطاسية والطباعة',
};

const row = (model: VoucherModel, key: string): VoucherRow | undefined =>
  model.rows.find((r) => r.key === key);
/** A row's lines as they read: the parts of each line joined by " / ". */
const text = (model: VoucherModel, key: string) =>
  row(model, key)?.lines.map((l) => l.parts.map((p) => p.text).join(' / '));

describe('voucher wording', () => {
  it('receives money from a customer on a receipt voucher', () => {
    const m = buildVoucherModel({
      kind: 'payment',
      source: received,
      company: company(),
      party: customer,
      documents: [{ number: 'INV-2026-0012' }, { number: 'INV-2026-0013' }],
    });
    expect(m.direction).toBe('in');
    expect(m.title).toEqual({ en: 'Receipt voucher', ar: 'سند قبض' });
    expect(m.documentTitle).toBe('Receipt voucher PAY-2026-0007');
    expect(m.rows.map((r) => r.key)).toEqual(['party', 'sum', 'method', 'being', 'reference']);
    expect(row(m, 'party')?.label).toEqual({ en: 'Received from', ar: 'استلمنا من' });
    expect(text(m, 'party')).toEqual(['Gulf Contracting Co.', 'شركة الخليج للمقاولات']);
    expect(text(m, 'method')).toEqual(['Bank transfer / تحويل بنكي']);
    expect(row(m, 'being')?.label).toEqual({ en: 'Being', ar: 'وذلك عن' });
    expect(text(m, 'being')).toEqual([
      'Payment of invoices INV-2026-0012, INV-2026-0013',
      'سداد الفواتير INV-2026-0012, INV-2026-0013',
    ]);
    expect(text(m, 'reference')).toEqual(['TRX-55120']);
    expect(m.signatures.map((s) => s.label)).toEqual(STANDARD_VOUCHER_LINES.in);
    expect(m.partyName).toBe('Gulf Contracting Co.');
  });

  it('pays a vendor on a payment voucher', () => {
    const m = buildVoucherModel({
      kind: 'payment',
      source: { ...received, direction: 'out', clientId: vendor.id, number: 'PM-2026-0003' },
      company: company(),
      party: vendor,
      documents: [{ number: 'BILL-0042' }],
    });
    expect(m.direction).toBe('out');
    expect(m.title).toEqual({ en: 'Payment voucher', ar: 'سند صرف' });
    expect(row(m, 'party')?.label).toEqual({ en: 'Paid to', ar: 'اصرفوا إلى' });
    expect(text(m, 'party')).toEqual(['Sample Paper Supplies']);
    expect(text(m, 'being')).toEqual([
      'Payment of bills BILL-0042',
      'سداد فواتير المشتريات BILL-0042',
    ]);
    expect(m.signatures.map((s) => s.label.en)).toEqual([
      'Accountant',
      'Approved by',
      'Receiver’s signature',
    ]);
  });

  it('prints the cheque, and its number once', () => {
    const cheque = newCheque({
      number: '004417',
      bank: 'NBOK',
      date: '2026-11-01',
      drawer: 'Gulf Contracting Co.',
    });
    const m = buildVoucherModel({
      kind: 'payment',
      source: { ...received, method: 'cheque', reference: '004417', cheque },
      company: company(),
      party: customer,
      documents: [],
    });
    expect(text(m, 'method')).toEqual(['Cheque / شيك']);
    expect(row(m, 'cheque')?.lines[0]).toMatchObject({ strong: true });
    expect(text(m, 'cheque')).toEqual(['004417']);
    expect(text(m, 'bank')).toEqual(['National Bank of Kuwait / بنك الكويت الوطني']);
    expect(text(m, 'chequeDate')).toEqual(['01/11/2026']);
    expect(row(m, 'drawer')?.label.en).toBe('Drawer');
    expect(row(m, 'reference')).toBeUndefined();
    expect(row(m, 'being')).toBeUndefined();

    const issued = buildVoucherModel({
      kind: 'payment',
      source: { ...received, direction: 'out', method: 'cheque', cheque },
      company: company(),
      party: vendor,
      documents: [],
    });
    expect(row(issued, 'drawer')?.label).toEqual({ en: 'Pay to', ar: 'ادفعوا لأمر' });
  });

  it('writes KWD amounts in words with the fils, in both languages', () => {
    const m = buildVoucherModel({
      kind: 'payment',
      source: received,
      company: company(),
      party: customer,
      documents: [],
    });
    expect(m.amount.en).toMatch(/^KD\s1,250\.750$/);
    expect(m.amount.ar).toMatch(/1,250\.750\sد\.ك/);
    expect(text(m, 'sum')).toEqual([
      'One Thousand Two Hundred Fifty Kuwaiti Dinars and Seven Hundred Fifty Fils Only',
      'فقط ألف ومائتان وخمسون دينارًا كويتيًا وسبعمائة وخمسون فلسًا لا غير',
    ]);
    expect(row(m, 'sum')?.lines.map((l) => l.parts[0].dir)).toEqual(['ltr', 'rtl']);
    const fils = buildVoucherModel({
      kind: 'payment',
      source: { ...received, amount: 0.5 },
      company: company(),
      party: customer,
      documents: [],
    });
    expect(text(fils, 'sum')?.[1]).toBe('فقط خمسمائة فلس لا غير');
  });

  it('dates the voucher in the company format and in the Hijri calendar', () => {
    const m = buildVoucherModel({
      kind: 'payment',
      source: received,
      company: company(),
      party: customer,
      documents: [],
    });
    expect(m.date).toBe('20/10/2026');
    expect(m.hijri).toMatch(/1448 هـ$/);
  });
});

describe('expense vouchers', () => {
  const expense = createExpense('sample-company', {
    number: 'EXP-2026-0004',
    date: '2026-10-19',
    amount: 36,
    currency: 'KWD',
    description: 'Courier envelopes',
    reference: 'R-3391',
  });

  it('pay the vendor, from the account the money came from', () => {
    const m = buildVoucherModel({
      kind: 'expense',
      source: { ...expense, vendorId: vendor.id },
      company: company(),
      party: vendor,
      paidFrom: cash,
      category: stationery,
    });
    expect(m.source).toBe('expense');
    expect(m.direction).toBe('out');
    expect(m.title.ar).toBe('سند صرف');
    expect(m.documentTitle).toBe('Payment voucher EXP-2026-0004');
    expect(m.rows.map((r) => r.key)).toEqual(['party', 'sum', 'paidFrom', 'being', 'reference']);
    expect(text(m, 'party')).toEqual(['Sample Paper Supplies']);
    expect(row(m, 'paidFrom')?.label).toEqual({ en: 'Paid from', ar: 'الدفع من' });
    expect(text(m, 'paidFrom')).toEqual(['Cash in hand / النقدية']);
    expect(text(m, 'being')).toEqual(['Courier envelopes']);
    expect(text(m, 'sum')?.[0]).toBe('Thirty-Six Kuwaiti Dinars Only');
  });

  it('name who was paid without a vendor, or leave a dash', () => {
    const named = buildVoucherModel({
      kind: 'expense',
      source: { ...expense, payee: 'Taxi to the port', description: '', notes: 'Two trips' },
      company: company(),
      party: null,
      paidFrom: null,
      category: stationery,
    });
    expect(text(named, 'party')).toEqual(['Taxi to the port']);
    expect(row(named, 'party')?.lines[0].parts[0].dir).toBe('auto');
    expect(row(named, 'paidFrom')).toBeUndefined();
    // No description: the category says what it was for.
    expect(text(named, 'being')).toEqual([
      'Stationery and printing / القرطاسية والطباعة',
      'Two trips',
    ]);
    expect(row(named, 'being')?.lines[1].multiline).toBe(true);
    expect(named.partyName).toBe('Taxi to the port');

    const unknown = buildVoucherModel({
      kind: 'expense',
      source: expense,
      company: company(),
      party: null,
      paidFrom: cash,
      category: null,
    });
    expect(text(unknown, 'party')).toEqual(['—']);
    expect(unknown.partyName).toBe('');
  });
});

describe('the stamp, the signature and the signature lines', () => {
  const input = (c: Company, voided = false): Extract<VoucherInput, { kind: 'payment' }> => ({
    kind: 'payment',
    source: { ...received, voided },
    company: c,
    party: customer,
    documents: [],
  });

  it('print as before until the owner switches them on', () => {
    const m = buildVoucherModel(input(company()));
    expect(m.signatures.every((s) => s.signature === null && s.stamp === null)).toBe(true);
    expect(m.company.address).toBeNull();
    expect(m.company.email).toBe('');
    expect(m.company).toMatchObject({
      name: 'Al Waha Print & Mail',
      nameAr: 'شركة الواحة للطباعة والبريد ذ.م.م',
      registration: 'CR No. 412785',
      phone: '+965 2575 0142',
    });
    expect(m.paper).toBe('A4');
  });

  it('sign for the company over the last line but one, with its address', () => {
    const m = buildVoucherModel(input(company({ vouchers: { images: true } })));
    expect(m.signatures.map((s) => [s.signature, s.stamp])).toEqual([
      [null, null],
      [PNG, STAMP],
      [null, null],
    ]);
    expect(m.company.address?.en).toContain('Salmiya');
    expect(m.company.address?.ar).toContain('السالمية');
    expect(m.company.email).toBe('accounts@alwaha-print.example');
  });

  it('never sign a void voucher', () => {
    const m = buildVoucherModel(input(company({ vouchers: { images: true } }), true));
    expect(m.voided).toBe(true);
    expect(m.signatures.some((s) => s.signature || s.stamp)).toBe(false);
  });

  it('use the company’s own lines, and its paper', () => {
    const lines = {
      in: [{ en: 'Cashier', ar: 'أمين الصندوق' }],
      out: [
        { en: 'Prepared by', ar: 'أعده' },
        { en: 'Manager', ar: 'المدير' },
        { en: 'Finance', ar: 'المالية' },
        { en: 'Received by', ar: 'المستلم' },
      ],
    };
    const c = company({ vouchers: { images: true, lines, paper: 'A5' } });
    const m = buildVoucherModel(input(c));
    expect(m.signatures).toEqual([{ label: lines.in[0], signature: PNG, stamp: STAMP }]);
    expect(m.paper).toBe('A5');
    const out = buildVoucherModel({
      ...input(c),
      source: { ...received, direction: 'out' },
      party: vendor,
    });
    expect(out.signatures.map((s) => s.label.en)).toEqual([
      'Prepared by',
      'Manager',
      'Finance',
      'Received by',
    ]);
    expect(out.signatures.findIndex((s) => s.signature)).toBe(2);
    // An empty list prints the standard lines.
    const empty = company({ vouchers: { lines: { in: [], out: [] } } });
    expect(buildVoucherModel(input(empty)).signatures.map((s) => s.label)).toEqual(
      STANDARD_VOUCHER_LINES.in,
    );
  });
});

describe('credit notes applied', () => {
  it('have no voucher: no money changed hands', () => {
    const applied = { ...received, method: 'credit_note' as const, creditId: 'credit' };
    expect(hasVoucher(applied)).toBe(false);
    expect(hasVoucher(received)).toBe(true);
    expect(() =>
      buildVoucherModel({
        kind: 'payment',
        source: applied,
        company: company(),
        party: customer,
        documents: [],
      }),
    ).toThrow('no voucher');
  });
});
