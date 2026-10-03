import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, Paperclip, Pencil, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import {
  heldRetention,
  newCertificate,
  releaseRetention,
  removeCertificate,
  saveCertificate,
  undoRetentionRelease,
} from '@/db/retention';
import type { ClearanceCertificate, Client, InvoiceDocument, RetentionRelease } from '@/db/types';
import { DOCUMENT_ROUTES, useFormat } from '@/app/company';
import { isPosted } from '@/lib/accounting/ledger';
import { daysBetween, today } from '@/lib/dates';
import { receiptFromFile } from '@/lib/image';
import { currencyPrecision, dec, round } from '@/lib/money';
import {
  certificateValidOn,
  contactRetention,
  retentionKindLabel,
  RETENTION_KINDS,
  RETENTION_STATUS_META,
  retentionStatus,
  validCertificate,
} from '@/lib/retention';
import type { StatementSide } from '@/lib/statements';
import { t, tp } from '@/i18n';
import { Button, ButtonLink } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Field, Input, NumberInput, Textarea } from '@/components/ui/form';
import { Badge, Card, CardBody, CardHeader, EmptyState, Segmented } from '@/components/ui/misc';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  useConfirm,
} from '@/components/ui/overlay';

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/* -------------------------------------------------------------------------- */
/* Certificates                                                               */
/* -------------------------------------------------------------------------- */

