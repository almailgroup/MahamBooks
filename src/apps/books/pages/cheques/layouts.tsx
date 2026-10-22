import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Info, RotateCcw, Ruler } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { archiveChequeLayout, saveChequeLayout } from '@/db/cheque-print';
import type { ChequeBox, ChequeLayout } from '@/db/types';
import { useCompany } from '@/app/company';
import { useCloudLink } from '@/cloud/hooks';
import { linkHasFeature } from '@/cloud/features';
import { canEditAccounting } from '@/cloud/roles';
import {
  isPresetBank,
  isPresetLayoutId,
  LAYOUT_FIELD_LABELS,
  LAYOUT_FIELDS,
  layoutBanks,
  layoutFor,
  layoutProblem,
  type LayoutField,
} from '@/lib/cheque-layouts';
import { bankName } from '@/lib/cheques';
import { today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { currentLanguage, t } from '@/i18n';
import { tr } from '@/i18n/provider';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input, NumberInput, Switch } from '@/components/ui/form';
import { Card, CardBody, CardHeader, PageHeader, Segmented, Spinner } from '@/components/ui/misc';
import { useConfirm } from '@/components/ui/overlay';
import { useReadOnly } from '@/components/ui/read-only';
import { useRoleView } from '@/features/cloud/role-gates';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { registerBottomBar } from '@/features/shell/store';
import { ChequeLeaf, sampleFace, useChequeFit } from '@/apps/books/features/cheques/cheque-leaf';

/** A crossing's place for layouts saved without one. */
const CROSSING: ChequeBox = { x: 6, y: 4, width: 42, height: 9 };

