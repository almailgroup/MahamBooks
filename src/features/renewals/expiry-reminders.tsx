import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { ComplianceDocumentType, PeopleSettings } from '@/db/types';
import {
  DOCUMENT_TYPES,
  MAX_NEW_COPY_DAYS,
  MAX_REMINDERS,
  MAX_REPEAT_DAYS,
  RECOMMENDED_EXPIRED_REPEAT_DAYS,
  RECOMMENDED_NEW_COPY_GRACE_DAYS,
  RECOMMENDED_REMINDER_DAYS_BY_TYPE,
  cleanReminderDays,
  documentTypeInfo,
  wholeDays,
} from '@/lib/compliance';
import { normalizeDigits } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Field, Input, NumberInput, Select, Switch } from '@/components/ui/form';
import { t } from '@/i18n';

/** A type's reminder days as typed, before they are read. */
interface TypeRow {
  type: string;
  days: string;
}

const parseDays = (text: string) =>
  cleanReminderDays(
    normalizeDigits(text)
      .split(/[^\d]+/)
      .filter(Boolean)
      .map(Number),
  ).slice(0, MAX_REMINDERS);

/** The rows of reminders by type, from what is saved. */
export function typeRows(settings: Pick<PeopleSettings, 'reminderDaysByType'>): TypeRow[] {
  return Object.entries(settings.reminderDaysByType ?? {}).map(([type, days]) => ({
    type,
    days: (days ?? []).join(', '),
  }));
}

/** The reminders by type the rows say: a row without days is left out. */
export function rowsToDays(rows: readonly TypeRow[]): Partial<Record<string, number[]>> {
  const out: Partial<Record<string, number[]>> = {};
  for (const row of rows) {
    const days = parseDays(row.days);
    if (row.type && days.length && !out[row.type]) out[row.type] = days;
  }
  return out;
}

const recommendedRows = (): TypeRow[] =>
  Object.entries(RECOMMENDED_REMINDER_DAYS_BY_TYPE).map(([type, days]) => ({
    type,
    days: (days ?? []).join(', '),
  }));

/** Every type a paper can be, in the interface language, for the list of types. */
const TYPE_CHOICES = (Object.keys(DOCUMENT_TYPES) as ComplianceDocumentType[]).filter(
  (type) => type !== 'other',
);

export interface ExpiryReminderDraft {
  byType: boolean;
  rows: TypeRow[];
  repeat: boolean;
  repeatDays: number;
  newCopy: boolean;
  graceDays: number;
  updates: boolean;
}

/** The form's state for what is saved. */
export function expiryDraft(settings: PeopleSettings): ExpiryReminderDraft {
  const rows = typeRows(settings);
  const repeatDays = wholeDays(settings.expiredRepeatDays, MAX_REPEAT_DAYS);
  const graceDays = wholeDays(settings.newCopyGraceDays, MAX_NEW_COPY_DAYS);
  return {
    byType: rows.length > 0,
    rows,
    repeat: repeatDays > 0,
    repeatDays: repeatDays || RECOMMENDED_EXPIRED_REPEAT_DAYS,
    newCopy: graceDays > 0,
    graceDays: graceDays || RECOMMENDED_NEW_COPY_GRACE_DAYS,
    updates: settings.expiryUpdates === true,
  };
}

/** What the form saves: whatever is off is left out, so nothing changes from before. */
export function expirySettings(
  draft: ExpiryReminderDraft,
): Pick<
  PeopleSettings,
  'reminderDaysByType' | 'expiredRepeatDays' | 'newCopyGraceDays' | 'expiryUpdates'
> {
  return {
    reminderDaysByType: draft.byType ? rowsToDays(draft.rows) : undefined,
    expiredRepeatDays: draft.repeat
      ? wholeDays(draft.repeatDays, MAX_REPEAT_DAYS) || undefined
      : undefined,
    newCopyGraceDays: draft.newCopy
      ? wholeDays(draft.graceDays, MAX_NEW_COPY_DAYS) || undefined
      : undefined,
    expiryUpdates: draft.updates ? true : undefined,
  };
}

/**
 * Compliance settings → expiry reminders (#18): lead times by document type,
 * reminders again after expiry, the new copy asked for after a renewal, and
 * the reminders in Updates. Each starts off; off, nothing differs from
 * before.
 */
