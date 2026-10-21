import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { deleteVehicle, saveVehicle, setVehicleArchived } from '@/db/vehicles';
import type { Vehicle } from '@/db/types';
import { useCompany } from '@/app/company';
import { isCurrent } from '@/lib/hr/employees';
import { useRoleView } from '@/features/cloud/role-gates';
import { useEmployees } from '@/features/people/hooks';
import { Button } from '@/components/ui/button';
import { useReadOnly } from '@/components/ui/read-only';
import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  useConfirm,
} from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import { useRegisterExtras } from './hooks';

/**
 * Adds or edits a company vehicle: its plate, what it is, the fixed asset it
 * is in the books as and, for those who see employees, its usual driver
 * (who then needs a valid driving licence when the company checks them).
 */
export function VehicleDialog({
  vehicle,
  isNew,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle;
  isNew: boolean;
  onClose: () => void;
  onSaved?: (vehicle: Vehicle) => void;
}) {
  const company = useCompany();
  const confirm = useConfirm();
  const { readOnly } = useReadOnly();
  const { peopleHidden } = useRoleView();
  const { cloudReady } = useRegisterExtras();
  const employees = useEmployees();
  const assets = useLiveQuery(
    () => db.assets.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const [draft, setDraft] = useState(vehicle);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Vehicle>) => setDraft((d) => ({ ...d, ...patch }));
  const locked = readOnly || !cloudReady;

  const drivers = useMemo(
    () =>
      (peopleHidden ? [] : (employees ?? []))
        .filter((e) => isCurrent(e) || e.id === draft.driverEmployeeId)
        .sort((a, b) => localName(a).localeCompare(localName(b)))
        .map((e) => ({
          value: e.id,
          label: localName(e),
          detail: e.number,
          keywords: `${e.name} ${e.nameAr ?? ''} ${e.jobTitle}`,
        })),
    [employees, peopleHidden, draft.driverEmployeeId],
  );
  const assetOptions = (assets ?? [])
    .filter((a) => a.status === 'active' || a.id === draft.assetId)
    .sort((a, b) => a.number.localeCompare(b.number));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveVehicle(draft);
      toast.success(isNew ? t('Vehicle added') : t('Vehicle saved'), { description: saved.plate });
      onSaved?.(saved);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the vehicle.'));
      setSaving(false);
    }
  };

  const archive = async () => {
    try {
      await setVehicleArchived(draft.id, !vehicle.archived);
      toast.success(vehicle.archived ? t('Vehicle restored') : t('Vehicle archived'));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the vehicle.'));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Delete this vehicle?'),
      description: t('This cannot be undone.'),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteVehicle(draft.id);
      toast.success(t('Vehicle deleted'));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not delete the vehicle.'));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={isNew ? t('Add vehicle') : t('Edit vehicle')}
        description={t('Its registration, insurance and other papers are kept with it.')}
      >
        <DialogBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('Plate number')} className="sm:col-span-2">
              {(id) => (
                <Input
                  id={id}
                  value={draft.plate}
                  onChange={(e) => set({ plate: e.target.value })}
                  dir="auto"
                  disabled={locked}
                />
              )}
            </Field>
            <Field label={t('Make')} optional>
              {(id) => (
                <Input
                  id={id}
                  value={draft.make}
                  onChange={(e) => set({ make: e.target.value })}
                  placeholder={t('e.g. Toyota')}
                  dir="auto"
                  disabled={locked}
                />
              )}
            </Field>
            <Field label={t('Model')} optional>
              {(id) => (
                <Input
                  id={id}
                  value={draft.model}
                  onChange={(e) => set({ model: e.target.value })}
                  dir="auto"
                  disabled={locked}
                />
              )}
            </Field>
            <Field label={t('Year made')} optional>
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.year ?? 0}
                  onValueChange={(year) => set({ year: year || null })}
                  allowNegative={false}
                  blankZero
                  disabled={locked}
                />
              )}
            </Field>
            <Field label={t('Chassis number')} optional>
              {(id) => (
                <Input
                  id={id}
                  value={draft.chassisNumber ?? ''}
                  onChange={(e) => set({ chassisNumber: e.target.value })}
                  dir="ltr"
                  disabled={locked}
                />
              )}
            </Field>
            {peopleHidden ? null : (
              <Field
                label={t('Driver')}
                optional
                className="sm:col-span-2"
                hint={t('Needs a valid driving licence when the company checks them.')}
              >
                {(id) => (
                  <Combobox
                    id={id}
                    value={draft.driverEmployeeId ?? ''}
                    onChange={(driverEmployeeId) =>
                      set({ driverEmployeeId: driverEmployeeId || null })
                    }
                    options={[{ value: '', label: t('No driver') }, ...drivers]}
                    placeholder={t('Choose an employee…')}
                    searchPlaceholder={t('Search employees…')}
                    emptyText={t('No matches')}
                    disabled={locked}
                  />
                )}
              </Field>
            )}
            {assetOptions.length > 0 ? (
              <Field label={t('Fixed asset')} optional className="sm:col-span-2">
                {(id) => (
                  <Select
                    id={id}
                    value={draft.assetId ?? ''}
                    onChange={(e) => set({ assetId: e.target.value || null })}
                    disabled={locked}
                  >
                    <option value="">{t('Not in the asset register')}</option>
                    {assetOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {[a.number, localName(a)].filter(Boolean).join(' ')}
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
                  value={draft.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                  disabled={locked}
                />
              )}
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          {!isNew && !locked ? (
            <div className="flex gap-2 sm:me-auto">
              <Button variant="ghost" onClick={() => void archive()}>
                {vehicle.archived ? <ArchiveRestore /> : <Archive />}
                {vehicle.archived ? t('Restore') : t('Archive')}
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
            {locked ? t('Close') : t('Cancel')}
          </Button>
          {locked ? null : (
            <Button onClick={() => void save()} loading={saving}>
              {isNew ? t('Add vehicle') : t('Save')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
