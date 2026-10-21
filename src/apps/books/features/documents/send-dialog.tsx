import { useMemo, useState } from 'react';
import { AlertTriangle, Copy, Mail, MessageCircle, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Client, Company, InvoiceDocument } from '@/db/types';
import { checkMarkSent, markSent } from '@/db/documents';
import { logActivity } from '@/db/activity';
import { useFormat } from '@/app/company';
import { fillTemplate, isValidEmail, mailtoLink } from '@/lib/email';
import { formatDate, formatMoney } from '@/lib/format';
import { normalizeKuwaitPhone } from '@/lib/kuwait';
import { today } from '@/lib/dates';
import { downloadName } from '@/lib/file-names';
import {
  isLinkExpired,
  shareMessage,
  whatsappNumber,
  whatsappUrl,
  type MessageLanguage,
} from '@/lib/whatsapp';
import { msg, t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form';
import { Segmented } from '@/components/ui/misc';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { useReadOnly } from '@/components/ui/read-only';
import { downloadBlob } from '@/pdf/client';
import { salesType } from '@/lib/document-types';

export type EmailKind = 'document' | 'reminder';

/** The online payment link to send: the document's own (unless expired), else the company's. */
export function documentPaymentLink(doc: InvoiceDocument, company: Company): string {
  if (doc.paymentLink?.url && !isLinkExpired(doc.paymentLink, today())) return doc.paymentLink.url;
  return company.payment.paymentLink?.trim() ?? '';
}

export function emailValues(doc: InvoiceDocument, company: Company, client: Client | null) {
  const contact = client?.contacts.find((c) => c.primary) ?? client?.contacts[0];
  const money = (n: number) =>
    formatMoney(n, doc.currency, company.locale, company.currencyDisplay ?? 'local');
  const link = documentPaymentLink(doc, company);
  return {
    client: client?.name ?? '',
    contact: contact?.name || client?.name || 'there',
    number: doc.number,
    amount: money(doc.totals.total),
    balance: money(doc.totals.balance),
    issueDate: formatDate(doc.issueDate, company.dateFormat, company.locale),
    dueDate: formatDate(doc.dueDate, company.dateFormat, company.locale) || '—',
    company: company.name,
    // Email templates are written by the company, in its own words.
    paymentLink: link ? `Pay online: ${link}` : '',
  };
}

/**
 * A draft sent with "Mark as sent": the status change is tried first, so its
 * signed copy never leaves while it stays a draft (a locked period, a role
 * that may only view…), and the real reason is shown.
 */
async function readyToMark(doc: InvoiceDocument, marking: boolean): Promise<void> {
  if (marking && doc.status === 'draft') await checkMarkSent(doc.id);
}

/** After it went out: marks it as sent and notes it; says so if marking it fails. */
async function noteSent(
  doc: InvoiceDocument,
  marking: boolean,
  readOnly: boolean,
  log: () => Promise<void>,
): Promise<void> {
  if (marking && doc.status === 'draft') {
    try {
      await markSent(doc.id);
    } catch (error) {
      toast.error(
        t('{number} went out, but could not be marked as sent: {reason}', {
          number: doc.number,
          reason: error instanceof Error ? error.message : t('Something went wrong.'),
        }),
      );
      return;
    }
  }
  // Viewers can't write to the log; what was sent went out all the same.
  if (!readOnly) await log().catch(() => undefined);
}

/** Whether this browser can share a PDF file with other apps (phones mostly). */
export function canSharePdf(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File([''], 'test.pdf', { type: 'application/pdf' })] })
  );
}

