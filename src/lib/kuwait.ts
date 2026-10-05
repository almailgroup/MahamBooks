import type { ISODate } from '@/db/types';

/**
 * Kuwait reference data: governorates and areas, banks, and checks for
 * IBANs, Civil IDs and phone numbers. Names are given in English and Arabic.
 */

export interface Bilingual {
  en: string;
  ar: string;
}

export interface Governorate {
  code: string;
  name: Bilingual;
  areas: Bilingual[];
}

const area = (en: string, ar: string): Bilingual => ({ en, ar });

/** The six governorates and their main areas (the area field also accepts any text). */
export const GOVERNORATES: Governorate[] = [
  {
    code: 'CA',
    name: { en: 'Capital', ar: 'العاصمة' },
    areas: [
      area('Kuwait City', 'مدينة الكويت'),
      area('Sharq', 'شرق'),
      area('Mirqab', 'المرقاب'),
      area('Qibla', 'القبلة'),
      area('Dasman', 'دسمان'),
      area('Bneid Al-Gar', 'بنيد القار'),
      area('Dasma', 'الدسمة'),
      area('Daiya', 'الدعية'),
      area('Shuwaikh', 'الشويخ'),
      area('Shuwaikh Industrial', 'الشويخ الصناعية'),
      area('Sulaibikhat', 'الصليبيخات'),
      area('Doha', 'الدوحة'),
      area('Granada', 'غرناطة'),
      area('Kaifan', 'كيفان'),
      area('Shamiya', 'الشامية'),
      area('Rawda', 'الروضة'),
      area('Adailiya', 'العديلية'),
      area('Khaldiya', 'الخالدية'),
      area('Qadsiya', 'القادسية'),
      area('Mansouriya', 'المنصورية'),
      area('Nuzha', 'النزهة'),
      area('Faiha', 'الفيحاء'),
      area('Yarmouk', 'اليرموك'),
      area('Qurtuba', 'قرطبة'),
      area('Surra', 'السرة'),
      area('Abdullah Al-Salem', 'ضاحية عبدالله السالم'),
      area('Nahdha', 'النهضة'),
      area('Qairawan', 'القيروان'),
    ],
  },
  {
    code: 'HA',
    name: { en: 'Hawalli', ar: 'حولي' },
    areas: [
      area('Hawalli', 'حولي'),
      area('Salmiya', 'السالمية'),
      area('Jabriya', 'الجابرية'),
      area('Rumaithiya', 'الرميثية'),
      area('Bayan', 'بيان'),
      area('Mishref', 'مشرف'),
      area('Salwa', 'سلوى'),
      area('Shaab', 'الشعب'),
      area('Shuhada', 'الشهداء'),
      area('Hittin', 'حطين'),
      area('Salam', 'السلام'),
      area('Siddiq', 'الصديق'),
      area('Zahra', 'الزهراء'),
      area('Mubarak Al-Abdullah', 'مبارك العبدالله'),
      area('Maidan Hawalli', 'ميدان حولي'),
      area('Bidaa', 'البدع'),
    ],
  },
  {
    code: 'FA',
    name: { en: 'Farwaniya', ar: 'الفروانية' },
    areas: [
      area('Farwaniya', 'الفروانية'),
      area('Khaitan', 'خيطان'),
      area('Jleeb Al-Shuyoukh', 'جليب الشيوخ'),
      area('Abbasiya', 'العباسية'),
      area('Ardiya', 'العارضية'),
      area('Ardiya Industrial', 'العارضية الحرفية'),
      area('Rabiya', 'الرابية'),
      area('Rehab', 'الرحاب'),
      area('Omariya', 'العمرية'),
      area('Andalous', 'الأندلس'),
      area('Ashbeliya', 'إشبيلية'),
      area('Firdous', 'الفردوس'),
      area('Riggae', 'الرقعي'),
      area('Abdullah Al-Mubarak', 'عبدالله المبارك'),
      area('Dhajeej', 'الضجيج'),
      area('Sabah Al-Nasser', 'صباح الناصر'),
      area('Shadadiya', 'الشدادية'),
    ],
  },
  {
    code: 'MU',
    name: { en: 'Mubarak Al-Kabeer', ar: 'مبارك الكبير' },
    areas: [
      area('Mubarak Al-Kabeer', 'مبارك الكبير'),
      area('Adan', 'العدان'),
      area('Qurain', 'القرين'),
      area('Qusour', 'القصور'),
      area('Sabah Al-Salem', 'صباح السالم'),
      area('Messila', 'المسيلة'),
      area('Abu Al-Hasaniya', 'أبو الحصانية'),
      area('Abu Fatira', 'أبو فطيرة'),
      area('Fnaitees', 'الفنيطيس'),
      area('Masayel', 'المسايل'),
    ],
  },
  {
    code: 'AH',
    name: { en: 'Ahmadi', ar: 'الأحمدي' },
    areas: [
      area('Ahmadi', 'الأحمدي'),
      area('Fahaheel', 'الفحيحيل'),
      area('Mangaf', 'المنقف'),
      area('Fintas', 'الفنطاس'),
      area('Abu Halifa', 'أبو حليفة'),
      area('Mahboula', 'المهبولة'),
      area('Egaila', 'العقيلة'),
      area('Riqqa', 'الرقة'),
      area('Hadiya', 'هدية'),
      area('Sabahiya', 'الصباحية'),
      area('Fahad Al-Ahmad', 'فهد الأحمد'),
      area('Jaber Al-Ali', 'جابر العلي'),
      area('Dhaher', 'الظهر'),
      area('Wafra', 'الوفرة'),
      area('Khairan', 'الخيران'),
      area('Sabah Al-Ahmad City', 'مدينة صباح الأحمد'),
      area('Ali Sabah Al-Salem', 'علي صباح السالم'),
      area('Mina Abdullah', 'ميناء عبدالله'),
      area('Shuaiba', 'الشعيبة'),
    ],
  },
  {
    code: 'JA',
    name: { en: 'Jahra', ar: 'الجهراء' },
    areas: [
      area('Jahra', 'الجهراء'),
      area('Saad Al-Abdullah', 'سعد العبدالله'),
      area('Oyoun', 'العيون'),
      area('Naeem', 'النعيم'),
      area('Qasr', 'القصر'),
      area('Waha', 'الواحة'),
      area('Taima', 'تيماء'),
      area('Nasseem', 'النسيم'),
      area('Amghara', 'أمغرة'),
      area('Sulaibiya', 'الصليبية'),
      area('Kabd', 'كبد'),
      area('Abdali', 'العبدلي'),
      area('Jaber Al-Ahmad City', 'مدينة جابر الأحمد'),
    ],
  },
];

