import { useState } from 'react';
import { addMonths, startOfMonth } from 'date-fns';
import { Archive, ArchiveRestore, ListPlus, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCompany, useFormat } from '@/app/company';
import { useCloudLink } from '@/cloud/hooks';
import { saveLeaveReasonSettings, updateLeaveReasons } from '@/db/payroll';
import type { LeaveReason, PayrollSettings } from '@/db/types';
import { ACCRUAL_PAUSE_DAYS, leaveReasonPay } from '@/lib/hr/leave';
import { CATEGORY_LABELS } from '@/lib/hr/employees';
import { lookup } from '@/lib/known';
import { parseISODate, today, toISODate } from '@/lib/dates';
import { useLeaveRecords, usePayrollSettings } from '@/features/payroll/hooks';
import { PayrollHeader } from '@/features/payroll/shared';
import {
  LEAVE_REASON_OLDER,
  LeaveReasonDialog,
  newLeaveReason,
} from '@/features/payroll/leave-reason-dialog';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, Spinner } from '@/components/ui/misc';
import { Field, Switch } from '@/components/ui/form';
import { DateField } from '@/components/ui/date-field';
import { useConfirm } from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { isRtl, msg, t } from '@/i18n';

/** The first day of next month: where the pause of long unpaid leave starts. */
const nextMonthStart = () => toISODate(startOfMonth(addMonths(parseISODate(today()), 1)));

/**
 * The owner's recommended reasons: emergency leave taken from annual leave,
 * and compensatory days added by hand. Any other reason starts on full pay.
 */
const RECOMMENDED = (): LeaveReason[] => [
  newLeaveReason({
    name: 'Emergency leave',
    nameAr: 'إجازة طارئة',
    pay: 'annual',
    base: 'annual',
  }),
  newLeaveReason({
    name: 'Compensatory days',
    nameAr: 'أيام تعويضية',
    pay: 'balance',
    base: 'bereavement',
  }),
];

type Switches = Pick<PayrollSettings, 'leaveReasonsOn' | 'leaveAccrualPause'>;

/**
 * Payroll → Leave reasons: the company's own reasons for leave (D11) besides
 * the six types of the Labour Law, how each is paid, and two switches, both
 * off until the owner turns them on (D1): offering the reasons when leave is
 * recorded, and pausing annual leave in months of long unpaid leave.
 */
