import { describe, expect, it } from 'vitest';
import {
  bankFromIban,
  findArea,
  formatHijri,
  formatIban,
  isValidCivilId,
  isValidIban,
  kuwaitHolidays,
  normalizeKuwaitPhone,
  placeName,
} from './kuwait';

describe('IBAN', () => {
  it('accepts a valid Kuwaiti IBAN with or without spaces', () => {
    expect(isValidIban('KW81CBKU0000000000001234560101')).toBe(true);
    expect(isValidIban('kw81 cbku 0000 0000 0000 1234 5601 01')).toBe(true);
    expect(formatIban('KW81CBKU0000000000001234560101')).toBe(
      'KW81 CBKU 0000 0000 0000 1234 5601 01',
    );
  });

  it('rejects wrong check digits and lengths', () => {
    expect(isValidIban('KW82CBKU0000000000001234560101')).toBe(false);
    expect(isValidIban('KW81CBKU000000000000123456010')).toBe(false);
    expect(isValidIban('GB82WEST12345698765432')).toBe(true);
  });

  it('names the bank', () => {
    expect(bankFromIban('KW12NBOK0000000000001000372151')?.name.en).toBe('National Bank of Kuwait');
    expect(bankFromIban('GB82WEST12345698765432')).toBeUndefined();
  });
});

describe('Civil ID', () => {
  // 2 850101 1235 + check digit, worked out with the official weights.
  it('checks the birth date and check digit', () => {
    const base = '28501011235';
    const weights = [2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const sum = weights.reduce((s, w, i) => s + w * Number(base[i]), 0);
    const check = 11 - (sum % 11);
    expect(check).toBeLessThan(10);
    expect(isValidCivilId(base + check)).toBe(true);
    expect(isValidCivilId(base + ((check + 1) % 10))).toBe(false);
    expect(isValidCivilId('28513011235' + check)).toBe(false);
    expect(isValidCivilId('1234')).toBe(false);
  });
});

it('formats Kuwaiti phone numbers', () => {
  expect(normalizeKuwaitPhone('+965 9988 7766')).toBe('+965 9988 7766');
  expect(normalizeKuwaitPhone('0096522445566')).toBe('+965 2244 5566');
  expect(normalizeKuwaitPhone('55667788')).toBe('+965 5566 7788');
  expect(normalizeKuwaitPhone('12345678')).toBeNull();
});

it('knows areas in both languages', () => {
  expect(findArea('salmiya')?.ar).toBe('السالمية');
  expect(placeName('السالمية', 'en')).toBe('Salmiya');
  expect(placeName('Hawalli', 'ar')).toBe('حولي');
  expect(placeName('Somewhere', 'ar')).toBe('Somewhere');
});

it('lists the public holidays of a year', () => {
  const holidays = kuwaitHolidays(2026);
  expect(holidays.map((h) => h.date)).toEqual(
    expect.arrayContaining(['2026-01-01', '2026-02-25', '2026-02-26', '2026-03-20', '2026-05-27']),
  );
  expect(holidays).toHaveLength(13);
});

it('formats Hijri dates', () => {
  expect(formatHijri('2026-10-03', 'en')).toContain('1448');
  expect(formatHijri('2026-10-03', 'ar')).toContain('1448');
});

describe('Kuwaiti addresses', async () => {
  const { formatAddressLines } = await import('./geo');
  const address = {
    line1: 'Al Hamra Tower',
    line2: '',
    city: 'Salmiya',
    state: 'Hawalli',
    postalCode: '22001',
    country: 'KW',
    block: '3',
    street: '12',
    avenue: '',
    building: '15',
    floor: '2',
    unit: '5',
    paci: '12345678',
  };

  it('are written block first, in English', () => {
    expect(formatAddressLines(address, 'en-KW')).toEqual([
      'Block 3, Street 12, Building 15, Floor 2, Unit 5',
      'Al Hamra Tower',
      'Salmiya, Hawalli 22001',
      'PACI no. 12345678',
      'Kuwait',
    ]);
  });

  it('and in Arabic', () => {
    expect(formatAddressLines(address, 'ar-KW')).toEqual([
      'قطعة 3، شارع 12، مبنى 15، الدور 2، وحدة 5',
      'Al Hamra Tower',
      'السالمية، حولي 22001',
      'الرقم الآلي 12345678',
      'الكويت',
    ]);
  });
});
