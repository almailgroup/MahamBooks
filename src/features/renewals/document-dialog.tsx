import { useId, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  deleteComplianceDocument,
  saveComplianceDocument,
  setDocumentArchived,
} from '@/db/renewals';
import type { ComplianceDocument, DocumentOwnerType, Employee } from '@/db/types';
import { useCompany } from '@/app/company';
import {
  DOCUMENT_TYPES,
  OWNER_LABELS,
  registerTypesFor,
  normalizeReminderDays,
} from '@/lib/compliance';
import { isCurrent } from '@/lib/hr/employees';
import { normalizeDigits } from '@/lib/money';
import { useDraftAttachments } from '@/features/purchases/attachments';
import { FileList } from '@/features/people/file-list';
import { Button } from '@/components/ui/button';
import { useReadOnly } from '@/components/ui/read-only';
import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';
import { Segmented } from '@/components/ui/misc';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  useConfirm,
} from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import { DateField } from '@/components/ui/date-field';

const OWNERS: DocumentOwnerType[] = ['company', 'employee', 'vehicle', 'other'];

/** "60, 30, 7" ⇄ [60, 30, 7]; empty uses the company setting. */
function parseDays(text: string): number[] | null {
  const days = normalizeDigits(text)
    .split(/[^\d]+/)
    .map(Number)
    .filter((n) => n > 0);
  return days.length ? normalizeReminderDays(days) : null;
}

