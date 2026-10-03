import { currencyPrecision, toMinor } from './money';

/**
 * Amounts written out in words, as printed on Kuwaiti invoices, receipts and
 * cheques: "One Thousand Two Hundred Thirty-Four Kuwaiti Dinars and Five
 * Hundred Fils Only" / "فقط ألف ومائتان وأربعة وثلاثون دينارًا كويتيًا
 * وخمسمائة فلس لا غير".
 */

// ---------------------------------------------------------------- English

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

function englishBelowThousand(n: number): string {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) words.push(`${ONES[hundreds]} Hundred`);
  if (rest >= 20) {
    words.push(rest % 10 ? `${TENS[Math.floor(rest / 10)]}-${ONES[rest % 10]}` : TENS[rest / 10]);
  } else if (rest) {
    words.push(ONES[rest]);
  }
  return words.join(' ');
}

/** 1234 → "One Thousand Two Hundred Thirty-Four". */
export function englishNumber(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'Zero';
  const groups: string[] = [];
  for (let scale = 0; n > 0 && scale < SCALES.length; scale++) {
    const chunk = n % 1000;
    if (chunk)
      groups.unshift([englishBelowThousand(chunk), SCALES[scale]].filter(Boolean).join(' '));
    n = Math.floor(n / 1000);
  }
  return groups.join(' ');
}

interface EnglishCurrency {
  one: string;
  many: string;
  minorOne: string;
  minorMany: string;
}

const ENGLISH_CURRENCIES: Record<string, EnglishCurrency> = {
  KWD: { one: 'Kuwaiti Dinar', many: 'Kuwaiti Dinars', minorOne: 'Fils', minorMany: 'Fils' },
  BHD: { one: 'Bahraini Dinar', many: 'Bahraini Dinars', minorOne: 'Fils', minorMany: 'Fils' },
  JOD: { one: 'Jordanian Dinar', many: 'Jordanian Dinars', minorOne: 'Fils', minorMany: 'Fils' },
  OMR: { one: 'Omani Rial', many: 'Omani Rials', minorOne: 'Baisa', minorMany: 'Baisa' },
  SAR: { one: 'Saudi Riyal', many: 'Saudi Riyals', minorOne: 'Halala', minorMany: 'Halalas' },
  QAR: { one: 'Qatari Riyal', many: 'Qatari Riyals', minorOne: 'Dirham', minorMany: 'Dirhams' },
  AED: { one: 'UAE Dirham', many: 'UAE Dirhams', minorOne: 'Fils', minorMany: 'Fils' },
  EGP: {
    one: 'Egyptian Pound',
    many: 'Egyptian Pounds',
    minorOne: 'Piastre',
    minorMany: 'Piastres',
  },
  USD: { one: 'US Dollar', many: 'US Dollars', minorOne: 'Cent', minorMany: 'Cents' },
  EUR: { one: 'Euro', many: 'Euros', minorOne: 'Cent', minorMany: 'Cents' },
  GBP: { one: 'Pound Sterling', many: 'Pounds Sterling', minorOne: 'Penny', minorMany: 'Pence' },
  INR: { one: 'Indian Rupee', many: 'Indian Rupees', minorOne: 'Paisa', minorMany: 'Paise' },
};

function englishWords(major: number, minor: number, currency: string, places: number): string {
  const names = ENGLISH_CURRENCIES[currency] ?? {
    one: currency,
    many: currency,
    minorOne: '',
    minorMany: '',
  };
  const parts: string[] = [];
  if (major > 0 || minor === 0) {
    parts.push(`${englishNumber(major)} ${major === 1 ? names.one : names.many}`);
  }
  if (minor > 0) {
    const unit = minor === 1 ? names.minorOne : names.minorMany;
    parts.push(unit ? `${englishNumber(minor)} ${unit}` : `${minor}/${10 ** places}`);
  }
  return `${parts.join(' and ')} Only`;
}

// ----------------------------------------------------------------- Arabic

type Gender = 'm' | 'f';

