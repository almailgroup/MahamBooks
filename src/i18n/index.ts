/**
 * Interface translations. The English text is the key: wrap every string a
 * person reads in `t()` (or `tp()` for counts) and add its Arabic to a file
 * in `src/i18n/ar/`. Text missing from the dictionary shows in English.
 *
 *   t('Save')                                   → "حفظ"
 *   t('Invoice {number} sent', { number })      → placeholders keep their names
 *   tp(n, '{count} invoice', '{count} invoices') → Arabic picks one of six plural forms
 *
 * Keys must be plain string literals (no template literals), so the test in
 * `check.test.ts` can find them and make sure every one is translated. For
 * labels kept in constants, mark them with `msg()` and translate where they
 * are shown: `t(STATUS_LABELS[status])`.
 */

export type Language = 'en' | 'ar';

export type PluralForms = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

export type Dictionary = Record<string, string | PluralForms>;

export type Vars = Record<string, string | number>;

export const LANGUAGES: { value: Language; label: string; nativeLabel: string }[] = [
  { value: 'en', label: 'English', nativeLabel: 'English' },
  { value: 'ar', label: 'Arabic', nativeLabel: 'العربية' },
];

const STORAGE_KEY = 'almailbooks.language';

let current: Language = 'en';
let dictionary: Dictionary = {};
let pluralRules = new Intl.PluralRules('en');

export function currentLanguage(): Language {
  return current;
}

export function isRtl(language: Language = current): boolean {
  return language === 'ar';
}

export function direction(language: Language = current): 'ltr' | 'rtl' {
  return isRtl(language) ? 'rtl' : 'ltr';
}

/**
 * Locale for numbers and dates shown in the interface. Arabic keeps Western
 * digits (1, 2, 3), which is what Kuwaiti invoices, banks and KNET receipts
 * use; `en` keeps the company's own locale.
 */
export function interfaceLocale(companyLocale: string | undefined): string {
  if (current === 'ar') return 'ar-KW-u-nu-latn';
  return companyLocale || 'en-KW';
}

export function storedLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ar') return saved;
  } catch {
    // Storage can be blocked (private windows); fall through to the browser.
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ar')) {
    return 'ar';
  }
  return 'en';
}

function remember(language: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not saved; the choice still applies to this visit.
  }
}

const loaders = import.meta.glob<{ default: Dictionary }>('./ar/*.ts');

async function loadArabic(): Promise<Dictionary> {
  const parts = await Promise.all(Object.values(loaders).map((load) => load()));
  return Object.assign({}, ...parts.map((p) => p.default));
}

/** Loads a language's dictionary and makes it current. */
export async function loadLanguage(language: Language, persist = false): Promise<void> {
  dictionary = language === 'ar' ? await loadArabic() : {};
  current = language;
  pluralRules = new Intl.PluralRules(language);
  if (persist) remember(language);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language === 'ar' ? 'ar-KW' : 'en';
    document.documentElement.dir = direction(language);
  }
}

/** For tests: use a dictionary directly. */
export function setDictionaryForTests(language: Language, dict: Dictionary): void {
  dictionary = dict;
  current = language;
  pluralRules = new Intl.PluralRules(language);
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function formatCount(n: number): string {
  const locale = interfaceLocale(undefined);
  let nf = numberFormats.get(locale);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
    numberFormats.set(locale, nf);
  }
  return nf.format(n);
}

export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** Translates interface text. */
export function t(text: string, vars?: Vars): string {
  const found = dictionary[text];
  const translated = typeof found === 'string' ? found : (found?.other ?? text);
  return interpolate(translated, vars);
}

/**
 * Translates text that depends on a count. `{count}` is replaced with the
 * formatted number. The Arabic entry is keyed by the plural (`other`) text
 * and may give each Arabic plural form.
 */
export function tp(count: number, one: string, other: string, vars?: Vars): string {
  const all = { count: formatCount(count), ...vars };
  const found = dictionary[other];
  if (current === 'en' || found === undefined) {
    return interpolate(count === 1 ? one : other, all);
  }
  if (typeof found === 'string') return interpolate(found, all);
  const rule = count === 0 && found.zero ? 'zero' : pluralRules.select(count);
  const form = (found as Record<string, string | undefined>)[rule] ?? found.other;
  return interpolate(form, all);
}

/** Marks text for translation without translating it yet; see `t`. */
export function msg<T extends string>(text: T): T {
  return text;
}
