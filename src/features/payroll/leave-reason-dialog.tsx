import { useState } from 'react';
import type { EmployeeCategory, LeaveReason, LeaveReasonPay } from '@/db/types';
import {
  LEAVE_REASON_PAY,
  LEAVE_REASON_PAY_ORDER,
  leaveReasonBase,
  leaveReasonPay,
} from '@/lib/hr/leave';
import { CATEGORY_LABELS } from '@/lib/hr/employees';
import { newId } from '@/lib/ids';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, NumberInput, Select, Switch } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { msg, t } from '@/i18n';

/** What each way of paying means, in a sentence. */
export const LEAVE_REASON_PAY_HINTS: Record<LeaveReasonPay, string> = {
  full: msg('Paid in full; the annual leave balance doesn’t change.'),
  half: msg('Each calendar day of it costs half a day’s pay.'),
  unpaid: msg('Each calendar day of it costs a day’s pay, like unpaid leave.'),
  annual: msg('Paid in full and taken from the annual leave balance, like annual leave.'),
  balance: msg(
    'Paid in full from a balance of its own: add days to it by hand, such as compensatory days for work on a rest day.',
  ),
};

/** What older versions of the app make of a reason's leave, by how it is paid. */
export const LEAVE_REASON_OLDER: Record<LeaveReasonPay, string> = {
  full: msg('Older versions show it as bereavement leave, paid in full.'),
  half: msg('Older versions show it as unpaid leave and pay nothing for it.'),
  unpaid: msg('Older versions show it as unpaid leave.'),
  annual: msg('Older versions show it as annual leave.'),
  balance: msg('Older versions show it as bereavement leave, paid in full.'),
};

const CATEGORY_ORDER: EmployeeCategory[] = ['kuwaiti', 'gcc', 'expat', 'domestic'];

/** A new reason: on full pay, as most are (the owner's recommended set). */
export function newLeaveReason(overrides: Partial<LeaveReason> = {}): LeaveReason {
  return { id: newId(), name: '', nameAr: '', base: 'bereavement', pay: 'full', ...overrides };
}

/**
 * Adds or changes one of the company's leave reasons: its names, how it is
 * paid (locked once leave is recorded with it), its days a year, the
 * categories of staff it is for, and whether it needs a note.
 */
export function LeaveReasonDialog({
  reason,
  locked,
  onSave,
  onClose,
}: {
  reason: LeaveReason;
  /** Leave is recorded with it: how it is paid stays as it is. */
  locked: boolean;
  onSave: (reason: LeaveReason) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<LeaveReason>(reason);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<LeaveReason>) => setDraft((d) => ({ ...d, ...patch }));
  const known = (LEAVE_REASON_PAY_ORDER as string[]).includes(draft.pay);
  const categories = draft.categories ?? [];

  const save = async () => {
    if (!draft.name.trim()) {
      setError(t('Enter the name of each leave reason.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave(draft);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Something went wrong.'));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={reason.name ? t('Edit leave reason') : t('Add a leave reason')}
        description={t('Leave of this reason is recorded and paid as set here.')}
      >
        <DialogBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('Name (English)')}>
              {(id) => (
                <Input
                  id={id}
                  value={draft.name}
                  onChange={(e) => set({ name: e.target.value })}
                  autoComplete="off"
                  dir="ltr"
                />
              )}
            </Field>
            <Field label={t('Name (Arabic)')} optional>
              {(id) => (
                <Input
                  id={id}
                  value={draft.nameAr}
                  onChange={(e) => set({ nameAr: e.target.value })}
                  autoComplete="off"
                  dir="rtl"
                />
              )}
            </Field>
          </div>
          <Field
            label={t('How it is paid')}
            hint={
              locked
                ? t(
                    'Leave is recorded with this reason, so how it is paid stays as it is. To change it, archive this reason and add a new one.',
                  )
                : known
                  ? `${t(LEAVE_REASON_PAY_HINTS[draft.pay])} ${t(LEAVE_REASON_OLDER[draft.pay])}`
                  : undefined
            }
          >
            {(id) => (
              <Select
                id={id}
                value={draft.pay}
                disabled={locked || !known}
                onChange={(e) => {
                  const pay = e.target.value as LeaveReasonPay;
                  set({ pay, base: leaveReasonBase(pay) });
                }}
              >
                {known ? null : <option value={draft.pay}>{t(leaveReasonPay(draft).label)}</option>}
                {LEAVE_REASON_PAY_ORDER.map((pay) => (
                  <option key={pay} value={pay}>
                    {t(LEAVE_REASON_PAY[pay].label)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('Most days a year')}
            optional
            hint={t(
              'Leave over it is still recorded, with a warning. Leave counts in the year it starts.',
            )}
          >
            {(id) => (
              <NumberInput
                id={id}
                value={draft.maxDaysPerYear ?? 0}
                onValueChange={(n) => set({ maxDaysPerYear: n > 0 ? n : null })}
                allowNegative={false}
                blankZero
                placeholder={t('No limit')}
                className="sm:max-w-40"
              />
            )}
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">{t('For')}</legend>
            <p className="text-xs text-slate-500">
              {t(
                'Tick none for everyone. Domestic workers come under their own law (Law 68/2015), so they can have reasons of their own.',
              )}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CATEGORY_ORDER.map((c) => (
                <Checkbox
                  key={c}
                  label={t(CATEGORY_LABELS[c])}
                  checked={categories.includes(c)}
                  onChange={(e) =>
                    set({
                      categories: e.target.checked
                        ? [...categories, c]
                        : categories.filter((x) => x !== c),
                    })
                  }
                />
              ))}
            </div>
          </fieldset>
          <Switch
            checked={Boolean(draft.noteRequired)}
            onChange={(noteRequired) => set({ noteRequired })}
            label={t('A note is needed')}
            description={t('Leave of this reason can’t be saved without a note.')}
          />
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