/** Finds a governorate by its English or Arabic name or code. */
export function findGovernorate(name: string): Governorate | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  return GOVERNORATES.find(
    (g) =>
      g.code.toLowerCase() === key || g.name.en.toLowerCase() === key || g.name.ar === name.trim(),
  );
}

/** Finds an area by its English or Arabic name. */
export function findArea(name: string): Bilingual | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  for (const g of GOVERNORATES) {
    const found = g.areas.find((a) => a.en.toLowerCase() === key || a.ar === name.trim());
    if (found) return found;
  }
  return undefined;
}

/** A place name in the wanted language when it is a known Kuwaiti area or governorate. */
export function placeName(name: string, language: 'en' | 'ar'): string {
  const found = findArea(name) ?? findGovernorate(name)?.name;
  return found ? found[language] : name;
}

// ------------------------------------------------------------------ Banks

export interface KuwaitBank {
  /** First four letters of the SWIFT/BIC code, also used in IBANs. */
  code: string;
  swift: string;
  name: Bilingual;
}

export const KUWAIT_BANKS: KuwaitBank[] = [
  {
    code: 'NBOK',
    swift: 'NBOKKWKW',
    name: { en: 'National Bank of Kuwait', ar: 'بنك الكويت الوطني' },
  },
  {
    code: 'KFHO',
    swift: 'KFHOKWKW',
    name: { en: 'Kuwait Finance House', ar: 'بيت التمويل الكويتي' },
  },
  { code: 'BBYN', swift: 'BBYNKWKW', name: { en: 'Boubyan Bank', ar: 'بنك بوبيان' } },
  { code: 'GULB', swift: 'GULBKWKW', name: { en: 'Gulf Bank', ar: 'بنك الخليج' } },
  { code: 'BRGN', swift: 'BRGNKWKW', name: { en: 'Burgan Bank', ar: 'بنك برقان' } },
  {
    code: 'COMB',
    swift: 'COMBKWKW',
    name: { en: 'Commercial Bank of Kuwait', ar: 'البنك التجاري الكويتي' },
  },
  {
    code: 'ABKK',
    swift: 'ABKKKWKW',
    name: { en: 'Al Ahli Bank of Kuwait', ar: 'البنك الأهلي الكويتي' },
  },
  { code: 'WRBA', swift: 'WRBAKWKW', name: { en: 'Warba Bank', ar: 'بنك وربة' } },
  {
    code: 'KWIB',
    swift: 'KWIBKWKW',
    name: { en: 'Kuwait International Bank', ar: 'بنك الكويت الدولي' },
  },
];

