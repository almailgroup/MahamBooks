import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Eye, Info, Lock } from 'lucide-react';
import { useCompany } from '@/app/company';
import { t } from '@/i18n';
import { buttonClass } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/misc';
import type { ReadOnlyState } from '@/components/ui/read-only';
import { cn } from '@/lib/cn';
import { useCloudLink } from '@/cloud/hooks';
import { canSeePeople, ROLE_LABELS, type MemberRole } from '@/cloud/roles';

export interface RoleView {
  /** Null for a company kept on this device only. */
  role: MemberRole | null;
  /** Payroll and people pages are hidden. */
  peopleHidden: boolean;
  /** The company's link to the cloud has been read (until then the role is not known). */
  known: boolean;
  readOnly: ReadOnlyState;
}

/** What the person's role in the current company lets them see and do. */
export function useRoleView(): RoleView {
  const company = useCompany();
  const link = useCloudLink(company.id);
  return useMemo(() => {
    const role = link?.role ?? null;
    const removed = link?.status === 'removed';
    const viewer = role === 'viewer';
    return {
      role,
      peopleHidden: !canSeePeople(role),
      known: link !== undefined,
      readOnly: {
        readOnly: viewer || removed,
        reason: removed ? t('No longer shared with you') : viewer ? t('View only') : '',
      },
    };
  }, [link]);
}

/** Payroll and people pages: shown only to roles that may see them. */
export function PeopleGate({ children }: { children: ReactNode }) {
  const { peopleHidden, role, known } = useRoleView();
  // Nothing until the role is known: a page of salaries must not flash up.
  if (!known) return null;
  if (!peopleHidden) return <>{children}</>;
  return (
    <Card className="mx-auto max-w-xl">
      <EmptyState
        icon={<Lock />}
        title={t('Payroll and people are private')}
        description={t(
          'As {role} in this company you don’t see salaries, payroll or employee documents. Ask the owner if you need them.',
          { role: t(ROLE_LABELS[role ?? 'viewer']) },
        )}
        action={
          <Link to="/" className={buttonClass('outline')}>
            {t('Go to the home page')}
          </Link>
        }
      />
    </Card>
  );
}

/**
 * Next to bank balances, the profit and loss, balance sheet, trial balance,
 * cash flow and dashboard totals of people who don't see payroll (staff and
 * viewers): payroll entries are private, so those figures leave them out.
 */
export function PayrollNotIncluded({ className }: { className?: string }) {
  const { peopleHidden } = useRoleView();
  if (!peopleHidden) return null;
  return (
    <p
      role="note"
      className={cn(
        'flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200',
        className,
      )}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
      {t('Payroll isn’t included in what you see.')}
    </p>
  );
}

/** At the top of every page for people who can only look. */
export function ViewOnlyBanner() {
  const { readOnly, role } = useRoleView();
  if (!readOnly.readOnly) return null;
  return (
    <div
      role="status"
      className="mb-5 flex items-start gap-2.5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/20"
    >
      <Eye className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        {role === 'viewer'
          ? t('You can view this company but not change it. Ask an owner or admin for more access.')
          : t(
              'This company is no longer shared with you. Keep it as a company on this device or remove it in Settings → Cloud and sync.',
            )}
      </p>
    </div>
  );
}
