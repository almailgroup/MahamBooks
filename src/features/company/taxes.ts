import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import type { Company } from '@/db/types';
import { useCompany } from '@/app/company';

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
