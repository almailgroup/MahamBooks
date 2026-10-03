import type { Address } from '@/db/types';
import { placeName } from './kuwait';

const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ');

const displayNames = new Map<string, Intl.DisplayNames | null>();

function names(locale: string, type: 'region' | 'currency'): Intl.DisplayNames | null {
  const key = `${locale}|${type}`;
  if (!displayNames.has(key)) {
    try {
      displayNames.set(key, new Intl.DisplayNames([locale, 'en'], { type }));
    } catch {
      displayNames.set(key, null);
    }
  }
  return displayNames.get(key) ?? null;
}

export function countryName(code: string, locale = 'en'): string {
  if (!code) return '';
  try {
    return names(locale, 'region')?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function countryOptions(locale = 'en'): { value: string; label: string }[] {
  return COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code, locale) })).sort(
    (a, b) => a.label.localeCompare(b.label),
  );
}

export function currencyName(code: string, locale = 'en'): string {
  try {
    return names(locale, 'currency')?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'AED',
  'SAR',
  'QAR',
  'KWD',
  'BHD',
  'OMR',
  'EGP',
  'CAD',
  'AUD',
  'CHF',
  'JPY',
  'CNY',
  'INR',
  'PKR',
  'NGN',
  'ZAR',
  'KES',
  'MAD',
  'TRY',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'SGD',
  'HKD',
  'NZD',
  'MXN',
  'BRL',
];

export function currencyOptions(locale = 'en'): { value: string; label: string }[] {
  let all: string[] = COMMON_CURRENCIES;
  try {
    all = Intl.supportedValuesOf('currency');
  } catch {
    // Older engines: fall back to the common list.
  }
  const common = COMMON_CURRENCIES.filter((c) => all.includes(c));
  const rest = all.filter((c) => !COMMON_CURRENCIES.includes(c));
  return [...common, ...rest].map((code) => ({
    value: code,
    label: `${code} — ${currencyName(code, locale)}`,
  }));
}

export const LOCALE_OPTIONS: { value: string; label: string }[] = [
  { value: 'en-KW', label: 'English (Kuwait)' },
  { value: 'ar-KW', label: 'العربية (الكويت)' },
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'en-AE', label: 'English (United Arab Emirates)' },
  { value: 'en-IN', label: 'English (India)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-IE', label: 'English (Ireland)' },
  { value: 'en-NZ', label: 'English (New Zealand)' },
  { value: 'en-SG', label: 'English (Singapore)' },
  { value: 'en-ZA', label: 'English (South Africa)' },
  { value: 'en-NG', label: 'English (Nigeria)' },
  { value: 'fr-FR', label: 'Français (France)' },
  { value: 'fr-CA', label: 'Français (Canada)' },
  { value: 'fr-BE', label: 'Français (Belgique)' },
  { value: 'fr-CH', label: 'Français (Suisse)' },
  { value: 'de-DE', label: 'Deutsch (Deutschland)' },
  { value: 'de-AT', label: 'Deutsch (Österreich)' },
  { value: 'de-CH', label: 'Deutsch (Schweiz)' },
  { value: 'es-ES', label: 'Español (España)' },
  { value: 'es-MX', label: 'Español (México)' },
  { value: 'pt-PT', label: 'Português (Portugal)' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'it-IT', label: 'Italiano (Italia)' },
  { value: 'nl-NL', label: 'Nederlands (Nederland)' },
  { value: 'nl-BE', label: 'Nederlands (België)' },
  { value: 'sv-SE', label: 'Svenska (Sverige)' },
  { value: 'da-DK', label: 'Dansk (Danmark)' },
  { value: 'nb-NO', label: 'Norsk (Norge)' },
  { value: 'fi-FI', label: 'Suomi (Suomi)' },
  { value: 'pl-PL', label: 'Polski (Polska)' },
  { value: 'tr-TR', label: 'Türkçe (Türkiye)' },
];

