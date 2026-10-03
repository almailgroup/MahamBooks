import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { createClient } from '@/db/defaults';
import { saveClient } from '@/db/records';
import type { Client } from '@/db/types';
import { useCompany } from '@/app/company';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader, Spinner } from '@/components/ui/misc';
import { ClientForm, newContact, validateClient } from '@/features/clients/client-form';
import { CONTACT_COPY, contactRoles, type ContactKind } from '@/features/clients/contact-kind';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { t } from '@/i18n';

export default function ClientFormPage({ kind = 'customer' }: { kind?: ContactKind }) {
  const copy = CONTACT_COPY[kind];
  const { id } = useParams();
  const navigate = useNavigate();
  const company = useCompany();
  const [client, setClient] = useState<Client | null>(null);
  const [original, setOriginal] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'name', string>>>({});
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded: Client | undefined;
      if (id) {
        loaded = await db.clients.get(id);
        if (!loaded || loaded.companyId !== company.id) {
          if (!cancelled) setMissing(true);
          return;
        }
      } else {
        loaded = createClient(company.id, {
          ...contactRoles(kind),
          contacts: [newContact(true)],
          address: {
            line1: '',
            line2: '',
            city: '',
            state: '',
            postalCode: '',
            country: company.address.country,
          },
        });
      }
      if (!cancelled) {
        setClient(loaded);
        setOriginal(JSON.stringify(loaded));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, kind, company.id, company.address.country]);

  const dirty = client !== null && JSON.stringify(client) !== original;
  const allowNavigation = useUnsavedGuard(dirty && !saving);

  if (missing) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">{t(copy.notFound)}</p>
        <Link to={copy.base} className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {t(copy.back)}
        </Link>
      </Card>
    );
  }
  if (!client) return <Spinner className="py-24" label={t('Loading…')} />;

  const save = async () => {
    const found = validateClient(client);
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error(t('Please fix the highlighted fields.'));
      return;
    }
    setSaving(true);
    try {
      const saved = await saveClient({
        ...client,
        contacts: client.contacts.filter((c) => c.name.trim() || c.email.trim() || c.phone.trim()),
      });
      toast.success(t('{name} saved', { name: saved.name }));
      allowNavigation();
      navigate(`${copy.base}/${saved.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(copy.saveError));
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumb={<Link to={copy.base}>{t(copy.title)}</Link>}
        title={id && client.name ? t(copy.editTitle, { name: client.name }) : t(copy.newLabel)}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate(-1)}>
              {t('Cancel')}
            </Button>
            <Button onClick={save} loading={saving}>
              {t(copy.saveLabel)}
            </Button>
          </>
        }
      />
      <Card>
        <CardBody>
          <ClientForm
            value={client}
            onChange={setClient}
            company={company}
            errors={errors}
            kind={kind}
          />
        </CardBody>
      </Card>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          {t('Cancel')}
        </Button>
        <Button onClick={save} loading={saving}>
          {t(copy.saveLabel)}
        </Button>
      </div>
    </div>
  );
}
