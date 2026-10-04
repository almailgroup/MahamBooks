import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import { createCompany } from '@/db/defaults';
import { createTaxRate } from '@/db/defaults';
import type { CompanyHoliday } from '@/db/types';
import { bankAccountOf, composeBankDetails, emptyBankAccount, withBankAccount } from './bank';
import { ibanProblem } from './bank-fields';
import {
  companyHolidays,
  hasOwnHolidays,
  isDayOff,
  officialHolidays,
  replaceYear,
} from './holidays';
import { taxesEnabled, withTaxes } from './taxes';
import { decodeCsv, guessColumns } from './import-columns';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('setting up a company', () => {
  it('starts Kuwait-first: KWD, Arabic name, Kuwait profile and chart, no taxes', async () => {
    const company = await setupCompany({
      name: '  Al Mail Trading ',
      nameAr: ' شركة الميل للتجارة ',
      registrationNumber: '445566',
      kuwait: { legalForm: 'spc', activity: 'salon', licenceNumber: 'L-77' },
      branding: { accentColor: '#0f766e' },
    });
    const stored = (await db.companies.get(company.id))!;
    expect(stored).toMatchObject({
      name: 'Al Mail Trading',
      nameAr: 'شركة الميل للتجارة',
      currency: 'KWD',
      dateFormat: 'dd/MM/yyyy',
      registrationLabel: 'CR No.',
      registrationNumber: '445566',
      taxesEnabled: false,
      accounting: { template: 'kw' },
    });
    expect(stored.address.country).toBe('KW');
    expect(stored.kuwait).toMatchObject({
      legalForm: 'spc',
      activity: 'salon',
      licenceNumber: 'L-77',
      foreignOwnershipPercent: 0,
      wamdPhone: '',
    });
    expect(stored.branding).toMatchObject({ accentColor: '#0f766e', templateId: 'modern' });
    expect(stored.defaults).toMatchObject({
      lineTaxes: false,
      documentTaxes: false,
      pageSize: 'A4',
    });
    expect(await db.taxRates.count()).toBe(0);

    const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
    const cheques = accounts.find((a) => a.code === '1150');
    expect(cheques).toMatchObject({
      name: 'Post-dated cheques received',
      nameAr: 'شيكات آجلة مستلمة',
    });
    expect(accounts.find((a) => a.role === 'opening_balance')?.nameAr).toBe('أرصدة افتتاحية');

    const [activity] = await db.activities.where('companyId').equals(company.id).toArray();
    expect(activity).toMatchObject({
      message: 'Company Al Mail Trading created',
      messageKey: 'Company {name} created',
      messageVars: { name: 'Al Mail Trading' },
    });
  });

  it('writes the default notes in the language of the documents', async () => {
    // Kuwaiti documents are bilingual: Arabic first, then English.
    const kuwait = await setupCompany({ name: 'Al Mail Trading' });
    expect(kuwait.language).toBe('ar-en');
    expect(kuwait.defaults.invoiceNotes).toBe('شكراً لتعاملكم معنا.\nThank you for your business.');
    expect(kuwait.defaults.quoteNotes).toBe(
      'نتطلع إلى التعامل معكم.\nWe look forward to working with you.',
    );
    expect(createCompany({ language: 'ar' }).defaults.invoiceNotes).toBe('شكراً لتعاملكم معنا.');
    expect(createCompany({ language: 'en' }).defaults).toMatchObject({
      invoiceNotes: 'Thank you for your business.',
      quoteNotes: 'We look forward to working with you.',
    });
  });

  it('switches taxes on when starter rates are given', async () => {
    const company = await setupCompany(
      { name: 'Gulf Co', currency: 'AED', address: { ...createCompany().address, country: 'AE' } },
      [{ name: 'VAT', rate: 5 }],
    );
    expect(company.taxesEnabled).toBe(true);
    expect(company.defaults.lineTaxes).toBe(true);
    expect(company.defaults.defaultTaxRateIds).toHaveLength(1);
    expect(company.accounting?.template).toBe('ae');
  });
});

describe('taxes switch', () => {
  it('treats older companies with tax rates as charging tax', () => {
    const company = createCompany();
    expect(taxesEnabled(company, 0)).toBe(false);
    expect(taxesEnabled(company, 2)).toBe(true);
    expect(taxesEnabled({ taxesEnabled: false }, 2)).toBe(false);
    expect(createTaxRate(company.id).archived).toBe(false);
  });

  it('turns the editor tax columns off and back on', () => {
    const company = createCompany({
      defaults: { ...createCompany().defaults, lineTaxes: true, documentTaxes: true },
    });
    const off = withTaxes(company, false);
    expect(off).toMatchObject({ taxesEnabled: false });
    expect(off.defaults).toMatchObject({ lineTaxes: false, documentTaxes: false });
    const on = withTaxes(off, true);
    expect(on).toMatchObject({ taxesEnabled: true });
    expect(on.defaults).toMatchObject({ lineTaxes: true, documentTaxes: false });
  });
});

