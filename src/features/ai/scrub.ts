import { currentLanguage, type Language } from '@/i18n';
import { compactIban, isValidCivilId, isValidIban } from '@/lib/kuwait';
import { normalizeDigits } from '@/lib/money';

/**
 * What the person types is cleaned before it is sent to the AI assistant:
 * ID numbers (Kuwaiti Civil IDs, passport-like numbers), IBANs of any
 * country, phone numbers, email addresses and runs of 10 or more digits are
 * replaced by a placeholder such as "[ID number hidden]", and so is any of
 * this company's own never-send values held on this device (known-values.ts),
 * however it is written.
 *
 * Arabic-Indic and Persian digits are folded to 0-9 on a copy of the text
 * that keeps its length (normalizeDigits changes one character for one), the
 * matches are found there, and replaced by their place in the original
 * text: the rest of an Arabic question, its marks and its digits, is sent as
 * it was typed. Nothing here keeps or logs the text.
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

/** Spaces, dashes, and the invisible marks of right-to-left text, left out when values are compared. */
const SEPARATOR = /[\s\-\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;

/** Values shorter than this are too common to hide wherever they appear. */
const MIN_KNOWN_LENGTH = 5;

/** A value as it is compared: digits folded, no spaces or dashes, letters in capitals. */
export function foldValue(value: string): string {
  let out = '';
  for (const ch of normalizeDigits(value)) {
    if (SEPARATOR.test(ch)) continue;
    const up = ch.toUpperCase();
    out += up.length === 1 ? up : ch;
  }
  return out;
}

const ALNUM = /[A-Za-z0-9]/;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** Two letters and two digits, then letters and digits, maybe in groups: checked below. */
const IBAN_CANDIDATE = /(?<![A-Za-z0-9])[A-Za-z]{2}\d{2}(?:[ -]?[A-Za-z0-9]){8,34}/g;
/** A Kuwaiti IBAN, even with a mistake in its check digits. */
const KUWAIT_IBAN = /^KW\d{2}[A-Z0-9]{26}$/;
/** 12 digits, maybe in groups, not part of a longer number: valid Civil IDs only. */
const CIVIL_ID = /(?<!\d[ -]?)\d(?:[ -]?\d){11}(?![ -]?\d)/g;
/** One or two letters and 6 to 9 digits, such as K1234567. */
const PASSPORT = /(?<![A-Za-z0-9])[A-Za-z]{1,2}\d{6,9}(?![A-Za-z0-9])/g;
/** With a country code: +965 9876 5432, 0044 20 7946 0958. */
const PHONE_INTERNATIONAL = /(?<![A-Za-z0-9+])(?:\+|00)[1-9]\d{0,2}(?:[ .-]?\d){6,12}(?![ -]?\d)/g;
/**
 * Not part of a longer code or number: not right after a letter or digit,
 * nor after one and a dash or slash (SO-2026-0042), nor after a digit and a space.
 */
const ALONE_BEFORE = String.raw`(?<![A-Za-z0-9]|[A-Za-z0-9][/-]|\d )`;
const ALONE_AFTER = String.raw`(?![A-Za-z0-9]|[/-][A-Za-z0-9]|[ -]\d)`;
/** A Kuwaiti number written in two groups of four: 9876 5432, 2245-6789. */
const PHONE_KUWAIT = new RegExp(
  String.raw`${ALONE_BEFORE}[24569]\d{3}[ -]\d{4}${ALONE_AFTER}`,
  'g',
);
/** A number after a word for a phone, in English or Arabic (the number is the group). */
const PHONE_WORD =
  /(?:\b(?:tel|telephone|phone|mobile|mob|cell|whatsapp|call)\b|هاتف|تلفون|تليفون|موبايل|جوال|نقال|واتساب|واتس)[^\d\n]{0,15}?(\+?\d(?:[ -]?\d){6,14})(?![ -]?\d)/gi;
/** 10 or more digits in a row. */
const LONG_RUN = /(?<!\d)\d{10,}(?!\d)/g;
/**
 * Groups of 3 or more digits with single spaces or dashes between them
 * (counted below), whatever follows: a card number with its expiry after it too.
 */
const LONG_GROUPED = new RegExp(String.raw`${ALONE_BEFORE}\d{3,}(?:[ -]\d{3,})+(?!\d)`, 'g');

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
 * The text with every private detail replaced by a placeholder, and what
 * was hidden. `known` are this company's never-send values on this device.
 */
export function scrubText(text: string, known: readonly KnownValue[] = []): Scrubbed {
  const folded = normalizeDigits(text);
  // normalizeDigits keeps the length; were it ever not to, the folded text
  // is what is sent: never the original with the details in the wrong place.
  const original = folded.length === text.length ? text : folded;
  const ranges: Range[] = [];
  const take = (start: number, end: number, kind: HiddenKind) => {
    if (end <= start) return;
    if (ranges.some((r) => start < r.end && r.start < end)) return;
    ranges.push({ start, end, kind });
  };

  for (const m of folded.matchAll(EMAIL)) take(m.index, m.index + m[0].length, 'email');

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
        if (ALNUM.test(folded[start - 1] ?? '') || ALNUM.test(folded[end] ?? '')) continue;
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
      const iban = compactIban(m[0].slice(0, length));
      if (iban.length < 14) break;
      if (isValidIban(iban) || KUWAIT_IBAN.test(iban)) {
        take(start, start + length, 'iban');
        taken = length;
        break;
      }
    }
    IBAN_CANDIDATE.lastIndex = start + Math.max(taken, 1);
  }

  for (const m of folded.matchAll(CIVIL_ID)) {
    if (isValidCivilId(m[0].replace(/[ -]/g, ''))) take(m.index, m.index + m[0].length, 'id');
  }
  for (const m of folded.matchAll(PASSPORT)) take(m.index, m.index + m[0].length, 'id');
  for (const m of folded.matchAll(PHONE_INTERNATIONAL)) {
    take(m.index, m.index + m[0].length, 'phone');
  }
  for (const m of folded.matchAll(PHONE_WORD)) {
    const end = m.index + m[0].length;
    take(end - m[1].length, end, 'phone');
  }
  for (const m of folded.matchAll(PHONE_KUWAIT)) take(m.index, m.index + m[0].length, 'phone');
  for (const m of folded.matchAll(LONG_RUN)) take(m.index, m.index + m[0].length, 'number');
  for (const m of folded.matchAll(LONG_GROUPED)) {
    if (m[0].replace(/\D/g, '').length >= 10) take(m.index, m.index + m[0].length, 'number');
  }

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
