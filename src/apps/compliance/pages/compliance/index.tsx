import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  CalendarCheck,
  Check,
  CircleAlert,
  FilePlus2,
  RefreshCw,
  Settings2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { clearComplianceMark, createComplianceDocument, markComplianceDone } from '@/db/renewals';
import type { ComplianceDocument } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import {
  ITEM_STATUS_LABELS,
  type ComplianceItem,
  type ComplianceItemStatus,
  type RegisterEntry,
} from '@/lib/compliance';
import { parseISODate } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { StatusTone } from '@/lib/status';
import { useEmployees, usePeopleSettings } from '@/features/people/hooks';
import { useComplianceCalendar, useRegister } from '@/features/renewals/hooks';
import { ComplianceHeader } from '@/features/renewals/compliance-header';
import { daysText, entryOwner, entryTitle } from '@/features/renewals/display';
import { DocumentDialog } from '@/features/renewals/document-dialog';
import { RenewDialog } from '@/features/renewals/renew-dialog';
import { ComplianceSettingsDialog } from '@/features/renewals/settings-dialog';
import { Button } from '@/components/ui/button';
import { useReadOnly } from '@/components/ui/read-only';
import { Badge, Card, CardBody, EmptyState, Spinner, Stat } from '@/components/ui/misc';
import { t } from '@/i18n';

const STATUS_TONES: Record<ComplianceItemStatus, StatusTone> = {
  overdue: 'red',
  due_soon: 'amber',
  upcoming: 'blue',
  done: 'green',
};

const WINDOW_DAYS = 90;

