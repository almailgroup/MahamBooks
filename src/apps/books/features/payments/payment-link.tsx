import { useState } from 'react';
import { AlertTriangle, ExternalLink, Link2, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { setPaymentLink } from '@/db/payments';
import type { InvoiceDocument, PaymentLink, PaymentLinkProvider } from '@/db/types';
import { useFormat } from '@/app/company';
import { addDaysISO, today } from '@/lib/dates';
import { PAYMENT_PROVIDERS, providerLabel } from '@/lib/payment-methods';
import { isLinkExpired, isValidPaymentLink } from '@/lib/whatsapp';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/misc';
import { Field, Input, Select } from '@/components/ui/form';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  useConfirm,
} from '@/components/ui/overlay';
import { DateField } from '@/components/ui/date-field';

const LINK_PROVIDERS = PAYMENT_PROVIDERS.filter((p) => p.kind !== 'bnpl') as {
  value: PaymentLinkProvider;
  label: string;
}[];

/** Adds or changes the online payment link of a document. */
export function PaymentLinkDialog({ doc, onClose }: { doc: InvoiceDocument; onClose: () => void }) {
  const [link, setLink] = useState<PaymentLink>(
    doc.paymentLink ?? { provider: 'myfatoorah', url: '', expiresAt: null },
  );
  const [saving, setSaving] = useState(false);
  const urlError = link.url.trim() && !isValidPaymentLink(link.url);
  const save = async () => {
    setSaving(true);
    try {
      await setPaymentLink(doc.id, link);
      toast.success(t('Payment link saved'));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={doc.paymentLink ? t('Change payment link') : t('Add payment link')}
        description={t(
          'The client pays online with KNET or a card. The link is printed on the PDF and sent with WhatsApp messages.',
        )}
      >
        <DialogBody>
          <Field label={t('Provider')}>
            {(id) => (
              <Select
                id={id}
                value={link.provider}
                onChange={(e) =>
                  setLink({ ...link, provider: e.target.value as PaymentLinkProvider })
                }
              >
                {LINK_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {t(p.label)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('Link')}
            error={urlError ? t('Enter the full link, starting with https://') : undefined}
          >
            {(id) => (
              <Input
                id={id}
                type="url"
                dir="ltr"
                value={link.url}
                onChange={(e) => setLink({ ...link, url: e.target.value })}
                placeholder="https://"
                aria-invalid={urlError || undefined}
                autoFocus
              />
            )}
          </Field>
          <Field
            label={t('Valid until')}
            optional
            hint={t('Some links stop working after 24 hours.')}
          >
            {(id) => (
              <div className="flex flex-wrap gap-2">
                <DateField
                  id={id}
                  className="w-auto flex-1"
                  value={link.expiresAt ?? ''}
                  onChange={(iso) => setLink({ ...link, expiresAt: iso || null })}
                />
                <Button
                  variant="outline"
                  onClick={() => setLink({ ...link, expiresAt: addDaysISO(today(), 1) })}
                >
                  {t('24 hours')}
                </Button>
              </div>
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {t('Save link')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The document's payment link, with a warning once it has expired. */
export function PaymentLinkCard({ doc }: { doc: InvoiceDocument }) {
  const fmt = useFormat();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const link = doc.paymentLink;
  const expired = isLinkExpired(link, today());
  const canAdd = doc.status !== 'void' && doc.status !== 'paid';

  const remove = async () => {
    const ok = await confirm({
      title: t('Remove the payment link?'),
      confirmLabel: t('Remove'),
      danger: true,
    });
    if (!ok) return;
    try {
      await setPaymentLink(doc.id, null);
      toast.success(t('Payment link removed'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
    }
  };

  return (
    <Card>
      <CardHeader
        title={t('Payment link')}
        actions={
          link ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setEditing(true)}
                aria-label={t('Change payment link')}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void remove()}
                aria-label={t('Remove the payment link')}
              >
                <Trash2 />
              </Button>
            </>
          ) : null
        }
      />
      <CardBody className="space-y-3 py-4 text-sm">
        {link ? (
          <>
            <p className="text-slate-500">{t(providerLabel(link.provider))}</p>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="text-primary-700 flex items-center gap-1.5 font-medium break-all hover:underline"
            >
              <ExternalLink className="size-4 shrink-0" aria-hidden />
              {link.url}
            </a>
            {expired ? (
              <p role="alert" className="flex gap-2 rounded-md bg-amber-50 p-2.5 text-amber-900">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t('This link expired on {date}. Add a new one before sending the invoice.', {
                  date: fmt.date(link.expiresAt),
                })}
              </p>
            ) : link.expiresAt ? (
              <p className="text-slate-500">
                {t('Valid until {date}', { date: fmt.date(link.expiresAt) })}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-slate-500">
              {t(
                'Let the client pay online with KNET or a card through MyFatoorah, Tap or your bank.',
              )}
            </p>
            {canAdd ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Link2 /> {t('Add payment link')}
              </Button>
            ) : null}
          </>
        )}
      </CardBody>
      {editing ? <PaymentLinkDialog doc={doc} onClose={() => setEditing(false)} /> : null}
    </Card>
  );
}
