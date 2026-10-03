import { describe, expect, it } from 'vitest';
import { amountInWords, arabicNumber, englishNumber, splitAmount } from './words';

describe('English', () => {
  it('writes numbers', () => {
    expect(englishNumber(0)).toBe('Zero');
    expect(englishNumber(15)).toBe('Fifteen');
    expect(englishNumber(40)).toBe('Forty');
    expect(englishNumber(1234)).toBe('One Thousand Two Hundred Thirty-Four');
    expect(englishNumber(2_000_015)).toBe('Two Million Fifteen');
  });

  it('writes Kuwaiti dinars and fils', () => {
    expect(amountInWords(1234.5, 'KWD', 'en')).toBe(
      'One Thousand Two Hundred Thirty-Four Kuwaiti Dinars and Five Hundred Fils Only',
    );
    expect(amountInWords(1, 'KWD', 'en')).toBe('One Kuwaiti Dinar Only');
    expect(amountInWords(0.075, 'KWD', 'en')).toBe('Seventy-Five Fils Only');
    expect(amountInWords(0, 'KWD', 'en')).toBe('Zero Kuwaiti Dinars Only');
    expect(amountInWords(12.01, 'USD', 'en')).toBe('Twelve US Dollars and One Cent Only');
  });
});

describe('Arabic', () => {
  it('writes numbers with the right gender', () => {
    expect(arabicNumber(3)).toBe('ثلاثة');
    expect(arabicNumber(3, 'f')).toBe('ثلاث');
    expect(arabicNumber(11)).toBe('أحد عشر');
    expect(arabicNumber(11, 'f')).toBe('إحدى عشرة');
    expect(arabicNumber(21)).toBe('واحد وعشرون');
    expect(arabicNumber(1234)).toBe('ألف ومائتان وأربعة وثلاثون');
    expect(arabicNumber(3000)).toBe('ثلاثة آلاف');
    expect(arabicNumber(11000)).toBe('أحد عشر ألفًا');
    expect(arabicNumber(200_000)).toBe('مائتا ألف');
    expect(arabicNumber(2_500_000)).toBe('مليونان وخمسمائة ألف');
  });

  it('writes Kuwaiti dinars and fils', () => {
    expect(amountInWords(1234.5, 'KWD', 'ar')).toBe(
      'فقط ألف ومائتان وأربعة وثلاثون دينارًا كويتيًا وخمسمائة فلس لا غير',
    );
    expect(amountInWords(1, 'KWD', 'ar')).toBe('فقط دينار كويتي واحد لا غير');
    expect(amountInWords(2, 'KWD', 'ar')).toBe('فقط ديناران كويتيان لا غير');
    expect(amountInWords(5, 'KWD', 'ar')).toBe('فقط خمسة دنانير كويتية لا غير');
    expect(amountInWords(100, 'KWD', 'ar')).toBe('فقط مائة دينار كويتي لا غير');
    expect(amountInWords(200, 'KWD', 'ar')).toBe('فقط مائتا دينار كويتي لا غير');
    expect(amountInWords(2000, 'KWD', 'ar')).toBe('فقط ألفا دينار كويتي لا غير');
    expect(amountInWords(0.25, 'KWD', 'ar')).toBe('فقط مائتان وخمسون فلسًا لا غير');
    expect(amountInWords(7.003, 'KWD', 'ar')).toBe('فقط سبعة دنانير كويتية وثلاثة فلوس لا غير');
    expect(amountInWords(13.5, 'SAR', 'ar')).toBe(
      'فقط ثلاثة عشر ريالًا سعوديًا وخمسون هللة لا غير',
    );
  });

  it('falls back to English for currencies without Arabic names', () => {
    expect(amountInWords(3, 'JPY', 'ar')).toBe('Three JPY Only');
  });
});

it('splits amounts by the currency decimals', () => {
  expect(splitAmount(12.345, 'KWD')).toEqual({ major: 12, minor: 345 });
  expect(splitAmount(-12.5, 'USD')).toEqual({ major: 12, minor: 50 });
});
