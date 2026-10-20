import { toast } from 'sonner';
import { setGroupSearch } from '@/db/people';
import type { Company } from '@/db/types';
import { Switch } from '@/components/ui/form';
import { companyTypeName } from '@/features/company/company-types';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import type { PeopleCompanies } from './all-companies';

/**
 * A switch for each company whose employees the person sees: on, its
 * employees are found from the other companies too (People → All
 * companies, and search). Saved in the company's own employee settings.
 */
export function GroupSearchSwitches({ group }: { group: PeopleCompanies }) {
  const included = new Set(group.included.map((c) => c.id));
  const change = async (company: Company, on: boolean) => {
    try {
      await setGroupSearch(company.id, on);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the settings.'));
    }
  };
  return (
    <ul className="divide-y divide-slate-100" aria-label={t('Companies searched')}>
      {group.eligible.map((company) => (
        <li key={company.id} className="py-3 first:pt-0 last:pb-0">
          <Switch
            checked={included.has(company.id)}
            onChange={(on) => void change(company, on)}
            label={<bdi>{localName(company)}</bdi>}
            description={companyTypeName(company.companyType) || undefined}
          />
        </li>
      ))}
    </ul>
  );
}