function CertificateDialog({
  client,
  certificate,
  onClose,
}: {
  client: Client;
  certificate: ClearanceCertificate | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState<ClearanceCertificate>(() => certificate ?? newCertificate());
  const [file, setFile] = useState<{ name: string; type: string; dataUrl: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ClearanceCertificate>) => setValue((v) => ({ ...v, ...patch }));

  const pick = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    if (!chosen) return;
    try {
      const read = await receiptFromFile(chosen);
      setFile({ name: chosen.name, ...read });
    } catch (error) {
      toast.error(errorText(error, t('Could not read the file.')));
      input.value = '';
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveCertificate(client.id, value, file);
      toast.success(t('Clearance certificate {number} saved', { number: value.number.trim() }));
      onClose();
    } catch (error) {
      toast.error(errorText(error, t('Could not save the certificate.')));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={certificate ? t('Edit clearance certificate') : t('Add clearance certificate')}
        description={t(
          'The Ministry of Finance tax clearance certificate. While it is valid, nothing is held back.',
        )}
      >
        <DialogBody className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Certificate number')} className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                value={value.number}
                onChange={(e) => set({ number: e.target.value })}
                autoFocus
              />
            )}
          </Field>
          <Field label={t('Issue date')}>
            {(id) => (
              <DateField
                id={id}
                required
                value={value.issueDate}
                onChange={(iso) => set({ issueDate: iso })}
              />
            )}
          </Field>
          <Field label={t('Expiry date')} optional hint={t('Leave empty if it doesn’t expire.')}>
            {(id) => (
              <DateField
                id={id}
                value={value.expiryDate ?? ''}
                onChange={(iso) => set({ expiryDate: iso || null })}
              />
            )}
          </Field>
          <Field
            label={t('Scan of the certificate')}
            optional
            hint={file ? file.name : t('PDF or photo, up to 10 MB.')}
            className="sm:col-span-2"
          >
            {(id) => (
              <Input
                id={id}
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => void pick(e.currentTarget)}
              />
            )}
          </Field>
          <Field label={t('Notes')} optional className="sm:col-span-2">
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={value.notes ?? ''}
                onChange={(e) => set({ notes: e.target.value })}
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {t('Save certificate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Releases                                                                   */
/* -------------------------------------------------------------------------- */

function ReleaseDialog({
  client,
  docs,
  onClose,
}: {
  client: Client;
  docs: InvoiceDocument[];
  onClose: () => void;
}) {
  const fmt = useFormat();
  const single = docs.length === 1 ? docs[0] : null;
  const kind = single?.retentionKind ?? client.retentionKind ?? 'tax';
  const now = today();
  const certificate = validCertificate(client, now);
  const [date, setDate] = useState(now);
  const [amount, setAmount] = useState(single ? heldRetention(single) : 0);
  const [basis, setBasis] = useState<RetentionRelease['basis']>(
    kind === 'contract' ? 'handover' : 'certificate',
  );
  const [reference, setReference] = useState(
    kind === 'contract' ? '' : (certificate?.number ?? ''),
  );
  const [saving, setSaving] = useState(false);
  const total = docs.reduce((s, d) => s.plus(dec(heldRetention(d))), dec(0)).toNumber();
  const currency = docs[0]?.currency ?? client.currency ?? 'KWD';

  const release = async () => {
    setSaving(true);
    try {
      for (const doc of docs) {
        await releaseRetention(doc.id, {
          date,
          amount: single ? round(amount, currencyPrecision(doc.currency)) : heldRetention(doc),
          basis,
          reference,
        });
      }
      toast.success(
        single
          ? t('Retention released on {number}', { number: single.number })
          : tp(docs.length, '{count} retention released', '{count} retentions released'),
      );
      onClose();
    } catch (error) {
      toast.error(errorText(error, t('Could not release the retention.')));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={
          single
            ? t('Release retention on {number}', { number: single.number })
            : t('Release all retentions')
        }
        description={t(
          'The amount moves back to the balance due, so it can be paid like any other amount.',
        )}
      >
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Release date')}>
              {(id) => <DateField id={id} required value={date} onChange={setDate} />}
            </Field>
            {single ? (
              <Field
                label={t('Amount')}
                hint={t('Held: {amount}', { amount: fmt.money(heldRetention(single), currency) })}
              >
                {(id) => (
                  <NumberInput
                    id={id}
                    value={amount}
                    onValueChange={setAmount}
                    allowNegative={false}
                  />
                )}
              </Field>
            ) : (
              <div>
                <p className="text-sm font-medium text-slate-700">{t('Amount')}</p>
                <p className="tabular mt-2 text-sm text-slate-900">{fmt.money(total, currency)}</p>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">{t('Released because of')}</p>
            <Segmented
              value={basis}
              onChange={setBasis}
              options={[
                { value: 'certificate', label: t('Clearance certificate') },
                { value: 'handover', label: t('Handover') },
              ]}
            />
          </div>
          <Field
            label={basis === 'certificate' ? t('Certificate number') : t('Handover note')}
            optional={basis === 'handover'}
            hint={
              basis === 'certificate'
                ? certificate
                  ? t('Valid until {date}', {
                      date: certificate.expiryDate ? fmt.date(certificate.expiryDate) : '—',
                    })
                  : t('No valid certificate is on file. Add it under Clearance certificates.')
                : t('For example the handover certificate or the date work was accepted.')
            }
          >
            {(id) => (
              <Input id={id} value={reference} onChange={(e) => setReference(e.target.value)} />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void release()} loading={saving}>
            {t('Release')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

/** Retentions of one contact: settings, certificates, what is held and what was released. */
export function RetentionPanel({
  client,
  side,
  documents,
  editHref,
}: {
  client: Client;
  side: StatementSide;
  documents: InvoiceDocument[];
  editHref: string;
}) {
  const fmt = useFormat();
  const confirm = useConfirm();
  const now = today();
  const [certificate, setCertificate] = useState<ClearanceCertificate | 'new' | null>(null);
  const [releasing, setReleasing] = useState<InvoiceDocument[] | null>(null);
  const type = side === 'vendor' ? 'bill' : 'invoice';
  const percent = contactRetention(client);
  const certificates = client.clearanceCertificates ?? [];
  const files = useLiveQuery(
    () =>
      certificates.length
        ? db.attachments
            .where('ownerId')
            .anyOf(certificates.map((c) => c.id))
            .toArray()
        : [],
    [certificates.map((c) => c.id).join()],
  );

  const retained = useMemo(
    () =>
      documents
        .filter((d) => d.type === type && isPosted(d) && (d.totals.retention ?? 0) > 0)
        .sort((a, b) => a.issueDate.localeCompare(b.issueDate)),
    [documents, type],
  );
  const held = retained.filter((d) => heldRetention(d) > 0);
  const releases = retained
    .flatMap((doc) => (doc.retentionReleases ?? []).map((release) => ({ doc, release })))
    .sort((a, b) => b.release.date.localeCompare(a.release.date));
  const totalsBy = (pick: (d: InvoiceDocument) => number) => {
    const byCurrency = new Map<string, number>();
    for (const d of held) byCurrency.set(d.currency, (byCurrency.get(d.currency) ?? 0) + pick(d));
    return [...byCurrency.entries()].map(([currency, amount]) => fmt.money(amount, currency));
  };

  const undo = async (doc: InvoiceDocument, release: RetentionRelease) => {
    const ok = await confirm({
      title: t('Undo this release?'),
      description: t(
        'A reversing entry holds the amount back again. The release stays in the history.',
      ),
      confirmLabel: t('Undo release'),
    });
    if (!ok) return;
    try {
      await undoRetentionRelease(doc.id, release.id);
      toast.success(t('Retention release on {number} undone', { number: doc.number }));
    } catch (error) {
      toast.error(errorText(error, t('Could not undo the release.')));
    }
  };

  const remove = async (c: ClearanceCertificate) => {
    const ok = await confirm({
      title: t('Remove certificate {number}?', { number: c.number }),
      description: t('Releases made with it keep its number.'),
      confirmLabel: t('Remove'),
      danger: true,
    });
    if (!ok) return;
    await removeCertificate(client.id, c.id);
    toast.success(t('Clearance certificate {number} removed', { number: c.number }));
  };

  const certificateState = (c: ClearanceCertificate) =>
    certificateValidOn(c, now)
      ? { label: t('Valid'), tone: 'green' as const }
      : c.issueDate > now
        ? { label: t('Not valid yet'), tone: 'amber' as const }
        : { label: t('Expired'), tone: 'red' as const };
  const status = RETENTION_STATUS_META[retentionStatus(client.retentionKind, client, now)];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-violet-600" aria-hidden />
          <div>
            <p className="text-sm font-medium text-slate-900">
              {percent
                ? t('{kind} of {percent}', {
                    kind: t(retentionKindLabel(client.retentionKind)),
                    percent: fmt.percent(percent),
                  })
                : side === 'vendor'
                  ? t('You hold nothing back from this vendor.')
                  : t('This client holds nothing back.')}
            </p>
            <p className="text-xs text-slate-500">
              {percent
                ? t(RETENTION_KINDS.find((k) => k.value === (client.retentionKind ?? 'tax'))!.hint)
                : t('Set a retention when the contract or the law asks for one.')}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {percent ? <Badge tone={status.tone}>{t(status.label)}</Badge> : null}
          <ButtonLink to={editHref} variant="outline" size="sm">
            <Pencil /> {t('Edit')}
          </ButtonLink>
        </div>
      </div>

      <Card>
        <CardHeader
          title={t('Held back')}
          description={
            held.length
              ? t('Total held: {amount}', { amount: totalsBy(heldRetention).join(' + ') })
              : undefined
          }
          actions={
            held.length > 1 ? (
              <Button size="sm" onClick={() => setReleasing(held)}>
                {t('Release all')}
              </Button>
            ) : null
          }
        />
        {held.length === 0 ? (
          <EmptyState
            className="py-10"
            title={t('Nothing is held back')}
            description={
              side === 'vendor'
                ? t('Retentions on bills show here until you release them.')
                : t('Retentions on invoices show here until they are released.')
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {held.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <Link
                    to={`${DOCUMENT_ROUTES[doc.type]}/${doc.id}`}
                    className="hover:text-primary-700 text-sm font-medium text-slate-900"
                  >
                    {doc.number}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {[
                      fmt.date(doc.issueDate),
                      daysBetween(doc.issueDate, now) > 0
                        ? tp(daysBetween(doc.issueDate, now), '{count} day', '{count} days')
                        : t('Today'),
                      doc.retentionPercent ? fmt.percent(doc.retentionPercent) : '',
                      t(retentionKindLabel(doc.retentionKind ?? client.retentionKind)),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className="tabular text-sm font-semibold text-slate-900">
                    {fmt.money(heldRetention(doc), doc.currency)}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setReleasing([doc])}>
                    {t('Release')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t('Clearance certificates')}
          description={
            side === 'vendor'
              ? t(
                  'Certificates this vendor gave you. While one is valid, new bills hold nothing back.',
                )
              : t(
                  'Certificates you gave this client. While one is valid, new invoices hold nothing back.',
                )
          }
          actions={
            <Button size="sm" variant="outline" onClick={() => setCertificate('new')}>
              <Plus /> {t('Add')}
            </Button>
          }
        />
        {certificates.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">{t('No certificates yet.')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {certificates.map((c) => {
              const state = certificateState(c);
              const file = files?.find((f) => f.ownerId === c.id);
              return (
                <li
                  key={c.id}
                  className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                      <FileText className="size-4 text-slate-400" aria-hidden />
                      <span dir="ltr">{c.number}</span>
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </p>
                    <p className="text-xs text-slate-500">
                      {c.expiryDate
                        ? t('{from} to {to}', {
                            from: fmt.date(c.issueDate),
                            to: fmt.date(c.expiryDate),
                          })
                        : t('Issued {date}', { date: fmt.date(c.issueDate) })}
                      {c.notes ? ` · ${c.notes}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {file ? (
                      <a
                        href={file.dataUrl}
                        download={file.name}
                        className="text-primary-700 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-slate-100"
                      >
                        <Paperclip className="size-3.5" aria-hidden /> {t('Scan')}
                      </a>
                    ) : null}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('Edit certificate {number}', { number: c.number })}
                      onClick={() => setCertificate(c)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('Remove certificate {number}', { number: c.number })}
                      onClick={() => void remove(c)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {releases.length ? (
        <Card>
          <CardHeader title={t('Released')} />
          <CardBody className="p-0">
            <ul className="divide-y divide-slate-100">
              {releases.map(({ doc, release }) => (
                <li
                  key={release.id}
                  className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 text-sm">
                    <span className="font-medium text-slate-900">{doc.number}</span>
                    <span className="ms-2 text-xs text-slate-500">
                      {[
                        fmt.date(release.date),
                        release.basis === 'certificate'
                          ? t('Certificate {number}', { number: release.reference })
                          : release.reference || t('Handover'),
                      ].join(' · ')}
                    </span>
                    {release.reversedOn ? (
                      <Badge tone="slate" className="ms-2">
                        {t('Undone {date}', { date: fmt.date(release.reversedOn) })}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <span
                      className={
                        release.reversedOn
                          ? 'tabular text-sm text-slate-500 line-through'
                          : 'tabular text-sm font-semibold text-slate-900'
                      }
                    >
                      {fmt.money(release.amount, doc.currency)}
                    </span>
                    {!release.reversedOn ? (
                      <Button size="sm" variant="ghost" onClick={() => void undo(doc, release)}>
                        <RotateCcw /> {t('Undo')}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {certificate ? (
        <CertificateDialog
          client={client}
          certificate={certificate === 'new' ? null : certificate}
          onClose={() => setCertificate(null)}
        />
      ) : null}
      {releasing ? (
        <ReleaseDialog client={client} docs={releasing} onClose={() => setReleasing(null)} />
      ) : null}
    </div>
  );
}
