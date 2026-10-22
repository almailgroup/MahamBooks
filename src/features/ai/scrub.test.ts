import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { saveClient, setupCompany } from '@/db/records';
import { createClient } from '@/db/defaults';
import { createEmployee, saveEmployee } from '@/db/people';
import type { Company } from '@/db/types';
import { loadLanguage } from '@/i18n';
import { isValidCivilId } from '@/lib/kuwait';
import { knownValues } from './known-values';
import { foldValue, scrubText } from './scrub';

/**
 * What the person types, cleaned before it goes to the AI assistant: ID
 * numbers, IBANs, phones, emails and long numbers by their shape, and this
 * company's own never-send values however they are written, with the rest
 * of the text, Arabic marks and digits included, sent as it was typed.
 * Made-up numbers only (valid Civil IDs and IBANs are made up to pass their
 * checks, and belong to nobody).
 */

/** Made-up Civil IDs that pass the check digit (born 15 April 1987 and 31 December 1995). */
const CIVIL_ID = '287041512345';
const CIVIL_ID_2 = '295123100125';
/** A made-up Kuwaiti IBAN with valid check digits (the standard example). */
const IBAN = 'KW81CBKU0000000000001234560101';
const IBAN_SPACED = 'KW81 CBKU 0000 0000 0000 1234 5601 01';

/** Arabic-Indic digits for Western ones. */
const arabicDigits = (text: string) =>
  text.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));

describe('the made-up numbers', () => {
  it('are what the checks take them for', () => {
    expect(isValidCivilId(CIVIL_ID)).toBe(true);
    expect(isValidCivilId(CIVIL_ID_2)).toBe(true);
    expect(isValidCivilId('287041512346')).toBe(false);
  });
});

describe('Civil IDs', () => {
  it('are hidden inside Arabic text with marks and Arabic-Indic digits, the rest as typed', () => {
    const before = 'رقمُ بطاقتي المدنيّة هو ';
    const after = '، فكيفَ أُضيفُ الموظّفَ؟';
    const typed = `${before}${arabicDigits(CIVIL_ID)}${after}`;
    const sent = scrubText(typed);
    // Exactly over the number: every mark and letter around it as it was.
    expect(sent.text).toBe(`${before}[رقم هوية مخفي]${after}`);
    expect(sent.hidden).toEqual({ id: 1 });
    expect(sent.count).toBe(1);
    expect(sent.text).not.toMatch(/[٠-٩]{4}/);
  });

  it('are hidden in Persian digits, in Western digits, with spaces, and next to letters', () => {
    const persian = CIVIL_ID.replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
    expect(scrubText(`الرقم ${persian}`).text).toBe('الرقم [رقم هوية مخفي]');
    expect(scrubText(`My Civil ID is ${CIVIL_ID}.`).text).toBe(
      'My Civil ID is [ID number hidden].',
    );
    expect(scrubText('Civil ID 2870 4151 2345 here').text).toBe('Civil ID [ID number hidden] here');
    expect(scrubText(`رقمه${arabicDigits(CIVIL_ID)}`).text).toBe('رقمه[رقم هوية مخفي]');
    expect(scrubText(`two: ${CIVIL_ID} and ${CIVIL_ID_2}`)).toMatchObject({
      text: 'two: [ID number hidden] and [ID number hidden]',
      hidden: { id: 2 },
    });
  });

  it('that fail the check are still hidden, as long numbers', () => {
    expect(scrubText('ID 287041512346 please')).toMatchObject({
      text: 'ID [number hidden] please',
      hidden: { number: 1 },
    });
  });
});

