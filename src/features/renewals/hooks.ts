import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { loadRegister, upcomingCompliance } from '@/db/renewals';
import { useCompany } from '@/app/company';
import { useCloudLink, useServerFeature } from '@/cloud/hooks';
import { registerExtrasOn } from '@/lib/compliance';
import { today } from '@/lib/dates';

/** Every tracked document (register records and employees' papers). */
export function useRegister() {
  const company = useCompany();
  return useLiveQuery(() => loadRegister(company.id), [company.id]);
}

/** The compliance calendar for the next `days` days, with what is overdue. */
export function useComplianceCalendar(days = 90) {
  const company = useCompany();
  return useLiveQuery(() => upcomingCompliance(company, today(), days), [company, days]);
}

/** The company's vehicles, archived ones too. */
export function useVehicles() {
  const company = useCompany();
  return useLiveQuery(
    () => db.vehicles.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
}

/**
 * The register's extras: whether the company keeps contracts, customers'
 * papers, vehicles and confidential documents (Compliance → Settings), and
 * whether its cloud can keep vehicles and confidential documents yet (always
 * for a company kept on this device only; `checking` until that is known).
 */
export function useRegisterExtras(): { on: boolean; cloudReady: boolean; checking: boolean } {
  const company = useCompany();
  const cloudReady = useServerFeature(company.id, 'tables_v16');
  const checking = useCloudLink(company.id) === undefined;
  return { on: registerExtrasOn(company), cloudReady, checking };
}
