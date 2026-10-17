import { Fragment, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Info,
  Landmark,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { roleMap } from '@/db/accounting';
import { vatSettings } from '@/db/chart-setup';
import { fileVatReturn, recordVatPayment, undoVatReturn } from '@/db/vat';
import type { Company, VatReturnRecord, VatSettings } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { useLedger } from '@/apps/books/features/accounting/use-ledger';
import { SOURCE_LABELS, sourceLink } from '@/apps/books/features/accounting/source-link';
import { MoneyAccountSelect, useAccounts } from '@/apps/books/features/accounting/account-pickers';
import { lineDescription, problemText, type LedgerLine } from '@/lib/accounting/ledger';
import {
  vatBoxLines,
  vatDueDate,
  vatPeriodOf,
  vatPeriods,
  vatReturn,
  type EmirateCode,
  type VatBox,
  type VatContext,
  type VatPeriod,
} from '@/lib/accounting/vat';
import { parseISODate, today } from '@/lib/dates';
import { currencyPrecision, fromMinor } from '@/lib/money';
import { downloadCsv } from '@/lib/csv';
import { cn } from '@/lib/cn';
import { isRtl, msg, t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { tr } from '@/i18n/provider';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardBody, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { Field, Input, Switch } from '@/components/ui/form';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  useConfirm,
} from '@/components/ui/overlay';
import { DateField } from '@/components/ui/date-field';

type VatStatus = 'filed' | 'open' | 'ready' | 'overdue';

const STATUS: Record<VatStatus, { label: string; tone: 'green' | 'gray' | 'amber' | 'red' }> = {
  filed: { label: msg('Filed'), tone: 'green' },
  open: { label: msg('In progress'), tone: 'gray' },
  ready: { label: msg('Ready to file'), tone: 'amber' },
  overdue: { label: msg('Overdue'), tone: 'red' },
};

const OFFICE: Record<VatSettings['format'], string> = {
  uk: msg(
    'Submit the figures to HMRC with your Making Tax Digital software or HMRC online services, then mark the return as filed here.',
  ),
  ae: msg('Submit the figures on the FTA EmaraTax portal, then mark the return as filed here.'),
  generic: msg('Submit the figures to your tax office, then mark the return as filed here.'),
};

/** "October 2026", or "Jul – Sep 2026" for a quarter, in the interface language. */
function periodName(period: VatPeriod, locale: string): string {
  const start = parseISODate(period.start);
  const end = parseISODate(period.end);
  if (period.start.slice(0, 7) === period.end.slice(0, 7)) {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(start);
  }
  return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).formatRange(
    start,
    end,
  );
}

function statusOf(
  period: VatPeriod,
  record: VatReturnRecord | undefined,
  settings: VatSettings,
  now: string,
): VatStatus {
  if (record) return 'filed';
  if (period.end >= now) return 'open';
  return vatDueDate(period, settings.format) < now ? 'overdue' : 'ready';
}

