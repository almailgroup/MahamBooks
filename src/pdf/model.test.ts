import { describe, expect, it } from 'vitest';
import type { Client, Company, DocumentLanguage, InvoiceDocument } from '@/db/types';
import { createCompany } from '@/db/defaults';
import { formatHijri } from '@/lib/kuwait';
import { composeBankDetails } from '@/features/company/bank';
import {
  buildRenderModel,
  documentLanguage,
  LOGO_SCALE,
  paymentLinkOf,
  printedBankDetails,
  printsAsDraft,
  qrLinkOf,
  showsAmountInWords,
} from './model';
import { sampleClient, sampleCompany, sampleDocument, sampleGoods } from './sample';
import { ltr } from './bidi';

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

describe('buildRenderModel: retention', () => {
  it('shows the retention held and leaves it out of the amount due', () => {
    // 5% of 1,355.500 is 67.775.
    const m = model('ar-en', { retentionPercent: 5 });
    const retention = m.totals.find((t) => t.kind === 'retention')!;
    expect(retention).toMatchObject({
      label: 'محتجزات (5%)',
      secondary: 'Retention held (5%)',
      value: `-${kd('67.775')}`,
    });
    expect(m.totals.at(-1)).toMatchObject({ kind: 'balance', value: kd('1,287.725') });
    expect(m.amountDue.value).toBe(kd('1,287.725'));
    expect(
      model('en', { retentionPercent: 5 }).totals.find((t) => t.kind === 'retention'),
    ).toMatchObject({ label: 'Retention held (5%)', secondary: '' });
  });

  it('is gone once released, and never shows on a quote', () => {
    const released = model('en', {
      retentionPercent: 5,
      retentionReleases: [
        {
          id: 'r',
          date: '2026-01-01',
          amount: 67.775,
          basis: 'handover',
          reference: '',
          journalId: 'j',
        },
      ],
    });
    expect(released.totals.some((t) => t.kind === 'retention')).toBe(false);
    expect(released.amountDue.value).toBe(kd('1,355.500'));
    const c = company;
    const quote = sampleDocument(c, client, 'quote', { retentionPercent: 5 }, 'en');
    expect(
      buildRenderModel(quote, c, client, { language: 'en' }).totals.some(
        (t) => t.kind === 'retention',
      ),
    ).toBe(false);
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

  it('prints saved bank details in the document’s words, with the WAMD number once', () => {
    const bankDetails = composeBankDetails(
      {
        bankCode: 'NBOK',
        bankName: '',
        accountName: 'Al Waha Print & Mail Co. W.L.L.',
        iban: 'KW86NBOK0000000000002012345678',
        accountNumber: '2012345678',
        swift: '',
        extra: '',
      },
      '+965 9876 5432',
    );
    const saved = { ...company, payment: { ...company.payment, bankDetails } };
    const details = (language: DocumentLanguage) =>
      model(language, {}, { company: saved }).payment!.details;
    const en = details('en');
    expect(en).toContain('Account name: Al Waha Print & Mail Co. W.L.L.');
    expect(en.match(/WAMD/g)).toHaveLength(1);
    // The bank is saved under both its names; each document prints its own.
    expect(bankDetails).toContain('National Bank of Kuwait · بنك الكويت الوطني');
    expect(en.split('\n')[0]).toBe('National Bank of Kuwait');
    const ar = details('ar');
    expect(ar.split('\n')[0]).toBe('بنك الكويت الوطني');
    expect(ar).toContain('اسم الحساب: Al Waha Print & Mail Co. W.L.L.');
    expect(ar).toContain('رقم الحساب: 2012345678');
    expect(ar).toContain('رقم الآيبان: KW86 NBOK 0000 0000 0000 2012 3456 78');
    expect(ar).not.toMatch(/National|Account|IBAN|WAMD/);
    expect(ar.match(/ومض/g)).toHaveLength(1);
    const both = details('ar-en');
    expect(both).toContain('اسم الحساب · Account name: Al Waha Print & Mail Co. W.L.L.');
    // Settings show the details as the documents print them.
    expect(printedBankDetails({ ...saved, language: 'ar' })).toMatch(
      /^بنك الكويت الوطني\nاسم الحساب: Al Waha Print & Mail Co\. W\.L\.L\.\n/,
    );
    expect(printedBankDetails({ ...saved, language: 'en' })).toBe(
      bankDetails.replace(' · بنك الكويت الوطني', ''),
    );
    expect(both.split('\n')[0]).toMatch(/^بنك الكويت الوطني · \W*National Bank of Kuwait\W*$/);
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

describe('buildRenderModel: drafts, signature and QR code', () => {
  const SIGNATURE = 'data:image/png;base64,U0lH';
  const STAMP = 'data:image/png;base64,U1RN';
  const QR = 'data:image/png;base64,UVI=';
  const signed: Company = {
    ...company,
    branding: { ...company.branding, signature: SIGNATURE, stamp: STAMP },
  };

  it('prints a draft without the signature and stamp, under a Draft watermark', () => {
    const m = model('ar-en', { status: 'draft' }, { company: signed });
    expect(m.signatures).toEqual({ signature: null, stamp: null, receivedBy: true });
    expect(m.watermark).toBe('draft');
    expect([m.labels.draftStamp, m.secondary?.draftStamp]).toEqual(['مسودة', 'Draft']);
    // An English draft keeps the empty boxes, where the copy sent is signed.
    expect(model('en', { status: 'draft' }, { company: signed }).signatures).toEqual({
      signature: null,
      stamp: null,
      receivedBy: true,
    });
    for (const type of ['quote', 'credit', 'proforma', 'sales_order', 'purchase_order'] as const) {
      expect(model('en', { type, status: 'draft' }, { company: signed }).watermark).toBe('draft');
    }
  });

  it('keeps the signature and stamp on what is sent, and on delivery notes', () => {
    for (const status of ['sent', 'partial', 'paid', 'void'] as const) {
      const m = model('en', { status }, { company: signed });
      expect(m.watermark).toBeNull();
      expect(m.signatures).toMatchObject({ signature: SIGNATURE, stamp: STAMP });
    }
    // A delivery note goes out with the goods before it is marked as delivered.
    const note = model('en', { type: 'delivery_note', status: 'draft' }, { company: signed });
    expect(note.watermark).toBeNull();
    expect(note.signatures).toMatchObject({ signature: SIGNATURE, stamp: STAMP });
    expect(printsAsDraft({ type: 'delivery_note', status: 'draft' })).toBe(false);
    expect(printsAsDraft({ type: 'invoice', status: 'draft' })).toBe(true);
  });

  it('prints no QR code when it is off, whatever it is set to open', () => {
    for (const qrContent of [undefined, 'payment_link', 'pay_page'] as const) {
      const c: Company = {
        ...company,
        payment: { ...company.payment, showQrCode: false },
        defaults: { ...company.defaults, qrContent },
      };
      const m = buildRenderModel(sampleDocument(c, client), c, client, { qrCode: QR });
      expect(m.payment?.link).toBe('https://pay.example.com/alwaha');
      expect(m.payment?.qr).toBeNull();
    }
  });

  it('opens the payment link from the QR code until there is a pay page', () => {
    for (const qrContent of [undefined, 'payment_link', 'pay_page'] as const) {
      const c: Company = { ...company, defaults: { ...company.defaults, qrContent } };
      expect(qrLinkOf({ paymentLink: null }, c)).toBe('https://pay.example.com/alwaha');
      const m = buildRenderModel(sampleDocument(c, client), c, client, { qrCode: QR });
      expect(m.payment?.qr).toBe(QR);
    }
  });

  it('prints as before when the new settings are missing', () => {
    // As an older version saves the company: no ink, no original, no QR choice.
    const before = model('ar-en', {}, { company: signed });
    expect(before.signatures).toEqual({ signature: SIGNATURE, stamp: STAMP, receivedBy: true });
    expect(before.watermark).toBeNull();
    const chosen: Company = {
      ...signed,
      branding: { ...signed.branding, signatureInk: 'original', signatureOriginal: null },
      defaults: { ...signed.defaults, qrContent: 'payment_link' },
    };
    expect(model('ar-en', {}, { company: chosen })).toEqual(before);
    // The blue signature is the one printed, so older versions print it too.
    const blue: Company = {
      ...signed,
      branding: { ...signed.branding, signatureInk: 'blue', signatureOriginal: STAMP },
    };
    expect(model('en', {}, { company: blue }).signatures?.signature).toBe(SIGNATURE);
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

describe('buildRenderModel: designs per type and layout', () => {
  const LOGO = 'data:image/png;base64,TE9HTw==';
  const PICTURE = 'data:image/png;base64,UElD';
  const withLogo: Company = { ...company, branding: { ...company.branding, logo: LOGO } };
  const designed = (branding: Partial<Company['branding']>): Company => ({
    ...withLogo,
    branding: { ...withLogo.branding, ...branding },
  });
  const quote = (
    c: Company,
    overrides: Partial<InvoiceDocument> = {},
    language: DocumentLanguage = 'en',
  ) =>
    buildRenderModel(sampleDocument(c, client, 'quote', overrides, language), c, client, {
      language,
    });

  it('prints as before when no design or layout is set', () => {
    for (const type of ['invoice', 'quote', 'credit'] as const) {
      const m = buildRenderModel(sampleDocument(withLogo, client, type), withLogo, client);
      expect(m.accent).toBe(withLogo.branding.accentColor);
      expect(m.company.logo).toBe(LOGO);
      expect(m.logo).toEqual({ scale: 1, row: null });
      expect(m.intro).toBe('');
      expect(m.acceptance).toBe(false);
      expect(m.columns).toMatchObject({ sku: false, images: false });
      expect(m.items.every((i) => i.sku === '' && i.image === null)).toBe(true);
    }
    // Settings at their defaults change nothing either.
    const defaults = designed({ layout: { logoSize: 'medium', showSku: false }, byType: {} });
    expect(quote(defaults)).toEqual(quote(withLogo));
  });

  it('takes the colour from the document, then its type, then the company', () => {
    const c = designed({ byType: { quote: { accentColor: '#0f766e' } } });
    expect(quote(c).accent).toBe('#0f766e');
    expect(quote(c, { accentColor: '#be123c' }).accent).toBe('#be123c');
    expect(buildRenderModel(sampleDocument(c, client), c, client).accent).toBe(
      c.branding.accentColor,
    );
    // The template gallery's colour still wins.
    const preview = buildRenderModel(sampleDocument(c, client, 'quote'), c, client, {
      accent: '#111111',
    });
    expect(preview.accent).toBe('#111111');
  });

  it('prints an SKU column for lines that have one, when the layout shows it', () => {
    const c = designed({ byType: { quote: { layout: { showSku: true } } } });
    const m = quote(c);
    expect(m.columns.sku).toBe(true);
    expect(m.items.map((i) => i.sku)).toEqual(['DSG-101', 'PRT-A4-100', 'ENV-C5', 'DLV-KW', '']);
    // Only quotes have it here; invoices keep the company's layout.
    expect(buildRenderModel(sampleDocument(c, client), c, client).columns.sku).toBe(false);
    // Lines without SKUs (documents from before) print no column.
    const old = sampleDocument(c, client, 'quote');
    const bare = { ...old, items: old.items.map(({ sku: _sku, ...line }) => line) };
    expect(buildRenderModel(bare, c, client).columns.sku).toBe(false);
    // In Arabic documents the code reads left to right.
    expect(quote(c, {}, 'ar').items[0].sku).toBe(ltr('DSG-101'));
  });

  it('moves the logo to a line of its own and scales it', () => {
    const c = designed({ layout: { logoPosition: 'center', logoSize: 'large' } });
    const m = buildRenderModel(sampleDocument(c, client), c, client);
    expect(m.logo).toEqual({ scale: LOGO_SCALE.large, row: { src: LOGO, align: 'center' } });
    // The template then prints its header as it does without a logo.
    expect(m.company.logo).toBeNull();
    const small = designed({ layout: { logoSize: 'small' } });
    expect(buildRenderModel(sampleDocument(small, client), small, client).logo).toEqual({
      scale: LOGO_SCALE.small,
      row: null,
    });
    // No logo, no line for it.
    const none = designed({ logo: null, layout: { logoPosition: 'end' } });
    expect(buildRenderModel(sampleDocument(none, client), none, client).logo.row).toBeNull();
  });

  it('prints the acceptance box on quotes and proformas only', () => {
    const c = designed({ layout: { showAcceptance: true } });
    expect(quote(c).acceptance).toBe(true);
    const of = (type: 'invoice' | 'credit' | 'proforma') =>
      buildRenderModel(sampleDocument(c, client, 'invoice', { type }), c, client).acceptance;
    expect([of('proforma'), of('invoice'), of('credit')]).toEqual([true, false, false]);
    expect(quote(c, {}, 'ar-en').labels.customerAcceptance).toBe('قبول العميل');
  });

  it('prints the quote’s introduction', () => {
    expect(quote(withLogo, { intro: '  Further to your request:  ' }).intro).toBe(
      'Further to your request:',
    );
  });

  it('prints item pictures only when the layout shows them', () => {
    const doc = sampleDocument(withLogo, client, 'quote');
    const items = doc.items.map((item, i) => (i === 0 ? { ...item, productId: 'p1' } : item));
    const pictures = { p1: PICTURE };
    const off = buildRenderModel({ ...doc, items }, withLogo, client, { itemImages: pictures });
    expect(off.columns.images).toBe(false);
    const c = designed({ layout: { showItemImages: true } });
    const on = buildRenderModel({ ...doc, items }, c, client, { itemImages: pictures });
    expect(on.columns.images).toBe(true);
    expect(on.items.map((i) => i.image)).toEqual([PICTURE, null, null, null, null]);
  });
});

describe('buildRenderModel: units from the list', () => {
  const goods = () => {
    const [printer, folder, rolls] = sampleGoods();
    return [
      { ...printer, unit: 'pcs', unitId: 'pcs' },
      // Typed by hand: no id.
      { ...folder, unit: 'pcs' },
      { ...rolls, unit: 'roll', unitId: 'u-roll' },
    ];
  };
  const own: Company = {
    ...company,
    items: { units: true, customUnits: [{ id: 'u-roll', name: 'roll', nameAr: 'لفة' }] },
  };

  it('print the Arabic name on Arabic and bilingual documents', () => {
    for (const language of ['ar', 'ar-en'] as const) {
      const m = model(language, { items: goods() }, { company: own });
      expect(m.items.map((i) => i.unit)).toEqual(['قطعة', 'pcs', 'لفة']);
    }
  });

  it('print the unit as stored in English, and as before without an id', () => {
    const m = model('en', { items: goods() }, { company: own });
    expect(m.items.map((i) => i.unit)).toEqual(['pcs', 'pcs', 'roll']);
    // An id the company no longer has (or an older copy of it): the text.
    const plain = model('ar', { items: goods() });
    expect(plain.items.map((i) => i.unit)).toEqual(['قطعة', 'pcs', 'roll']);
  });
});

describe('buildRenderModel: an invoice issued in place of a void one (D12)', () => {
  it('prints the number it replaces, and nothing for every other document', () => {
    const en = model('en', { replacesNumber: 'INV-2026-0007' });
    expect(en.meta).toContainEqual(
      expect.objectContaining({ label: 'Replaces', value: 'INV-2026-0007' }),
    );
    const ar = model('ar', { replacesNumber: 'INV-2026-0007' });
    expect(ar.meta).toContainEqual(
      expect.objectContaining({ label: 'بدلاً من', value: ltr('INV-2026-0007') }),
    );
    expect(model('en').meta.some((m) => m.label === 'Replaces')).toBe(false);
  });
});
