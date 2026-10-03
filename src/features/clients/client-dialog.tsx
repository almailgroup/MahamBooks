import { useState } from 'react';
import { toast } from 'sonner';
import type { Client, Company } from '@/db/types';
import { createClient } from '@/db/defaults';
import { saveClient } from '@/db/records';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { t } from '@/i18n';
import { ClientForm, newContact, validateClient } from './client-form';
import { CONTACT_COPY, contactRoles, type ContactKind } from './contact-kind';

/** Quick "new client" (or vendor) dialog used from the editors and payments. */
export function ClientDialog({
  open,
  onOpenChange,
  company,
  initialName = '',
  onSaved,
  kind = 'customer',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company;
  initialName?: string;
  onSaved: (client: Client) => void;
  kind?: ContactKind;
}) {
  const copy = CONTACT_COPY[kind];
  const [client, setClient] = useState<Client>(() =>
    createClient(company.id, {
      ...contactRoles(kind),
      name: initialName,
      contacts: [newContact(true)],
      address: {
        line1: '',
        line2: '',
        city: '',
        state: '',
        postalCode: '',
        country: company.address.country,
      },
    }),
  );
  const [errors, setErrors] = useState<Partial<Record<'name', string>>>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const found = validateClient(client);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const saved = await saveClient({
        ...client,
        contacts: client.contacts.filter((c) => c.name || c.email || c.phone),
      });
      toast.success(t(copy.added, { name: saved.name }));
      onSaved(saved);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(copy.saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t(copy.newLabel)} description={t(copy.quickHint)} size="lg">
        <DialogBody>
          <ClientForm
            value={client}
            onChange={setClient}
            company={company}
            compact
            errors={errors}
            kind={kind}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} loading={saving}>
            {t(copy.saveLabel)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