/** Forms of a counted noun: 1, 2, 3–10, 11–99 and 100s/1000s. */
interface ArabicNoun {
  gender: Gender;
  /** "دينار كويتي واحد" (said after the noun for 1). */
  one: string;
  /** "ديناران كويتيان" */
  two: string;
  /** "دنانير كويتية" (3–10) */
  few: string;
  /** "دينارًا كويتيًا" (11–99) */
  many: string;
  /** "دينار كويتي" (100, 1000, and after compound numbers) */
  single: string;
}

const noun = (gender: Gender, forms: Omit<ArabicNoun, 'gender'>): ArabicNoun => ({
  gender,
  ...forms,
});

const AR_UNITS: Record<Gender, string[]> = {
  m: ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة'],
  f: ['', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثماني', 'تسع', 'عشر'],
};
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = [
  '',
  'مائة',
  'مائتان',
  'ثلاثمائة',
  'أربعمائة',
  'خمسمائة',
  'ستمائة',
  'سبعمائة',
  'ثمانمائة',
  'تسعمائة',
];

function arabicBelowHundred(n: number, gender: Gender): string {
  if (n <= 10) return AR_UNITS[gender][n];
  if (n === 11) return gender === 'm' ? 'أحد عشر' : 'إحدى عشرة';
  if (n === 12) return gender === 'm' ? 'اثنا عشر' : 'اثنتا عشرة';
  if (n < 20) return `${AR_UNITS[gender][n - 10]} ${gender === 'm' ? 'عشر' : 'عشرة'}`;
  const unit = n % 10;
  const tens = AR_TENS[Math.floor(n / 10)];
  if (!unit) return tens;
  const unitWord = unit === 1 ? (gender === 'm' ? 'واحد' : 'إحدى') : AR_UNITS[gender][unit];
  return `${unitWord} و${tens}`;
}

function arabicBelowThousand(n: number, gender: Gender): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(AR_HUNDREDS[hundreds]);
  if (rest) parts.push(arabicBelowHundred(rest, gender));
  return parts.join(' و');
}

const AR_SCALES: { one: string; two: string; few: string; many: string }[] = [
  { one: 'ألف', two: 'ألفان', few: 'آلاف', many: 'ألفًا' },
  { one: 'مليون', two: 'مليونان', few: 'ملايين', many: 'مليونًا' },
  { one: 'مليار', two: 'ملياران', few: 'مليارات', many: 'مليارًا' },
];

/** A count of thousands/millions: "ألف", "ألفان", "ثلاثة آلاف", "أحد عشر ألفًا". */
function arabicScale(count: number, scale: (typeof AR_SCALES)[number]): string {
  if (count === 1) return scale.one;
  if (count === 2) return scale.two;
  const rest = count % 100;
  const words = arabicBelowThousand(count, 'm');
  if (rest >= 3 && rest <= 10) return `${words} ${scale.few}`;
  if (rest >= 11) return `${words} ${scale.many}`;
  return `${construct(words)} ${scale.one}`;
}

/** A dual directly before its noun loses its final ن: "مائتا ألف", "ألفا دينار". */
function construct(words: string): string {
  return words.replace(/(مائت|ألف|مليون|مليار)ان$/, '$1ا');
}

/** The number in words, agreeing with a noun of the given gender. */
export function arabicNumber(n: number, gender: Gender = 'm'): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'صفر';
  const parts: string[] = [];
  const groups: number[] = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 1000)) groups.push(rest % 1000);
  for (let i = groups.length - 1; i >= 1; i--) {
    if (groups[i]) parts.push(arabicScale(groups[i], AR_SCALES[Math.min(i, AR_SCALES.length) - 1]));
  }
  if (groups[0]) parts.push(arabicBelowThousand(groups[0], gender));
  return parts.join(' و');
}

/** A count with its noun: "دينار كويتي واحد", "ثلاثة دنانير كويتية", "مائة دينار كويتي". */
function arabicCount(n: number, item: ArabicNoun): string {
  if (n === 1) return item.one;
  if (n === 2) return item.two;
  const rest = n % 100;
  const words = arabicNumber(n, item.gender);
  if (rest >= 3 && rest <= 10) return `${words} ${item.few}`;
  if (rest >= 11) return `${words} ${item.many}`;
  return `${construct(words)} ${item.single}`;
}

