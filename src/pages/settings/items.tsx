import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, ArchiveRestore, ImagePlus, Plus, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import type { Company, CustomUnit, ItemSettings } from '@/db/types';
import { assignItemCodes, itemCodeRule } from '@/db/inventory';
import { previewNumber } from '@/lib/numbering';
import { BUILT_IN_UNITS, customUnits } from '@/lib/units';
import { today } from '@/lib/dates';
import { newId } from '@/lib/ids';
import { tp, t } from '@/i18n';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input, Switch } from '@/components/ui/form';
import { useConfirm } from '@/components/ui/overlay';
import { useCompany } from '@/app/company';
import { useRoleView } from '@/features/cloud/role-gates';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

/**
 * Item settings with `patch` applied. A setting set to undefined is left
 * out, and so are the settings when none is left: items work as before.
 */
function withItems(company: Company, patch: Partial<ItemSettings>): Company {
  const next: Record<string, unknown> = { ...company.items, ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  const { items: _old, ...rest } = company;
  return Object.keys(next).length ? { ...rest, items: next as ItemSettings } : rest;
}

/** Names trimmed; a new unit left without any name is dropped. */
function tidyUnits(units: CustomUnit[], saved: CustomUnit[]): CustomUnit[] | undefined {
  const known = new Set(saved.map((u) => u.id));
  const tidy = units
    .map((u) => ({ ...u, name: u.name.trim(), nameAr: u.nameAr.trim() }))
    .filter((u) => u.name || u.nameAr || known.has(u.id));
  return tidy.length ? tidy : undefined;
}

export default function ItemSettingsPage() {
  const saved = useCompany();
  const { draft, setDraft, dirty, saving, saveWith, reset } = useCompanyDraft();
  const { role, readOnly } = useRoleView();
  const confirm = useConfirm();
  // Part of the company record: staff and viewers only look at it.
  const locked = readOnly.readOnly || role === 'staff';
  const items = draft.items ?? {};
  const units = items.customUnits ?? [];
  const setItems = (patch: Partial<ItemSettings>) => setDraft((c) => withItems(c, patch));
  const setUnit = (id: string, patch: Partial<CustomUnit>) =>
    setItems({ customUnits: units.map((u) => (u.id === id ? { ...u, ...patch } : u)) });

  const uncoded = useLiveQuery(
    () =>
      db.products
        .where('companyId')
        .equals(draft.id)
        .filter((p) => !p.archived && !p.sku.trim())
        .count(),
    [draft.id],
  );

  const onSave = () =>
    void saveWith((c) =>
      withItems(c, { customUnits: tidyUnits(c.items?.customUnits ?? [], customUnits(saved)) }),
    );

  const giveCodes = async () => {
    const ok = await confirm({
      title: tp(uncoded ?? 0, 'Give a code to {count} item?', 'Give codes to {count} items?'),
      description: t(
        'They get the next codes, in the order they were added. You can print their labels afterwards.',
      ),
      confirmLabel: t('Give codes'),
    });
    if (!ok) return;
    try {
      const count = await assignItemCodes(draft.id);
      toast.success(tp(count, '{count} item has a code now', '{count} items have codes now'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Could not save.'));
    }
  };

  return (
    <div className="space-y-6">
      {locked ? (
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
          {t('Owners, admins and accountants set up items. You can look at it.')}
        </p>
      ) : null}

      <SettingsSection
        id="units"
        title={t('Units')}
        description={t(
          'Pick units from a list with Arabic names, printed on Arabic documents. Units typed before stay as they are.',
        )}
      >
        <Switch
          checked={Boolean(items.units)}
          disabled={locked}
          onChange={(on) => setItems({ units: on || undefined })}
          label={t('Units from a list')}
          description={t(
            'Items and lines take their unit from the list: a unit picked on an English document prints in Arabic on an Arabic one.',
          )}
        />
        {items.units ? (
          <>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">{t('Built-in units')}</p>
              <ul className="flex flex-wrap gap-2">
                {BUILT_IN_UNITS.map((u) => (
                  <li
                    key={u.id}
                    className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700"
                  >
                    <span dir="ltr">{u.name}</span>
                    <span className="mx-1.5 text-slate-400">·</span>
                    <span dir="rtl" lang="ar">
                      {u.nameAr}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700">{t('Your units')}</p>
              {units.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {t('Add the units you use that are not in the list, such as roll or bag.')}
                </p>
              ) : null}
              {units.map((unit, index) => (
                <div
                  key={unit.id}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3"
                >
                  <Field label={t('Unit {number}', { number: index + 1 })}>
                    {(id) => (
                      <Input
                        id={id}
                        dir="ltr"
                        value={unit.name}
                        disabled={locked || unit.archived}
                        onChange={(e) => setUnit(unit.id, { name: e.target.value })}
                        placeholder="roll"
                      />
                    )}
                  </Field>
                  <Field label={t('Arabic name')}>
                    {(id) => (
                      <Input
                        id={id}
                        dir="rtl"
                        lang="ar"
                        value={unit.nameAr}
                        disabled={locked || unit.archived}
                        onChange={(e) => setUnit(unit.id, { nameAr: e.target.value })}
                        placeholder="لفة"
                      />
                    )}
                  </Field>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={locked}
                    aria-label={
                      unit.archived
                        ? t('Restore unit {number}', { number: index + 1 })
                        : t('Archive unit {number}', { number: index + 1 })
                    }
                    title={unit.archived ? t('Restore') : t('Archive')}
                    onClick={() => setUnit(unit.id, { archived: unit.archived ? undefined : true })}
                  >
                    {unit.archived ? <ArchiveRestore /> : <Archive />}
                  </Button>
                </div>
              ))}
              {units.some((u) => u.archived) ? (
                <p className="text-xs text-slate-500">
                  {t(
                    'Archived units are no longer offered; documents that have them still print them.',
                  )}
                </p>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={locked}
                onClick={() =>
                  setItems({ customUnits: [...units, { id: newId(), name: '', nameAr: '' }] })
                }
              >
                <Plus /> {t('Add unit')}
              </Button>
            </div>
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection
        id="codes"
        title={t('Item codes (SKU)')}
        description={t(
          'Codes for items, printed on labels as a QR code that any scanner types into item search.',
        )}
        actions={
          <ButtonLink to="/settings/numbering" variant="ghost" size="sm">
            {t('Numbering')}
          </ButtonLink>
        }
      >
        <Switch
          checked={Boolean(items.autoSku)}
          disabled={locked}
          onChange={(on) =>
            setDraft((c) => {
              const next = withItems(c, { autoSku: on || undefined });
              // The cloud gives codes only once the company has the rule.
              return on && !c.numbering.product
                ? { ...next, numbering: { ...next.numbering, product: itemCodeRule(c) } }
                : next;
            })
          }
          label={t('Give new items a code')}
          description={t(
            'A new item saved without an SKU gets the next code, such as {code}. SKUs typed by hand stay as they are.',
            { code: previewNumber(itemCodeRule(draft), today()) },
          )}
        />
        {items.autoSku && !dirty && (uncoded ?? 0) > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
            <p className="text-sm text-slate-700">
              {tp(uncoded ?? 0, '{count} item has no code yet.', '{count} items have no code yet.')}
            </p>
            <Button variant="outline" size="sm" disabled={locked} onClick={() => void giveCodes()}>
              <QrCode /> {t('Give codes to items without one')}
            </Button>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        id="pictures"
        title={t('Item pictures')}
        description={t(
          'Pictures of your items, to tell them apart in lists and to show customers on quotes and invoices.',
        )}
        actions={
          <ButtonLink to="/templates" variant="ghost" size="sm">
            {t('Templates')}
          </ButtonLink>
        }
      >
        <Switch
          checked={Boolean(items.images)}
          disabled={locked}
          onChange={(on) => setItems({ images: on || undefined })}
          label={t('Give items pictures')}
          description={t(
            'Up to five pictures per item, the first one its main picture: shown in Products & services and when picking items, and printed on documents whose design shows item pictures (Templates).',
          )}
        />
        {items.images ? (
          <p className="flex items-start gap-2 text-sm text-slate-600">
            <ImagePlus className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
            {t('Add pictures to each item in Products & services. Staff can add them too.')}
          </p>
        ) : null}
      </SettingsSection>
      <SaveBar dirty={dirty} saving={saving} onSave={onSave} onReset={reset} />
    </div>
  );
}