/** Adds or edits a document in the register: a licence, a vehicle, an employee's insurance. */
export function DocumentDialog({
  document,
  isNew,
  employees,
  defaultReminderDays,
  onClose,
}: {
  document: ComplianceDocument;
  isNew: boolean;
  employees: Employee[];
  defaultReminderDays: number[];
  onClose: () => void;
}) {
  const company = useCompany();
  const confirm = useConfirm();
  const { readOnly } = useReadOnly();
  const [draft, setDraft] = useState(document);
  const [daysText, setDaysText] = useState(document.reminderDays?.join(', ') ?? '');
  const [saving, setSaving] = useState(false);
  const files = useDraftAttachments(draft.id);
  const ownerLabel = useId();
  const set = (patch: Partial<ComplianceDocument>) => setDraft((d) => ({ ...d, ...patch }));

  const types = registerTypesFor(draft.ownerType);
  const employeeOptions = useMemo(
    () =>
      employees
        .filter((e) => isCurrent(e) || e.id === draft.employeeId)
        .sort((a, b) => localName(a).localeCompare(localName(b)))
        .map((e) => ({
          value: e.id,
          label: localName(e),
          detail: e.number,
          keywords: `${e.name} ${e.nameAr ?? ''} ${e.civilId}`,
        })),
    [employees, draft.employeeId],
  );

  const setOwner = (ownerType: DocumentOwnerType) => {
    const allowed = registerTypesFor(ownerType);
    set({
      ownerType,
      type: allowed.includes(draft.type) ? draft.type : allowed[0],
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveComplianceDocument({ ...draft, reminderDays: parseDays(daysText) });
      await files.commit(company.id);
      toast.success(isNew ? t('Document added') : t('Document saved'), {
        description: saved.title || t(DOCUMENT_TYPES[saved.type].label),
      });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the document.'));
      setSaving(false);
    }
  };

  const archive = async () => {
    await setDocumentArchived(draft.id, !document.archived);
    toast.success(document.archived ? t('Document restored') : t('Document archived'));
    onClose();
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Delete this document?'),
      description: t('Its files are deleted too. This cannot be undone.'),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteComplianceDocument(draft.id);
      toast.success(t('Document deleted'));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not delete the document.'));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={isNew ? t('Add document') : t('Edit document')}
        description={t('Licences, contracts, vehicle papers and other documents that expire.')}
        size="lg"
      >
        <DialogBody>
          <div className="flex flex-col gap-1.5">
            <p id={ownerLabel} className="text-sm font-medium text-slate-700">
              {t('Belongs to')}
            </p>
            <div role="group" aria-labelledby={ownerLabel}>
              <Segmented
                value={draft.ownerType}
                onChange={setOwner}
                options={OWNERS.map((o) => ({ value: o, label: t(OWNER_LABELS[o]) }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {draft.ownerType === 'employee' ? (
              <Field
                label={t('Employee')}
                className="sm:col-span-2"
                hint={t(
                  'Civil ID, passport, residency and work permit are kept on the employee’s page.',
                )}
              >
                {(id) => (
                  <Combobox
                    id={id}
                    value={draft.employeeId}
                    onChange={(employeeId) => set({ employeeId })}
                    options={employeeOptions}
                    placeholder={t('Choose an employee…')}
                    searchPlaceholder={t('Search employees…')}
                    emptyText={t('No matches')}
                  />
                )}
              </Field>
            ) : draft.ownerType === 'vehicle' ? (
              <Field label={t('Vehicle')} className="sm:col-span-2">
                {(id) => (
                  <Input
                    id={id}
                    value={draft.ownerName}
                    onChange={(e) => set({ ownerName: e.target.value })}
                    placeholder={t('Plate number or model')}
                    dir="auto"
                  />
                )}
              </Field>
            ) : draft.ownerType === 'other' ? (
              <Field label={t('Owner')} optional className="sm:col-span-2">
                {(id) => (
                  <Input
                    id={id}
                    value={draft.ownerName}
                    onChange={(e) => set({ ownerName: e.target.value })}
                    dir="auto"
                  />
                )}
              </Field>
            ) : null}
            <Field label={t('Document type')}>
              {(id) => (
                <Select
                  id={id}
                  value={draft.type}
                  onChange={(e) => set({ type: e.target.value as ComplianceDocument['type'] })}
                >
                  {types.map((type) => (
                    <option key={type} value={type}>
                      {t(DOCUMENT_TYPES[type].label)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('Title')} optional>
              {(id) => (
                <Input
                  id={id}
                  value={draft.title}
                  onChange={(e) => set({ title: e.target.value })}
                  placeholder={t(DOCUMENT_TYPES[draft.type].label)}
                  dir="auto"
                />
              )}
            </Field>
            <Field label={t('Document number')} optional>
              {(id) => (
                <Input
                  id={id}
                  value={draft.number}
                  onChange={(e) => set({ number: e.target.value })}
                  dir="auto"
                />
              )}
            </Field>
            <Field label={t('Issued by')} optional>
              {(id) => (
                <Input
                  id={id}
                  value={draft.issuer}
                  onChange={(e) => set({ issuer: e.target.value })}
                  placeholder={t('e.g. Ministry of Commerce and Industry')}
                  dir="auto"
                />
              )}
            </Field>
            <Field label={t('Issue date')} optional>
              {(id) => (
                <DateField
                  id={id}
                  value={draft.issueDate ?? ''}
                  onChange={(iso) => set({ issueDate: iso || null })}
                />
              )}
            </Field>
            <Field label={t('Expiry date')}>
              {(id) => (
                <DateField
                  id={id}
                  value={draft.expiryDate ?? ''}
                  onChange={(iso) => set({ expiryDate: iso || null })}
                />
              )}
            </Field>
            <Field
              label={t('Renewal cost')}
              optional
              hint={t('What the next renewal is expected to cost.')}
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.renewalCost}
                  onValueChange={(renewalCost) => set({ renewalCost })}
                  allowNegative={false}
                  blankZero
                />
              )}
            </Field>
            <Field
              label={t('Reminders (days before expiry)')}
              optional
              hint={t('Leave empty to use the company setting.')}
            >
              {(id) => (
                <Input
                  id={id}
                  value={daysText}
                  onChange={(e) => setDaysText(e.target.value)}
                  placeholder={defaultReminderDays.join(', ')}
                  inputMode="numeric"
                  dir="ltr"
                />
              )}
            </Field>
            <Field label={t('Notes')} optional className="sm:col-span-2">
              {(id) => (
                <Textarea
                  id={id}
                  rows={2}
                  value={draft.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">{t('Files')}</p>
            <FileList
              files={files.files}
              onAdd={files.add}
              onRemove={(f) => files.remove(f.id)}
              emptyText={t('Attach a scan of the document to keep it at hand.')}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          {!isNew && !readOnly ? (
            <div className="flex gap-2 sm:me-auto">
              <Button variant="ghost" onClick={() => void archive()}>
                {document.archived ? <ArchiveRestore /> : <Archive />}
                {document.archived ? t('Restore') : t('Archive')}
              </Button>
              <Button
                variant="ghost"
                className="text-red-600 hover:bg-red-50"
                onClick={() => void remove()}
              >
                <Trash2 /> {t('Delete')}
              </Button>
            </div>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {isNew ? t('Add document') : t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