// ------------------------------------------------------------------- IBAN

/** Removes spaces and makes letters upper case. */
export function compactIban(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

/** Groups an IBAN in fours for display: "KW81 CBKU 0000 ...". */
export function formatIban(value: string): string {
  return compactIban(value)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

const IBAN_LENGTHS: Record<string, number> = {
  KW: 30,
  SA: 24,
  AE: 23,
  BH: 22,
  QA: 29,
  OM: 23,
  JO: 30,
  EG: 29,
  GB: 22,
  DE: 22,
  FR: 27,
};

/** Checks the length (for known countries) and the ISO 13616 mod-97 check digits. */
export function isValidIban(value: string): boolean {
  const iban = compactIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected && iban.length !== expected) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** The Kuwaiti bank an IBAN belongs to, when known. */
export function bankFromIban(value: string): KuwaitBank | undefined {
  const iban = compactIban(value);
  if (!iban.startsWith('KW')) return undefined;
  const code = iban.slice(4, 8);
  return KUWAIT_BANKS.find((b) => b.code === code);
}

/** The short names people use for the banks. */
const BANK_SHORT_NAMES: Record<string, string[]> = {
  NBOK: ['NBK'],
  KFHO: ['KFH', 'Bait Al Tamweel', 'بيتك'],
  BBYN: ['Boubyan', 'بوبيان'],
  GULB: ['GBK', 'Gulf'],
  BRGN: ['Burgan', 'برقان'],
  COMB: ['CBK', 'Commercial Bank', 'التجاري'],
  ABKK: ['ABK', 'Ahli', 'Al Ahli', 'الاهلي'],
  WRBA: ['Warba', 'وربة'],
  KWIB: ['KIB', 'International Bank', 'الدولي'],
};

const bankKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** A Kuwaiti bank by its code, SWIFT code, English or Arabic name or short name (NBK, KFH…). */
export function findBank(name: string): KuwaitBank | undefined {
  const wanted = bankKey(name);
  if (!wanted) return undefined;
  return KUWAIT_BANKS.find((b) =>
    [b.code, b.swift, b.name.en, b.name.ar, ...(BANK_SHORT_NAMES[b.code] ?? [])].some(
      (n) => bankKey(n) === wanted,
    ),
  );
}

/**
 * Checks a payment card number, such as a salary card: 12 to 19 digits with
 * a valid Luhn check digit.
 */
export function isValidCardNumber(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// --------------------------------------------------------------- Civil ID

const CIVIL_ID_WEIGHTS = [2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];

/**
 * Checks a 12-digit Kuwaiti Civil ID: century digit (2 = 1900s, 3 = 2000s),
 * a valid birth date (YYMMDD) and the check digit.
 */
export function isValidCivilId(value: string): boolean {
  const id = value.replace(/\s/g, '');
  if (!/^[23]\d{11}$/.test(id)) return false;
  const year = (id[0] === '2' ? 1900 : 2000) + Number(id.slice(1, 3));
  const month = Number(id.slice(3, 5));
  const day = Number(id.slice(5, 7));
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) return false;
  const sum = CIVIL_ID_WEIGHTS.reduce((s, w, i) => s + w * Number(id[i]), 0);
  const check = 11 - (sum % 11);
  return check < 10 && check === Number(id[11]);
}

// ------------------------------------------------------------------ Phone

/** Kuwaiti numbers have 8 digits: mobiles start with 4, 5, 6 or 9, landlines with 2. */
export function normalizeKuwaitPhone(value: string): string | null {
  let digits = value.replace(/[^\d+]/g, '');
  if (digits.startsWith('+965')) digits = digits.slice(4);
  else if (digits.startsWith('00965')) digits = digits.slice(5);
  else if (digits.startsWith('965') && digits.length === 11) digits = digits.slice(3);
  if (!/^[24569]\d{7}$/.test(digits)) return null;
  return `+965 ${digits.slice(0, 4)} ${digits.slice(4)}`;
}

// --------------------------------------------------------------- Calendar

/** The weekend in Kuwait: Friday and Saturday (getDay() numbers). */
export const KUWAIT_WEEKEND = [5, 6];

export interface Holiday {
  date: ISODate;
  name: Bilingual;
}

const hijriParts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
});

