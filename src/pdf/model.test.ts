import { describe, expect, it } from 'vitest';
import type { Client, Company, DocumentLanguage, InvoiceDocument } from '@/db/types';
import { createCompany } from '@/db/defaults';
import { formatHijri } from '@/lib/kuwait';
import { buildRenderModel, documentLanguage, paymentLinkOf, showsAmountInWords } from './model';
import { sampleClient, sampleCompany, sampleDocument, sampleGoods } from './sample';

const company = sampleCompany();
const client = sampleClient(company.id);

function model(
  language: DocumentLanguage,
  overrides: Partial<InvoiceDocument> = {},
  options: { company?: Company; client?: Client | null } = {},
) {
  const c = options.company ?? company;
  const cl = options.client === undefined ? client : options.client;
  const doc = sampleDocument(c, cl ?? client, 'invoice', overrides, language);
  return buildRenderModel(doc, c, cl, { language });
}

const WORDS_EN = 'One Thousand Three Hundred Fifty-Five Kuwaiti Dinars and Five Hundred Fils Only';
const WORDS_AR = 'فقط ألف وثلاثمائة وخمسة وخمسون دينارًا كويتيًا وخمسمائة فلس لا غير';
/** Amounts as Intl writes them, with a non-breaking space after "KD". */
const kd = (amount: string) => `KD\u00a0${amount}`;
const ARABIC_DIGITS = /[٠-٩۰-۹]/;

describe('buildRenderModel: totals in Kuwaiti dinars', () => {
  it('prints KD with 3 decimals in English and bilingual documents', () => {
    for (const language of ['en', 'ar-en'] as const) {
      const m = model(language);
      expect(m.grandTotal.value).toBe(kd('1,355.500'));
      expect(m.amountDue.value).toBe(kd('1,355.500'));
      expect(m.items.map((i) => i.amount)).toEqual([
        kd('185.000'),
        kd('350.000'),
        kd('150.000'),
        kd('562.500'),
        kd('108.000'),
      ]);
      expect(m.items[1].unitPrice).toBe(kd('0.028'));
    }
  });

  it('writes د.ك after the amount in Arabic documents, with Western digits', () => {
    const m = model('ar');
    expect(m.grandTotal.value).toContain('1,355.500\u00a0د.ك');
    for (const value of [...m.totals.map((t) => t.value), ...m.items.map((i) => i.amount)]) {
      expect(value).not.toMatch(ARABIC_DIGITS);
    }
    expect(m.issueDate).not.toMatch(ARABIC_DIGITS);
  });
});

describe('buildRenderModel: amount in words', () => {
  it('is English in English documents', () => {
    expect(model('en').amountInWords).toEqual([WORDS_EN]);
  });

  it('is Arabic in Arabic documents', () => {
    expect(model('ar').amountInWords).toEqual([WORDS_AR]);
  });

  it('is Arabic then English in bilingual documents', () => {
    expect(model('ar-en').amountInWords).toEqual([WORDS_AR, WORDS_EN]);
  });

  it('can be turned off, and is off by default outside Kuwait', () => {
    const off = { ...company, defaults: { ...company.defaults, showAmountInWords: false } };
    expect(model('ar-en', {}, { company: off }).amountInWords).toEqual([]);
    expect(showsAmountInWords(company)).toBe(true);
    const uk = createCompany({
      currency: 'GBP',
      address: { ...company.address, country: 'GB' },
    });
    expect(showsAmountInWords(uk)).toBe(false);
  });

  it('is left out when the total is zero', () => {
    expect(model('ar-en', { items: [] }).amountInWords).toEqual([]);
  });
});

