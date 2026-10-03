import type { DateFormat, DocumentLanguage, PageSize } from '@/db/types';

export interface RegionDefaults {
  currency: string;
  locale: string;
  dateFormat: DateFormat;
  pageSize: PageSize;
  language: DocumentLanguage;
  taxIdLabel: string;
  /** Typical standard tax; null when there is no general sales tax/VAT. */
  tax: { name: string; rate: number } | null;
}

const base = (
  currency: string,
  locale: string,
  taxIdLabel: string,
  tax: RegionDefaults['tax'],
  extra: Partial<RegionDefaults> = {},
): RegionDefaults => ({
  currency,
  locale,
  dateFormat: 'dd/MM/yyyy',
  pageSize: 'A4',
  language: 'en',
  taxIdLabel,
  tax,
  ...extra,
});

/**
 * Sensible starting points per country. Rates are the common standard rates
 * and can be changed in Settings → Taxes.
 */
export const REGION_DEFAULTS: Record<string, RegionDefaults> = {
  US: base('USD', 'en-US', 'EIN', null, { dateFormat: 'MM/dd/yyyy', pageSize: 'LETTER' }),
  CA: base(
    'CAD',
    'en-CA',
    'GST/HST No.',
    { name: 'GST', rate: 5 },
    { dateFormat: 'yyyy-MM-dd', pageSize: 'LETTER' },
  ),
  GB: base('GBP', 'en-GB', 'VAT No.', { name: 'VAT', rate: 20 }),
  IE: base('EUR', 'en-IE', 'VAT No.', { name: 'VAT', rate: 23 }),
  AE: base('AED', 'en-AE', 'TRN', { name: 'VAT', rate: 5 }),
  SA: base('SAR', 'en-US', 'VAT No.', { name: 'VAT', rate: 15 }),
  BH: base('BHD', 'en-US', 'VAT No.', { name: 'VAT', rate: 10 }),
  OM: base('OMR', 'en-US', 'VATIN', { name: 'VAT', rate: 5 }),
  QA: base('QAR', 'en-US', 'Tax ID', null),
  KW: base('KWD', 'en-KW', 'Tax card no.', null),
  EG: base('EGP', 'en-US', 'Tax Reg. No.', { name: 'VAT', rate: 14 }),
  JO: base('JOD', 'en-US', 'Tax No.', { name: 'GST', rate: 16 }),
  MA: base('MAD', 'fr-FR', 'ICE', { name: 'TVA', rate: 20 }, { language: 'fr' }),
  TR: base('TRY', 'tr-TR', 'VKN', { name: 'KDV', rate: 20 }, { dateFormat: 'dd.MM.yyyy' }),
  PK: base('PKR', 'en-US', 'NTN', { name: 'GST', rate: 18 }),
  IN: base('INR', 'en-IN', 'GSTIN', { name: 'GST', rate: 18 }),
  SG: base('SGD', 'en-SG', 'GST Reg. No.', { name: 'GST', rate: 9 }),
  AU: base('AUD', 'en-AU', 'ABN', { name: 'GST', rate: 10 }),
  NZ: base('NZD', 'en-NZ', 'GST No.', { name: 'GST', rate: 15 }),
  ZA: base('ZAR', 'en-ZA', 'VAT No.', { name: 'VAT', rate: 15 }, { dateFormat: 'yyyy-MM-dd' }),
  NG: base('NGN', 'en-NG', 'TIN', { name: 'VAT', rate: 7.5 }),
  KE: base('KES', 'en-US', 'KRA PIN', { name: 'VAT', rate: 16 }),
  GH: base('GHS', 'en-US', 'TIN', { name: 'VAT', rate: 15 }),
  DE: base(
    'EUR',
    'de-DE',
    'USt-IdNr.',
    { name: 'MwSt.', rate: 19 },
    { dateFormat: 'dd.MM.yyyy', language: 'de' },
  ),
  AT: base(
    'EUR',
    'de-AT',
    'UID',
    { name: 'USt.', rate: 20 },
    { dateFormat: 'dd.MM.yyyy', language: 'de' },
  ),
  CH: base(
    'CHF',
    'de-CH',
    'MWST-Nr.',
    { name: 'MWST', rate: 8.1 },
    { dateFormat: 'dd.MM.yyyy', language: 'de' },
  ),
  FR: base('EUR', 'fr-FR', 'N° TVA', { name: 'TVA', rate: 20 }, { language: 'fr' }),
  BE: base('EUR', 'fr-BE', 'N° TVA', { name: 'TVA', rate: 21 }, { language: 'fr' }),
  LU: base('EUR', 'fr-FR', 'N° TVA', { name: 'TVA', rate: 17 }, { language: 'fr' }),
  ES: base('EUR', 'es-ES', 'NIF', { name: 'IVA', rate: 21 }, { language: 'es' }),
  MX: base('MXN', 'es-MX', 'RFC', { name: 'IVA', rate: 16 }, { language: 'es' }),
  PT: base('EUR', 'pt-PT', 'NIF', { name: 'IVA', rate: 23 }, { language: 'pt' }),
  BR: base('BRL', 'pt-BR', 'CNPJ', null, { language: 'pt' }),
  IT: base('EUR', 'it-IT', 'P. IVA', { name: 'IVA', rate: 22 }, { language: 'it' }),
  NL: base(
    'EUR',
    'nl-NL',
    'Btw-nr.',
    { name: 'Btw', rate: 21 },
    { dateFormat: 'dd-MM-yyyy', language: 'nl' },
  ),
  SE: base('SEK', 'sv-SE', 'Momsreg.nr', { name: 'Moms', rate: 25 }, { dateFormat: 'yyyy-MM-dd' }),
  DK: base('DKK', 'da-DK', 'CVR', { name: 'Moms', rate: 25 }, { dateFormat: 'dd.MM.yyyy' }),
  NO: base('NOK', 'nb-NO', 'Org.nr.', { name: 'MVA', rate: 25 }, { dateFormat: 'dd.MM.yyyy' }),
  FI: base('EUR', 'fi-FI', 'ALV-nro', { name: 'ALV', rate: 25.5 }, { dateFormat: 'dd.MM.yyyy' }),
  PL: base('PLN', 'pl-PL', 'NIP', { name: 'VAT', rate: 23 }, { dateFormat: 'dd.MM.yyyy' }),
};

/** Defaults for a country; Kuwait when the country is not known. */
export function regionDefaults(country: string): RegionDefaults {
  return REGION_DEFAULTS[country.toUpperCase()] ?? REGION_DEFAULTS.KW;
}
