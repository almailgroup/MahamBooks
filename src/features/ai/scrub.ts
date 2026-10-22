import { currentLanguage, type Language } from '@/i18n';
import { compactIban, isValidCivilId, isValidIban } from '@/lib/kuwait';
import { normalizeDigits } from '@/lib/money';

/**
 * What the person types is cleaned before it is sent to the AI assistant:
 * ID numbers (Kuwaiti Civil IDs, passport-like numbers, and numbers after a
 * word for an ID paper such as "residency" or "إقامة"), IBANs of any
 * country, phone numbers, email addresses and runs of 10 or more digits are
 * replaced by a placeholder such as "[ID number hidden]", and so is any of
 * this company's own never-send values held on this device (known-values.ts),
 * however it is written.
 *
 * Arabic-Indic, Persian and full-width digits are folded to 0-9 on a copy
 * of the text that keeps its length (normalizeDigits changes one character
 * for one), the matches are found there, and replaced by their place in the
 * original text: the rest of an Arabic question, its marks and its digits,
 * is sent as it was typed. Numbers are found however their groups are
 * spaced: with no-break or thin spaces (the app's own PDFs print them so),
 * several spaces, the invisible marks of right-to-left text, a line break
 * in an ID number, and dots, commas or slashes in one of the company's own
 * values. Nothing here keeps or logs the text.
 */

/** What kind of private detail was hidden. */
export type HiddenKind = 'id' | 'iban' | 'account' | 'phone' | 'email' | 'number';

/** How many of each kind were hidden in one message. */
export type HiddenCounts = Partial<Record<HiddenKind, number>>;

/** In the order the note under a message names them. */
export const HIDDEN_KINDS: readonly HiddenKind[] = [
  'id',
  'iban',
  'account',
  'phone',
  'email',
  'number',
];

/**
 * What takes each one's place, in the language of the text it is in (the
 * person reads it in their own message, and the model in the question).
 */
const PLACEHOLDERS: Record<HiddenKind, Record<Language, string>> = {
  id: { en: '[ID number hidden]', ar: '[رقم هوية مخفي]' },
  iban: { en: '[IBAN hidden]', ar: '[رقم آيبان مخفي]' },
  account: { en: '[account number hidden]', ar: '[رقم حساب مخفي]' },
  phone: { en: '[phone number hidden]', ar: '[رقم هاتف مخفي]' },
  email: { en: '[email address hidden]', ar: '[بريد إلكتروني مخفي]' },
  number: { en: '[number hidden]', ar: '[رقم مخفي]' },
};

export function placeholder(kind: HiddenKind, language: Language): string {
  return PLACEHOLDERS[kind][language];
}

/** One of this company's own values that is never sent (known-values.ts). */
export interface KnownValue {
  value: string;
  kind: HiddenKind;
}

export interface Scrubbed {
  /** The text to send, with each private detail replaced. */
  text: string;
  hidden: HiddenCounts;
  /** How many were hidden in all. */
  count: number;
}

/** The invisible marks of right-to-left text, soft hyphens and zero-width spaces. */
const MARKS = String.raw`\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff`;
/** Any space (no-break and thin ones too, and line breaks) or invisible mark. */
const GAP = String.raw`[\s${MARKS}]`;
/** A space or an invisible mark on the same line. */
const LINE_GAP = String.raw`[\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000${MARKS}]`;
/** A dash of any length, and the minus sign. */
const DASH = String.raw`[\-\u2010-\u2015\u2212]`;
/** Between two groups of a number on one line: spaces or marks, a dash, or both. */
const LINE_SEP = String.raw`(?:${LINE_GAP}{1,3}(?:${DASH}${LINE_GAP}{0,3})?|${DASH}${LINE_GAP}{0,3})`;

/** Left out when values are compared: spaces, marks, dashes, and dots, commas, slashes and underscores. */
const SEPARATOR = new RegExp(String.raw`${GAP}|${DASH}|[.,/_]`);

/** Values shorter than this are too common to hide wherever they appear. */
const MIN_KNOWN_LENGTH = 5;

/**
 * The text with digits in 0-9 and full-width letters and signs in their
 * usual form, one character for one (so places in it are places in the
 * original).
 */