function hijriOf(date: Date): { month: number; day: number } {
  const parts = Object.fromEntries(hijriParts.formatToParts(date).map((p) => [p.type, p.value]));
  return { month: Number(parts.month), day: Number(parts.day) };
}

const ISLAMIC_HOLIDAYS: { month: number; day: number; days: number; name: Bilingual }[] = [
  { month: 7, day: 27, days: 1, name: { en: "Isra and Mi'raj", ar: 'الإسراء والمعراج' } },
  { month: 10, day: 1, days: 3, name: { en: 'Eid al-Fitr', ar: 'عيد الفطر' } },
  { month: 12, day: 9, days: 1, name: { en: 'Arafat Day', ar: 'يوم عرفة' } },
  { month: 12, day: 10, days: 3, name: { en: 'Eid al-Adha', ar: 'عيد الأضحى' } },
  { month: 1, day: 1, days: 1, name: { en: 'Islamic New Year', ar: 'رأس السنة الهجرية' } },
  { month: 3, day: 12, days: 1, name: { en: "Prophet's Birthday", ar: 'المولد النبوي الشريف' } },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Public holidays for a Gregorian year. Islamic holidays follow the Umm
 * al-Qura calendar; the official dates depend on the moon sighting and can
 * move by a day, and the government may add bridge days.
 */
export function kuwaitHolidays(year: number): Holiday[] {
  const out: Holiday[] = [
    { date: `${year}-01-01`, name: { en: "New Year's Day", ar: 'رأس السنة الميلادية' } },
    { date: `${year}-02-25`, name: { en: 'National Day', ar: 'العيد الوطني' } },
    { date: `${year}-02-26`, name: { en: 'Liberation Day', ar: 'عيد التحرير' } },
  ];
  for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year;) {
    const h = hijriOf(d);
    const holiday = ISLAMIC_HOLIDAYS.find((x) => x.month === h.month && x.day === h.day);
    if (holiday) {
      for (let i = 0; i < holiday.days; i++) {
        const day = new Date(d.getTime() + i * 86_400_000);
        out.push({ date: iso(day), name: holiday.name });
      }
    }
    d = new Date(d.getTime() + 86_400_000);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** A date in the Hijri (Umm al-Qura) calendar, e.g. "22 ربيع الآخر 1448 هـ". */
export function formatHijri(value: ISODate, language: 'en' | 'ar'): string {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const locale =
    language === 'ar' ? 'ar-SA-u-ca-islamic-umalqura-nu-latn' : 'en-u-ca-islamic-umalqura';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}
