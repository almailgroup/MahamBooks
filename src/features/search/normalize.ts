/**
 * Text normalisation for search, so "أحمد", "احمد" and the same name written
 * with vowel marks find the same customer, and "Café" matches "cafe".
 */

// Arabic short vowels, shadda, sukun, superscript alef and Quranic marks; tatweel.
const ARABIC_MARKS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g;
const LATIN_MARKS = /[\u0300-\u036f]/g;

const ARABIC_LETTERS: Record<string, string> = {
  أ: 'ا',
  إ: 'ا',
  آ: 'ا',
  ٱ: 'ا',
  ى: 'ي',
  ئ: 'ي',
  ة: 'ه',
  ؤ: 'و',
  // Persian forms sometimes typed on Gulf keyboards.
  ک: 'ك',
  ی: 'ي',
};

const DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

/** Lower case, no diacritics, one form of each Arabic letter, Western digits, single spaces. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(LATIN_MARKS, '')
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱىئةؤکی]/g, (c) => ARABIC_LETTERS[c] ?? c)
    .replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d] ?? d)
    .toLowerCase()
    .replace(/[\u200c-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[^\p{L}\p{N}.@+-]+/gu, ' ')
    .trim();
}

/** Letters and digits only: "INV-2026-0001" and "inv 2026 0001" both give "inv20260001". */
export function compactSearch(text: string): string {
  return normalizeSearch(text).replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * A typed amount ("1,250.750", "١٢٥٠٫٧٥", "1250") as a plain decimal
 * string, or null when the query isn't a number.
 */
export function amountQuery(query: string): string | null {
  const text = query
    .trim()
    .replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d] ?? d)
    .replace(/٫/g, '.')
    .replace(/[,٬\s]/g, '')
    .replace(/^(kd|kwd|د\.ك)/i, '')
    .replace(/(kd|kwd|د\.ك)$/i, '');
  if (!/^\d+(\.\d*)?$/.test(text)) return null;
  return text.replace(/\.$/, '');
}