function foldText(text: string): string {
  return normalizeDigits(text).replace(/[\uff01-\uff5e]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

/** A value as it is compared: digits folded, no spaces, dashes or dots, letters in capitals. */
export function foldValue(value: string): string {
  let out = '';
  for (const ch of foldText(value)) {
    if (SEPARATOR.test(ch)) continue;
    const up = ch.toUpperCase();
    out += up.length === 1 ? up : ch;
  }
  return out;
}

/** Every space, mark and dash, to take out of an IBAN found in groups. */
const SEPARATORS = new RegExp(String.raw`${GAP}|${DASH}`, 'g');

const ALNUM = /[A-Za-z0-9]/;
const DIGIT = /\d/;
/** What carries a number on: 1,234.500, 22/10, 10:30. */
const NUMBER_JOINER = /[.,/:]/;

/**
 * Whether what was found at start..end runs on from, or into, a longer
 * number or word: a letter or digit next to it, or a dot, comma, slash or
 * colon and then a digit (an amount, a date).
 */
function partOfLonger(text: string, start: number, end: number): boolean {
  const before = text[start - 1] ?? '';
  const after = text[end] ?? '';
  if (ALNUM.test(before) || ALNUM.test(after)) return true;
  if (NUMBER_JOINER.test(before) && DIGIT.test(text[start - 2] ?? '')) return true;
  return NUMBER_JOINER.test(after) && DIGIT.test(text[end + 1] ?? '');
}

/**
 * An Arabic word however it is written: with or without its short vowels
 * and a stretching line, and alef with or without hamza, final ة or ه, ي or ى.
 */
function arabicWord(word: string): string {
  const variants: Record<string, string> = { ا: '[اأإآ]', ة: '[ةه]', ي: '[يى]' };
  return [...word]
    .map((ch) =>
      ch === ' ' ? String.raw`\s*` : `${variants[ch] ?? ch}[\u064b-\u065f\u0670\u0640]*`,
    )
    .join('');
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/**
 * Two letters and two digits, then letters and digits, maybe in groups
 * (also across a line): checked below. Even straight after a word
 * ("IBANKW81…"), as only one that passes its check is taken.
 */
const IBAN_CANDIDATE = new RegExp(
  String.raw`[A-Za-z]{2}\d{2}(?:(?:${GAP}{1,3}|${GAP}{0,2}${DASH}${GAP}{0,2})?[A-Za-z0-9]){8,34}`,
  'g',
);
/** A Kuwaiti IBAN, even with a mistake in its check digits. */
const KUWAIT_IBAN = /^KW\d{2}[A-Z0-9]{26}$/;
/**
 * Between two digits of an ID number: spaces or marks (a line break too), a
 * dash, or one dot, comma, slash or underscore (2870.4151.2345).
 */
const ID_SEP = String.raw`(?:${GAP}{0,3}(?:${DASH}${GAP}{0,3})?|[.,/_])`;
/** 12 digits, maybe in groups, not part of a longer number: valid Civil IDs only. */
const CIVIL_ID = new RegExp(String.raw`(?<!\d${ID_SEP})\d(?:${ID_SEP}\d){11}(?!${ID_SEP}\d)`, 'g');
/** One or two letters and 6 to 9 digits, maybe a letter after: K1234567, P1234567A. */
const PASSPORT = /(?<![A-Za-z0-9])[A-Za-z]{1,2}\d{6,9}[A-Za-z]?(?![A-Za-z0-9])/g;
/**
 * A number after a word for an ID paper, in English or Arabic: the
 * passport, residency, work permit, central card, PIFSS or Civil ID number
 * (the group), with letters before or after it, maybe straight after the
 * word ("passportX98765"). Not a date, an amount or a time (a dot, comma,
 * slash, dash or colon and a digit after it); 5 digits at least, counted below.
 */
const ID_WORD = new RegExp(
  String.raw`(?:\b(?:passports?|residency|iqama|work${LINE_GAP}*permit|civil${LINE_GAP}*(?:id|card|no|number)|central${LINE_GAP}*(?:card|agency)|pifss|social${LINE_GAP}*security)|` +
    [
      'جواز',
      'اقامة',
      'اذن عمل',
      'اذن العمل',
      'تصريح عمل',
      'التامينات',
      'الرقم المدني',
      'رقم مدني',
      'رقمي المدني',
      'المدنية',
      'هوية',
    ]
      .map(arabicWord)
      .join('|') +
    String.raw`)(?:[^\d\n]{0,20}?[^A-Za-z\d\n])?([A-Za-z]{0,2}\d(?:${GAP}{0,2}\d)*[A-Za-z]?)(?![A-Za-z0-9]|[.,/:\-]\d)`,
  'gi',
);
const MIN_ID_WORD_DIGITS = 5;
/** With a country code: +965 9876 5432, 0044 20 7946 0958. */
const PHONE_INTERNATIONAL = new RegExp(
  String.raw`(?<![A-Za-z0-9+])(?:\+|00)[1-9]\d{0,2}(?:(?:${LINE_GAP}|[.\-])?\d){6,12}(?![ -]?\d)`,
  'g',
);
/**
 * Not part of a longer code or number: not right after a letter or digit,
 * nor after one and a dash or slash (SO-2026-0042), nor after a digit and a
 * space (of any kind).
 */
const ALONE_BEFORE = String.raw`(?<![A-Za-z0-9]|[A-Za-z0-9][/-]|\d${LINE_GAP})`;
const ALONE_AFTER = String.raw`(?![A-Za-z0-9]|[/-][A-Za-z0-9]|(?:${LINE_GAP}|-)\d)`;
/** A Kuwaiti number written in two groups of four: 9876 5432, 2245-6789. */
const PHONE_KUWAIT = new RegExp(
  String.raw`${ALONE_BEFORE}[24569]\d{3}(?:${LINE_GAP}|-)\d{4}${ALONE_AFTER}`,
  'g',
);
/** A number after a word for a phone, in English or Arabic (the number is the group). */
const PHONE_WORD = new RegExp(
  String.raw`(?:\b(?:tel|telephone|phone|mobile|mob|cell|whatsapp|call)\b|هاتف|تلفون|تليفون|موبايل|جوال|نقال|واتساب|واتس)[^\d\n]{0,15}?(\+?\d(?:(?:${LINE_GAP}|-)?\d){6,14})(?![ -]?\d)`,
  'gi',
);
/** 10 or more digits in a row. */
const LONG_RUN = /(?<!\d)\d{10,}(?!\d)/g;
/**
 * Groups of 3 or more digits on one line with spaces (of any kind), marks
 * or dashes between them (counted below), whatever follows: a card number
 * with its expiry after it too. Not dots or commas: those are amounts.
 */
const LONG_GROUPED = new RegExp(String.raw`${ALONE_BEFORE}\d{3,}(?:${LINE_SEP}\d{3,})+(?!\d)`, 'g');

interface Range {
  start: number;
  end: number;
  kind: HiddenKind;
}

/** The known values as they are compared, longest first, each once. */
function prepare(known: readonly KnownValue[]): KnownValue[] {
  const seen = new Map<string, HiddenKind>();
  for (const { value, kind } of known) {
    const folded = foldValue(value);
    if (folded.length < MIN_KNOWN_LENGTH || seen.has(folded)) continue;
    seen.set(folded, kind);
  }
  return [...seen]
    .map(([value, kind]) => ({ value, kind }))
    .sort((a, b) => b.value.length - a.value.length);
}

/** The language of a text: the script most of its letters are in, else the interface's. */
function languageOf(text: string): Language {
  const arabic = (text.match(/[ء-يٮ-ۓۺ-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic === latin) return currentLanguage();
  return arabic > latin ? 'ar' : 'en';
}

/**
 * Where the private details in a folded text are, in the order the rules
 * take them (the first to find a place keeps it). `lastCheck` runs only the
 * rules the last check before sending needs: the company's own values, and
 * Civil IDs and IBANs that pass their checks.
 */
function findPrivate(
  folded: string,
  known: readonly KnownValue[],
  { lastCheck = false }: { lastCheck?: boolean } = {},
): Range[] {
  const ranges: Range[] = [];
  const take = (start: number, end: number, kind: HiddenKind) => {
    if (end <= start) return;
    if (ranges.some((r) => start < r.end && r.start < end)) return;
    ranges.push({ start, end, kind });
  };

  if (!lastCheck) {
    for (const m of folded.matchAll(EMAIL)) take(m.index, m.index + m[0].length, 'email');
  }

  // This company's own values, however they are spaced or written.
  const values = prepare(known);
  if (values.length > 0) {
    let compact = '';
    const at: number[] = [];
    for (let i = 0; i < folded.length; i++) {
      const ch = folded[i];
      if (SEPARATOR.test(ch)) continue;
      const up = ch.toUpperCase();
      compact += up.length === 1 ? up : ch;
      at.push(i);
    }
    for (const { value, kind } of values) {
      for (
        let from = compact.indexOf(value);
        from !== -1;
        from = compact.indexOf(value, from + 1)
      ) {
        const start = at[from];
        const end = at[from + value.length - 1] + 1;
        // A whole value, not the middle of a longer number or word.
        if (partOfLonger(folded, start, end)) continue;
        take(start, end, kind);
      }
    }
  }

  // IBANs: the longest start of each candidate that is one (it may run into the next word).
  IBAN_CANDIDATE.lastIndex = 0;
  for (let m = IBAN_CANDIDATE.exec(folded); m; m = IBAN_CANDIDATE.exec(folded)) {
    const start = m.index;
    let taken = 0;
    for (let length = m[0].length; length > 0; length--) {
      if (!ALNUM.test(m[0][length - 1])) continue;
      const iban = compactIban(m[0].slice(0, length).replace(SEPARATORS, ''));
      if (iban.length < 14) break;
      if (isValidIban(iban) || (!lastCheck && KUWAIT_IBAN.test(iban))) {
        take(start, start + length, 'iban');
        taken = length;
        break;
      }
    }
    IBAN_CANDIDATE.lastIndex = start + Math.max(taken, 1);
  }

  for (const m of folded.matchAll(CIVIL_ID)) {
    if (isValidCivilId(m[0].replace(/\D/g, ''))) take(m.index, m.index + m[0].length, 'id');
  }
  if (lastCheck) return ranges;

  for (const m of folded.matchAll(PASSPORT)) take(m.index, m.index + m[0].length, 'id');
  for (const m of folded.matchAll(PHONE_INTERNATIONAL)) {
    take(m.index, m.index + m[0].length, 'phone');
  }
  for (const m of folded.matchAll(PHONE_WORD)) {
    const end = m.index + m[0].length;
    take(end - m[1].length, end, 'phone');
  }
  for (const m of folded.matchAll(ID_WORD)) {
    if (m[1].replace(/\D/g, '').length < MIN_ID_WORD_DIGITS) continue;
    const end = m.index + m[0].length;
    take(end - m[1].length, end, 'id');
  }
  for (const m of folded.matchAll(PHONE_KUWAIT)) take(m.index, m.index + m[0].length, 'phone');
  for (const m of folded.matchAll(LONG_RUN)) take(m.index, m.index + m[0].length, 'number');
  for (const m of folded.matchAll(LONG_GROUPED)) {
    if (m[0].replace(/\D/g, '').length >= 10) take(m.index, m.index + m[0].length, 'number');
  }
  return ranges;
}

/**
 * The text with every private detail replaced by a placeholder, and what
 * was hidden. `known` are this company's never-send values on this device.
 */
export function scrubText(text: string, known: readonly KnownValue[] = []): Scrubbed {
  const folded = foldText(text);
  // foldText keeps the length; were it ever not to, the folded text
  // is what is sent: never the original with the details in the wrong place.
  const original = folded.length === text.length ? text : folded;
  const ranges = findPrivate(folded, known);

  if (ranges.length === 0) return { text: original, hidden: {}, count: 0 };
  ranges.sort((a, b) => a.start - b.start);
  let rest = '';
  let from = 0;
  for (const r of ranges) {
    rest += `${original.slice(from, r.start)} `;
    from = r.end;
  }
  rest += original.slice(from);
  const language = languageOf(rest);

  const hidden: HiddenCounts = {};
  let out = '';
  from = 0;
  for (const r of ranges) {
    out += original.slice(from, r.start) + placeholder(r.kind, language);
    from = r.end;
    hidden[r.kind] = (hidden[r.kind] ?? 0) + 1;
  }
  out += original.slice(from);
  return { text: out, hidden, count: ranges.length };
}

/**
 * The last check before a question leaves the device (client.ts): whether
 * a text still holds one of the company's own values, or a Civil ID or an
 * IBAN that passes its check, in any digit form. It hides nothing: what is
 * sent has been through scrubText, so if this ever finds something, a way
 * in skipped it, and nothing is sent.
 */
export function holdsPrivate(text: string, known: readonly KnownValue[] = []): boolean {
  return findPrivate(foldText(text), known, { lastCheck: true }).length > 0;
}