describe('buildRenderModel: bilingual names and labels', () => {
  it('lays bilingual documents out right to left with Arabic first', () => {
    const m = model('ar-en');
    expect(m.dir).toBe('rtl');
    expect(m.title).toBe('فاتورة');
    expect(m.titleSecondary).toBe('Invoice');
    expect(m.recipientLabel).toBe('فاتورة إلى');
    expect(m.recipientLabelSecondary).toBe('Bill to');
    expect(m.grandTotal).toMatchObject({ label: 'الإجمالي', secondary: 'Total' });
    expect(m.documentTitle).toBe('Invoice INV-2026-0042');
  });

  it('prints Arabic names with the English name under them', () => {
    const m = model('ar-en');
    expect(m.company).toMatchObject({
      name: 'شركة الواحة للطباعة والبريد ذ.م.م',
      nameSecondary: 'Al Waha Print & Mail Co. W.L.L.',
    });
    expect(m.client).toMatchObject({
      name: 'شركة الروضة التجارية',
      nameSecondary: 'Al Rawda Trading Co.',
    });
    expect(m.items[0]).toMatchObject({
      title: 'تصميم الحملة والأعمال الفنية',
      titleSecondary: 'Campaign design & artwork',
    });
  });

  it('prints only the Arabic names in Arabic documents', () => {
    const m = model('ar');
    expect(m.secondary).toBeNull();
    expect(m.company.nameSecondary).toBe('');
    expect(m.client.name).toBe('شركة الروضة التجارية');
    expect(m.items[0]).toMatchObject({ title: 'تصميم الحملة والأعمال الفنية', titleSecondary: '' });
  });

  it('falls back to the English name when there is no Arabic one', () => {
    const doc = sampleDocument(company, client, 'invoice', {}, 'ar');
    doc.items[0] = { ...doc.items[0], nameAr: '' };
    const m = buildRenderModel(doc, { ...company, nameAr: '' }, { ...client, nameAr: undefined });
    expect(m.items[0]).toMatchObject({ title: 'Campaign design & artwork', titleSecondary: '' });
    expect(m.company.name).toBe('Al Waha Print & Mail Co. W.L.L.');
    expect(m.client.name).toBe('Al Rawda Trading Co.');
  });

  it('prints English names in English documents', () => {
    const m = model('en');
    expect(m.dir).toBe('ltr');
    expect(m.secondary).toBeNull();
    expect(m.company.name).toBe('Al Waha Print & Mail Co. W.L.L.');
    expect(m.items[0].title).toBe('Campaign design & artwork');
  });

  it('writes Kuwaiti addresses with Arabic place names in Arabic documents', () => {
    expect(model('ar').company.addressLines).toContain('السالمية، حولي 22001');
    expect(model('en').company.addressLines).toContain('Salmiya, Hawalli 22001');
  });

  it('labels the CR and commercial licence numbers', () => {
    expect(model('en').company.registrationLine).toBe('CR No.: 412785');
    expect(model('en').company.licenceLine).toBe('Licence No.: 2019/18452');
    expect(model('ar').company.registrationLine).toBe('رقم السجل التجاري: 412785');
  });

  it('uses the client’s language over the company’s', () => {
    expect(documentLanguage(company, { ...client, language: 'en' })).toBe('en');
    expect(documentLanguage(company, client)).toBe('ar-en');
    const m = buildRenderModel(sampleDocument(company, client, 'invoice'), company, {
      ...client,
      language: 'ar',
    });
    expect(m.language).toBe('ar');
  });

  it('applies custom wording per language', () => {
    const custom = {
      ...company,
      labels: { invoice: 'Tax Invoice', 'ar.invoice': 'فاتورة ضريبية' },
    };
    const both = model('ar-en', {}, { company: custom });
    expect([both.title, both.titleSecondary]).toEqual(['فاتورة ضريبية', 'Tax Invoice']);
    expect(model('en', {}, { company: custom }).title).toBe('Tax Invoice');
    expect(model('ar', {}, { company: custom }).title).toBe('فاتورة ضريبية');
  });
});