describe('IBANs', () => {
  it('are hidden with or without spaces, in capitals or not, of any country', () => {
    expect(scrubText(`Pay to ${IBAN_SPACED} please`)).toMatchObject({
      text: 'Pay to [IBAN hidden] please',
      hidden: { iban: 1 },
    });
    expect(scrubText(`iban: ${IBAN.toLowerCase()}`).text).toBe('iban: [IBAN hidden]');
    expect(scrubText('UK account GB82 WEST 1234 5698 7654 32 for the supplier').text).toBe(
      'UK account [IBAN hidden] for the supplier',
    );
    expect(scrubText('DE89370400440532013000 and SA0380000000608010167519').text).toBe(
      '[IBAN hidden] and [IBAN hidden]',
    );
  });

  it('are hidden in Arabic text, with Arabic-Indic digits, and two in a row', () => {
    const typed = `حوّل إلى ${arabicDigits(IBAN_SPACED)} أو ${IBAN}`;
    expect(scrubText(typed)).toMatchObject({
      text: 'حوّل إلى [رقم آيبان مخفي] أو [رقم آيبان مخفي]',
      hidden: { iban: 2 },
    });
  });

  it('a Kuwaiti one is hidden even with a mistake in its check digits', () => {
    expect(scrubText('KW00 CBKU 0000 0000 0000 1234 5601 01').text).toBe('[IBAN hidden]');
  });
});

describe('emails and phones', () => {
  it('hides email addresses', () => {
    expect(scrubText('Write to made.up-person+ai@example.com or info@example.co.kw today')).toEqual(
      {
        text: 'Write to [email address hidden] or [email address hidden] today',
        hidden: { email: 2 },
        count: 2,
      },
    );
    expect(scrubText('راسل made.up@example.com من فضلك').text).toBe(
      'راسل [بريد إلكتروني مخفي] من فضلك',
    );
  });

  it('hides phone numbers with a country code, in groups, or after a phone word', () => {
    expect(scrubText('Call +965 9876 5432 now').text).toBe('Call [phone number hidden] now');
    expect(scrubText('00965 98765432').text).toBe('[phone number hidden]');
    expect(scrubText('+44 20 7946 0958 in London').text).toBe('[phone number hidden] in London');
    expect(scrubText('My number is 9876 5432.').text).toBe('My number is [phone number hidden].');
    expect(scrubText('mobile: 99887766').text).toBe('mobile: [phone number hidden]');
    expect(scrubText(`هاتفي ${arabicDigits('99887766')} شكراً`)).toMatchObject({
      text: 'هاتفي [رقم هاتف مخفي] شكراً',
      hidden: { phone: 1 },
    });
    expect(scrubText('رقم الجوال: ٦٥٤٣٢١٠٩').text).toBe('رقم الجوال: [رقم هاتف مخفي]');
  });
});

describe('numbers', () => {
  it('hides passport-like numbers and runs of 10 or more digits', () => {
    expect(scrubText('passport K1234567 expires soon').text).toBe(
      'passport [ID number hidden] expires soon',
    );
    expect(scrubText('جواز AB12345678').text).toBe('جواز [رقم هوية مخفي]');
    expect(scrubText('reference 12345678901 from the bank').text).toBe(
      'reference [number hidden] from the bank',
    );
    expect(scrubText('card 4111 1111 1111 1111').text).toBe('card [number hidden]');
    expect(scrubText('card 4111 1111 1111 1111 12/27').text).toBe('card [number hidden] 12/27');
  });

  it('leaves a 9-digit number alone, and invoice numbers, cheque numbers, amounts and dates', () => {
    for (const text of [
      'Invoice 123456789 is due',
      'Cheque 12345678 from the bank',
      'INV-000123 for 1,234.567 KWD',
      'Pay 1234.567 KD on 2026-10-22, or by 22/10/2026',
      'Order SO-2026-0042 and quote QT-17',
      'الفاتورة ١٢٣٤٥٦٧٨٩ بمبلغ ١٬٢٣٤٫٥٠٠ د.ك',
      'How do I record annual leave?',
    ]) {
      expect(scrubText(text), text).toEqual({ text, hidden: {}, count: 0 });
    }
  });
});

