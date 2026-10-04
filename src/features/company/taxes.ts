import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import type { Company } from '@/db/types';
import { useCompany } from '@/app/company';
import { msg, t } from '@/i18n';

/**
 * Whether the business charges tax. There is no VAT in Kuwait, so new
 * companies start with taxes off; companies created before the setting
 * existed charge tax when they have tax rates.
 */
export function taxesEnabled(company: Pick<Company, 'taxesEnabled'>, rateCount: number): boolean {
  return company.taxesEnabled ?? rateCount > 0;
}

/** The company with taxes switched on or off, and the editor defaults to match. */
export function withTaxes(company: Company, enabled: boolean): Company {
  const d = company.defaults;
  return {
    ...company,
    taxesEnabled: enabled,
    defaults: enabled
      ? { ...d, lineTaxes: d.lineTaxes || !d.documentTaxes }
      : { ...d, lineTaxes: false, documentTaxes: false },
  };
}

/** Live version of taxesEnabled() for the current company. */
export function useTaxesEnabled(): boolean {
  const company = useCompany();
  const known = company.taxesEnabled !== undefined;
  const rates = useLiveQuery(
    () => (known ? 0 : db.taxRates.where('companyId').equals(company.id).count()),
    [company.id, known],
  );
  return taxesEnabled(company, rates ?? 0);
}

/** The labels new companies start with (see lib/regions), in words a reader may need translated. */
const DEFAULT_TAX_ID_LABELS: Record<string, string> = {
  'Tax card no.': msg('Tax card no.'),
  'VAT No.': msg('VAT No.'),
  'Tax ID': msg('Tax ID'),
  'Tax No.': msg('Tax No.'),
};

/**
 * What a contact's tax number is called: the company's own label, translated
 * when it is one of the defaults ("Tax card no." reads رقم البطاقة الضريبية).
 */
export function taxIdLabel(company: Pick<Company, 'taxIdLabel'>): string {
  const label = company.taxIdLabel?.trim();
  if (!label) return t('Tax ID');
  return DEFAULT_TAX_ID_LABELS[label] ? t(DEFAULT_TAX_ID_LABELS[label]) : label;
}
