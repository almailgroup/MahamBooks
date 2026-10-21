import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { useCompany } from '@/app/company';
import { isPresetBank, layoutFor } from '@/lib/cheque-layouts';

/**
 * Whether cheques on `bank` have a layout to print with: a built-in one, or
 * one the company made. Only read while cheque printing is on.
 */
export function useHasChequeLayout(bank: string | null | undefined): boolean {
  const company = useCompany();
  const code = (bank ?? '').trim().toUpperCase();
  const builtIn = isPresetBank(code);
  const own = useLiveQuery(
    async () =>
      company.chequePrinting && code && !builtIn
        ? layoutFor(
            code,
            await db.chequeLayouts.where('companyId').equals(company.id).toArray(),
            company.id,
          ) !== null
        : false,
    [company.id, company.chequePrinting, code, builtIn],
  );
  return builtIn || Boolean(own);
}
