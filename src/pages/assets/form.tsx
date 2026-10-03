import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import type { Account, AssetSource, DepreciationMethod, FixedAsset } from '@/db/types';
import {
  assetTerms,
  billAssetLines,
  createAsset,
  lastDepreciationDate,
  monthLabel,
  saveAsset,
} from '@/db/assets';
import { accountingSettings } from '@/db/chart-setup';
import { useCompany, useFormat } from '@/app/company';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { AttachmentList, useDraftAttachments } from '@/features/purchases/attachments';
import { decliningRateOf, depreciationSchedule } from '@/lib/accounting/depreciation';
import { isMoneyAccount } from '@/lib/accounting/account-types';
import { currencyPrecision, fromMinor } from '@/lib/money';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Segmented, Spinner } from '@/components/ui/misc';
import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';
import {
  accountLabel,
  accumulatedAccounts,
  byCode,
  categoryAccounts,
  expenseAccounts,
  lifeText,
  METHOD_LABELS,
  SOURCE_LABELS,
  suggestAccumulated,
  suggestExpense,
  useAssetData,
} from './shared';
import { DateField } from '@/components/ui/date-field';

const SOURCES: AssetSource[] = ['purchase', 'bill', 'opening', 'existing'];

function AccountSelect({
  id,
  value,
  accounts,
  onChange,
  disabled,
  placeholder,
}: {
  id: string;
  value: string;
  accounts: Account[];
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder ?? t('Choose an account…')}</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {accountLabel(a)}
        </option>
      ))}
    </Select>
  );
}

