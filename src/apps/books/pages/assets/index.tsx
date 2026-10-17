import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock, Landmark, Plus, Search, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import type { DepreciationRun } from '@/db/types';
import {
  activeRuns,
  billAssetLines,
  bookValue,
  depreciationDue,
  monthLabel,
  postedDepreciation,
  reverseDepreciationRun,
  runDepreciation,
  suggestedPeriod,
} from '@/db/assets';
import { useCompany, useFormat } from '@/app/company';
import { currencyPrecision, fromMinor, toMinor } from '@/lib/money';
import { periodEnd, periodOf } from '@/lib/accounting/depreciation';
import { today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button, ButtonLink } from '@/components/ui/button';
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Segmented,
  Spinner,
  Stat,
} from '@/components/ui/misc';
import { Field, Input } from '@/components/ui/form';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  useConfirm,
} from '@/components/ui/overlay';
import { accountLabel, AssetStatusBadge, useAssetData } from './shared';
import { isolate } from '@/apps/books/features/reports/report-language';

type Filter = 'active' | 'disposed' | 'all';

function RunDialog({ onClose }: { onClose: () => void }) {
  const company = useCompany();
  const fmt = useFormat();
  const data = useAssetData();
  const [period, setPeriod] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const p = currencyPrecision(company.currency);
  const month = period ?? suggestedPeriod(data.runs);
  const valid = /^\d{4}-\d{2}$/.test(month);
  const done = valid && activeRuns(data.runs).some((r) => r.period === month);
  const due = valid && !done ? depreciationDue(data.assets, data.runs, periodEnd(month), p) : [];
  const total = due.reduce((s, l) => s + l.amount, 0);
  const future = valid && month > periodOf(today());

  const run = async () => {
    setBusy(true);
    try {
      const result = await runDepreciation(company.id, month);
      if (result.created) {
        toast.success(
          t('Depreciation for {month} posted', { month: monthLabel(month, company.locale) }),
        );
        onClose();
      } else {
        toast.info(
          t('Nothing to charge for {month}.', { month: monthLabel(month, company.locale) }),
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not post the depreciation.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('Run depreciation')}
        description={t('Charges every asset in use up to the end of the month, in one journal.')}
      >
        <DialogBody>
          <Field label={t('Month')} hint={t('Months that were skipped are caught up.')}>
            {(id) => (
              <Input
                id={id}
                type="month"
                value={month}
                max={periodOf(today())}
                onChange={(e) => setPeriod(e.target.value)}
                className="w-48"
              />
            )}
          </Field>
          {!valid ? null : future ? (
            <p className="text-sm text-amber-700">
              {t('Depreciation can only be run for months that have started.')}
            </p>
          ) : done ? (
            <p className="text-sm text-slate-600">
              {t('Depreciation for {month} is already posted.', {
                month: monthLabel(month, company.locale),
              })}
            </p>
          ) : due.length === 0 ? (
            <p className="text-sm text-slate-600">
              {t('Nothing to charge for {month}.', { month: monthLabel(month, company.locale) })}
            </p>
          ) : (
            <div className="rounded-lg border border-slate-200">
              <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto text-sm">
                {due.map(({ asset, amount }) => (
                  <li key={asset.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate text-slate-700">
                      <span className="tabular me-2 text-slate-500">{asset.number}</span>
                      <bdi>{localName(asset)}</bdi>
                    </span>
                    <span className="tabular shrink-0 text-slate-900">
                      {fmt.money(fromMinor(amount, p))}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                <span>{t('Total for {month}', { month: monthLabel(month, company.locale) })}</span>
                <span className="tabular">{fmt.money(fromMinor(total, p))}</span>
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => void run()}
            loading={busy}
            disabled={!valid || future || done || due.length === 0}
          >
            {t('Post depreciation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunsTable({ runs }: { runs: DepreciationRun[] }) {
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const journals = useLiveQuery(
    () => db.journals.bulkGet(runs.flatMap((r) => [r.journalId, r.reversalJournalId ?? ''])),
    [runs],
  );
  const sorted = [...runs].sort(
    (a, b) => b.period.localeCompare(a.period) || b.createdAt.localeCompare(a.createdAt),
  );
  const latest = activeRuns(runs).sort((a, b) => b.period.localeCompare(a.period))[0];
  const number = (id: string | null) => journals?.find((j) => j?.id === id)?.number ?? '';

  const undo = async (run: DepreciationRun) => {
    const month = monthLabel(run.period, company.locale);
    const ok = await confirm({
      title: t('Undo depreciation for {month}?', { month }),
      description: t(
        'A reversing journal is posted, so the history stays in the books. You can run the month again afterwards.',
      ),
      confirmLabel: t('Undo run'),
      danger: true,
    });
    if (!ok) return;
    try {
      await reverseDepreciationRun(run.id);
      toast.success(t('Depreciation for {month} undone', { month }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not undo the run.'));
    }
  };

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock />}
        title={t('No depreciation runs yet')}
        description={t(
          'Run depreciation at the end of each month. Each run posts one journal for every asset in use.',
        )}
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 bg-slate-50/60 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2.5 text-start font-medium">{t('Month')}</th>
            <th className="px-3 py-2.5 text-start font-medium">{t('Journal')}</th>
            <th className="hidden px-3 py-2.5 text-end font-medium sm:table-cell">{t('Assets')}</th>
            <th className="px-3 py-2.5 text-end font-medium">{t('Amount')}</th>
            <th className="px-4 py-2.5 text-end font-medium">
              <span className="sr-only">{t('Actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((run) => (
            <tr key={run.id} className={cn(run.reversedAt && 'text-slate-500')}>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <span
                  className={cn(
                    'font-medium',
                    run.reversedAt ? 'text-slate-500 line-through' : 'text-slate-900',
                  )}
                >
                  {monthLabel(run.period, company.locale)}
                </span>
                {run.reversedAt ? (
                  <Badge tone="gray" className="ms-2">
                    {t('Undone')}
                  </Badge>
                ) : null}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <Link
                  to={`/journals/${run.journalId}`}
                  className="text-primary-700 hover:underline"
                >
                  {number(run.journalId)}
                </Link>
                {run.reversalJournalId ? (
                  <>
                    {' · '}
                    <Link
                      to={`/journals/${run.reversalJournalId}`}
                      className="text-primary-700 hover:underline"
                    >
                      {number(run.reversalJournalId)}
                    </Link>
                  </>
                ) : null}
              </td>
              <td className="tabular hidden px-3 py-2.5 text-end sm:table-cell">
                {fmt.quantity(run.lines.length)}
              </td>
              <td className="tabular px-3 py-2.5 text-end">{fmt.money(run.total)}</td>
              <td className="px-4 py-1.5 text-end">
                {latest?.id === run.id ? (
                  <Button variant="ghost" size="sm" onClick={() => void undo(run)}>
                    <Undo2 /> {t('Undo')}
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The fixed asset register and the monthly depreciation runs. */
export default function AssetsPage() {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const data = useAssetData();
  const bills = useLiveQuery(
    () => db.documents.where('[companyId+type]').equals([company.id, 'bill']).toArray(),
    [company.id],
  );
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'runs' ? 'runs' : 'register';
  const [filter, setFilter] = useState<Filter>('active');
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const p = currencyPrecision(company.currency);

  const unlinked = useMemo(
    () =>
      data && bills
        ? billAssetLines(company, bills, data.accounts, data.assets).filter((l) => !l.assetId)
        : [],
    [company, bills, data],
  );
  if (!data) return <Spinner className="py-24" label={t('Loading…')} />;
  const { assets, runs, accounts } = data;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const live = assets.filter((a) => a.status !== 'void');
  const active = live.filter((a) => a.status === 'active');
  const cost = active.reduce((s, a) => s + toMinor(a.cost, p), 0);
  const depreciated = active.reduce((s, a) => s + postedDepreciation(a, runs, p), 0);
  const q = query.trim().toLowerCase();
  const shown = live
    .filter((a) => filter === 'all' || a.status === filter)
    .filter(
      (a) =>
        !q ||
        `${a.number} ${a.name} ${a.nameAr ?? ''} ${a.serialNumber} ${a.location} ${a.custodian}`
          .toLowerCase()
          .includes(q),
    )
    .sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true }));
  const lastRun = activeRuns(runs).sort((a, b) => b.period.localeCompare(a.period))[0];

  return (
    <div>
      <PageHeader
        title={t('Fixed assets')}
        description={t(
          'Equipment, vehicles, furniture and other things the business keeps for more than a year, and their depreciation.',
        )}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setRunning(true)}
              disabled={active.length === 0}
            >
              <CalendarClock /> {t('Run depreciation')}
            </Button>
            <ButtonLink to="/assets/new">
              <Plus /> {t('New asset')}
            </ButtonLink>
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label={t('Cost of assets in use')} value={fmt.money(fromMinor(cost, p))} />
        <Stat
          label={t('Accumulated depreciation')}
          value={fmt.money(fromMinor(depreciated, p))}
          hint={
            lastRun
              ? t('Depreciation posted up to {date}', { date: isolate(fmt.date(lastRun.date)) })
              : t('No depreciation posted yet')
          }
        />
        <Stat label={t('Book value')} value={fmt.money(fromMinor(cost - depreciated, p))} />
      </div>

      {unlinked.length > 0 ? (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
          <p>
            {tp(
              unlinked.length,
              '{count} bill line was booked to a fixed asset account but is not in the register.',
              '{count} bill lines were booked to fixed asset accounts but are not in the register.',
            )}
          </p>
          <ButtonLink to="/assets/new?source=bill" variant="outline" size="sm">
            {t('Add from a bill')}
          </ButtonLink>
        </div>
      ) : null}

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <Segmented
            value={tab}
            onChange={(next) =>
              setParams(next === 'runs' ? { tab: 'runs' } : {}, { replace: true })
            }
            options={[
              { value: 'register', label: t('Register'), count: live.length },
              { value: 'runs', label: t('Depreciation runs'), count: activeRuns(runs).length },
            ]}
          />
          {tab === 'register' && live.length > 0 ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Segmented
                size="sm"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'active', label: t('In use') },
                  { value: 'disposed', label: t('Disposed of') },
                  { value: 'all', label: t('All') },
                ]}
              />
              <div className="relative sm:w-56">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Search assets…')}
                  aria-label={t('Search assets')}
                  className="ps-9"
                />
              </div>
            </div>
          ) : null}
        </div>
        {tab === 'runs' ? (
          <RunsTable runs={runs} />
        ) : live.length === 0 ? (
          <EmptyState
            icon={<Landmark />}
            title={t('No fixed assets yet')}
            description={t(
              'Add what the business owns, such as computers, furniture or vehicles. Maham Books works out the depreciation every month.',
            )}
            action={
              <ButtonLink to="/assets/new">
                <Plus /> {t('New asset')}
              </ButtonLink>
            }
          />
        ) : shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            {t('No assets match your search.')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{t('Asset')}</th>
                  <th className="hidden px-3 py-2.5 text-start font-medium lg:table-cell">
                    {t('Category')}
                  </th>
                  <th className="hidden px-3 py-2.5 text-start font-medium md:table-cell">
                    {t('Purchase date')}
                  </th>
                  <th className="hidden px-3 py-2.5 text-end font-medium sm:table-cell">
                    {t('Cost')}
                  </th>
                  <th className="px-3 py-2.5 text-end font-medium">{t('Book value')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t('Status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((asset) => (
                  <tr
                    key={asset.id}
                    onClick={() => navigate(`/assets/${asset.id}`)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/assets/${asset.id}`}
                        className="font-medium text-slate-900 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {localName(asset)}
                      </Link>
                      <span className="tabular block text-xs text-slate-500">{asset.number}</span>
                    </td>
                    <td className="hidden px-3 py-2.5 text-slate-600 lg:table-cell">
                      {accountLabel(byId.get(asset.assetAccountId))}
                    </td>
                    <td className="hidden px-3 py-2.5 whitespace-nowrap text-slate-600 md:table-cell">
                      {fmt.date(asset.purchaseDate)}
                    </td>
                    <td className="tabular hidden px-3 py-2.5 text-end sm:table-cell">
                      {fmt.money(asset.cost)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-end font-medium text-slate-900">
                      {asset.status === 'active'
                        ? fmt.money(fromMinor(bookValue(asset, runs, p), p))
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <AssetStatusBadge status={asset.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {running ? <RunDialog onClose={() => setRunning(false)} /> : null}
    </div>
  );
}