describe('buildRenderModel: Kuwaiti invoice details', () => {
  it('prints delivery date and place when set', () => {
    const m = model('ar-en', { deliveryDate: '2026-10-05', deliveryPlace: 'Shuwaikh, Block 2' });
    expect(m.meta).toContainEqual({
      label: 'تاريخ التسليم',
      secondary: 'Delivery date',
      value: '05/10/2026',
    });
    expect(m.meta).toContainEqual({
      label: 'مكان التسليم',
      secondary: 'Delivery place',
      value: 'Shuwaikh, Block 2',
    });
    expect(model('en').meta.map((r) => r.label)).not.toContain('Delivery date');
  });

  it('prints the Hijri date when turned on', () => {
    const hijri = { ...company, defaults: { ...company.defaults, showHijriDate: true } };
    const m = model('ar', { issueDate: '2026-10-03' }, { company: hijri });
    expect(m.meta[1]).toEqual({
      label: 'التاريخ الهجري',
      secondary: '',
      value: formatHijri('2026-10-03', 'ar'),
    });
    expect(model('ar').meta.map((r) => r.label)).not.toContain('التاريخ الهجري');
  });

  it('prints the condition and serial number of goods', () => {
    const m = model('ar-en', { items: sampleGoods() });
    expect(m.columns.condition).toBe(true);
    expect(m.items.map((i) => i.condition)).toEqual(['جديد · New', 'مستعمل · Used', 'جديد · New']);
    expect(m.items[0].serial).toContain('ZT4-26-004217');
    expect(m.items[2].serial).toBe('');
    const plain = model('en');
    expect(plain.columns.condition).toBe(false);
    expect(model('en', { items: sampleGoods() }).items[1].condition).toBe('Used');
  });

  it('groups the IBAN and names the bank in the document language', () => {
    const en = model('en').payment!;
    expect(en.details.split('\n')).toEqual([
      'Bank: National Bank of Kuwait',
      'Al Waha Print & Mail Co. W.L.L.',
      'IBAN',
      'KW86 NBOK 0000 0000 0000 2012 3456 78',
      'WAMD: +965 9876 5432',
    ]);
    const ar = model('ar').payment!;
    expect(ar.details).toContain('البنك: بنك الكويت الوطني');
    expect(ar.details).not.toContain('National Bank of Kuwait');
    const both = model('ar-en').payment!;
    expect(both.details).toContain('البنك: بنك الكويت الوطني');
    expect(both.details).toContain('Bank: National Bank of Kuwait');
  });

  it('prints the document’s own payment link while it is valid', () => {
    const doc = {
      paymentLink: {
        provider: 'tap' as const,
        url: 'https://tap.example/1',
        expiresAt: '2026-10-10',
      },
    };
    expect(paymentLinkOf(doc, company, '2026-10-09')).toBe('https://tap.example/1');
    expect(paymentLinkOf(doc, company, '2026-10-11')).toBe('https://pay.example.com/alwaha');
    expect(paymentLinkOf({ paymentLink: null }, company)).toBe('https://pay.example.com/alwaha');
    const m = model('en', {
      paymentLink: { provider: 'tap', url: 'https://tap.example/2', expiresAt: null },
    });
    expect(m.payment?.link).toBe('https://tap.example/2');
  });

  it('leaves room for the signature and stamp on Arabic documents', () => {
    expect(model('ar-en').signatures).toEqual({ signature: null, stamp: null, receivedBy: true });
    expect(model('en').signatures).toBeNull();
    const signed = {
      ...company,
      branding: { ...company.branding, signature: 'data:image/png;base64,AA', stamp: null },
    };
    expect(model('en', {}, { company: signed }).signatures).toMatchObject({
      signature: 'data:image/png;base64,AA',
    });
    const quote = buildRenderModel(sampleDocument(company, client, 'quote'), company, client);
    expect(quote.signatures?.receivedBy).toBe(false);
  });

  it('labels the paid stamp in both languages', () => {
    const m = model('ar-en', {
      status: 'paid',
      totals: { subtotal: 0, discount: 0, taxTotal: 0, total: 0, paid: 1355.5, balance: 0 },
    });
    expect(m.stamp).toEqual({ text: 'مدفوعة', secondary: 'Paid', tone: 'green' });
    expect(m.amountDue).toMatchObject({ label: 'الرصيد المستحق', value: kd('0.000') });
  });
});

