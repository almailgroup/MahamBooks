import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { getPeopleSettings } from '@/db/people';
import type { Employee, PeopleSettings } from '@/db/types';
import { useCompany } from '@/app/company';

/** The company's employees, kept up to date. */
export function useEmployees(): Employee[] | undefined {
  const company = useCompany();
  return useLiveQuery(
    () => db.employees.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
}

/** Employee and compliance settings, with defaults. */
export function usePeopleSettings(): PeopleSettings | undefined {
  const company = useCompany();
  return useLiveQuery(() => getPeopleSettings(company.id), [company.id]);
}