const ARABIC_CURRENCIES: Record<string, { major: ArabicNoun; minor: ArabicNoun }> = {
  KWD: {
    major: noun('m', {
      one: 'دينار كويتي واحد',
      two: 'ديناران كويتيان',
      few: 'دنانير كويتية',
      many: 'دينارًا كويتيًا',
      single: 'دينار كويتي',
    }),
    minor: noun('m', {
      one: 'فلس واحد',
      two: 'فلسان',
      few: 'فلوس',
      many: 'فلسًا',
      single: 'فلس',
    }),
  },
  BHD: {
    major: noun('m', {
      one: 'دينار بحريني واحد',
      two: 'ديناران بحرينيان',
      few: 'دنانير بحرينية',
      many: 'دينارًا بحرينيًا',
      single: 'دينار بحريني',
    }),
    minor: noun('m', { one: 'فلس واحد', two: 'فلسان', few: 'فلوس', many: 'فلسًا', single: 'فلس' }),
  },
  SAR: {
    major: noun('m', {
      one: 'ريال سعودي واحد',
      two: 'ريالان سعوديان',
      few: 'ريالات سعودية',
      many: 'ريالًا سعوديًا',
      single: 'ريال سعودي',
    }),
    minor: noun('f', {
      one: 'هللة واحدة',
      two: 'هللتان',
      few: 'هللات',
      many: 'هللة',
      single: 'هللة',
    }),
  },
  AED: {
    major: noun('m', {
      one: 'درهم إماراتي واحد',
      two: 'درهمان إماراتيان',
      few: 'دراهم إماراتية',
      many: 'درهمًا إماراتيًا',
      single: 'درهم إماراتي',
    }),
    minor: noun('m', { one: 'فلس واحد', two: 'فلسان', few: 'فلوس', many: 'فلسًا', single: 'فلس' }),
  },
  USD: {
    major: noun('m', {
      one: 'دولار أمريكي واحد',
      two: 'دولاران أمريكيان',
      few: 'دولارات أمريكية',
      many: 'دولارًا أمريكيًا',
      single: 'دولار أمريكي',
    }),
    minor: noun('m', { one: 'سنت واحد', two: 'سنتان', few: 'سنتات', many: 'سنتًا', single: 'سنت' }),
  },
  EUR: {
    major: noun('m', {
      one: 'يورو واحد',
      two: 'يوروان',
      few: 'يوروات',
      many: 'يورو',
      single: 'يورو',
    }),
    minor: noun('m', { one: 'سنت واحد', two: 'سنتان', few: 'سنتات', many: 'سنتًا', single: 'سنت' }),
  },
};

function arabicWords(major: number, minor: number, currency: string): string | null {
  const names = ARABIC_CURRENCIES[currency];
  if (!names) return null;
  const parts: string[] = [];
  if (major > 0 || minor === 0) {
    parts.push(major === 0 ? `صفر ${names.major.single}` : arabicCount(major, names.major));
  }
  if (minor > 0) parts.push(arabicCount(minor, names.minor));
  return `فقط ${parts.join(' و')} لا غير`;
}

// ------------------------------------------------------------------ Public

/** Splits an amount into whole units and minor units (fils, cents). */
export function splitAmount(amount: number, currency: string): { major: number; minor: number } {
  const places = currencyPrecision(currency);
  const total = Math.abs(toMinor(amount, places));
  const factor = 10 ** places;
  return { major: Math.floor(total / factor), minor: total % factor };
}

/**
 * The amount in words in English or Arabic. Currencies without Arabic names
 * fall back to English.
 */
export function amountInWords(amount: number, currency: string, language: 'en' | 'ar'): string {
  const code = currency.toUpperCase();
  const { major, minor } = splitAmount(amount, code);
  if (language === 'ar') {
    const arabic = arabicWords(major, minor, code);
    if (arabic) return arabic;
  }
  return englishWords(major, minor, code, currencyPrecision(code));
}
