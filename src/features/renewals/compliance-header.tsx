import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/ui/misc';
import { t } from '@/i18n';
import { useRegisterExtras } from './hooks';

/**
 * Title and the Calendar / Documents tabs shared by the compliance pages,
 * and Vehicles with the register's extras.
 */
export function ComplianceHeader({ actions }: { actions?: ReactNode }) {
  const { on: extras } = useRegisterExtras();
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      'border-b-2 px-1 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors',
      isActive
        ? 'border-primary-600 text-primary-700'
        : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
    );
  return (
    <div className="mb-6">
      <PageHeader
        title={t('Compliance')}
        description={t('Deadlines, licences and staff papers that need renewing.')}
        actions={actions}
      />
      <nav
        className="-mt-2 flex gap-6 overflow-x-auto border-b border-slate-200"
        aria-label={t('Compliance sections')}
      >
        <NavLink to="/compliance" end className={tab}>
          {t('Calendar')}
        </NavLink>
        <NavLink to="/compliance/documents" className={tab}>
          {t('Documents')}
        </NavLink>
        {extras ? (
          <NavLink to="/compliance/vehicles" className={tab}>
            {t('Vehicles')}
          </NavLink>
        ) : null}
      </nav>
    </div>
  );
}
