import type { ChequeDetails } from '@/db/types';
import { daysToMaturity, isOpenCheque, type ChequeFilter } from '@/lib/cheques';
import { t, tp } from '@/i18n';

export type RegisterTab = 'received' | 'issued' | 'security';

const TABS: RegisterTab[] = ['received', 'issued', 'security'];
export const CHEQUE_FILTERS: ChequeFilter[] = ['open', 'week', 'overdue', 'returned', 'all'];

/** The register tab named in the address, received cheques by default. */
export function registerTab(value: string | null): RegisterTab {
  return TABS.includes(value as RegisterTab) ? (value as RegisterTab) : 'received';
}

/** The filter named in the address, open cheques by default. */
export function registerFilter(value: string | null): ChequeFilter {
  return CHEQUE_FILTERS.includes(value as ChequeFilter) ? (value as ChequeFilter) : 'open';
}

/** Filter names in the interface language. */
export function filterLabel(filter: ChequeFilter, tab: RegisterTab): string {
  switch (filter) {
    case 'open':
      return t('Open');
    case 'week':
      return t('Due in 7 days');
    case 'overdue':
      return tab === 'issued' ? t('Past date') : t('Overdue to deposit');
    case 'returned':
      return t('Returned');
    case 'all':
      return t('All');
  }
}

/** "In 3 days", "Today", "2 days overdue" for open cheques; a dash for the rest. */
export function maturityText(cheque: Pick<ChequeDetails, 'date' | 'status'>, todayIso: string) {
  if (!isOpenCheque(cheque.status)) return '—';
  const days = daysToMaturity(cheque.date, todayIso);
  if (days === 0) return t('Today');
  if (days > 0) return tp(days, 'In {count} day', 'In {count} days');
  if (cheque.status === 'deposited') return t('Presented');
  return tp(-days, '{count} day overdue', '{count} days overdue');
}