function Note({ tone, children }: { tone: 'info' | 'warning'; children: React.ReactNode }) {
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <p
      className={cn(
        'mb-4 flex gap-2 rounded-lg px-4 py-3 text-sm',
        tone === 'info'
          ? 'bg-slate-50 text-slate-600 ring-1 ring-slate-200'
          : 'bg-amber-50 text-amber-900 ring-1 ring-amber-600/20',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/**
 * Cheque layouts (نماذج الشيكات): where each bank's leaf takes the date, the
 * payee, the amount in words and in figures, and the crossing, in
 * millimetres, with a preview at the leaf's real size. The built-in Burgan
 * Bank and KFH layouts print until the company saves its own.
 */
export default function ChequeLayoutsPage() {
  const company = useCompany();
  const [params, setParams] = useSearchParams();
  const { role } = useRoleView();
  const { readOnly } = useReadOnly();
  // Layouts are records of a table the server must know (database version 16).
  const link = useCloudLink(company.id);
  const tables = link !== undefined && linkHasFeature(link, 'tables_v16');
  const saved = useLiveQuery(
    () => db.chequeLayouts.where('companyId').equals(company.id).toArray(),
    [company.id],
  );

  if (!saved || link === undefined) return <Spinner className="py-24" label={t('Loading…')} />;

  const banks = layoutBanks(saved);
  const asked = (params.get('bank') ?? '').toUpperCase();
  const bank = banks.includes(asked) ? asked : banks[0];
  const layout = layoutFor(bank, saved, company.id)!;
  const mayEdit = !readOnly && canEditAccounting(role);
  // Layouts are looked at, not changed, until the company prints cheques (D1).
  const locked = !mayEdit || !company.chequePrinting;
  const language = currentLanguage();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumb={<Link to="/cheques?tab=issued">{t('Cheques')}</Link>}
        title={t('Cheque layouts')}
        description={t(
          'Where each bank’s cheque leaf takes the date, the payee and the amount, for printing cheques issued.',
        )}
        actions={
          <ButtonLink variant="outline" to={`/cheques/test-print?bank=${encodeURIComponent(bank)}`}>
            <Ruler /> {t('Test print')}
          </ButtonLink>
        }
      />

      {!company.chequePrinting ? (
        <Note tone="info">
          {tr('Cheque printing is off. The owner turns it on in {place}.', {
            place: (
              <Link to="/settings/payments" className="font-medium underline underline-offset-2">
                {t('Settings → Payment details')}
              </Link>
            ),
          })}
        </Note>
      ) : null}
      {!mayEdit ? (
        <Note tone="info">
          {t('Owners, admins and accountants change cheque layouts. You can look at them.')}
        </Note>
      ) : link && !tables ? (
        <Note tone="warning">
          {t(
            'Saving layouts needs the latest database script on the server: ask the owner to run it (Settings → Cloud and sync). The built-in layouts print meanwhile.',
          )}
        </Note>
      ) : null}

      <Segmented
        className="mb-5"
        value={bank}
        onChange={(next) => setParams({ bank: next }, { replace: true })}
        options={banks.map((code) => ({ value: code, label: bankName(code, language) }))}
      />

      <LayoutEditor
        key={`${layout.id}:${layout.updatedAt}`}
        layout={layout}
        locked={locked}
        canSave={!locked && tables}
      />
    </div>
  );
}

function LayoutEditor({
  layout,
  locked,
  canSave,
}: {
  layout: ChequeLayout;
  locked: boolean;
  canSave: boolean;
}) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState<ChequeLayout>(layout);
  const [saving, setSaving] = useState(false);
  const [crossed, setCrossed] = useState(true);
  const dirty = JSON.stringify(draft) !== JSON.stringify(layout);
  useUnsavedGuard(dirty && !saving);
  // The save bar floats at the bottom while there are changes: Ask AI moves up.
  useEffect(() => (dirty && !locked ? registerBottomBar() : undefined), [dirty, locked]);
  const problem = layoutProblem(draft);
  const face = sampleFace(draft, today(), crossed);
  const fit = useChequeFit(draft, face);
  const own = !isPresetLayoutId(layout.id);

  const set = (patch: Partial<ChequeLayout>) => setDraft((d) => ({ ...d, ...patch }));
  const setBox = (key: LayoutField, patch: Partial<ChequeBox>) =>
    setDraft((d) => ({
      ...d,
      fields: { ...d.fields, [key]: { ...(d.fields[key] ?? CROSSING), ...patch } },
    }));
  const mm = (n: number) => Math.round(n * 10) / 10;

  const save = async () => {
    setSaving(true);
    try {
      await saveChequeLayout(draft);
      toast.success(t('Cheque layout saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save.'));
      setSaving(false);
    }
  };

  const backToBuiltIn = async () => {
    const ok = await confirm({
      title: t('Use the built-in layout again?'),
      description: t(
        'Cheques on this bank print with the built-in layout. This layout is kept with the cheques printed with it.',
      ),
      confirmLabel: t('Use the built-in layout'),
    });
    if (!ok) return;
    try {
      await archiveChequeLayout(layout.id);
      toast.success(t('The built-in layout prints again'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save.'));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={t('Preview')}
          description={
            draft.calibrated
              ? t('At the leaf’s real size, with a sample cheque of 1,250.750 dinars.')
              : t(
                  'At the leaf’s real size, with a sample cheque of 1,250.750 dinars. Not checked against a real leaf yet.',
                )
          }
        />
        <CardBody className="space-y-3">
          <div className="overflow-x-auto rounded-lg bg-slate-100 p-4">
            <ChequeLeaf layout={draft} face={face} fit={fit} guides="screen" label={t('Preview')} />
          </div>
          {!fit.words.fits ? (
            <p role="alert" className="text-sm text-red-700">
              {t(
                'The amount in words doesn’t fit on the two lines of the leaf. Make the lines longer in the cheque layout.',
              )}
            </p>
          ) : null}
          {!fit.figures.fits || !fit.date.fits ? (
            <p role="alert" className="text-sm text-red-700">
              {t(
                'The amount in figures or the date doesn’t fit in its box. Make the box wider in the cheque layout.',
              )}
            </p>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="accent-primary-600 size-4"
              checked={crossed}
              onChange={(e) => setCrossed(e.target.checked)}
            />
            {t('Show the crossing')}
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('Leaf')}
          description={t('Measured from the top left corner of the leaf, in millimetres.')}
        />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('Name')} className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                value={draft.name}
                disabled={locked}
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('Name in Arabic')} optional className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                dir="rtl"
                value={draft.nameAr ?? ''}
                disabled={locked}
                onChange={(e) => set({ nameAr: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('Width (mm)')}>
            {(id) => (
              <NumberInput
                id={id}
                value={draft.size.width}
                allowNegative={false}
                disabled={locked}
                onValueChange={(v) => set({ size: { ...draft.size, width: mm(v) } })}
              />
            )}
          </Field>
          <Field label={t('Height (mm)')}>
            {(id) => (
              <NumberInput
                id={id}
                value={draft.size.height}
                allowNegative={false}
                disabled={locked}
                onValueChange={(v) => set({ size: { ...draft.size, height: mm(v) } })}
              />
            )}
          </Field>
          <Field
            label={t('Move every field right (mm)')}
            hint={t('For every printer; each printer also has its own, in the test print.')}
          >
            {(id) => (
              <NumberInput
                id={id}
                value={draft.offset.x}
                disabled={locked}
                onValueChange={(v) => set({ offset: { ...draft.offset, x: mm(v) } })}
              />
            )}
          </Field>
          <Field label={t('Move every field down (mm)')}>
            {(id) => (
              <NumberInput
                id={id}
                value={draft.offset.y}
                disabled={locked}
                onValueChange={(v) => set({ offset: { ...draft.offset, y: mm(v) } })}
              />
            )}
          </Field>
          <div className="space-y-1.5 sm:col-span-2">
            <p className="text-sm font-medium text-slate-700">{t('Amount in words')}</p>
            <Segmented
              value={draft.wordsLanguage}
              onChange={(wordsLanguage) => !locked && set({ wordsLanguage })}
              options={[
                { value: 'ar', label: t('Arabic') },
                { value: 'en', label: t('English') },
              ]}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <p className="text-sm font-medium text-slate-700">{t('Date written as')}</p>
            <Segmented
              value={draft.dateStyle}
              onChange={(dateStyle) => !locked && set({ dateStyle })}
              options={[
                { value: 'slashes', label: '12/10/2026' },
                { value: 'boxes', label: t('One digit per box') },
              ]}
            />
          </div>
          <Field label={t('Before the figures')} hint={t('Such as KD, when the leaf has none.')}>
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                value={draft.figures.prefix}
                disabled={locked}
                onChange={(e) => set({ figures: { ...draft.figures, prefix: e.target.value } })}
              />
            )}
          </Field>
          <Field
            label={t('Around the figures')}
            hint={t('So that nothing can be added, such as **.')}
          >
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                value={draft.figures.guard}
                disabled={locked}
                onChange={(e) => set({ figures: { ...draft.figures, guard: e.target.value } })}
              />
            )}
          </Field>
          <Switch
            className="sm:col-span-2 lg:col-span-4"
            checked={draft.calibrated}
            disabled={locked}
            onChange={(calibrated) => set({ calibrated })}
            label={t('Checked against a real leaf')}
            description={t(
              'Turn on once a test print on plain paper lines up with a real leaf on the office printer.',
            )}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('Fields')} />
        <CardBody className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                <th className="py-2 pe-3 text-start">{t('Field')}</th>
                <th className="px-2 py-2 text-start">{t('From the left')}</th>
                <th className="px-2 py-2 text-start">{t('From the top')}</th>
                <th className="px-2 py-2 text-start">{t('Width')}</th>
                <th className="px-2 py-2 text-start">{t('Height')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {LAYOUT_FIELDS.map((key) => {
                const box = draft.fields[key] ?? CROSSING;
                const field = t(LAYOUT_FIELD_LABELS[key]);
                const input = (part: keyof ChequeBox, label: string) => (
                  <td className="px-2 py-2">
                    <NumberInput
                      value={box[part]}
                      allowNegative={false}
                      disabled={locked}
                      aria-label={label}
                      onValueChange={(v) => setBox(key, { [part]: mm(v) })}
                    />
                  </td>
                );
                return (
                  <tr key={key}>
                    <th scope="row" className="py-2 pe-3 text-start font-medium text-slate-700">
                      {field}
                    </th>
                    {input('x', t('{field}: from the left (mm)', { field }))}
                    {input('y', t('{field}: from the top (mm)', { field }))}
                    {input('width', t('{field}: width (mm)', { field }))}
                    {input('height', t('{field}: height (mm)', { field }))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {!locked ? (
        <div
          className={cn(
            'bg-surface/95 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-slate-200 px-4 py-3 sm:px-5',
            dirty && 'sticky bottom-4 z-10 shadow-lg backdrop-blur',
          )}
        >
          <p className={cn('text-sm', problem ? 'text-red-700' : 'text-slate-600')}>
            {problem
              ? t(problem)
              : dirty
                ? t('You have unsaved changes.')
                : own
                  ? t('This company’s layout prints cheques on this bank.')
                  : t('The built-in layout prints cheques on this bank.')}
          </p>
          <div className="flex flex-wrap gap-2">
            {own && isPresetBank(layout.bank) ? (
              <Button variant="ghost" onClick={() => void backToBuiltIn()} disabled={!canSave}>
                <RotateCcw /> {t('Use the built-in layout')}
              </Button>
            ) : null}
            {dirty ? (
              <Button variant="ghost" onClick={() => setDraft(layout)} disabled={saving}>
                {t('Discard')}
              </Button>
            ) : null}
            <Button
              onClick={() => void save()}
              loading={saving}
              disabled={!canSave || !dirty || problem !== null}
            >
              {t('Save layout')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