describe('bank account on documents', () => {
  it('composes the printed details from the structured account', () => {
    const account = {
      ...emptyBankAccount(),
      bankCode: 'NBOK',
      accountName: 'Al Mail Trading Co. W.L.L.',
      iban: 'kw81 cbku 0000 0000 0000 1234 5601 01',
    };
    expect(composeBankDetails(account, '+965 5555 1234')).toBe(
      [
        'National Bank of Kuwait · بنك الكويت الوطني',
        'Account name: Al Mail Trading Co. W.L.L.',
        'IBAN: KW81 CBKU 0000 0000 0000 1234 5601 01',
        'SWIFT: NBOKKWKW',
        'WAMD: +965 5555 1234',
      ].join('\n'),
    );
    const company = withBankAccount(createCompany(), account, '');
    expect(company.bankAccount?.iban).toBe('KW81CBKU0000000000001234560101');
    expect(company.payment.bankDetails).toContain('IBAN: KW81 CBKU');
  });

  it('keeps free text typed before as extra details', () => {
    const company = createCompany({
      payment: { ...createCompany().payment, bankDetails: 'Gulf Bank\nAcc 123' },
    });
    const account = bankAccountOf(company);
    expect(account.extra).toBe('Gulf Bank\nAcc 123');
    expect(composeBankDetails(account)).toBe('Gulf Bank\nAcc 123');
  });

  it('explains what is wrong with an IBAN', () => {
    expect(ibanProblem('')).toBeNull();
    expect(ibanProblem('KW81CBKU0000000000001234560101')).toBeNull();
    expect(ibanProblem('KW81CBKU00000000000012345601')).toBe(
      'A Kuwaiti IBAN has 30 characters. This one has 28.',
    );
    expect(ibanProblem('KW82CBKU0000000000001234560101')).toBe(
      'This IBAN is not valid. Check it for a typing mistake.',
    );
  });
});

describe('public holidays', () => {
  it('uses the official estimates until a year is changed', () => {
    const official = officialHolidays(2026);
    expect(official.map((h) => h.date)).toContain('2026-02-25');
    expect(official.find((h) => h.date === '2026-02-26')).toEqual({
      date: '2026-02-26',
      name: 'Liberation Day',
      nameAr: 'عيد التحرير',
    });
    expect(companyHolidays({}, 2026)).toEqual(official);
    expect(hasOwnHolidays({}, 2026)).toBe(false);
  });

  it('replaces one year and leaves the others alone', () => {
    const bridge: CompanyHoliday = { date: '2026-02-24', name: 'Bridge day', nameAr: 'يوم عطلة' };
    const holidays = replaceYear(undefined, 2026, [...officialHolidays(2026), bridge]);
    expect(hasOwnHolidays({ holidays }, 2026)).toBe(true);
    expect(hasOwnHolidays({ holidays }, 2027)).toBe(false);
    expect(companyHolidays({ holidays }, 2026)[2]).toEqual(bridge);
    expect(companyHolidays({ holidays }, 2027)).toEqual(officialHolidays(2027));
    expect(isDayOff({ holidays }, '2026-02-24')).toBe(true); // bridge day (Tuesday)
    expect(isDayOff({ holidays }, '2026-02-23')).toBe(false); // Monday
    expect(isDayOff({ holidays }, '2026-02-27')).toBe(true); // Friday
    expect(isDayOff({ holidays }, '2026-02-28')).toBe(true); // Saturday
    expect(replaceYear(holidays, 2026, [])).toBeUndefined();
  });
});

describe('reading CSV files', () => {
  it('reads UTF-8 with a BOM, Windows Arabic and UTF-16 files', () => {
    const utf8 = new TextEncoder().encode('\uFEFFالاسم,المبلغ\n');
    expect(decodeCsv(utf8).replace(/^\uFEFF/, '')).toBe('الاسم,المبلغ\n');
    // "الاسم" in Windows-1256, as Excel saves a plain CSV on Arabic Windows.
    const cp1256 = new Uint8Array([0xc7, 0xe1, 0xc7, 0xd3, 0xe3, 0x2c, 0x41]);
    expect(decodeCsv(cp1256)).toBe('الاسم,A');
    const utf16 = new Uint8Array([0xff, 0xfe, 0x27, 0x06, 0x44, 0x06, 0x09, 0x00, 0x41, 0x00]);
    expect(decodeCsv(utf16)).toBe('ال\tA');
    expect(guessColumns('products', decodeCsv(cp1256).split(','))).toMatchObject({ name: 0 });
  });
});
