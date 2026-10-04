import { useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CalendarCheck, CheckCircle2, Info, Lock, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import type { YearEndLineKind } from '@/db/types';
import { closeYear, reopenYear } from '@/db/accounting';
import { activeRuns, monthLabel } from '@/db/assets';
import { accountingSettings } from '@/db/chart-setup';
import { useCompany, useFormat } from '@/app/company';
import { useLedger } from '@/features/accounting/use-ledger';
import { today } from '@/lib/dates';
import { currencyPrecision, fromMinor, toMinor } from '@/lib/money';
import { kuwaitProfile, LEGAL_FORMS } from '@/lib/kuwait-rules';
import { periodOf } from '@/lib/accounting/depreciation';
import { specialAccounts } from '@/lib/accounting/statements';
import {
  financialYearLabel,
  financialYears,
  foreignShare,
  levyRates,
  YEAR_END_LABELS,
  yearEndFigures,
  type YearEndProposal,
} from '@/lib/accounting/year-end';
import { currentLanguage, t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, PageHeader, Spinner } from '@/components/ui/misc';
import { Checkbox, Field, NumberInput, Select } from '@/components/ui/form';
import { useConfirm } from '@/components/ui/overlay';
import { isolate } from '@/features/reports/report-language';

/** Why each line is proposed, in plain words. */
function explanation(
  p: YearEndProposal,
  money: (minor: number) => string,
  percent: (n: number) => string,
  capital: number,
  capitalCap: number,
): string {
  switch (p.kind) {
    case 'statutory_reserve':
      if (p.room === null || p.room === undefined)
        return t(
          '{rate} of the profit. Enter the capital in the company profile to apply the limit.',
          {
            rate: percent(p.rate),
          },
        );
      return p.room === 0
        ? t('The reserve has reached {cap} of the capital ({capital}), so no transfer is needed.', {
            cap: percent(capitalCap),
            capital: money(capital),
          })
        : t(
            '{rate} of the profit, until the reserve reaches {cap} of the capital. Room left: {room}.',
            {
              rate: percent(p.rate),
              cap: percent(capitalCap),
              room: money(p.room),
            },
          );
    case 'voluntary_reserve':
      return t('Optional, as decided by the partners or the general assembly.');
    case 'kfas':
      return t('{rate} of the profit after the statutory reserve and losses brought forward.', {
        rate: percent(p.rate),
      });
    case 'zakat':
      return t('{rate} of the profit (Law 46/2006).', { rate: percent(p.rate) });
    case 'nlst':
      return t('{rate} of the profit of listed companies (Law 19/2000).', {
        rate: percent(p.rate),
      });
    case 'income_tax':
      return t('{rate} of the foreign-owned share of the profit ({base}).', {
        rate: percent(p.rate),
        base: money(p.base),
      });
  }
}

export default function YearEndPage() {
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const ledger = useLedger();
  const closes = useLiveQuery(
    () => db.yearEnds.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const runs = useLiveQuery(
    () => db.depreciationRuns.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const assetCount = useLiveQuery(
    () =>
      db.assets
        .where('companyId')
        .equals(company.id)
        .filter((a) => a.status === 'active')
        .count(),
    [company.id],
  );
  const settings = accountingSettings(company);
  const profile = kuwaitProfile(company);
  const rates = levyRates(settings);
  const p = currencyPrecision(company.currency);
  const money = (minor: number) => fmt.money(fromMinor(minor, p));

  // Financial years from the first entry to the current one.
  const years = financialYears(ledger?.lines[0]?.date, settings.fiscalYearEnd, today());
  const [chosen, setChosen] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Partial<Record<YearEndLineKind, number>>>({});
  const [lock, setLock] = useState(true);
  const [busy, setBusy] = useState(false);

  const closedYears = new Set(
    (closes ?? []).filter((c) => c.status === 'closed').map((c) => c.yearEnd),
  );
  const year =
    years.find((y) => y.to === chosen) ??
    years.find((y) => y.to < today() && !closedYears.has(y.to)) ??
    years[0];
  const close = closes?.find((c) => c.status === 'closed' && c.yearEnd === year?.to);
  // A closed year is shown without its own entries, as it was closed.
  const figures =
    ledger && year
      ? yearEndFigures({
          lines: ledger.lines,
          accounts: ledger.accounts,
          special: specialAccounts(ledger.accounts, settings.template),
          fiscalYearEnd: settings.fiscalYearEnd,
          date: year.to,
          profile,
          precision: p,
          rates,
          exclude: new Set(close?.journalIds ?? []),
        })
      : null;

  if (!ledger || !closes || !runs || assetCount === undefined || !figures || !year) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }
  const label = financialYearLabel(year.from, year.to);
  const form = LEGAL_FORMS.find((f) => f.value === profile.legalForm);
  const formName = form ? (currentLanguage() === 'ar' ? form.labelAr : t(form.label)) : '';
  const applies = figures.proposals.filter((x) => x.applies);
  const amountOf = (x: YearEndProposal) =>
    close
      ? toMinor(close.lines.find((l) => l.kind === x.kind)?.amount ?? 0, p)
      : toMinor(amounts[x.kind] ?? fromMinor(x.amount, p), p);
  const levies = applies.filter(
    (x) => x.kind !== 'statutory_reserve' && x.kind !== 'voluntary_reserve',
  );
  const totalLevies = levies.reduce((s, x) => s + amountOf(x), 0);
  const ended = year.to < today();
  const lastMonth = periodOf(year.to);
  const depreciationMissing =
    assetCount > 0 && !activeRuns(runs).some((r) => r.period >= lastMonth);
  const lockedByDate = Boolean(settings.lockDate && settings.lockDate >= year.to);
  const laterClosed = closes.some((c) => c.status === 'closed' && c.yearEnd > year.to);

  const submit = async () => {
    const ok = await confirm({
      title: t('Close {year}?', { year: label }),
      description: lock
        ? t('The entries are dated {date} and the books are locked up to that date.', {
            date: isolate(fmt.date(year.to)),
          })
        : t('The entries are dated {date}.', { date: isolate(fmt.date(year.to)) }),
      confirmLabel: t('Close the year'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await closeYear(company.id, {
        yearStart: year.from,
        yearEnd: year.to,
        profitBeforeLevies: fromMinor(figures.profitBeforeLevies, p),
        lines: applies.map((x) => ({
          kind: x.kind,
          base: fromMinor(x.base, p),
          rate: x.rate,
          amount: fromMinor(amountOf(x), p),
        })),
        lock,
      });
      setAmounts({});
      toast.success(t('Financial year {year} closed', { year: label }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not close the year.'));
    } finally {
      setBusy(false);
    }
  };
  const reopen = async () => {
    if (!close) return;
    const ok = await confirm({
      title: t('Reopen {year}?', { year: label }),
      description: t(
        'Reversing entries undo the levies and the transfers to reserves. The original entries stay in the books.',
      ),
      confirmLabel: t('Reopen'),
      danger: true,
    });
    if (!ok) return;
    try {
      await reopenYear(close.id);
      toast.success(t('Financial year {year} reopened', { year: label }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not reopen the year.'));
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link to="/reports" className="hover:text-slate-700">
            {t('Reports')}
          </Link>
        }
        title={t('Year-end close')}
        description={t(
          'Works out the statutory reserve and the levies on the profit for the year, posts them and locks the year.',
        )}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <Field label={t('Financial year')} className="sm:w-56">
                {(id) => (
                  <Select
                    id={id}
                    value={year.to}
                    onChange={(e) => {
                      setChosen(e.target.value);
                      setAmounts({});
                    }}
                  >
                    {years.map((y) => (
                      <option key={y.to} value={y.to}>
                        {financialYearLabel(y.from, y.to)}
                        {closedYears.has(y.to) ? ` · ${t('Closed')}` : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <p className="text-sm text-slate-500">
                <bdi>{fmt.date(year.from)}</bdi> – <bdi>{fmt.date(year.to)}</bdi>
              </p>
            </CardBody>
          </Card>

          {!ended && !close ? (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <Info className="mt-0.5 size-4 shrink-0" />
              {t('This year ends on {date}. Close it once its figures are final.', {
                date: isolate(fmt.date(year.to)),
              })}
            </p>
          ) : null}
          {depreciationMissing && !close ? (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {t('Depreciation has not been run for {month} yet.', {
                  month: monthLabel(lastMonth, company.locale),
                })}{' '}
                <Link to="/assets?tab=runs" className="font-medium underline">
                  {t('Run depreciation')}
                </Link>
              </span>
            </p>
          ) : null}

          <Card>
            <CardHeader
              title={t('Profit for {year}', { year: label })}
              description={t('Before KFAS, Zakat, NLST and income tax.')}
              actions={
                <span
                  className={`tabular text-lg font-semibold ${figures.profitBeforeLevies < 0 ? 'text-red-600' : 'text-slate-900'}`}
                >
                  {money(figures.profitBeforeLevies)}
                </span>
              }
            />
            <CardBody className="space-y-4">
              {figures.profitBeforeLevies <= 0 ? (
                <p className="text-sm text-slate-600">
                  {t(
                    'There is no profit this year, so nothing is due. You can still close the year to lock it.',
                  )}
                </p>
              ) : null}
              <ul className="divide-y divide-slate-100">
                {applies.map((x) => (
                  <li
                    key={x.kind}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {t(YEAR_END_LABELS[x.kind])}
                      </p>
                      <p className="text-xs text-slate-500">
                        {explanation(
                          x,
                          money,
                          fmt.percent,
                          figures.capital,
                          rates.statutoryReserveCap,
                        )}
                      </p>
                    </div>
                    <div className="sm:w-44">
                      <NumberInput
                        aria-label={t(YEAR_END_LABELS[x.kind])}
                        value={fromMinor(amountOf(x), p)}
                        allowNegative={false}
                        disabled={Boolean(close)}
                        onValueChange={(n) => setAmounts((a) => ({ ...a, [x.kind]: n }))}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              {levies.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {t(
                    'KFAS and Zakat apply to shareholding companies, NLST to listed ones, and income tax to foreign-owned profits. None apply to this company.',
                  )}
                </p>
              ) : null}
              <p className="flex items-start gap-2 text-xs text-slate-500">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {t(
                    'Rates follow Kuwaiti law. Check the amounts with your auditor before posting.',
                  )}{' '}
                  <Link to="/settings/accounting" className="underline">
                    {t('Change the rates')}
                  </Link>
                </span>
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              {close ? (
                <>
                  <p className="flex items-center gap-2 text-sm text-emerald-700">
                    <CheckCircle2 className="size-4" />
                    {t('Closed on {date}', { date: isolate(fmt.dateTime(close.createdAt)) })}
                    {close.lockedTo ? (
                      <Badge tone="gray">
                        <Lock className="size-3" /> {t('Locked')}
                      </Badge>
                    ) : null}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => void reopen()}
                    disabled={lockedByDate || laterClosed}
                  >
                    <Undo2 /> {t('Reopen')}
                  </Button>
                </>
              ) : (
                <>
                  <Checkbox
                    checked={lock}
                    onChange={(e) => setLock(e.target.checked)}
                    label={t('Lock the books up to {date}', { date: isolate(fmt.date(year.to)) })}
                    description={t('Nothing dated on or before it can be changed afterwards.')}
                  />
                  <Button onClick={() => void submit()} loading={busy} disabled={laterClosed}>
                    <CalendarCheck /> {t('Close {year}', { year: label })}
                  </Button>
                </>
              )}
            </CardBody>
            {close && (lockedByDate || laterClosed) ? (
              <p className="px-5 pb-4 text-xs text-slate-500">
                {laterClosed
                  ? t('Reopen the later years first.')
                  : t('To reopen the year, remove the lock date in Settings → Accounting first.')}
              </p>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title={t('Company')} />
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">{t('Legal form')}</span>
                <span className="text-end text-slate-900">{formName}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">{t('Paid-up capital')}</span>
                <span className="tabular text-slate-900">
                  {figures.capital > 0 ? money(figures.capital) : '—'}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">{t('Foreign ownership')}</span>
                <span className="tabular text-slate-900">
                  {fmt.percent(foreignShare(profile.legalForm, profile.foreignOwnershipPercent))}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">{t('Statutory reserve')}</span>
                <span className="tabular text-slate-900">{money(figures.statutoryReserve)}</span>
              </div>
              {figures.lossesBroughtForward > 0 ? (
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">{t('Losses brought forward')}</span>
                  <span className="tabular text-slate-900">
                    {money(figures.lossesBroughtForward)}
                  </span>
                </div>
              ) : null}
              <div className="flex justify-between gap-3 border-t border-slate-100 pt-2 font-medium">
                <span className="text-slate-700">{t('Levies and tax')}</span>
                <span className="tabular text-slate-900">{money(totalLevies)}</span>
              </div>
              <p className="pt-2 text-xs text-slate-500">
                {figures.capitalSource === 'books'
                  ? t('The capital is taken from the capital account.')
                  : null}{' '}
                <Link to="/settings/company" className="underline">
                  {t('Edit the company profile')}
                </Link>
              </p>
            </CardBody>
          </Card>
          {closes.length > 0 ? (
            <Card>
              <CardHeader title={t('Closed years')} />
              <ul className="divide-y divide-slate-100 text-sm">
                {[...closes]
                  .sort((a, b) => b.yearEnd.localeCompare(a.yearEnd))
                  .map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <button
                        type="button"
                        className="font-medium text-slate-900 hover:underline"
                        onClick={() => setChosen(c.yearEnd)}
                      >
                        {financialYearLabel(c.yearStart, c.yearEnd)}
                      </button>
                      <Badge tone={c.status === 'closed' ? 'green' : 'gray'}>
                        {c.status === 'closed' ? t('Closed') : t('Reopened')}
                      </Badge>
                    </li>
                  ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
