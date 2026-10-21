import { useId, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import {
  addDocumentPurpose,
  deleteComplianceDocument,
  documentRenewals,
  makeDocumentConfidential,
  saveComplianceDocument,
  setDocumentArchived,
} from '@/db/renewals';
import { createVehicle } from '@/db/vehicles';
import { isCustomer } from '@/db/purchases';
import type { ComplianceDocument, DocumentOwnerType, Employee, Vehicle } from '@/db/types';
import { useCompany } from '@/app/company';
import {
  checksDrivingLicences,
  CUSTOMER_DOCUMENT_TYPES,
  DOCUMENT_TYPES,
  documentTypeInfo,
  needsTitle,
  OWNER_LABELS,
  registerTypesFor,
  normalizeReminderDays,
  recordKey,
} from '@/lib/compliance';
import { isKnown } from '@/lib/known';
import { isCurrent } from '@/lib/hr/employees';
import { normalizeDigits } from '@/lib/money';
import { useRoleView } from '@/features/cloud/role-gates';
import { usePeopleSettings } from '@/features/people/hooks';
import { useDraftAttachments } from '@/features/purchases/attachments';
import { FileList } from '@/features/people/file-list';
import { Button } from '@/components/ui/button';
import { useReadOnly } from '@/components/ui/read-only';
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
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
import { useRegisterExtras, useVehicles } from './hooks';
import { vehicleLabel } from './text';
import { VehicleDialog } from './vehicle-dialog';

const OWNERS: DocumentOwnerType[] = ['company', 'employee', 'vehicle', 'other'];

/** "60, 30, 7" ⇄ [60, 30, 7]; empty uses the company setting. */
function parseDays(text: string): number[] | null {
  const days = normalizeDigits(text)
    .split(/[^\d]+/)
    .map(Number)
    .filter((n) => n > 0);
  return days.length ? normalizeReminderDays(days) : null;
}

const ARABIC = /[؀-ۿ]/;

/**
 * Adds or edits a document in the register: a licence, a vehicle, an
 * employee's insurance. With the register's extras, also contracts and a
 * customer's papers, what each document is for, the company's vehicles and
 * confidential documents.
 */
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
  const { peopleHidden } = useRoleView();
  const { on: extras, cloudReady } = useRegisterExtras();
  // The licence class is asked once the company checks drivers' licences (or kept once stored).
  const checksLicences = checksDrivingLicences(usePeopleSettings());
  const vehicles = useVehicles();
  const clients = useLiveQuery(
    () => (extras ? db.clients.where('companyId').equals(company.id).toArray() : []),
    [company.id, extras],
  );
  const [draft, setDraft] = useState(document);
  const [daysText, setDaysText] = useState(document.reminderDays?.join(', ') ?? '');
  const [saving, setSaving] = useState(false);
  // A new cost sheet starts confidential, until the box is changed by hand.
  const [confidentialTouched, setConfidentialTouched] = useState(!isNew);
  const [newVehicle, setNewVehicle] = useState<Vehicle | null>(null);
  const [newPurpose, setNewPurpose] = useState<{ name: string; nameAr: string } | null>(null);
  const files = useDraftAttachments(draft.id);
  const ownerLabel = useId();
  const set = (patch: Partial<ComplianceDocument>) => setDraft((d) => ({ ...d, ...patch }));

  // The document's own type stays on the list, whatever is offered now. A
  // customer's cost sheet waits for a cloud that keeps it confidential.
  const offered = registerTypesFor(draft.ownerType, extras).filter(
    (type) => cloudReady || type !== 'customer_cost',
  );
  const costSheetsWait = extras && !cloudReady && draft.ownerType === 'other';
  const types =
    offered.includes(draft.type) || !isKnown(DOCUMENT_TYPES, draft.type)
      ? offered
      : [...offered, draft.type];
  const titleRequired = needsTitle(draft.type);
  const customerRequired = CUSTOMER_DOCUMENT_TYPES.includes(draft.type);
  // Confidential documents are people data: only those who see it choose. An
  // employee's papers are private already.
  const showConfidential =
    draft.ownerType !== 'employee' && ((extras && !peopleHidden) || document.confidential === true);
  const confidentialLocked = readOnly || document.confidential === true || !cloudReady;

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
  const customerOptions = useMemo(
    () =>
      (clients ?? [])
        .filter((c) => (isCustomer(c) && !c.archived) || c.id === draft.clientId)
        .sort((a, b) => localName(a).localeCompare(localName(b)))
        .map((c) => ({
          value: c.id,
          label: localName(c),
          detail: c.number,
          keywords: `${c.name} ${c.nameAr ?? ''}`,
        })),
    [clients, draft.clientId],
  );
  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? [])
        .filter((v) => !v.archived || v.id === draft.vehicleId)
        .sort((a, b) => a.plate.localeCompare(b.plate))
        .map((v) => ({
          value: v.id,
          label: v.plate,
          detail: vehicleLabel({ ...v, plate: '' }),
          keywords: v.chassisNumber,
        })),
    [vehicles, draft.vehicleId],
  );
  const purposeOptions = (company.documentPurposes ?? [])
    .filter((p) => !p.archived || p.id === draft.purposeId)
    .map((p) => ({ value: p.id, label: localName(p), keywords: `${p.name} ${p.nameAr}` }));

  const setType = (type: ComplianceDocument['type'], patch: Partial<ComplianceDocument> = {}) => {
    const auto =
      !confidentialTouched && showConfidential && !confidentialLocked
        ? { confidential: type === 'customer_cost' }
        : {};
    set({ ...patch, type, ...auto });
  };

  const setOwner = (ownerType: DocumentOwnerType) => {
    const allowed = registerTypesFor(ownerType, extras).filter(
      (type) => cloudReady || type !== 'customer_cost',
    );
    setType(allowed.includes(draft.type) ? draft.type : allowed[0], { ownerType });
  };

  const addPurpose = async (input: { name: string; nameAr: string }) => {
    try {
      const purpose = await addDocumentPurpose(company.id, input);
      set({ purposeId: purpose.id });
      setNewPurpose(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the purpose.'));
    }
  };

  const save = async () => {
    const input = { ...draft, reminderDays: parseDays(daysText) };
    const becomesConfidential = !isNew && !document.confidential && draft.confidential === true;
    if (becomesConfidential) {
      const ok = await confirm({
        title: t('Make this document confidential?'),
        description: t(
          'Staff and viewers stop seeing it, its files, renewals and activity: their copies are removed from their devices. This can’t be undone.',
        ),
        confirmLabel: t('Make confidential'),
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      let saved: ComplianceDocument;
      if (becomesConfidential) {
        // Its files and its renewals' are saved again with it: those still in
        // the cloud are fetched first (not the ones taken off the list).
        const kept = new Set(files.files.map((f) => f.id));
        const renewals = await documentRenewals(recordKey(document.id));
        const missing = (
          await db.attachments
            .where('ownerId')
            .anyOf([document.id, ...renewals.map((r) => r.id)])
            .toArray()
        ).filter((f) => !f.dataUrl && (f.ownerId !== document.id || kept.has(f.id)));
        if (missing.length) {
          const { attachmentContent } = await import('@/cloud/attachments');
          for (const file of missing) await attachmentContent(file.id);
        }
        // The files taken off the list go with the checks passed, never before.
        saved = await makeDocumentConfidential(input, { removedFiles: files.removed });
        await files.commit(company.id, saved.id);
      } else {
        saved = await saveComplianceDocument(input);
        await files.commit(company.id);
      }
      toast.success(isNew ? t('Document added') : t('Document saved'), {
        description: saved.title || t(documentTypeInfo(saved.type).label),
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

  /** Who it belongs to, typed: a vehicle or another owner not on a list. */
  const ownerInput = (label: string, optional: boolean, placeholder?: string) => (
    <Field label={label} optional={optional} className="sm:col-span-2">
      {(id) => (
        <Input
          id={id}
          value={draft.ownerName}
          onChange={(e) => set({ ownerName: e.target.value })}
          placeholder={placeholder}
          dir="auto"
        />
      )}
    </Field>
  );

  return (
    <>
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
              ) : draft.ownerType === 'vehicle' && extras ? (
                <>
                  <Field
                    label={t('Vehicle')}
                    className="sm:col-span-2"
                    hint={
                      cloudReady
                        ? undefined
                        : t(
                            'The cloud needs the latest database script before vehicles can be added.',
                          )
                    }
                  >
                    {(id) => (
                      <Combobox
                        id={id}
                        value={draft.vehicleId ?? ''}
                        onChange={(vehicleId) => {
                          const vehicle = vehicles?.find((v) => v.id === vehicleId);
                          set({
                            vehicleId: vehicleId || null,
                            ...(vehicle ? { ownerName: vehicle.plate } : {}),
                          });
                        }}
                        options={[{ value: '', label: t('Not in the list') }, ...vehicleOptions]}
                        placeholder={t('Choose a vehicle…')}
                        searchPlaceholder={t('Search vehicles…')}
                        emptyText={t('No matches')}
                        onCreate={
                          cloudReady && !readOnly
                            ? (plate) => setNewVehicle(createVehicle(company.id, { plate }))
                            : undefined
                        }
                        createLabel={t('New vehicle')}
                      />
                    )}
                  </Field>
                  {draft.vehicleId
                    ? null
                    : ownerInput(t('Plate number or model'), false, t('Plate number or model'))}
                </>
              ) : draft.ownerType === 'vehicle' ? (
                ownerInput(t('Vehicle'), false, t('Plate number or model'))
              ) : draft.ownerType === 'other' ? (
                <>
                  {extras ? (
                    <Field
                      label={t('Customer')}
                      optional={!customerRequired}
                      className="sm:col-span-2"
                    >
                      {(id) => (
                        <Combobox
                          id={id}
                          value={draft.clientId ?? ''}
                          onChange={(clientId) => {
                            const client = clients?.find((c) => c.id === clientId);
                            set({
                              clientId: clientId || null,
                              ...(client ? { ownerName: client.name } : {}),
                            });
                          }}
                          options={[{ value: '', label: t('No customer') }, ...customerOptions]}
                          placeholder={t('Choose a customer…')}
                          searchPlaceholder={t('Search customers…')}
                          emptyText={t('No matches')}
                        />
                      )}
                    </Field>
                  ) : null}
                  {draft.clientId ? null : ownerInput(t('Owner'), true)}
                </>
              ) : null}
              <Field
                label={t('Document type')}
                hint={
                  costSheetsWait
                    ? t(
                        'Customer cost sheets can be added once the owner of the company runs the latest database script.',
                      )
                    : undefined
                }
              >
                {(id) => (
                  <Select
                    id={id}
                    value={draft.type}
                    onChange={(e) => setType(e.target.value as ComplianceDocument['type'])}
                  >
                    {types.map((type) => (
                      <option key={type} value={type}>
                        {t(documentTypeInfo(type).label)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('Title')} optional={!titleRequired}>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.title}
                    onChange={(e) => set({ title: e.target.value })}
                    placeholder={titleRequired ? undefined : t(documentTypeInfo(draft.type).label)}
                    dir="auto"
                  />
                )}
              </Field>
              {extras ? (
                <Field label={t('Purpose')} optional>
                  {(id) => (
                    <Combobox
                      id={id}
                      value={draft.purposeId ?? ''}
                      onChange={(purposeId) => set({ purposeId: purposeId || null })}
                      options={[{ value: '', label: t('No purpose') }, ...purposeOptions]}
                      placeholder={t('Choose a purpose…')}
                      searchPlaceholder={t('Search purposes…')}
                      emptyText={t('No matches')}
                      onCreate={
                        readOnly
                          ? undefined
                          : (text) =>
                              setNewPurpose(
                                ARABIC.test(text)
                                  ? { name: '', nameAr: text }
                                  : { name: text, nameAr: '' },
                              )
                      }
                      createLabel={t('Add purpose')}
                    />
                  )}
                </Field>
              ) : null}
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
              {draft.type === 'driving_licence' && (checksLicences || document.licenceClass) ? (
                <Field label={t('Licence class')} optional hint={t('As written on the licence.')}>
                  {(id) => (
                    <Input
                      id={id}
                      value={draft.licenceClass ?? ''}
                      onChange={(e) => set({ licenceClass: e.target.value })}
                      dir="auto"
                    />
                  )}
                </Field>
              ) : null}
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
              {showConfidential ? (
                <Checkbox
                  className="sm:col-span-2"
                  label={t('Confidential')}
                  description={
                    document.confidential === true
                      ? t('A confidential document stays confidential.')
                      : !cloudReady
                        ? t(
                            'The cloud needs the latest database script first. Ask the owner of the company to run it.',
                          )
                        : t(
                            'Only owners, admins and accountants see it, with its files, renewals and activity.',
                          )
                  }
                  checked={draft.confidential === true}
                  disabled={confidentialLocked}
                  onChange={(e) => {
                    setConfidentialTouched(true);
                    set({ confidential: e.target.checked });
                  }}
                />
              ) : null}
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
      {newVehicle ? (
        <VehicleDialog
          vehicle={newVehicle}
          isNew
          onClose={() => setNewVehicle(null)}
          onSaved={(vehicle) => set({ vehicleId: vehicle.id, ownerName: vehicle.plate })}
        />
      ) : null}
      {newPurpose ? (
        <PurposeDialog
          initial={newPurpose}
          onSave={addPurpose}
          onClose={() => setNewPurpose(null)}
        />
      ) : null}
    </>
  );
}

/** A new purpose for the company's documents, in English and Arabic. */
function PurposeDialog({
  initial,
  onSave,
  onClose,
}: {
  initial: { name: string; nameAr: string };
  onSave: (input: { name: string; nameAr: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('Add purpose')}
        description={t('What documents are for, such as a tender, a site or a bank facility.')}
        size="sm"
      >
        <DialogBody>
          <Field label={t('Name (English)')}>
            {(id) => (
              <Input
                id={id}
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                dir="auto"
              />
            )}
          </Field>
          <Field label={t('Name (Arabic)')} optional>
            {(id) => (
              <Input
                id={id}
                value={draft.nameAr}
                onChange={(e) => setDraft((d) => ({ ...d, nameAr: e.target.value }))}
                dir="rtl"
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {t('Add purpose')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