describe('buildRenderModel: orders and delivery notes', () => {
  it('titles each document in Arabic with English beside it', () => {
    const titles = (['proforma', 'sales_order', 'purchase_order', 'delivery_note'] as const).map(
      (type) => {
        const m = model('ar-en', { type, number: 'X-1' });
        return [m.title, m.titleSecondary, m.numberLabel, m.numberLabelSecondary];
      },
    );
    expect(titles).toEqual([
      ['فاتورة مبدئية', 'Proforma Invoice', 'رقم الفاتورة المبدئية', 'Proforma no.'],
      ['أمر بيع', 'Sales Order', 'رقم أمر البيع', 'Order no.'],
      ['أمر شراء', 'Purchase Order', 'رقم أمر الشراء', 'PO no.'],
      ['إذن تسليم', 'Delivery Note', 'رقم إذن التسليم', 'Delivery note no.'],
    ]);
    expect(model('en', { type: 'delivery_note' }).documentTitle).toMatch(/^Delivery Note /);
  });

  it('prints no prices, totals or payment details on delivery notes', () => {
    const m = model('ar-en', {
      type: 'delivery_note',
      items: sampleGoods(),
      deliveryDate: '2026-10-03',
      deliveryPlace: 'Warehouse 4\nShuwaikh Industrial',
    });
    expect(m.columns).toMatchObject({ prices: false, unit: true, serial: true, tax: false });
    expect(m.totals).toEqual([]);
    expect(m.amountInWords).toEqual([]);
    expect(m.payment).toBeNull();
    expect(m.deposit).toBeNull();
    expect(m.amountDue.label).toBe('تاريخ التسليم');
    expect(m.recipientLabel).toBe('تم التسليم إلى');
    expect(m.recipientLabelSecondary).toBe('Delivered to');
    expect(m.client.addressLines).toEqual(['Warehouse 4', 'Shuwaikh Industrial']);
    expect(m.shipTo).toBeNull();
    expect(m.items[0].serialNo).not.toBe('');
    // Signed and stamped by both sides, with blank lines until it is delivered.
    expect(m.signatures?.receivedBy).toBe(true);
    expect(m.receipt).toEqual({ name: '', civilId: '', date: '' });
  });

  it('fills in who received the goods once delivered', () => {
    const m = model('en', {
      type: 'delivery_note',
      status: 'delivered',
      deliveryDate: '2026-10-03',
      receiverName: 'Ahmad Al-Mutairi',
      receiverCivilId: '287010112349',
    });
    expect(m.receipt).toMatchObject({ name: 'Ahmad Al-Mutairi', civilId: '287010112349' });
    expect(m.receipt?.date).not.toBe('');
    expect(m.stamp?.text).toBe('Delivered');
  });

  it('prints the supplier on purchase orders and the deposit on proformas', () => {
    const po = model('en', { type: 'purchase_order', poNumber: 'ignored' });
    expect(po.recipientLabel).toBe('Supplier');
    expect(po.meta.map((r) => r.label)).not.toContain('PO number');
    expect(po.amountDue.label).toBe('Total');
    expect(po.payment).toBeNull();

    const proforma = model('en', { type: 'proforma', deposit: 500, depositDueDate: '2026-10-15' });
    expect(proforma.recipientLabel).toBe('Bill to');
    expect(proforma.deposit?.value).toBe(kd('500.000'));
    expect(proforma.meta.map((r) => r.label)).toContain('Valid until');
  });

  it('refuses to print bills, which are the vendor’s documents', () => {
    expect(() => model('en', { type: 'bill' })).toThrow();
  });
});
