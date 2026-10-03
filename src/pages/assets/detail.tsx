import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, MoreHorizontal, Pencil, Undo2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import type { FixedAsset, ManualJournal } from '@/db/types';
import { addAttachment, removeAttachment } from '@/db/purchases';
import {
  assetTerms,
  disposalPreview,
  disposeAsset,
  lastDepreciationDate,
  monthLabel,
  postedDepreciation,
  undoDisposal,
  voidAsset,
} from '@/db/assets';
import { useCompany, useFormat } from '@/app/company';
import { AttachmentList } from '@/features/purchases/attachments';
import { depreciationSchedule, decliningRateOf } from '@/lib/accounting/depreciation';
import { journalKind } from '@/lib/accounting/journal-kinds';
import { accountGroup } from '@/lib/accounting/account-types';
import { currencyPrecision, fromMinor, toMinor } from '@/lib/money';
import { today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Spinner } from '@/components/ui/misc';
import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  useConfirm,
} from '@/components/ui/overlay';
import {
  accountLabel,
  AssetStatusBadge,
  byCode,
  lifeText,
  METHOD_LABELS,
  SOURCE_LABELS,
  useAssetData,
} from './shared';
import { isolate } from '@/features/reports/report-language';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800">{children || '—'}</dd>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={cn('tabular', strong ? 'font-semibold text-slate-900' : 'text-slate-700')}>
        {value}
      </span>
    </div>
  );
}

