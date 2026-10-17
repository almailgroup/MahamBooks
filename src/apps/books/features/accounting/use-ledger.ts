import { useLiveQuery } from 'dexie-react-hooks';
import { loadLedger, type CompanyLedger } from '@/db/accounting';
import { accountingSettings } from '@/db/chart-setup';
import { useCompany } from '@/app/company';

/**
 * The company's general ledger, rebuilt whenever an invoice, payment,
 * journal, account, product or client changes.
 */
export function useLedger():
  (CompanyLedger & { yearEnd: { month: number; day: number } }) | undefined {
  const company = useCompany();
  const ledger = useLiveQuery(() => loadLedger(company), [company]);
  return ledger ? { ...ledger, yearEnd: accountingSettings(company).fiscalYearEnd } : undefined;
}
