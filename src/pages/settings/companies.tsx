import { useNavigate } from 'react-router';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { deleteCompany, unsentChanges } from '@/db/records';
import { allowOnDevice, keepOffDevice } from '@/cloud/kept-off';
import { withSyncLock } from '@/cloud/lock';
import { unsentWarning } from '@/features/cloud/unsent';
import { useCompanyContext } from '@/app/company';
import { CompanyLogo } from '@/app/layout';
import { countryName, currencyName } from '@/lib/geo';
import { companyTypeName } from '@/features/company/company-types';
import { usePeopleCompanies } from '@/features/people/hooks';
import { GroupSearchSwitches } from '@/features/people/group-search';
import { currentLanguage, t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import { useConfirm } from '@/components/ui/overlay';
import { SettingsSection } from './shared';

export default function CompaniesSettings() {
  return (
    <div className="space-y-6">
      <CompanyList />
      <EmployeeSearch />
    </div>
  );
}

function CompanyList() {
  const { company, companies, switchCompany } = useCompanyContext();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const language = currentLanguage();

  const remove = async (id: string, name: string) => {
    // A company kept in the cloud only leaves this device; it is deleted for
    // everyone from Settings → Team, by its owner.
    const link = await db.syncState.get(id);
    const inCloud = Boolean(link);
    // Changes not sent yet are lost with this device's copy (as Settings →
    // Cloud and sync says).
    const unsent = inCloud ? await unsentChanges(id) : 0;
    const ok = await confirm({
      title: inCloud
        ? t('Remove {name} from this device?', { name })
        : t('Delete {name}?', { name }),
      description: unsent
        ? unsentWarning(unsent)
        : inCloud
          ? t(
              'It stays in the cloud for you and your team, and you can download it again. To delete it for everyone, the owner uses Settings → Team.',
            )
          : t(
              'All of its clients, products, invoices, quotes, payments and settings are permanently deleted from this browser. Download a backup first if you may need them.',
            ),
      confirmLabel: inCloud ? t('Remove from this device') : t('Delete company'),
      danger: true,
    });
    if (!ok) return;
    try {
      // Removed on purpose: it doesn't come back to this device by itself.
      if (link) await keepOffDevice(link.userId, id);
      // After a sync under way, never in the middle of one. Only the changes
      // counted above may be lost; any queued since stop it.
      await withSyncLock(id, () => deleteCompany(id, { force: unsent > 0 })).catch(
        async (error: unknown) => {
          if (link) await allowOnDevice(link.userId, id);
          throw error;
        },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not delete the data.'));
      return;
    }
    toast.success(
      inCloud ? t('{name} was removed from this device.', { name }) : t('{name} deleted', { name }),
    );
    navigate('/');
  };

  return (
    <SettingsSection
      title={t('Companies')}
      description={t(
        'Run several businesses or brands, each with its own clients, numbering and branding.',
      )}
      actions={
        <Button size="sm" onClick={() => navigate('/setup')}>
          <Plus /> {t('Add company')}
        </Button>
      }
    >
      <ul className="divide-y divide-slate-100">
        {companies.map((c) => {
          const name = localName(c);
          const type = companyTypeName(c.companyType, language);
          return (
            <li key={c.id} className="flex items-center gap-3 py-3">
              <CompanyLogo name={c.name} logo={c.branding.logo} />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2 font-medium text-slate-900">
                  <span className="truncate">{name}</span>
                  {c.id === company.id ? <Badge tone="blue">{t('Current company')}</Badge> : null}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {type ? (
                    <>
                      <bdi>{type}</bdi> ·{' '}
                    </>
                  ) : null}
                  {currencyName(c.currency, language)} ·{' '}
                  {c.address.country
                    ? countryName(c.address.country, language)
                    : t('No country set')}
                </p>
              </div>
              {c.id !== company.id ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await switchCompany(c.id);
                    navigate('/');
                  }}
                >
                  {t('Switch')}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('Delete {name}', { name })}
                onClick={() => void remove(c.id, name)}
              >
                <Trash2 />
              </Button>
            </li>
          );
        })}
      </ul>
    </SettingsSection>
  );
}

/**
 * The switch of each company for the employee search across companies:
 * shown only where it can find anything, with two companies or more whose
 * employees the person sees.
 */
function EmployeeSearch() {
  const people = usePeopleCompanies();
  if (!people || people.eligible.length < 2) return null;
  return (
    <SettingsSection
      id="employee-search"
      title={t('Employee search across companies')}
      description={t(
        'Find the employees of the companies switched on here from any of them: on People → All companies and in search. Each switch is the company’s, for everyone in it who sees employees. Salaries, IBANs and Civil IDs aren’t shown there.',
      )}
      actions={
        people.included.length > 1 ? (
          <ButtonLink to="/people/all" size="sm" variant="outline">
            <Search /> {t('Search all companies')}
          </ButtonLink>
        ) : null
      }
    >
      <GroupSearchSwitches group={people} />
    </SettingsSection>
  );
}