describe('numbers however they are spaced', () => {
  it('hides Civil IDs and IBANs with no-break, thin or double spaces, marks, line breaks and dots', () => {
    for (const typed of [
      '2870\u00a04151\u00a02345',
      '2870\u202f4151\u202f2345',
      '2870  4151  2345',
      '2870\u200f4151\u200f2345',
      '287041\n512345',
      '2870.4151.2345',
      '287,041,512,345',
      '2870 - 4151 - 2345',
    ]) {
      expect(scrubText(`my civil id ${typed} please`), typed).toMatchObject({
        text: 'my civil id [ID number hidden] please',
        hidden: { id: 1 },
      });
    }
    for (const typed of [
      IBAN_SPACED.replaceAll(' ', '\u00a0'),
      'KW81 CBKU 0000\n0000 0000 1234 5601 01',
      `IBAN${IBAN}`,
    ]) {
      expect(scrubText(`to ${typed} today`).text, typed).toMatch(
        /^to (IBAN)?\[IBAN hidden\] today$/,
      );
    }
  });

  it('hides long numbers and phones grouped with no-break spaces, as the app’s PDFs print them', () => {
    expect(scrubText('ref 1234\u00a05678\u00a09012 here').text).toBe('ref [number hidden] here');
    expect(scrubText('ref 123\u2009456\u2009789\u2009012 here').text).toBe(
      'ref [number hidden] here',
    );
    expect(scrubText('Call 9876\u00a05432 now').text).toBe('Call [phone number hidden] now');
    expect(scrubText('Call +965\u00a09876\u00a05432 now').text).toBe(
      'Call [phone number hidden] now',
    );
  });

  it('leaves alone a list of numbers on separate lines, amounts and dates', () => {
    for (const text of [
      'Quantities:\n1001\n1002\n1003\n1004',
      'Totals 12,345.678 and 98,765.432',
      'Amounts: 1,250.000 2,500.000 3,750.000',
      'Dates 2026-10-22 2026-11-05 2026-12-01',
      'IDs 287041512346, 287041512347',
    ]) {
      expect(scrubText(text).text, text).not.toMatch(/\[ID number hidden\]|\[IBAN hidden\]/);
    }
  });
});

describe('numbers after a word for an ID paper', () => {
  it('are hidden in English and Arabic, with letters before or after them', () => {
    expect(scrubText('residency no 123456789').text).toBe('residency no [ID number hidden]');
    expect(scrubText('His passport is X98765.').text).toBe('His passport is [ID number hidden].');
    expect(scrubText('passportX98765').text).toBe('passport[ID number hidden]');
    expect(scrubText('work permit: 55443322').text).toBe('work permit: [ID number hidden]');
    expect(scrubText('PIFSS number 7766554').text).toBe('PIFSS number [ID number hidden]');
    expect(scrubText('iqama 2345\n67890').text).toBe('iqama [ID number hidden]');
    expect(scrubText(`رقم الإقامة ${arabicDigits('123456789')} من فضلك`)).toMatchObject({
      text: 'رقم الإقامة [رقم هوية مخفي] من فضلك',
      hidden: { id: 1 },
    });
    expect(scrubText(`جوازه رقم ${arabicDigits('5544332')}`).text).toBe(
      'جوازه رقم [رقم هوية مخفي]',
    );
    expect(scrubText(`إذن العمل ${arabicDigits('99887766')}`).text).toBe(
      'إذن العمل [رقم هوية مخفي]',
    );
    expect(scrubText(`رقم التأمينات ${arabicDigits('7766554')}`).text).toBe(
      'رقم التأمينات [رقم هوية مخفي]',
    );
    // With its short vowels.
    expect(scrubText(`الإِقَامَة ${arabicDigits('123456789')}`).text).toBe(
      'الإِقَامَة [رقم هوية مخفي]',
    );
  });

  it('are not dates, amounts, times or short numbers', () => {
    for (const text of [
      'My passport expires on 2027-01-10, how do I renew?',
      'Residency renewal costs 10.000 KD',
      'PIFSS is 11.5% of 1,250.000 this month',
      'PIFSS 1250.000 this month',
      'work permit for 3 employees',
      `التأمينات الاجتماعية ${arabicDigits('125.500')} دينار`,
      `الإقامة تنتهي في ${arabicDigits('2027/01/10')}`,
      'passport renewal at 10:30 tomorrow',
      'the residency report for 2026',
      'civil works tender 20260042',
    ]) {
      expect(scrubText(text), text).toEqual({ text, hidden: {}, count: 0 });
    }
  });

  it('a passport number may end with a letter', () => {
    expect(scrubText('P1234567A is mine').text).toBe('[ID number hidden] is mine');
    expect(scrubText('passport:P1234567A.').text).toBe('passport:[ID number hidden].');
  });
});