export default function CompliancePage() {
  const company = useCompany();
  // Staff and viewers look at the calendar without changing it.
  const { readOnly } = useReadOnly();
  const fmt = useFormat();
  const items = useComplianceCalendar(WINDOW_DAYS);
  const register = useRegister();
  const employees = useEmployees();
  const settings = usePeopleSettings();
  const [renewing, setRenewing] = useState<RegisterEntry | null>(null);
  const [adding, setAdding] = useState<ComplianceDocument | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const byEmployee = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(fmt.locale, { month: 'long', year: 'numeric' }),
    [fmt.locale],
  );
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(fmt.locale, { day: 'numeric' }),
    [fmt.locale],
  );
  const shortMonth = useMemo(
    () => new Intl.DateTimeFormat(fmt.locale, { month: 'short' }),
    [fmt.locale],
  );

  if (!items || !register || !employees || !settings) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }

  const overdue = items.filter((i) => i.status === 'overdue');
  const upcoming = items.filter((i) => i.status !== 'overdue');
  const dueIn30 = upcoming.filter((i) => i.status !== 'done' && i.daysLeft <= 30).length;
  const groups = new Map<string, ComplianceItem[]>();
  for (const item of upcoming) {
    const key = item.dueDate.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const hasLicence = register.documents.some((d) => d.type === 'commercial_licence' && !d.archived);

  const newDocument = (type: ComplianceDocument['type'] = 'commercial_licence') =>
    setAdding(createComplianceDocument(company.id, { type }));

  const markDone = async (item: ComplianceItem) => {
    const label = itemTitle(item);
    await markComplianceDone(company.id, item.key, { label });
    toast.success(t('Marked as done'), {
      description: label,
      action: {
        label: t('Undo'),
        onClick: () => void clearComplianceMark(company.id, item.key, label),
      },
    });
  };

  const itemTitle = (item: ComplianceItem) =>
    item.deadline
      ? t(item.deadline.title, item.deadline.vars)
      : item.entry
        ? entryTitle(item.entry)
        : '';

  const itemDetail = (item: ComplianceItem) => {
    if (item.deadline) {
      const d = item.deadline;
      const [y, m] = d.period.split('-').map(Number);
      return d.periodKind === 'month'
        ? t('For {month}', { month: monthFormat.format(new Date(y, m - 1, 1)) })
        : t('Year ended {date}', { date: fmt.date(d.period) });
    }
    if (item.entry) {
      return [entryOwner(item.entry, byEmployee, company), item.entry.number]
        .filter(Boolean)
        .join(' · ');
    }
    return '';
  };

  const renderItem = (item: ComplianceItem) => {
    const date = parseISODate(item.dueDate);
    return (
      <li key={item.key} className="flex gap-4 px-5 py-4">
        <div
          className={cn(
            'flex size-12 shrink-0 flex-col items-center justify-center rounded-lg text-center leading-tight',
            item.status === 'overdue'
              ? 'bg-red-50 text-red-700'
              : item.status === 'done'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-700',
          )}
          aria-hidden
        >
          <span className="tabular text-base font-semibold">{dayFormat.format(date)}</span>
          <span className="text-xs">{shortMonth.format(date)}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p
                className={cn(
                  'font-medium',
                  item.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-900',
                )}
              >
                {itemTitle(item)}
              </p>
              <Badge tone={STATUS_TONES[item.status]}>{t(ITEM_STATUS_LABELS[item.status])}</Badge>
              {item.deadline?.checkWithAuditor && item.status !== 'done' ? (
                <Badge tone="gray">{t('Check with your auditor')}</Badge>
              ) : null}
            </div>
            <p className="mt-0.5 text-sm text-slate-600">
              {[itemDetail(item), `${fmt.date(item.dueDate)} (${daysText(item.daysLeft)})`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {item.deadline ? (
              <p className="mt-1 text-xs text-slate-500">{t(item.deadline.explanation)}</p>
            ) : null}
          </div>
          <div className="shrink-0">
            {readOnly ? null : item.entry ? (
              <Button variant="outline" size="sm" onClick={() => setRenewing(item.entry)}>
                <RefreshCw /> {t('Renew')}
              </Button>
            ) : item.status === 'done' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void clearComplianceMark(company.id, item.key, itemTitle(item))}
                aria-label={t('Mark {item} as not done', { item: itemTitle(item) })}
              >
                <Undo2 /> {t('Undo')}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void markDone(item)}
                aria-label={t('Mark {item} as done', { item: itemTitle(item) })}
              >
                <Check /> {t('Done')}
              </Button>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <ComplianceHeader
        actions={
          readOnly ? null : (
            <>
              <Button variant="outline" onClick={() => setSettingsOpen(true)}>
                <Settings2 /> {t('Settings')}
              </Button>
              <Button onClick={() => newDocument()}>
                <FilePlus2 /> {t('Add document')}
              </Button>
            </>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label={t('Overdue')}
          value={fmt.quantity(overdue.length)}
          tone={overdue.length ? 'danger' : 'default'}
          hint={t('Deadlines missed and documents expired')}
        />
        <Stat label={t('Due in 30 days')} value={fmt.quantity(dueIn30)} hint={t('Not done yet')} />
        <Stat
          label={t('Tracked documents')}
          value={fmt.quantity(register.entries.length)}
          hint={
            <Link to="/compliance/documents" className="text-primary-700 hover:underline">
              {t('Open the register')}
            </Link>
          }
        />
      </div>

      {(!hasLicence && !readOnly) || !company.kuwait ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="flex-1 space-y-2 text-sm text-slate-700">
              {!company.kuwait ? (
                <p>
                  {t(
                    'Deadlines follow your legal form and foreign ownership. Set them in the company settings to see the right ones.',
                  )}{' '}
                  <Link
                    to="/settings/company"
                    className="text-primary-700 font-medium hover:underline"
                  >
                    {t('Company settings')}
                  </Link>
                </p>
              ) : null}
              {!hasLicence && !readOnly ? (
                <p>
                  {t('Add your commercial licence to be reminded before it expires.')}{' '}
                  <button
                    type="button"
                    onClick={() => newDocument('commercial_licence')}
                    className="text-primary-700 font-medium hover:underline"
                  >
                    {t('Add commercial licence')}
                  </button>
                </p>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarCheck />}
            title={t('Nothing due in the next 90 days')}
            description={t(
              'Statutory deadlines and documents that expire appear here, with reminders before each date.',
            )}
            action={
              readOnly ? null : (
                <Button onClick={() => newDocument()}>
                  <FilePlus2 /> {t('Add document')}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {overdue.length > 0 ? (
            <section aria-labelledby="overdue-heading">
              <h2
                id="overdue-heading"
                className="mb-2 text-sm font-semibold tracking-wide text-red-700 uppercase"
              >
                {t('Overdue')}
              </h2>
              <Card>
                <ul className="divide-y divide-slate-100">{overdue.map(renderItem)}</ul>
              </Card>
            </section>
          ) : null}
          {[...groups.entries()].map(([month, list]) => {
            const [y, m] = month.split('-').map(Number);
            const heading = monthFormat.format(new Date(y, m - 1, 1));
            return (
              <section key={month} aria-label={heading}>
                <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
                  {heading}
                </h2>
                <Card>
                  <ul className="divide-y divide-slate-100">{list.map(renderItem)}</ul>
                </Card>
              </section>
            );
          })}
          <p className="text-xs text-slate-500">
            {t(
              'Deadlines are worked out from your financial year end and legal form, as commonly applied in Kuwait. They are reminders, not legal advice.',
            )}
          </p>
        </div>
      )}

      {renewing ? (
        <RenewDialog
          entry={renewing}
          owner={entryOwner(renewing, byEmployee, company)}
          onClose={() => setRenewing(null)}
        />
      ) : null}
      {adding ? (
        <DocumentDialog
          document={adding}
          isNew
          employees={employees}
          defaultReminderDays={register.reminderDays}
          reminderDaysByType={register.reminderDaysByType}
          onClose={() => setAdding(null)}
        />
      ) : null}
      {settingsOpen ? (
        <ComplianceSettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} />
      ) : null}
    </div>
  );
}