export default function LeaveReasonsPage() {
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const settings = usePayrollSettings();
  const records = useLeaveRecords();
  const link = useCloudLink(company.id);
  const [editing, setEditing] = useState<LeaveReason | null>(null);
  const [draft, setDraft] = useState<Switches | null>(null);
  const [busy, setBusy] = useState(false);
  if (!settings || !records) return <Spinner className="py-24" label={t('Loading…')} />;

  const reasons = settings.leaveReasons ?? [];
  const used = new Set(records.map((r) => r.reasonId).filter(Boolean));
  const sorted = [...reasons].sort(
    (a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived)),
  );
  const switches: Switches = draft ?? {
    leaveReasonsOn: settings.leaveReasonsOn,
    leaveAccrualPause: settings.leaveAccrualPause,
  };
  const pause = switches.leaveAccrualPause ?? null;
  const pauseChanged = pause?.from !== settings.leaveAccrualPause?.from;

  const run = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Something went wrong.'));
    }
  };

  const saveReason = async (reason: LeaveReason) => {
    await updateLeaveReasons(company.id, (list) =>
      list.some((r) => r.id === reason.id)
        ? list.map((r) => (r.id === reason.id ? reason : r))
        : [...list, reason],
    );
    toast.success(t('Leave reason saved'));
  };

  const setArchived = (reason: LeaveReason, archived: boolean) =>
    run(
      () =>
        updateLeaveReasons(company.id, (list) =>
          list.map((r) => (r.id === reason.id ? { ...r, archived } : r)),
        ),
      archived ? t('Leave reason archived') : t('Leave reason restored'),
    );

  const remove = async (reason: LeaveReason) => {
    const ok = await confirm({
      title: t('Remove {name}?', { name: localName(reason) }),
      description: t('No leave is recorded with it, so it can be removed.'),
      confirmLabel: t('Remove'),
      danger: true,
    });
    if (!ok) return;
    await run(
      () => updateLeaveReasons(company.id, (list) => list.filter((r) => r.id !== reason.id)),
      t('Leave reason removed'),
    );
  };

  const addRecommended = () =>
    run(
      () => updateLeaveReasons(company.id, (list) => [...list, ...RECOMMENDED()]),
      t('Recommended leave reasons added'),
    );

  const saveSwitches = async () => {
    setBusy(true);
    try {
      await saveLeaveReasonSettings(company.id, switches);
      setDraft(null);
      toast.success(t('Leave reasons saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  const details = (r: LeaveReason) =>
    [
      t(leaveReasonPay(r).label),
      r.maxDaysPerYear
        ? t('At most {days} days a year', { days: fmt.quantity(r.maxDaysPerYear) })
        : '',
      r.categories?.length
        ? t('For: {categories}', {
            categories: r.categories
              .map((c) => t(lookup(CATEGORY_LABELS, c, msg('Other'))))
              .join(isRtl() ? '، ' : ', '),
          })
        : '',
      r.noteRequired ? t('A note is needed') : '',
    ].filter(Boolean);

  return (
    <div>
      <PayrollHeader
        description={t(
          'Reasons for leave of the company’s own, besides the six types of the Labour Law.',
        )}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader
            title={t('Leave reasons')}
            description={t(
              'Such as emergency leave or compensatory days. Each one says how its leave is paid and what it does to the balances. Leave keeps the pay it was recorded with.',
            )}
            actions={
              <Button size="sm" onClick={() => setEditing(newLeaveReason())}>
                <Plus /> {t('Add a reason')}
              </Button>
            }
          />
          <CardBody className="space-y-4">
            <Switch
              checked={Boolean(switches.leaveReasonsOn)}
              onChange={(leaveReasonsOn) => setDraft({ ...switches, leaveReasonsOn })}
              label={t('Offer these reasons when leave is recorded')}
              description={t(
                'Off: leave is recorded with the six types of the Labour Law only, as before. Leave already recorded with a reason keeps its pay either way.',
              )}
            />
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t(
                'Ask your auditor to confirm how each reason is paid before you switch them on: leave taken from annual leave lowers the annual leave balance and the leave salary provision, and leave on half pay or without pay lowers the month’s pay.',
              )}
            </p>
            {link ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {t(
                  'Update the app on every device that records leave or prepares pay runs first. Older versions show each reason’s leave as one of the six types (see below each reason), and a pay run they work out can’t be approved here until it is updated from the records.',
                )}
              </p>
            ) : null}
            {reasons.length === 0 ? (
              <EmptyState
                icon={<Tags />}
                title={t('No leave reasons yet')}
                description={t(
                  'We recommend emergency leave taken from annual leave, and compensatory days added by hand. Any other reason starts on full pay; give it the most days a year it allows.',
                )}
                action={
                  <Button variant="outline" onClick={() => void addRecommended()}>
                    <ListPlus /> {t('Add the recommended reasons')}
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {sorted.map((r) => {
                  const inUse = used.has(r.id);
                  const older = (LEAVE_REASON_OLDER as Record<string, string>)[r.pay];
                  return (
                    <li
                      key={r.id}
                      className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">
                          {localName(r)}
                          {r.archived ? (
                            <Badge tone="slate" className="ms-2">
                              {t('Archived')}
                            </Badge>
                          ) : null}
                          {inUse ? (
                            <Badge tone="blue" className="ms-2">
                              {t('In use')}
                            </Badge>
                          ) : null}
                        </p>
                        <p className="text-xs text-slate-500">{details(r).join(' · ')}</p>
                        {older ? <p className="text-xs text-slate-400">{t(older)}</p> : null}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" size="xs" onClick={() => setEditing(r)}>
                          <Pencil /> {t('Edit')}
                        </Button>
                        {r.archived ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => void setArchived(r, false)}
                          >
                            <ArchiveRestore /> {t('Restore')}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => void setArchived(r, true)}
                          >
                            <Archive /> {t('Archive')}
                          </Button>
                        )}
                        {inUse ? null : (
                          <Button variant="ghost" size="xs" onClick={() => void remove(r)}>
                            <Trash2 /> {t('Remove')}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('Long unpaid leave')}
            description={t(
              'Annual leave is earned for each month of service, counted from the hire date (or the opening balance).',
            )}
          />
          <CardBody className="space-y-4">
            <Switch
              checked={Boolean(pause)}
              onChange={(on) =>
                setDraft({
                  ...switches,
                  leaveAccrualPause: on
                    ? { from: settings.leaveAccrualPause?.from ?? nextMonthStart() }
                    : null,
                })
              }
              label={t(
                'A month of service with more than {days} days of unpaid leave earns no annual leave',
                { days: ACCRUAL_PAUSE_DAYS },
              )}
              description={t(
                'Off: every month of service earns annual leave, as before. Unpaid leave counts in calendar days; leave on half pay doesn’t count.',
              )}
            />
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t(
                'Ask your auditor to confirm that a month of service with more than 15 days of unpaid leave earns no annual leave before you switch this on: it lowers the annual leave balance, the leave salary provision and the final settlement of staff on long unpaid leave.',
              )}
            </p>
            {pause ? (
              <Field
                label={t('From')}
                hint={
                  pauseChanged && pause.from <= today()
                    ? t(
                        'This date has passed: balances from it change, and the next approved pay run’s leave provision takes in the difference.',
                      )
                    : t('Months of service that start before this date earn as before.')
                }
              >
                {(id) => (
                  <DateField
                    id={id}
                    value={pause.from}
                    onChange={(iso) =>
                      iso && setDraft({ ...switches, leaveAccrualPause: { from: iso } })
                    }
                    className="sm:max-w-48"
                  />
                )}
              </Field>
            ) : null}
          </CardBody>
        </Card>

        <div className="flex justify-end gap-2">
          {draft ? (
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t('Discard changes')}
            </Button>
          ) : null}
          <Button onClick={() => void saveSwitches()} loading={busy} disabled={!draft}>
            {t('Save changes')}
          </Button>
        </div>
      </div>
      {editing ? (
        <LeaveReasonDialog
          reason={editing}
          locked={used.has(editing.id)}
          onSave={saveReason}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