export function ExpiryReminderSettings({
  draft,
  onChange,
  updatesAvailable,
}: {
  draft: ExpiryReminderDraft;
  onChange: (draft: ExpiryReminderDraft) => void;
  /** The company is in the cloud and its server has the reminders in Updates. */
  updatesAvailable: boolean;
}) {
  const [adding, setAdding] = useState('');
  const set = (patch: Partial<ExpiryReminderDraft>) => onChange({ ...draft, ...patch });
  const setRow = (i: number, patch: Partial<TypeRow>) =>
    set({ rows: draft.rows.map((row, j) => (j === i ? { ...row, ...patch } : row)) });
  const used = new Set(draft.rows.map((r) => r.type));
  const free = TYPE_CHOICES.filter((type) => !used.has(type));

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{t('Expiry reminders')}</h3>
        <p className="text-xs text-slate-500">
          {t(
            'For the morning email alerts and the register. Each is off until you turn it on; while off, reminders work as before.',
          )}
        </p>
      </div>
      <Switch
        checked={draft.byType}
        onChange={(byType) =>
          set({ byType, rows: byType && !draft.rows.length ? recommendedRows() : draft.rows })
        }
        label={t('Reminders by document type')}
        description={t(
          'Some papers take longer to renew. A type listed here is reminded of on its own days; the others on the days above, and a document’s own days come first.',
        )}
      />
      {draft.byType ? (
        <div className="space-y-2">
          <ul className="space-y-2">
            {draft.rows.map((row, i) => {
              const label = t(documentTypeInfo(row.type).label);
              return (
                <li key={row.type} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{label}</span>
                  <Input
                    value={row.days}
                    onChange={(e) => setRow(i, { days: e.target.value })}
                    aria-label={t('Days before expiry for {type}', { type: label })}
                    inputMode="numeric"
                    dir="ltr"
                    className="w-40"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('Remove {name}', { name: label })}
                    onClick={() => set({ rows: draft.rows.filter((_, j) => j !== i) })}
                  >
                    <X />
                  </Button>
                </li>
              );
            })}
          </ul>
          {free.length ? (
            <div className="flex items-center gap-2">
              <Select
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                aria-label={t('Document type')}
                className="min-w-0 flex-1"
              >
                <option value="">{t('Choose a document type…')}</option>
                {free.map((type) => (
                  <option key={type} value={type}>
                    {t(DOCUMENT_TYPES[type].label)}
                  </option>
                ))}
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={!adding}
                onClick={() => {
                  set({ rows: [...draft.rows, { type: adding, days: '60, 30, 7' }] });
                  setAdding('');
                }}
              >
                <Plus /> {t('Add type')}
              </Button>
            </div>
          ) : null}
          <p className="text-xs text-slate-500">
            {t('For example 90, 60, 30, 7. Up to five reminders a type.')}
          </p>
        </div>
      ) : null}
      <Switch
        checked={draft.repeat}
        onChange={(repeat) => set({ repeat })}
        label={t('Remind again after expiry')}
        description={t(
          'An expired paper is in the next email again every few days until it is renewed, instead of only in Sunday’s summary.',
        )}
      />
      {draft.repeat ? (
        <Field label={t('Remind every (days) after expiry')}>
          {(id) => (
            <NumberInput
              id={id}
              value={draft.repeatDays}
              onValueChange={(repeatDays) => set({ repeatDays })}
              allowNegative={false}
              className="w-32"
            />
          )}
        </Field>
      ) : null}
      <Switch
        checked={draft.newCopy}
        onChange={(newCopy) => set({ newCopy })}
        label={t('Ask for the new copy after a renewal')}
        description={t(
          'A paper renewed with Renew from today on is marked “New copy missing” until a file is added as its new copy, valid until the new expiry, and the email reminds you of it.',
        )}
      />
      {draft.newCopy ? (
        <Field label={t('Ask for the new copy within (days)')}>
          {(id) => (
            <NumberInput
              id={id}
              value={draft.graceDays}
              onValueChange={(graceDays) => set({ graceDays })}
              allowNegative={false}
              className="w-32"
            />
          )}
        </Field>
      ) : null}
      {updatesAvailable ? (
        <Switch
          checked={draft.updates}
          onChange={(updates) => set({ updates })}
          label={t('Show the reminders in Updates')}
          description={t(
            'The owner and the approvers who get the changes of the team also find them under the bell, each morning. Employees’ papers show there without names.',
          )}
        />
      ) : null}
    </section>
  );
}
