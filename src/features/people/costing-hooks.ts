import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import {
  canEditCostings,
  canSeeCostings,
  costingBasis,
  costingsAvailable,
  rateCard,
} from '@/db/costings';
import type { Client, CostingRate, CostingSettings, ID, StaffingCosting } from '@/db/types';
import { costingSettingsOf, type CostingBasis } from '@/lib/hr/costing';
import { useCompany } from '@/app/company';
import { useCloudLink } from '@/cloud/hooks';
import type { CloudLink } from '@/cloud/types';
import { usePeopleSettings } from './hooks';

/**
 * Manpower costing (#3) for the person on this device: whether the company
 * may use it and has it on, and what the person may do with it.
 */
export interface CostingView {
  /** The company's link to the cloud: null kept on this device, undefined while it is read. */
  link: CloudLink | null | undefined;
  settings: CostingSettings;
  loading: boolean;
  /** The company may use costings (always on this device; in the cloud once its server has them). */
  available: boolean;
  /** Switched on, and available. */
  on: boolean;
  /** Sees costings: owners, admins and accountants. */
  canSee: boolean;
  /** Makes costings and turns them on or off (unless People is view only for them). */
  canEdit: boolean;
}

export function useCostingView(): CostingView {
  const company = useCompany();
  const link = useCloudLink(company.id);
  const people = usePeopleSettings();
  const settings = costingSettingsOf(people?.costing);
  const available = costingsAvailable(link);
  return {
    link,
    settings,
    loading: link === undefined || people === undefined,
    available,
    on: available && settings.on,
    canSee: canSeeCostings(link),
    canEdit: canEditCostings(link),
  };
}

/** The company's costings, the latest changed first. */
export function useCostings(): StaffingCosting[] | undefined {
  const company = useCompany();
  return useLiveQuery(
    async () =>
      (await db.staffingCostings.where('companyId').equals(company.id).toArray()).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    [company.id],
  );
}

/** One costing; null when there is none of this company with that id. */
export function useCosting(id: ID | undefined): StaffingCosting | null | undefined {
  const company = useCompany();
  return useLiveQuery(async () => {
    if (!id) return null;
    const found = await db.staffingCostings.get(id);
    return found && found.companyId === company.id ? found : null;
  }, [company.id, id]);
}

/** The company's customers (not vendors, not archived), by name. */
export function useCustomers(): Client[] | undefined {
  const company = useCompany();
  return useLiveQuery(
    async () =>
      (await db.clients.where('companyId').equals(company.id).toArray())
        .filter((c) => !c.isVendor && !c.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [company.id],
  );
}

/** The rate card: saved, or worked out from the current salaries until it is. */
export function useRateCard(): { rates: CostingRate[]; fromSalaries: boolean } | undefined {
  const company = useCompany();
  return useLiveQuery(() => rateCard(company.id), [company.id]);
}

/** What posts are priced with today (payroll and People settings). */
export function useCostingBasis(): CostingBasis | undefined {
  const company = useCompany();
  return useLiveQuery(() => costingBasis(company.id), [company.id]);
}

/**
 * The manpower costing a quote was made from, for someone who sees costings
 * (owners, admins and accountants); null for anyone else, or when it is gone.
 */
export function useQuoteCosting(
  costingId: ID | null | undefined,
): Pick<StaffingCosting, 'id' | 'name'> | null | undefined {
  const company = useCompany();
  const link = useCloudLink(company.id);
  const sees = canSeeCostings(link);
  return useLiveQuery(async () => {
    if (!costingId || !sees) return null;
    const found = await db.staffingCostings.get(costingId);
    return found && found.companyId === company.id ? { id: found.id, name: found.name } : null;
  }, [company.id, costingId, sees]);
}
