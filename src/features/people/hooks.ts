import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { getPeopleSettings } from '@/db/people';
import type { Company, Employee, PeopleSettings } from '@/db/types';
import { useCompany, useCompanyContext } from '@/app/company';
import { useCloud } from '@/cloud/store';
import { peopleCompanies, seesPeopleIn, type PeopleCompanies } from './all-companies';

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

/**
 * The companies on this device whose employees the person may see, each
 * judged by its own link, and those of them switched on for the search
 * across companies (see all-companies.ts). Undefined until it is known who
 * is signed in.
 */
export function usePeopleCompanies(): PeopleCompanies | undefined {
  const { companies } = useCompanyContext();
  const { ready, user } = useCloud();
  const userId = user?.id ?? null;
  const ids = companies.map((c) => c.id).join(',');
  const stored = useLiveQuery(async () => {
    const links = await db.syncState.toArray();
    // Only the settings of companies whose people the person sees.
    const linkOf = new Map(links.map((link) => [link.companyId, link]));
    const seen = ids.split(',').filter((id) => id && seesPeopleIn(linkOf.get(id), userId));
    return { links, settings: await db.peopleSettings.bulkGet(seen) };
  }, [ids, userId]);
  return useMemo(
    () =>
      ready && stored
        ? peopleCompanies(companies, stored.links, userId, stored.settings)
        : undefined,
    [ready, stored, companies, userId],
  );
}

/**
 * The employees of the companies switched on for the search across
 * companies, with those companies. Rows of any other company are dropped
 * again, whatever the database returned.
 */
export function useEmployeesEverywhere():
  { companies: Company[]; employees: Employee[] } | undefined {
  const group = usePeopleCompanies();
  const key = (group?.included ?? []).map((c) => c.id).join(',');
  const rows = useLiveQuery(
    () => (key ? db.employees.where('companyId').anyOf(key.split(',')).toArray() : []),
    [key],
  );
  return useMemo(() => {
    if (!group || !rows) return undefined;
    const allowed = new Set(group.included.map((c) => c.id));
    return {
      companies: group.included,
      employees: rows.filter((e) => allowed.has(e.companyId)),
    };
  }, [group, rows]);
}