/** The VAT context for a company's ledger. */
function useVatData() {
  const company = useCompany();
  const ledger = useLedger();
  const records = useLiveQuery(
    () => db.vatReturns.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const settings = vatSettings(company);
  const ctx = useMemo<VatContext | null>(
    () =>
      ledger
        ? {
            roles: roleMap(ledger.accounts),
            precision: currencyPrecision(company.currency),
            emirate: (settings.emirate ?? undefined) as EmirateCode | undefined,
          }
        : null,
    [ledger, company.currency, settings.emirate],
  );
  return { company, ledger, records, settings, ctx };
}

function useMinor() {
  const company = useCompany();
  const fmt = useFormat();
  const p = currencyPrecision(company.currency);
  const whole = new Intl.NumberFormat(fmt.locale, {
    style: 'currency',
    currency: company.currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
  return {
    money: (minor: number) => fmt.money(fromMinor(minor, p)),
    whole: (minor: number) => whole.format(fromMinor(minor, p)),
    major: (minor: number) => fromMinor(minor, p),
  };
}

function NotRegistered() {
  return (
    <div>
      <PageHeader title={t('VAT returns')} />
      <Card>
        <EmptyState
          icon={<Landmark />}
          title={t('VAT returns are off')}
          description={t(
            'If your business is registered for VAT, turn returns on and choose how often you file.',
          )}
          action={<ButtonLink to="/settings/accounting">{t('Set up VAT returns')}</ButtonLink>}
        />
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* List                                                                       */
/* -------------------------------------------------------------------------- */

function VatReturnList() {
  const fmt = useFormat();
  const navigate = useNavigate();
  const { ledger, records, settings, ctx } = useVatData();
  const { money } = useMinor();
  const now = today();

  const rows = useMemo(() => {
    if (!ledger || !records || !ctx) return null;
    // From the first transaction (or today) to the current period.
    const first = ledger.lines.reduce((min, l) => (l.date < min ? l.date : min), now);
    const filed = new Map(records.map((r) => [r.periodStart, r]));
    return vatPeriods(settings, first, now)
      .map((period) => {
        const record = filed.get(period.start);
        const net = record ? record.net : vatReturn(ledger.lines, period, settings.format, ctx).net;
        return {
          period,
          record,
          net,
          status: statusOf(period, record, settings, now),
          due: vatDueDate(period, settings.format),
        };
      })
      .reverse();
  }, [ledger, records, ctx, settings, now]);

  if (!rows) return <Spinner className="py-24" label={t('Loading…')} />;
  const next = [...rows].reverse().find((r) => r.status === 'ready' || r.status === 'overdue');

  return (
    <div>
      <PageHeader
        title={t('VAT returns')}
        description={t('Worked out from your invoices, bills and expenses.')}
        actions={
          <ButtonLink to="/settings/accounting" variant="outline">
            {t('VAT settings')}
          </ButtonLink>
        }
      />
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-900">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>{t(OFFICE[settings.format])}</p>
      </div>
      {next ? (
        <Card className="mb-6">
          <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-slate-500">{t('Next return to file')}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {periodName(next.period, fmt.locale)} ·{' '}
                {next.net >= 0
                  ? t('{amount} to pay', { amount: money(next.net) })
                  : t('{amount} to reclaim', { amount: money(-next.net) })}
              </p>
              <p
                className={cn(
                  'text-sm',
                  next.status === 'overdue' ? 'font-medium text-red-600' : 'text-slate-500',
                )}
              >
                {t('Due {date}', { date: fmt.date(next.due) })}
              </p>
            </div>
            <ButtonLink to={`/vat/${next.period.start}`}>{t('Review return')}</ButtonLink>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-start text-xs font-medium tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-3 sm:px-5">{t('Period')}</th>
                <th className="hidden px-3 py-3 sm:table-cell">{t('Due')}</th>
                <th className="px-3 py-3">{t('Status')}</th>
                <th className="px-4 py-3 text-end sm:px-5">{t('VAT')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr
                  key={r.period.start}
                  onClick={() => navigate(`/vat/${r.period.start}`)}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className="px-4 py-3 sm:px-5">
                    <Link
                      to={`/vat/${r.period.start}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-primary-700 font-medium text-slate-900"
                    >
                      {periodName(r.period, fmt.locale)}
                    </Link>
                    <span className="hidden text-xs text-slate-500 sm:block">
                      {fmt.date(r.period.start)} – {fmt.date(r.period.end)}
                    </span>
                    <span
                      className={cn(
                        'block text-xs sm:hidden',
                        r.status === 'overdue' ? 'font-medium text-red-600' : 'text-slate-500',
                      )}
                    >
                      {t('Due {date}', { date: fmt.date(r.due) })}
                    </span>
                  </td>
                  <td
                    className={cn(
                      'hidden px-3 py-3 whitespace-nowrap sm:table-cell',
                      r.status === 'overdue' ? 'font-medium text-red-600' : 'text-slate-600',
                    )}
                  >
                    {fmt.date(r.due)}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={STATUS[r.status].tone}>{t(STATUS[r.status].label)}</Badge>
                    {r.record ? (
                      <span className="ms-2 hidden text-xs text-slate-500 md:inline">
                        {fmt.date(r.record.filedOn)}
                      </span>
                    ) : null}
                  </td>
                  <td className="tabular px-4 py-3 text-end whitespace-nowrap sm:px-5">
                    <span className="font-medium text-slate-900">{money(Math.abs(r.net))}</span>
                    <span className="block text-xs text-slate-500">
                      {r.net >= 0 ? t('to pay') : t('to reclaim')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One return                                                                 */
/* -------------------------------------------------------------------------- */

function FileDialog({
  company,
  period,
  onClose,
}: {
  company: Company;
  period: VatPeriod;
  onClose: () => void;
}) {
  const fmt = useFormat();
  const [filedOn, setFiledOn] = useState(today());
  const [reference, setReference] = useState('');
  const [lock, setLock] = useState(true);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await fileVatReturn(company.id, period, { filedOn, reference, lock });
      toast.success(t('Return marked as filed'));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not file the return.'));
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('Mark as filed')}
        description={t(
          'Record that you submitted this return. The VAT for the period moves to your VAT liability account.',
        )}
      >
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Filed on')}>
              {(id) => (
                <DateField id={id} value={filedOn} onChange={(iso) => iso && setFiledOn(iso)} />
              )}
            </Field>
            <Field label={t('Reference')} optional>
              {(id) => (
                <Input
                  id={id}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={t('Submission receipt')}
                />
              )}
            </Field>
          </div>
          <Switch
            checked={lock}
            onChange={setLock}
            label={t('Lock the period')}
            description={t('Nothing dated on or before {date} can be changed afterwards.', {
              date: fmt.date(period.end),
            })}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {t('Mark as filed')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ record, onClose }: { record: VatReturnRecord; onClose: () => void }) {
  const accounts = useAccounts();
  const { money } = useMinor();
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pay = record.net > 0;
  const save = async () => {
    const bank = accountId ?? accounts?.find((a) => a.role === 'bank')?.id;
    if (!bank) return toast.error(t('Choose the bank account.'));
    setSaving(true);
    try {
      await recordVatPayment(record.id, { date, accountId: bank });
      toast.success(pay ? t('VAT payment recorded') : t('VAT refund recorded'));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not record it.'));
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={pay ? t('Record VAT payment') : t('Record VAT refund')}
        description={
          pay
            ? t('{amount} paid to the tax office.', { amount: money(Math.abs(record.net)) })
            : t('{amount} received from the tax office.', { amount: money(Math.abs(record.net)) })
        }
      >
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Date')}>
              {(id) => <DateField id={id} value={date} onChange={(iso) => iso && setDate(iso)} />}
            </Field>
            <Field label={pay ? t('Paid from') : t('Received into')}>
              {(id) => (
                <MoneyAccountSelect
                  id={id}
                  value={accountId}
                  onChange={setAccountId}
                  accounts={accounts ?? []}
                  use={pay ? 'payment' : 'deposit'}
                />
              )}
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {pay ? t('Record payment') : t('Record refund')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VatReturnDetail({ start }: { start: string }) {
  const fmt = useFormat();
  const confirm = useConfirm();
  const { company, ledger, records, settings, ctx } = useVatData();
  const { money, whole, major } = useMinor();
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const payment = useLiveQuery(async () => {
    const record = records?.find((r) => r.periodStart === start);
    return record?.paymentJournalId
      ? ((await db.journals.get(record.paymentJournalId)) ?? null)
      : null;
  }, [records, start]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'file' | 'pay' | null>(null);

  const period = useMemo(() => vatPeriodOf(start, settings), [start, settings]);
  const live = useMemo(
    () => (ledger && ctx ? vatReturn(ledger.lines, period, settings.format, ctx) : null),
    [ledger, ctx, period, settings.format],
  );
  if (!live || !records || !ledger || !ctx || !clients || payment === undefined)
    return <Spinner className="py-24" label={t('Loading…')} />;

  const record = records.find((r) => r.periodStart === period.start);
  const now = today();
  const status = statusOf(period, record, settings, now);
  const due = vatDueDate(period, settings.format);
  const boxes: VatBox[] = record
    ? record.boxes.map((b) => ({
        ...b,
        total: live.boxes.find((x) => x.id === b.id)?.total,
        whole: live.boxes.find((x) => x.id === b.id)?.whole,
      }))
    : live.boxes;
  const changed = record
    ? live.boxes.filter((b) => {
        const filed = record.boxes.find((x) => x.id === b.id);
        return !filed || filed.amount !== b.amount || (filed.vat ?? 0) !== (b.vat ?? 0);
      })
    : [];
  const hasVat = boxes.some((b) => b.vat !== undefined);
  const net = record ? record.net : live.net;
  const names = new Map(clients.map((c) => [c.id, localName(c)]));
  const problems = ledger.problems.filter((p) =>
    ledger.lines.some(
      (l) => l.sourceId === p.sourceId && l.date >= period.start && l.date <= period.end,
    ),
  );
  const untaxed = [...new Map(live.untaxed.map((l) => [l.sourceId, l])).values()];

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportCsv = () =>
    downloadCsv(
      `vat-return-${period.start}_${period.end}`,
      hasVat
        ? [t('Box'), t('Description'), t('Amount'), t('VAT')]
        : [t('Box'), t('Description'), t('Amount')],
      boxes.map((b) =>
        hasVat
          ? [b.id, t(b.label), major(b.amount), b.vat === undefined ? '' : major(b.vat)]
          : [b.id, t(b.label), major(b.amount)],
      ),
    );

  const undo = async () => {
    const ok = await confirm({
      title: t('Undo this filing?'),
      description: t(
        'The return goes back to “ready to file” and its closing entry (and any payment recorded) is removed.',
      ),
      confirmLabel: t('Undo filing'),
      danger: true,
    });
    if (!ok || !record) return;
    try {
      await undoVatReturn(record.id);
      toast.success(t('Filing undone'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not undo the filing.'));
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-1 text-sm text-slate-500">
            <Link to="/vat" className="hover:text-slate-700">
              {t('VAT returns')}
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {t('VAT return · {period}', { period: periodName(period, fmt.locale) })}
            </h1>
            <Badge tone={STATUS[status].tone}>{t(STATUS[status].label)}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {[
              `${fmt.date(period.start)} – ${fmt.date(period.end)}`,
              t('Due {date}', { date: fmt.date(due) }),
              record
                ? record.reference
                  ? t('Filed {date}, ref. {reference}', {
                      date: fmt.date(record.filedOn),
                      reference: record.reference,
                    })
                  : t('Filed {date}', { date: fmt.date(record.filedOn) })
                : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download /> {t('Export CSV')}
          </Button>
          {record ? (
            <>
              <Button variant="outline" onClick={() => void undo()}>
                <Undo2 /> {t('Undo filing')}
              </Button>
              {net !== 0 && !payment ? (
                <Button onClick={() => setDialog('pay')}>
                  {net > 0 ? t('Record payment') : t('Record refund')}
                </Button>
              ) : null}
            </>
          ) : (
            <Button
              onClick={() => setDialog('file')}
              disabled={period.end >= now}
              title={
                period.end >= now
                  ? t('You can file after {date}.', { date: fmt.date(period.end) })
                  : undefined
              }
            >
              {t('Mark as filed')}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {changed.length ? (
          <Notice tone="amber">
            {tp(
              changed.length,
              'The books changed after this return was filed (box {boxes}). Correct the difference in your next return or with the tax office.',
              'The books changed after this return was filed (boxes {boxes}). Correct the difference in your next return or with the tax office.',
              {
                boxes: new Intl.ListFormat(fmt.locale, { type: 'conjunction' }).format(
                  changed.map((b) => b.id),
                ),
              },
            )}
          </Notice>
        ) : null}
        {untaxed.length ? (
          <Notice tone="amber">
            {tr(
              'Lines without a tax rate in {documents}. Choose a rate (zero-rated, exempt…) so they are reported correctly.',
              {
                documents: untaxed.map((l, i) => (
                  <Fragment key={l.sourceId}>
                    {i > 0 ? (isRtl() ? '، ' : ', ') : ''}
                    <Link to={sourceLink(l)} className="font-medium underline">
                      <bdi>{l.number}</bdi>
                    </Link>
                  </Fragment>
                )),
              },
            )}
          </Notice>
        ) : null}
        {problems.length ? (
          <Notice tone="amber">
            {problems.map((p) => `${p.number}: ${problemText(p)}`).join(' ')}
          </Notice>
        ) : null}

        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr className="text-start text-xs font-medium tracking-wide text-slate-500 uppercase">
                <th className="py-3 ps-4 pe-2 sm:w-20 sm:px-5">{t('Box')}</th>
                <th className="px-3 py-3">{t('Description')}</th>
                <th className="px-3 py-3 text-end">{t('Amount')}</th>
                {hasVat ? (
                  <th className="hidden px-5 py-3 text-end sm:table-cell">{t('VAT')}</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {boxes.map((b) => {
                const expandable = !b.total;
                const isOpen = open.has(b.id);
                const lines = isOpen
                  ? vatBoxLines(ledger.lines, period, settings.format, ctx, b.id)
                  : [];
                return (
                  <Fragment key={b.id}>
                    <tr
                      className={cn(
                        b.total && 'bg-slate-50/60 font-semibold',
                        expandable && 'cursor-pointer hover:bg-slate-50',
                      )}
                      onClick={expandable ? () => toggle(b.id) : undefined}
                    >
                      <td className="py-3 ps-4 pe-2 whitespace-nowrap text-slate-500 sm:px-5">
                        {expandable ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            aria-expanded={isOpen}
                            aria-label={t('Box {box} transactions', { box: b.id })}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(b.id);
                            }}
                          >
                            {isOpen ? (
                              <ChevronDown className="size-3.5" />
                            ) : (
                              <ChevronRight className="size-3.5" />
                            )}
                            {b.id}
                          </button>
                        ) : (
                          <span className="ps-[18px]">{b.id}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-800">{t(b.label)}</td>
                      <td className="tabular px-3 py-3 text-end whitespace-nowrap text-slate-900">
                        {b.whole ? whole(b.amount) : money(b.amount)}
                        {hasVat && b.vat !== undefined ? (
                          <span className="block text-xs font-normal text-slate-500 sm:hidden">
                            {t('VAT {amount}', { amount: money(b.vat) })}
                          </span>
                        ) : null}
                      </td>
                      {hasVat ? (
                        <td className="tabular hidden px-5 py-3 text-end whitespace-nowrap text-slate-900 sm:table-cell">
                          {b.vat === undefined ? '' : money(b.vat)}
                        </td>
                      ) : null}
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colSpan={hasVat ? 4 : 3} className="bg-slate-50/50 px-4 py-3 sm:px-5">
                          {lines.length === 0 ? (
                            <p className="text-sm text-slate-500">{t('Nothing in this box.')}</p>
                          ) : (
                            <BoxLines
                              lines={lines}
                              names={names}
                              money={money}
                              showVat={hasVat}
                              date={fmt.date}
                            />
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-slate-500">
                {net >= 0 ? t('VAT to pay') : t('VAT to reclaim')}
              </p>
              <p className="tabular text-2xl font-semibold text-slate-900">
                {money(Math.abs(net))}
              </p>
            </div>
            <p className="text-sm text-slate-500">
              {record
                ? payment
                  ? net >= 0
                    ? t('Paid on {date}.', { date: fmt.date(payment.date) })
                    : t('Received on {date}.', { date: fmt.date(payment.date) })
                  : net >= 0
                    ? t('Recorded in your VAT liability account until paid.')
                    : t('Recorded in your VAT liability account until refunded.')
                : t(OFFICE[settings.format])}
            </p>
          </CardBody>
        </Card>
      </div>

      {dialog === 'file' ? (
        <FileDialog company={company} period={period} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'pay' && record ? (
        <PaymentDialog record={record} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function Notice({ tone, children }: { tone: 'amber'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 text-sm',
        tone === 'amber' && 'border-amber-200 bg-amber-50 text-amber-900',
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function BoxLines({
  lines,
  names,
  money,
  showVat,
  date,
}: {
  lines: { line: LedgerLine; amount: number; vat: number }[];
  names: Map<string, string>;
  money: (minor: number) => string;
  showVat: boolean;
  date: (value: string) => string;
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-start text-slate-500">
          <th className="py-1.5 pe-3 font-medium">{t('Date')}</th>
          <th className="py-1.5 pe-3 font-medium">{t('Transaction')}</th>
          <th className="hidden py-1.5 pe-3 font-medium sm:table-cell">{t('Contact')}</th>
          <th className="py-1.5 pe-3 text-end font-medium">{t('Amount')}</th>
          {showVat ? <th className="py-1.5 text-end font-medium">{t('VAT')}</th> : null}
        </tr>
      </thead>
      <tbody>
        {lines.map(({ line, amount, vat }, i) => (
          <tr key={`${line.sourceId}-${i}`} className="border-t border-slate-100">
            <td className="py-1.5 pe-3 whitespace-nowrap text-slate-600">{date(line.date)}</td>
            <td className="py-1.5 pe-3">
              <Link to={sourceLink(line)} className="text-primary-700 font-medium hover:underline">
                {t(SOURCE_LABELS[line.source])}{' '}
                <bdi className="whitespace-nowrap">{line.number}</bdi>
              </Link>
              <span className="block text-slate-500">{lineDescription(line)}</span>
            </td>
            <td className="hidden py-1.5 pe-3 text-slate-600 sm:table-cell">
              {line.contactId ? (names.get(line.contactId) ?? '—') : '—'}
            </td>
            <td className="tabular py-1.5 pe-3 text-end text-slate-800">{money(amount)}</td>
            {showVat ? (
              <td className="tabular py-1.5 text-end text-slate-800">{vat ? money(vat) : ''}</td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function VatPage() {
  const { start } = useParams();
  const company = useCompany();
  const settings = vatSettings(company);
  if (!settings.registered) return <NotRegistered />;
  return start ? <VatReturnDetail key={start} start={start} /> : <VatReturnList />;
}