function DisposeDialog({ asset, onClose }: { asset: FixedAsset; onClose: () => void }) {
  const company = useCompany();
  const fmt = useFormat();
  const data = useAssetData();
  const [date, setDate] = useState(today());
  const [proceeds, setProceeds] = useState(0);
  const [depositAccountId, setDeposit] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const p = currencyPrecision(company.currency);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= asset.purchaseDate;
  const preview = valid ? disposalPreview(asset, data.runs, { date, proceeds }, p) : null;
  const deposits = data.accounts
    .filter(
      (a) =>
        !a.archived &&
        accountGroup(a.type) === 'asset' &&
        (a.type === 'asset_cash' || a.type === 'asset_receivable' || a.type === 'asset_current'),
    )
    .sort(byCode);
  const money = (minor: number) => fmt.money(fromMinor(minor, p));

  const submit = async () => {
    setBusy(true);
    try {
      await disposeAsset(asset.id, {
        date,
        proceeds,
        depositAccountId: depositAccountId || null,
        notes,
      });
      toast.success(t('{name} disposed of', { name: localName(asset) }));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not dispose of the asset.'));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('Dispose of {name}', { name: localName(asset) })}
        description={t(
          'Sold, scrapped or written off. Depreciation is charged up to the date, and the gain or loss is posted.',
        )}
      >
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Date')}>
              {(id) => (
                <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              )}
            </Field>
            <Field label={t('Sale price')} hint={t('Leave at zero if it was scrapped.')}>
              {(id) => (
                <NumberInput
                  id={id}
                  value={proceeds}
                  allowNegative={false}
                  blankZero
                  onValueChange={setProceeds}
                />
              )}
            </Field>
            {proceeds > 0 ? (
              <Field label={t('Money received in')} className="sm:col-span-2">
                {(id) => (
                  <Select
                    id={id}
                    value={depositAccountId}
                    onChange={(e) => setDeposit(e.target.value)}
                  >
                    <option value="">{t('Choose an account…')}</option>
                    {deposits.map((a) => (
                      <option key={a.id} value={a.id}>
                        {accountLabel(a)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            <Field label={t('Notes')} optional className="sm:col-span-2">
              {(id) => (
                <Textarea
                  id={id}
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              )}
            </Field>
          </div>
          {preview ? (
            <div className="rounded-lg bg-slate-50 px-4 py-2">
              <Figure label={t('Depreciation to the date')} value={money(preview.depreciation)} />
              <Figure label={t('Cost')} value={money(preview.cost)} />
              <Figure label={t('Accumulated depreciation')} value={money(preview.accumulated)} />
              <Figure label={t('Book value')} value={money(preview.bookValue)} />
              <Figure label={t('Sale price')} value={money(preview.proceeds)} />
              <div className="border-t border-slate-200">
                <Figure
                  label={preview.gain >= 0 ? t('Gain on disposal') : t('Loss on disposal')}
                  value={money(Math.abs(preview.gain))}
                  strong
                />
              </div>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={busy} disabled={!valid}>
            {t('Dispose of asset')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One fixed asset: its figures, depreciation schedule, entries and files. */
export default function AssetDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const data = useAssetData();
  const asset = useLiveQuery(async () => (await db.assets.get(id)) ?? null, [id]);
  const journals = useLiveQuery(
    async () =>
      (await db.journals.where('companyId').equals(company.id).toArray()).filter(
        (j) => j.sourceId === id,
      ),
    [company.id, id],
  );
  const runJournals = useLiveQuery(
    async () => (data ? db.journals.bulkGet(data.runs.map((r) => r.journalId)) : []),
    [data?.runs],
  );
  const files = useLiveQuery(() => db.attachments.where('ownerId').equals(id).toArray(), [id]);
  const [disposing, setDisposing] = useState(false);
  const [fullSchedule, setFullSchedule] = useState(false);

  if (asset === undefined || !data || !journals || !files) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }
  if (!asset) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">{t('This asset could not be found.')}</p>
        <Link to="/assets" className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {t('Back to fixed assets')}
        </Link>
      </Card>
    );
  }
  const p = currencyPrecision(company.currency);
  const money = (minor: number) => fmt.money(fromMinor(minor, p));
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const posted = postedDepreciation(asset, data.runs, p);
  const cost = toMinor(asset.cost, p);
  const last = lastDepreciationDate(asset, data.runs);
  const schedule = depreciationSchedule(assetTerms(asset), p);
  const shownSchedule = fullSchedule ? schedule : schedule.slice(0, 12);
  const runOf = new Map(
    data.runs
      .filter((r) => !r.reversedAt)
      .flatMap((r) => r.lines.map((l) => [`${r.period}:${l.assetId}`, r])),
  );
  const entries: { journal: ManualJournal; amount: number }[] = [
    ...journals.map((j) => ({
      journal: j,
      amount: j.lines.reduce((s, l) => s + l.debit, 0),
    })),
    ...data.runs
      .filter((r) => r.lines.some((l) => l.assetId === asset.id && l.amount !== 0))
      .flatMap((r) => {
        const journal = runJournals?.find((j) => j?.id === r.journalId);
        const amount = r.lines.find((l) => l.assetId === asset.id)?.amount ?? 0;
        return journal ? [{ journal, amount }] : [];
      }),
  ].sort((a, b) => b.journal.date.localeCompare(a.journal.date));

  const remove = async () => {
    const ok = await confirm({
      title: t('Void {name}?', { name: localName(asset) }),
      description: t(
        'Use this for an asset entered by mistake. Its purchase entry is reversed and it leaves the register; the history stays in the books.',
      ),
      confirmLabel: t('Void asset'),
      danger: true,
    });
    if (!ok) return;
    try {
      await voidAsset(asset.id);
      toast.success(t('Asset {number} voided', { number: asset.number }));
      navigate('/assets');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not void the asset.'));
    }
  };
  const undo = async () => {
    const ok = await confirm({
      title: t('Undo the disposal?'),
      description: t('A reversing journal is posted and the asset is back in use.'),
      confirmLabel: t('Undo disposal'),
    });
    if (!ok) return;
    try {
      await undoDisposal(asset.id);
      toast.success(t('Disposal undone'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not undo the disposal.'));
    }
  };

  const source = (() => {
    if (asset.source === 'bill' && asset.billId)
      return (
        <Link to={`/bills/${asset.billId}`} className="text-primary-700 hover:underline">
          {t('Open the bill')}
        </Link>
      );
    if (asset.source === 'purchase')
      return t('Paid from {account}', {
        account: accountLabel(accounts.get(asset.paidFromAccountId ?? '')),
      });
    return t(SOURCE_LABELS[asset.source].label);
  })();

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-sm text-slate-500">
            <Link to="/assets" className="hover:text-slate-700">
              {t('Fixed assets')}
            </Link>
          </p>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight text-slate-900">
            <span className="truncate">{localName(asset)}</span>
            <AssetStatusBadge status={asset.status} />
          </h1>
          <p className="tabular mt-1 text-sm text-slate-500">{asset.number}</p>
        </div>
        {asset.status !== 'void' ? (
          <div className="flex flex-wrap items-center gap-2">
            {asset.status === 'active' ? (
              <Button variant="outline" onClick={() => setDisposing(true)}>
                <Trash2 /> {t('Dispose of')}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => void undo()}>
                <Undo2 /> {t('Undo disposal')}
              </Button>
            )}
            <ButtonLink to={`/assets/${asset.id}/edit`}>
              <Pencil /> {t('Edit')}
            </ButtonLink>
            {asset.status === 'active' && !last ? (
              <DropdownMenu>
                <DropdownTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('More actions')}>
                    <MoreHorizontal />
                  </Button>
                </DropdownTrigger>
                <DropdownContent>
                  <DropdownItem icon={<Ban />} danger onSelect={() => void remove()}>
                    {t('Void asset')}
                  </DropdownItem>
                </DropdownContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('Details')} />
            <CardBody>
              <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label={t('Asset account')}>
                  {accountLabel(accounts.get(asset.assetAccountId))}
                </Detail>
                <Detail label={t('Purchase date')}>{fmt.date(asset.purchaseDate)}</Detail>
                <Detail label={t('Bought')}>{source}</Detail>
                <Detail label={t('Depreciation method')}>
                  {asset.method === 'declining_balance'
                    ? t('{method}, {rate} a year', {
                        method: t(METHOD_LABELS[asset.method]),
                        rate: fmt.percent(decliningRateOf(asset)),
                      })
                    : t(METHOD_LABELS[asset.method])}
                </Detail>
                <Detail label={t('Useful life')}>{lifeText(asset.usefulLifeMonths)}</Detail>
                <Detail label={t('Depreciation starts')}>
                  {fmt.date(asset.depreciationStart)}
                </Detail>
                <Detail label={t('Accumulated depreciation account')}>
                  {accountLabel(accounts.get(asset.accumulatedAccountId))}
                </Detail>
                <Detail label={t('Depreciation expense account')}>
                  {accountLabel(accounts.get(asset.expenseAccountId))}
                </Detail>
                <Detail label={t('Serial number')}>{asset.serialNumber}</Detail>
                <Detail label={t('Location')}>{asset.location}</Detail>
                <Detail label={t('Custodian')}>{asset.custodian}</Detail>
                {asset.nameAr && asset.nameAr !== localName(asset) ? (
                  <Detail label={t('Name in Arabic')}>
                    <span dir="rtl" lang="ar">
                      {asset.nameAr}
                    </span>
                  </Detail>
                ) : null}
              </dl>
              {asset.description || asset.notes ? (
                <p className="mt-5 text-sm whitespace-pre-line text-slate-600">
                  {[asset.description, asset.notes].filter(Boolean).join('\n')}
                </p>
              ) : null}
            </CardBody>
          </Card>

          {asset.disposal ? (
            <Card>
              <CardHeader
                title={t('Disposal')}
                description={t('On {date}', { date: isolate(fmt.date(asset.disposal.date)) })}
              />
              <CardBody className="grid gap-x-8 sm:grid-cols-2">
                <Figure label={t('Sale price')} value={fmt.money(asset.disposal.proceeds)} />
                <Figure
                  label={asset.disposal.gain >= 0 ? t('Gain on disposal') : t('Loss on disposal')}
                  value={fmt.money(Math.abs(asset.disposal.gain))}
                  strong
                />
                <Figure
                  label={t('Depreciation to the date')}
                  value={fmt.money(asset.disposal.depreciation)}
                />
              </CardBody>
            </Card>
          ) : null}

          {asset.status === 'active' ? (
            <Card>
              <CardHeader
                title={t('Depreciation schedule')}
                description={t('Month by month until the end of its useful life.')}
              />
              {schedule.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">{t('Fully depreciated.')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-100 bg-slate-50/60 text-xs text-slate-500">
                      <tr>
                        <th className="px-5 py-2 text-start font-medium">{t('Month')}</th>
                        <th className="px-3 py-2 text-end font-medium">{t('Depreciation')}</th>
                        <th className="hidden px-3 py-2 text-end font-medium sm:table-cell">
                          {t('Accumulated')}
                        </th>
                        <th className="px-5 py-2 text-end font-medium">{t('Book value')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {shownSchedule.map((row) => (
                        <tr key={row.period}>
                          <td className="px-5 py-2 whitespace-nowrap text-slate-700">
                            {monthLabel(row.period, company.locale)}
                            {runOf.has(`${row.period}:${asset.id}`) ? (
                              <Badge tone="green" className="ms-2">
                                {t('Posted')}
                              </Badge>
                            ) : null}
                          </td>
                          <td className="tabular px-3 py-2 text-end">{money(row.charge)}</td>
                          <td className="tabular hidden px-3 py-2 text-end text-slate-600 sm:table-cell">
                            {money(row.accumulated)}
                          </td>
                          <td className="tabular px-5 py-2 text-end text-slate-900">
                            {money(row.bookValue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {schedule.length > 12 ? (
                    <div className="border-t border-slate-100 px-5 py-2">
                      <Button variant="ghost" size="sm" onClick={() => setFullSchedule((v) => !v)}>
                        {fullSchedule ? t('Show less') : t('Show the whole schedule')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </Card>
          ) : null}

          <Card>
            <CardHeader title={t('Entries')} description={t('Journals that record this asset.')} />
            {entries.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">{t('Nothing posted yet.')}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {entries.map(({ journal, amount }) => {
                  const kind = journalKind(journal);
                  return (
                    <li
                      key={journal.id}
                      className="flex items-center justify-between gap-3 px-5 py-2.5"
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <Link
                          to={`/journals/${journal.id}`}
                          className="text-primary-700 font-medium hover:underline"
                        >
                          {journal.number}
                        </Link>
                        <span className="text-slate-500">{fmt.date(journal.date)}</span>
                        {kind ? <Badge tone={kind.tone}>{t(kind.label)}</Badge> : null}
                        {journal.reversalOf ? <Badge tone="gray">{t('Reversal')}</Badge> : null}
                      </span>
                      <span className="tabular shrink-0 text-slate-900">{fmt.money(amount)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title={t('Files')} />
            <CardBody>
              <AttachmentList
                files={files}
                onAdd={(file) => addAttachment(company.id, asset.id, file)}
                onRemove={(fileId) => removeAttachment(fileId)}
                emptyText={t('Keep the invoice, warranty or photos with the asset.')}
              />
            </CardBody>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title={t('Value')} />
          <CardBody className="divide-y divide-slate-100 py-2">
            <Figure label={t('Cost')} value={money(cost)} />
            <Figure label={t('Salvage value')} value={fmt.money(asset.salvageValue)} />
            <Figure
              label={t('Accumulated depreciation')}
              value={asset.status === 'active' ? money(posted) : '—'}
            />
            <Figure
              label={t('Book value')}
              value={asset.status === 'active' ? money(cost - posted) : '—'}
              strong
            />
            <p className="pt-3 text-xs text-slate-500">
              {last
                ? t('Depreciation posted up to {date}', { date: isolate(fmt.date(last)) })
                : t('No depreciation posted yet')}
            </p>
          </CardBody>
        </Card>
      </div>
      {disposing ? <DisposeDialog asset={asset} onClose={() => setDisposing(false)} /> : null}
    </div>
  );
}