describe('placeholders', () => {
  afterEach(async () => {
    await loadLanguage('en');
  });

  it('are in the language of the text, else of the interface', async () => {
    expect(scrubText(`رقمي ${CIVIL_ID}`).text).toBe('رقمي [رقم هوية مخفي]');
    expect(scrubText(`Mine is ${CIVIL_ID}`).text).toBe('Mine is [ID number hidden]');
    expect(scrubText(CIVIL_ID).text).toBe('[ID number hidden]');
    await loadLanguage('ar');
    expect(scrubText(CIVIL_ID).text).toBe('[رقم هوية مخفي]');
    expect(scrubText(`Mine is ${CIVIL_ID}`).text).toBe('Mine is [ID number hidden]');
  });
});

describe('the company’s own values on this device', () => {
  let company: Company;
  let other: Company;

  beforeEach(async () => {
    await db.delete();
    await db.open();
    company = await setupCompany({ name: 'Made-up Guarding Co', currency: 'KWD' });
    other = await setupCompany({ name: 'Another Made-up Co', currency: 'KWD' });
    await saveEmployee(
      createEmployee(company.id, {
        name: 'Imaginary Guard Person',
        civilId: CIVIL_ID,
        // Shapes no pattern catches: only the check against the values hides them.
        passportNumber: 'X98765',
        residencyNumber: '123456789',
        workPermitNumber: 'WP-55443',
        pifssNumber: '7766554',
        iban: IBAN,
        accountNumber: '0011223344',
      }),
    );
    await saveClient(createClient(company.id, { name: 'Made-up Customer', civilId: CIVIL_ID_2 }));
    await saveEmployee(createEmployee(other.id, { name: 'Elsewhere', passportNumber: 'Z55555' }));
  });

  it('are read for the company only, and the employee’s passport number is caught', async () => {
    const known = await knownValues(company.id);
    expect(known).toEqual(
      expect.arrayContaining([
        { value: 'X98765', kind: 'id' },
        { value: '123456789', kind: 'id' },
        { value: IBAN, kind: 'iban' },
        { value: '0011223344', kind: 'account' },
        { value: CIVIL_ID_2, kind: 'id' },
      ]),
    );
    expect(known.map((k) => k.value)).not.toContain('Z55555');
    expect(scrubText('His passport is X98765, what do I renew?', known)).toEqual({
      text: 'His passport is [ID number hidden], what do I renew?',
      hidden: { id: 1 },
      count: 1,
    });
    // Without the values, and without a word for a passport before it,
    // nothing in it looks like a passport: only the check against the values hides it.
    expect(scrubText('Renew X98765 before it runs out').count).toBe(0);
    expect(scrubText('Renew X98765 before it runs out', known)).toEqual({
      text: 'Renew [ID number hidden] before it runs out',
      hidden: { id: 1 },
      count: 1,
    });
    // Another company's values are not this one's.
    expect(scrubText('Z55555', known).count).toBe(0);
  });

  it('are found however they are written: case, spaces, dashes and Arabic-Indic digits', async () => {
    const known = await knownValues(company.id);
    expect(scrubText('passport x 98 765', known).text).toBe('passport [ID number hidden]');
    expect(scrubText(`الإقامة ${arabicDigits('123 456 789')} منتهية`, known).text).toBe(
      'الإقامة [رقم هوية مخفي] منتهية',
    );
    expect(scrubText('permit wp55443 and PIFSS 7766-554', known)).toMatchObject({
      text: 'permit [ID number hidden] and PIFSS [ID number hidden]',
      hidden: { id: 2 },
    });
    expect(scrubText('account 0011 2233 44', known)).toMatchObject({
      text: 'account [account number hidden]',
      hidden: { account: 1 },
    });
    // A 9-digit number that isn't one of them is left alone; the residency number isn't.
    expect(scrubText('Invoice 123456780 and 123456789', known).text).toBe(
      'Invoice 123456780 and [ID number hidden]',
    );
  });

  it('are not hidden in the middle of a longer number or word', async () => {
    const known = await knownValues(company.id);
    for (const text of [
      'REF123456789X',
      'REFX98765Q',
      'Order 77665549',
      'Total 7766554.5 and 1,7766554',
      'Due 1.123456789',
    ]) {
      expect(scrubText(text, known).text, text).not.toContain('hidden]');
    }
    // After the word PIFSS a number of 5 digits or more is hidden as an ID
    // number by its place; the values add nothing to it.
    expect(scrubText('PIFSS 77665549', known)).toEqual(scrubText('PIFSS 77665549'));
  });

  it('are found with dots, commas, slashes, odd spaces, line breaks and full-width digits', async () => {
    const known = await knownValues(company.id);
    for (const typed of [
      '2870.4151.2345',
      '287,041,512,345',
      '2870/4151/2345',
      '287041\n512345',
      '2870\u00a04151\u00a02345',
      '2870\u200e4151\u200e2345',
      '２８７０４１５１２３４５',
    ]) {
      expect(scrubText(`Civil ID ${typed} please`, known), typed).toMatchObject({
        text: 'Civil ID [ID number hidden] please',
        hidden: { id: 1 },
      });
    }
    expect(scrubText('account 0011.2233.44 and 0011/2233/44', known)).toMatchObject({
      text: 'account [account number hidden] and [account number hidden]',
      hidden: { account: 2 },
    });
  });

  it('include who signed for a delivery, cheque drawers and the numbers of private papers', async () => {
    const SIGNED = '286022012341';
    const DRAWER = '279121512340';
    const HOLDER = '300010112349';
    await db.documents.put({
      id: 'note-1',
      companyId: company.id,
      type: 'delivery_note',
      receiverCivilId: SIGNED,
    } as never);
    await db.payments.put({
      id: 'payment-1',
      companyId: company.id,
      cheque: { drawerCivilId: DRAWER },
    } as never);
    await db.securityCheques.put({
      id: 'security-1',
      companyId: company.id,
      drawerCivilId: HOLDER,
    } as never);
    for (const [id, type, number] of [
      ['paper-1', 'passport', 'Q4455667'],
      ['paper-2', 'driving_licence', 'DL-778899'],
      ['paper-3', 'authorised_signatories', 'AS 5544332'],
      ['paper-4', 'commercial_licence', 'CL-2026-1234'],
    ]) {
      await db.complianceDocuments.put({ id, companyId: company.id, type, number } as never);
    }
    const known = await knownValues(company.id);
    expect(known).toEqual(
      expect.arrayContaining([
        { value: SIGNED, kind: 'id' },
        { value: DRAWER, kind: 'id' },
        { value: HOLDER, kind: 'id' },
        { value: 'Q4455667', kind: 'id' },
        { value: 'DL-778899', kind: 'id' },
        { value: 'AS 5544332', kind: 'id' },
      ]),
    );
    // A company paper of another type is not a person's.
    expect(known.map((k) => k.value)).not.toContain('CL-2026-1234');
    // Split over two lines, which no pattern takes for one number.
    expect(scrubText(`receiver ${SIGNED.slice(0, 6)}\n${SIGNED.slice(6)}`, known).text).toBe(
      'receiver [ID number hidden]',
    );
    expect(scrubText('licence dl 778 899 and signatories AS5544332', known)).toMatchObject({
      text: 'licence [ID number hidden] and signatories [ID number hidden]',
      hidden: { id: 2 },
    });
  });

  it('ignores values too short to be told from ordinary numbers', () => {
    expect(scrubText('Room 1234, floor 2', [{ value: '1234', kind: 'id' }]).count).toBe(0);
    expect(foldValue(' kw81-cbku ٠٠ ')).toBe('KW81CBKU00');
  });
});
