import { useState } from 'react';
import { toast } from 'sonner';
import { saveWarehouse } from '@/db/inventory';
import type { Warehouse } from '@/db/types';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input, Switch, Textarea } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';

/** Adds or edits a warehouse (a showroom, a store in Shuwaikh or Al-Rai). */
export function WarehouseDialog({
  warehouse,
  onClose,
}: {
  warehouse: Warehouse;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(warehouse);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isNew = !warehouse.name;
  const set = (patch: Partial<Warehouse>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    if (!draft.name.trim()) {
      setError(t('Enter a name for the warehouse.'));
      return;
    }
    setSaving(true);
    try {
      await saveWarehouse(draft);
      toast.success(t('{name} saved', { name: draft.name.trim() }));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Could not save.'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={isNew ? t('New warehouse') : t('Edit {name}', { name: warehouse.name })}
        description={t('A place you keep stock, such as a showroom or a store.')}
      >
        <DialogBody>
          <Field label={t('Name')} error={error}>
            {(id) => (
              <Input
                id={id}
                value={draft.name}
                onChange={(e) => {
                  set({ name: e.target.value });
                  setError('');
                }}
                placeholder={t('e.g. Shuwaikh store')}
                autoFocus
                aria-invalid={Boolean(error)}
              />
            )}
          </Field>
          <Field label={t('Arabic name')} optional>
            {(id) => (
              <Input
                id={id}
                dir="rtl"
                lang="ar"
                value={draft.nameAr ?? ''}
                onChange={(e) => set({ nameAr: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('Address')} optional>
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={draft.address}
                onChange={(e) => set({ address: e.target.value })}
              />
            )}
          </Field>
          <Switch
            checked={draft.isDefault}
            onChange={(isDefault) => set({ isDefault })}
            disabled={warehouse.isDefault}
            label={t('Default warehouse')}
            description={t('Bills and invoices move stock here unless a line says otherwise.')}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} loading={saving}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