export function SendDialog({
  open,
  onOpenChange,
  doc,
  company,
  client,
  kind = 'document',
  getPdf,
  fileName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: InvoiceDocument;
  company: Company;
  client: Client | null;
  kind?: EmailKind;
  /** The PDF; `issued` asks for a draft's copy as sent, when it is marked as sent too. */
  getPdf: (issued?: boolean) => Promise<Blob>;
  fileName: string;
}) {
  const template =
    kind === 'reminder'
      ? company.emailTemplates.reminder
      : company.emailTemplates[salesType(doc.type)];
  const values = useMemo(() => emailValues(doc, company, client), [doc, company, client]);
  const contacts = (client?.contacts ?? []).filter((c) => c.email);
  const [to, setTo] = useState(
    contacts.find((c) => c.primary)?.email ?? contacts[0]?.email ?? client?.email ?? '',
  );
  const [subject, setSubject] = useState(fillTemplate(template.subject, values));
  const [body, setBody] = useState(fillTemplate(template.body, values));
  // Viewers can't mark it as sent: their copy of a draft stays a draft.
  const { readOnly } = useReadOnly();
  const [markAsSent, setMarkAsSent] = useState(doc.status === 'draft' && !readOnly);
  const [busy, setBusy] = useState<'mail' | 'share' | null>(null);
  const canShare = canSharePdf();

  const recipients = to
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const invalid = recipients.filter((r) => !isValidEmail(r));

  const afterSend = (via: string) =>
    noteSent(doc, markAsSent, readOnly, async () => {
      const vars = { number: doc.number, recipients: recipients.join(', '), via };
      await logActivity(
        company.id,
        doc.type,
        doc.id,
        kind === 'reminder' ? 'reminded' : 'emailed',
        kind === 'reminder'
          ? recipients.length
            ? { text: msg('Reminder for {number} sent to {recipients} ({via})'), vars }
            : { text: msg('Reminder for {number} sent ({via})'), vars }
          : recipients.length
            ? { text: msg('{number} sent to {recipients} ({via})'), vars }
            : { text: msg('{number} sent ({via})'), vars },
        { clientId: doc.clientId || null, documentId: doc.id },
      );
    });

  const openMail = async () => {
    setBusy('mail');
    try {
      await readyToMark(doc, markAsSent);
      // Email links cannot carry attachments, so download the PDF to attach.
      downloadBlob(await getPdf(markAsSent), fileName);
      window.location.assign(mailtoLink({ to: recipients, subject, body }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not prepare the email.'));
      setBusy(null);
      return;
    }
    toast.success(t('PDF downloaded. Attach it to the email that just opened.'));
    await afterSend(t('email app'));
    setBusy(null);
    onOpenChange(false);
  };

  const share = async () => {
    setBusy('share');
    try {
      await readyToMark(doc, markAsSent);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
      setBusy(null);
      return;
    }
    try {
      const file = new File([await getPdf(markAsSent)], downloadName(fileName), {
        type: 'application/pdf',
      });
      await navigator.share({ files: [file], title: subject, text: body });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        toast.error(t('Sharing failed. Try “Open email app” instead.'));
      }
      setBusy(null);
      return;
    }
    await afterSend(t('share'));
    setBusy(null);
    onOpenChange(false);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(`${subject}\n\n${body}`);
    toast.success(t('Email text copied'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={
          kind === 'reminder'
            ? t('Send a payment reminder')
            : t('Send {number}', { number: doc.number })
        }
        description={t(
          'Opens your email app with the message ready. The PDF is downloaded so you can attach it.',
        )}
        size="lg"
      >
        <DialogBody>
          <Field
            label={t('To')}
            error={
              invalid.length ? t('Check: {emails}', { emails: invalid.join(', ') }) : undefined
            }
            hint={t('Separate several addresses with commas.')}
          >
            {(id) => (
              <Input
                id={id}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="client@example.com"
                dir="ltr"
              />
            )}
          </Field>
          {contacts.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {contacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-200"
                  onClick={() =>
                    setTo((v) =>
                      v.includes(c.email) ? v : [v, c.email].filter(Boolean).join(', '),
                    )
                  }
                >
                  + {c.name || c.email}
                </button>
              ))}
            </div>
          ) : null}
          <Field label={t('Subject')}>
            {(id) => <Input id={id} value={subject} onChange={(e) => setSubject(e.target.value)} />}
          </Field>
          <Field label={t('Message')}>
            {(id) => (
              <Textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} rows={9} />
            )}
          </Field>
          {doc.status === 'draft' && !readOnly ? (
            <Checkbox
              checked={markAsSent}
              onChange={(e) => setMarkAsSent(e.target.checked)}
              label={t('Mark as sent')}
              description={
                markAsSent
                  ? t('Moves the document out of drafts.')
                  : t('The PDF stays a draft: a DRAFT watermark, without the signature and stamp.')
              }
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={copy}>
            <Copy /> {t('Copy text')}
          </Button>
          {canShare ? (
            <Button
              variant="outline"
              onClick={share}
              loading={busy === 'share'}
              disabled={busy !== null}
            >
              <Share2 /> {t('Share PDF…')}
            </Button>
          ) : null}
          <Button
            onClick={openMail}
            loading={busy === 'mail'}
            disabled={busy !== null || invalid.length > 0}
          >
            <Mail /> {t('Open email app')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The client's mobile number for WhatsApp: the primary contact's, else the client's. */
function clientPhone(client: Client | null): string {
  const contact =
    client?.contacts.find((c) => c.primary && c.phone) ?? client?.contacts.find((c) => c.phone);
  return contact?.phone || client?.phone || '';
}

/**
 * Shares an invoice or quote on WhatsApp: a short message with the number,
 * amount, due date and payment link, in English, Arabic or both. Phones
 * that can share files also offer to send the PDF.
 */
export function WhatsAppDialog({
  open,
  onOpenChange,
  doc,
  company,
  client,
  getPdf,
  fileName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: InvoiceDocument;
  company: Company;
  client: Client | null;
  /** The PDF; `issued` asks for a draft's copy as sent, when it is marked as sent too. */
  getPdf: (issued?: boolean) => Promise<Blob>;
  fileName: string;
}) {
  const fmt = useFormat();
  const [language, setLanguage] = useState<MessageLanguage>('both');
  const [phone, setPhone] = useState(clientPhone(client));
  // Viewers can't mark it as sent: their copy of a draft stays a draft.
  const { readOnly } = useReadOnly();
  const [markAsSent, setMarkAsSent] = useState(doc.status === 'draft' && !readOnly);
  const [busy, setBusy] = useState(false);
  const expired = isLinkExpired(doc.paymentLink, today());
  const link = documentPaymentLink(doc, company);
  const build = (lang: MessageLanguage) =>
    shareMessage({
      type: doc.type === 'quote' ? 'quote' : doc.type === 'credit' ? 'credit' : 'invoice',
      number: doc.number,
      total: doc.totals.total,
      balance: doc.status === 'void' ? 0 : doc.totals.balance,
      currency: doc.currency,
      dueDate: doc.dueDate,
      company,
      client,
      paymentLink: link,
      dateFormat: company.dateFormat,
      locale: company.locale,
      currencyDisplay: company.currencyDisplay ?? 'local',
      language: lang,
    });
  const [text, setText] = useState(() => build('both'));
  const number = whatsappNumber(phone);
  const kuwaiti = normalizeKuwaitPhone(phone);
  const canShare = canSharePdf();

  const afterShare = (via: string) =>
    noteSent(doc, markAsSent, readOnly, async () => {
      await logActivity(
        company.id,
        doc.type,
        doc.id,
        'shared',
        { text: msg('{number} shared on {via}'), vars: { number: doc.number, via } },
        { clientId: doc.clientId || null, documentId: doc.id },
      );
    });

  const openWhatsApp = async () => {
    // The message carries no PDF, so nothing signed leaves before the change.
    window.open(whatsappUrl(phone, text), '_blank', 'noopener,noreferrer');
    await afterShare('WhatsApp');
    onOpenChange(false);
  };

  const sharePdf = async () => {
    setBusy(true);
    try {
      await readyToMark(doc, markAsSent);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
      setBusy(false);
      return;
    }
    try {
      const file = new File([await getPdf(markAsSent)], downloadName(fileName), {
        type: 'application/pdf',
      });
      await navigator.share({ files: [file], text });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        toast.error(t('Sharing failed. Try “Open WhatsApp” instead.'));
      }
      setBusy(false);
      return;
    }
    await afterShare(t('share'));
    setBusy(false);
    onOpenChange(false);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    toast.success(t('Message copied'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('Share {number} on WhatsApp', { number: doc.number })}
        description={t('Opens WhatsApp with the message ready to send.')}
        size="lg"
      >
        <DialogBody>
          <Field
            label={t('Mobile number')}
            hint={
              number
                ? t('Opens a chat with {number}.', { number: kuwaiti ?? `+${number}` })
                : t('No number: WhatsApp asks who to send it to.')
            }
          >
            {(id) => (
              <Input
                id={id}
                type="tel"
                dir="ltr"
                className="rtl:text-end"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+965 5XXX XXXX"
              />
            )}
          </Field>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700">{t('Language of the message')}</p>
            <Segmented
              size="sm"
              value={language}
              onChange={(value) => {
                setLanguage(value);
                setText(build(value));
              }}
              options={[
                { value: 'both', label: t('English and Arabic') },
                { value: 'en', label: 'English' },
                { value: 'ar', label: 'العربية' },
              ]}
            />
          </div>
          {expired ? (
            <p
              role="alert"
              className="flex gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {link
                ? t('The payment link expired on {date}; the company link is sent instead.', {
                    date: fmt.date(doc.paymentLink?.expiresAt),
                  })
                : t('The payment link expired on {date}, so it is left out.', {
                    date: fmt.date(doc.paymentLink?.expiresAt),
                  })}
            </p>
          ) : null}
          <Field label={t('Message')}>
            {(id) => (
              <Textarea
                id={id}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                dir="auto"
              />
            )}
          </Field>
          {doc.status === 'draft' && !readOnly ? (
            <Checkbox
              checked={markAsSent}
              onChange={(e) => setMarkAsSent(e.target.checked)}
              label={t('Mark as sent')}
              description={
                markAsSent
                  ? t('Moves the document out of drafts.')
                  : t('The PDF stays a draft: a DRAFT watermark, without the signature and stamp.')
              }
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={copy}>
            <Copy /> {t('Copy text')}
          </Button>
          {canShare ? (
            <Button variant="outline" onClick={sharePdf} loading={busy} disabled={busy}>
              <Share2 /> {t('Share PDF…')}
            </Button>
          ) : null}
          <Button onClick={() => void openWhatsApp()} disabled={busy}>
            <MessageCircle /> {t('Open WhatsApp')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
