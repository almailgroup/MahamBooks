import { useLiveQuery } from 'dexie-react-hooks';
import { loadRegister, upcomingCompliance } from '@/db/renewals';
import { useCompany } from '@/app/company';
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
