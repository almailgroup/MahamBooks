import { useNavigate } from 'react-router';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { deleteCompany } from '@/db/records';
import { useCompanyContext } from '@/app/company';
import { CompanyLogo } from '@/app/layout';
import { countryName, currencyName } from '@/lib/geo';
import { currentLanguage, t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import { useConfirm } from '@/components/ui/overlay';
import { SettingsSection } from './shared';

export default function CompaniesSettings() {
  const { company, companies, switchCompany } = useCompanyContext();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const language = currentLanguage();

  const remove = async (id: string, name: string) => {
    const ok = await confirm({
      title: t('Delete {name}?', { name }),
      description: t(
        'All of its clients, products, invoices, quotes, payments and settings are permanently deleted from this browser. Download a backup first if you may need them.',
      ),
      confirmLabel: t('Delete company'),
      danger: true,
    });
    if (!ok) return;
    await deleteCompany(id);
    toast.success(t('{name} deleted', { name }));
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
          return (
            <li key={c.id} className="flex items-center gap-3 py-3">
              <CompanyLogo name={c.name} logo={c.branding.logo} />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2 font-medium text-slate-900">
                  <span className="truncate">{name}</span>
                  {c.id === company.id ? <Badge tone="blue">{t('Current company')}</Badge> : null}
                </p>
                <p className="truncate text-xs text-slate-500">
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