const CITY_STATE_ZIP = new Set(['US', 'CA', 'AU', 'PH']);
const CITY_THEN_POSTCODE = new Set([
  'GB',
  'IE',
  'IM',
  'JE',
  'GG',
  'AE',
  'SA',
  'QA',
  'KW',
  'BH',
  'OM',
]);

export function emptyAddress(country = ''): Address {
  return { line1: '', line2: '', city: '', state: '', postalCode: '', country };
}

const KUWAIT_PARTS = ['block', 'street', 'avenue', 'building', 'floor', 'unit', 'paci'] as const;

export function isAddressEmpty(address: Address | null | undefined): boolean {
  if (!address) return true;
  return ![
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
    ...KUWAIT_PARTS.map((k) => address[k]),
  ].some((v) => v && v.trim() !== '');
}

const KUWAIT_WORDS = {
  en: {
    block: 'Block',
    street: 'Street',
    avenue: 'Avenue',
    building: 'Building',
    floor: 'Floor',
    unit: 'Unit',
    paci: 'PACI no.',
    country: 'Kuwait',
    comma: ', ',
  },
  ar: {
    block: 'قطعة',
    street: 'شارع',
    avenue: 'جادة',
    building: 'مبنى',
    floor: 'الدور',
    unit: 'وحدة',
    paci: 'الرقم الآلي',
    country: 'الكويت',
    comma: '، ',
  },
};

/**
 * A Kuwaiti address the way it is written locally:
 * "Block 3, Street 12, Avenue 4, Building 15, Floor 2, Unit 5",
 * "Salmiya, Hawalli 22001", "PACI no. 12345678".
 */
function kuwaitAddressLines(address: Address, language: 'en' | 'ar', includeCountry: boolean) {
  const w = KUWAIT_WORDS[language];
  const part = (key: (typeof KUWAIT_PARTS)[number]) => {
    const value = address[key]?.trim();
    return value ? `${w[key]} ${value}` : '';
  };
  const place = [address.city, address.state]
    .map((v) => placeName(v?.trim() ?? '', language))
    .filter(Boolean)
    .join(w.comma);
  const lines = [
    KUWAIT_PARTS.filter((k) => k !== 'paci')
      .map(part)
      .filter(Boolean)
      .join(w.comma),
    address.line1?.trim() ?? '',
    address.line2?.trim() ?? '',
    [place, address.postalCode?.trim() ?? ''].filter(Boolean).join(' '),
    part('paci'),
  ];
  if (includeCountry && !isAddressEmpty(address)) lines.push(w.country);
  return lines.filter((l) => l !== '');
}

/**
 * Formats an address following common conventions of its country.
 * The country line is included when `includeCountry` is true.
 */
export function formatAddressLines(
  address: Address | null | undefined,
  locale = 'en',
  includeCountry = true,
): string[] {
  if (!address) return [];
  if (address.country?.trim().toUpperCase() === 'KW') {
    return kuwaitAddressLines(address, locale.startsWith('ar') ? 'ar' : 'en', includeCountry);
  }
  const a = {
    line1: address.line1?.trim() ?? '',
    line2: address.line2?.trim() ?? '',
    city: address.city?.trim() ?? '',
    state: address.state?.trim() ?? '',
    postalCode: address.postalCode?.trim() ?? '',
    country: address.country?.trim().toUpperCase() ?? '',
  };
  const lines = [a.line1, a.line2];
  if (CITY_STATE_ZIP.has(a.country)) {
    const stateZip = [a.state, a.postalCode].filter(Boolean).join(' ');
    lines.push([a.city, stateZip].filter(Boolean).join(', '));
  } else if (CITY_THEN_POSTCODE.has(a.country)) {
    lines.push(
      [[a.city, a.postalCode].filter(Boolean).join(' '), a.state].filter(Boolean).join(', '),
    );
  } else {
    lines.push([a.postalCode, a.city].filter(Boolean).join(' '));
    lines.push(a.state);
  }
  if (includeCountry && a.country && !isAddressEmpty(address)) {
    lines.push(countryName(a.country, locale));
  }
  return lines.filter((l) => l !== '');
}