function Editor({
  initial,
  isNew,
  chart,
}: {
  initial: FixedAsset;
  isNew: boolean;
  /** The chart of accounts as loaded, for the defaults of a new asset. */
  chart: Account[];
}) {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const data = useAssetData();
  const bills = useLiveQuery(
    () => db.documents.where('[companyId+type]').equals([company.id, 'bill']).toArray(),
    [company.id],
  );
  // New assets start with the usual expense account and the bank.
  const [base] = useState(() => {
    if (!isNew) return initial;
    const bank = chart.find((a) => a.role === 'bank');
    return {
      ...initial,
      expenseAccountId:
        initial.expenseAccountId ||
        (suggestExpense(chart, accountingSettings(company).template)?.id ?? ''),
      paidFromAccountId: initial.paidFromAccountId ?? bank?.id ?? null,
    };
  });
  const [asset, setAsset] = useState(base);
  const [saving, setSaving] = useState(false);
  const attachments = useDraftAttachments(asset.id);
  const dirty = JSON.stringify(asset) !== JSON.stringify(base) || attachments.dirty;
  const allowNavigation = useUnsavedGuard(dirty && !saving);
  const p = currencyPrecision(company.currency);

  const lines = useMemo(
    () => (data && bills ? billAssetLines(company, bills, data.accounts, data.assets) : []),
    [company, bills, data],
  );
  const preview = useMemo(() => {
    if (!(asset.cost > asset.salvageValue) || !(asset.usefulLifeMonths > 0)) return null;
    if (!asset.depreciationStart) return null;
    const rows = depreciationSchedule(assetTerms(asset), p);
    return rows.length ? rows : null;
  }, [asset, p]);
  if (!data || !bills) return <Spinner className="py-24" label={t('Loading…')} />;

  const { accounts, runs } = data;
  const locked =
    !isNew && (asset.status === 'disposed' || Boolean(lastDepreciationDate(initial, runs)));
  const update = (patch: Partial<FixedAsset>) => setAsset((a) => ({ ...a, ...patch }));
  const setCategory = (assetAccountId: string) =>
    update({
      assetAccountId,
      accumulatedAccountId:
        suggestAccumulated(accounts, assetAccountId)?.id ?? asset.accumulatedAccountId,
    });
  const money = accounts
    .filter((a) => isMoneyAccount(a.type) && (!a.archived || a.id === asset.paidFromAccountId))
    .sort(byCode);
  const lineOptions = lines
    .filter((l) => !l.assetId || l.line.id === asset.billLineId)
    .map((l) => ({
      value: l.line.id,
      label: `${l.bill.number} · ${localName(l.line) || t('Line')}`,
      detail: fmt.money(l.cost),
      keywords: `${l.bill.vendorReference ?? ''} ${l.line.description}`,
    }));
  const chooseLine = (lineId: string) => {
    const found = lines.find((l) => l.line.id === lineId);
    if (!found) return;
    update({
      billId: found.bill.id,
      billLineId: found.line.id,
      name: asset.name || found.line.name,
      nameAr: asset.nameAr || found.line.nameAr,
      description: asset.description || found.line.description,
      cost: found.cost,
      purchaseDate: found.bill.issueDate,
      depreciationStart: found.bill.issueDate,
      assetAccountId: found.accountId,
      accumulatedAccountId:
        suggestAccumulated(accounts, found.accountId)?.id ?? asset.accumulatedAccountId,
      vendorId: found.bill.clientId || null,
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveAsset(asset);
      await attachments.commit(company.id);
      toast.success(t('Asset {number} saved', { number: saved.number }));
      allowNavigation();
      navigate(`/assets/${saved.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the asset.'));
      setSaving(false);
    }
  };

  const monthly = preview ? (preview[1] ?? preview[0]).charge : 0;
  const defaultRate = decliningRateOf({
    decliningRate: null,
    usefulLifeMonths: asset.usefulLifeMonths,
  });

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-sm text-slate-500">
            <Link to="/assets" className="hover:text-slate-700">
              {t('Fixed assets')}
            </Link>
          </p>
          <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900">
            {isNew ? t('New asset') : t('Edit {name}', { name: localName(initial) })}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => navigate(isNew ? '/assets' : `/assets/${asset.id}`)}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {t('Save asset')}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('Asset')} />
            <CardBody className="grid gap-4 md:grid-cols-2">
              <Field label={t('Name')}>
                {(id) => (
                  <Input
                    id={id}
                    value={asset.name}
                    onChange={(e) => update({ name: e.target.value })}
                    autoFocus={isNew}
                  />
                )}
              </Field>
              <Field label={t('Name in Arabic')} optional>
                {(id) => (
                  <Input
                    id={id}
                    dir="rtl"
                    lang="ar"
                    value={asset.nameAr ?? ''}
                    onChange={(e) => update({ nameAr: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('Asset number')} hint={t('Leave empty to number it automatically.')}>
                {(id) => (
                  <Input
                    id={id}
                    value={asset.number}
                    placeholder="FA-0001"
                    onChange={(e) => update({ number: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('Serial number')} optional>
                {(id) => (
                  <Input
                    id={id}
                    value={asset.serialNumber}
                    onChange={(e) => update({ serialNumber: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('Location')} optional>
                {(id) => (
                  <Input
                    id={id}
                    value={asset.location}
                    placeholder={t('e.g. Head office, Shuwaikh warehouse')}
                    onChange={(e) => update({ location: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('Custodian')} optional hint={t('Who looks after it.')}>
                {(id) => (
                  <Input
                    id={id}
                    value={asset.custodian}
                    onChange={(e) => update({ custodian: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('Description')} optional className="md:col-span-2">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={2}
                    value={asset.description}
                    onChange={(e) => update({ description: e.target.value })}
                  />
                )}
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('Purchase')} description={t(SOURCE_LABELS[asset.source].hint)} />
            <CardBody className="space-y-4">
              {locked ? (
                <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  <Lock className="mt-0.5 size-4 shrink-0 text-slate-400" />
                  {t(
                    'Depreciation has been posted for this asset, so its cost and depreciation can’t change. Undo the depreciation runs first.',
                  )}
                </p>
              ) : null}
              {isNew ? (
                <div role="group" aria-label={t('How the asset was bought')}>
                  <Segmented
                    value={asset.source}
                    onChange={(source) => update({ source })}
                    options={SOURCES.map((s) => ({ value: s, label: t(SOURCE_LABELS[s].label) }))}
                  />
                </div>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                {asset.source === 'bill' ? (
                  <Field label={t('Bill line')} className="md:col-span-2">
                    {(id) => (
                      <Combobox
                        id={id}
                        value={asset.billLineId}
                        onChange={chooseLine}
                        options={lineOptions}
                        disabled={locked}
                        placeholder={t('Choose a bill line…')}
                        searchPlaceholder={t('Search bills…')}
                        emptyText={t('No bill lines booked to fixed asset accounts.')}
                      />
                    )}
                  </Field>
                ) : null}
                <Field label={t('Asset account')} hint={t('The category, e.g. vehicles.')}>
                  {(id) => (
                    <AccountSelect
                      id={id}
                      value={asset.assetAccountId}
                      accounts={categoryAccounts(accounts, asset.assetAccountId)}
                      onChange={setCategory}
                      disabled={locked}
                    />
                  )}
                </Field>
                {asset.source === 'purchase' ? (
                  <Field label={t('Paid from')}>
                    {(id) => (
                      <AccountSelect
                        id={id}
                        value={asset.paidFromAccountId ?? ''}
                        accounts={money}
                        onChange={(paidFromAccountId) => update({ paidFromAccountId })}
                        disabled={locked}
                      />
                    )}
                  </Field>
                ) : null}
                <Field label={t('Purchase date')}>
                  {(id) => (
                    <DateField
                      id={id}
                      value={asset.purchaseDate}
                      disabled={locked}
                      onChange={(iso) => {
                        const purchaseDate = iso;
                        update({
                          purchaseDate,
                          depreciationStart:
                            asset.depreciationStart === asset.purchaseDate
                              ? purchaseDate
                              : asset.depreciationStart,
                        });
                      }}
                    />
                  )}
                </Field>
                <Field label={t('Cost')}>
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={asset.cost}
                      allowNegative={false}
                      blankZero
                      disabled={locked}
                      onValueChange={(cost) => update({ cost })}
                    />
                  )}
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('Depreciation')} />
            <CardBody className="grid gap-4 md:grid-cols-2">
              <Field label={t('Depreciation starts')} hint={t('When the asset was put to use.')}>
                {(id) => (
                  <DateField
                    id={id}
                    value={asset.depreciationStart}
                    disabled={locked}
                    onChange={(iso) => update({ depreciationStart: iso })}
                  />
                )}
              </Field>
              <Field label={t('Useful life (months)')} hint={lifeText(asset.usefulLifeMonths)}>
                {(id) => (
                  <NumberInput
                    id={id}
                    value={asset.usefulLifeMonths}
                    allowNegative={false}
                    disabled={locked}
                    onValueChange={(n) => update({ usefulLifeMonths: Math.round(n) })}
                  />
                )}
              </Field>
              <Field label={t('Depreciation method')}>
                {(id) => (
                  <Select
                    id={id}
                    value={asset.method}
                    disabled={locked}
                    onChange={(e) => update({ method: e.target.value as DepreciationMethod })}
                  >
                    {(Object.keys(METHOD_LABELS) as DepreciationMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {t(METHOD_LABELS[m])}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {asset.method === 'declining_balance' ? (
                <Field
                  label={t('Yearly rate (%)')}
                  optional
                  hint={t('Empty uses twice the straight-line rate ({rate}).', {
                    rate: fmt.percent(defaultRate),
                  })}
                >
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={asset.decliningRate ?? 0}
                      allowNegative={false}
                      blankZero
                      disabled={locked}
                      onValueChange={(rate) => update({ decliningRate: rate || null })}
                    />
                  )}
                </Field>
              ) : null}
              <Field
                label={t('Salvage value')}
                optional
                hint={t('What it will be worth at the end.')}
              >
                {(id) => (
                  <NumberInput
                    id={id}
                    value={asset.salvageValue}
                    allowNegative={false}
                    blankZero
                    disabled={locked}
                    onValueChange={(salvageValue) => update({ salvageValue })}
                  />
                )}
              </Field>
              {asset.source !== 'purchase' ? (
                <>
                  <Field
                    label={t('Depreciation already charged')}
                    optional
                    hint={t('Before the asset was entered here.')}
                  >
                    {(id) => (
                      <NumberInput
                        id={id}
                        value={asset.openingDepreciation}
                        allowNegative={false}
                        blankZero
                        disabled={locked}
                        onValueChange={(openingDepreciation) => update({ openingDepreciation })}
                      />
                    )}
                  </Field>
                  {asset.openingDepreciation > 0 ? (
                    <Field label={t('Charged up to')}>
                      {(id) => (
                        <DateField
                          id={id}
                          value={asset.openingDepreciationDate ?? ''}
                          disabled={locked}
                          onChange={(iso) => update({ openingDepreciationDate: iso || null })}
                        />
                      )}
                    </Field>
                  ) : null}
                </>
              ) : null}
              <Field label={t('Accumulated depreciation account')}>
                {(id) => (
                  <AccountSelect
                    id={id}
                    value={asset.accumulatedAccountId}
                    accounts={accumulatedAccounts(accounts, asset.accumulatedAccountId)}
                    onChange={(accumulatedAccountId) => update({ accumulatedAccountId })}
                    disabled={locked}
                  />
                )}
              </Field>
              <Field label={t('Depreciation expense account')}>
                {(id) => (
                  <AccountSelect
                    id={id}
                    value={asset.expenseAccountId}
                    accounts={expenseAccounts(accounts, asset.expenseAccountId)}
                    onChange={(expenseAccountId) => update({ expenseAccountId })}
                    disabled={locked}
                  />
                )}
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('Notes and files')} />
            <CardBody className="space-y-4">
              <Field label={t('Notes')} optional>
                {(id) => (
                  <Textarea
                    id={id}
                    rows={2}
                    value={asset.notes}
                    onChange={(e) => update({ notes: e.target.value })}
                  />
                )}
              </Field>
              <AttachmentList
                files={attachments.files}
                onAdd={attachments.add}
                onRemove={attachments.remove}
                emptyText={t('Keep the invoice, warranty or photos with the asset.')}
              />
            </CardBody>
          </Card>
        </div>

        <Card className="h-fit xl:sticky xl:top-20">
          <CardHeader title={t('Depreciation preview')} />
          <CardBody className="space-y-3 text-sm">
            {preview ? (
              <>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">{t('Each month')}</span>
                  <span className="tabular font-medium text-slate-900">
                    {fmt.money(fromMinor(monthly, p))}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">{t('First month')}</span>
                  <span className="tabular text-slate-700">
                    {monthLabel(preview[0].period, company.locale)} ·{' '}
                    {fmt.money(fromMinor(preview[0].charge, p))}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">{t('Fully depreciated')}</span>
                  <span className="text-slate-700">
                    {monthLabel(preview[preview.length - 1].period, company.locale)}
                  </span>
                </div>
                <div className="flex justify-between gap-3 border-t border-slate-100 pt-3">
                  <span className="text-slate-500">{t('Total to depreciate')}</span>
                  <span className="tabular font-medium text-slate-900">
                    {fmt.money(asset.cost - asset.salvageValue - asset.openingDepreciation)}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-slate-500">
                {t('Enter the cost, the useful life and when depreciation starts.')}
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default function AssetFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const company = useCompany();
  const data = useAssetData();
  const existing = useLiveQuery(
    async () => (id ? ((await db.assets.get(id)) ?? null) : null),
    [id],
  );
  const [fresh] = useState(() =>
    createAsset(company.id, { source: params.get('source') === 'bill' ? 'bill' : 'purchase' }),
  );
  if (!data || (id && existing === undefined)) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }
  if (id && !existing) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">{t('This asset could not be found.')}</p>
        <Link to="/assets" className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {t('Back to fixed assets')}
        </Link>
      </Card>
    );
  }
  const initial = existing ?? fresh;
  return (
    <Editor
      key={initial.id + (existing?.updatedAt ?? '')}
      initial={initial}
      isNew={!existing}
      chart={data.accounts}
    />
  );
}
