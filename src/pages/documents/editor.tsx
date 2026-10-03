import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Eye, EyeOff, FileText, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import {
  defaultTaxes as loadDefaultTaxes,
  draftDocument,
  DuplicateNumberError,
  isNumberTaken,
  markSent,
  saveDocument,
  suggestNumber,
} from '@/db/documents';
import type { DocumentType, InvoiceDocument, TaxLine } from '@/db/types';
import { DOCUMENT_LABELS, DOCUMENT_ROUTES, useCompany, useFormat } from '@/app/company';
import { computeDocument } from '@/lib/document-calc';
import { addDaysISO, daysBetween } from '@/lib/dates';
import { currencySymbol, formatUnitPrice } from '@/lib/format';
import { cn } from '@/lib/cn';
import { TEMPLATE_META } from '@/pdf/template-meta';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Spinner } from '@/components/ui/misc';
import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from '@/components/ui/overlay';
import { CurrencySelect } from '@/components/fields';
import { PdfPreview } from '@/components/pdf/pdf-preview';
import { useLivePdf } from '@/components/pdf/use-pdf';
import { LineItemsEditor } from '@/features/editor/line-items';
import { TotalsPanel } from '@/features/editor/totals-panel';
import { ClientDialog } from '@/features/clients/client-dialog';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { isCustomer } from '@/db/purchases';
import { t } from '@/i18n';

const PAYMENT_TERMS = [0, 7, 14, 15, 30, 45, 60, 90];
const QUOTE_VALIDITY = [7, 14, 30, 45, 60, 90];

type SaveIntent = 'save' | 'sent' | 'download';

export default function DocumentEditorPage({ type }: { type: DocumentType }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const company = useCompany();
  const fmt = useFormat();
  const labels = DOCUMENT_LABELS[type];

  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const products = useLiveQuery(
    () => db.products.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const taxRates = useLiveQuery(
    () => db.taxRates.where('companyId').equals(company.id).toArray(),
    [company.id],
  );

  const [doc, setDoc] = useState<InvoiceDocument | null>(null);
  const [original, setOriginal] = useState('');
  const [defaultTaxes, setDefaultTaxes] = useState<TaxLine[]>([]);
  const [numberHint, setNumberHint] = useState('');
  const [errors, setErrors] = useState<{ client?: string; number?: string; items?: string }>({});
  const [saving, setSaving] = useState<SaveIntent | null>(null);
  const [clientDialog, setClientDialog] = useState<{ open: boolean; name: string }>({
    open: false,
    name: '',
  });
  const [showPreview, setShowPreview] = useState(true);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Reads the latest company without making the load effect depend on it.
  const currentCompany = useEffectEvent(() => company);

  // Load the document (or a fresh draft) once per route.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = currentCompany();
      const taxes = await loadDefaultTaxes(current);
      let loaded: InvoiceDocument | undefined;
      if (id) {
        loaded = await db.documents.get(id);
        if (!loaded || loaded.companyId !== current.id || loaded.type !== type) {
          if (!cancelled) setNotFound(true);
          return;
        }
      } else {
        const clientId = searchParams.get('client');
        const client = clientId ? await db.clients.get(clientId) : undefined;
        loaded = await draftDocument(current, type, client ?? null);
      }
      if (cancelled) return;
      setDefaultTaxes(taxes);
      setDoc(loaded);
      setOriginal(JSON.stringify(loaded));
    })();
    return () => {
      cancelled = true;
    };
    // Only reload when the route changes, never while the user is editing.
  }, [id, type, company.id, searchParams]);

  const client = useMemo(
    () => (doc && clients ? (clients.find((c) => c.id === doc.clientId) ?? null) : null),
    [doc, clients],
  );

  // Suggested number for new documents (assigned for real on save).
  const issueDate = doc?.issueDate;
  const hasNumber = Boolean(doc?.number);
  useEffect(() => {
    if (!issueDate || hasNumber) return;
    let cancelled = false;
    void suggestNumber(currentCompany(), type, issueDate, client?.number ?? '').then((n) => {
      if (!cancelled) setNumberHint(n);
    });
    return () => {
      cancelled = true;
    };
  }, [issueDate, hasNumber, type, client?.number]);

  const result = useMemo(
    () =>
      doc ? computeDocument(doc, { paid: doc.totals.paid, taxExempt: client?.taxExempt }) : null,
    [doc, client],
  );

  const previewDoc = useMemo(
    () => (doc ? { ...doc, number: doc.number || numberHint } : null),
    [doc, numberHint],
  );
  const templateId = doc?.templateId ?? company.branding.templateId;
  const pdf = useLivePdf(
    showPreview || mobilePreview ? previewDoc : null,
    company,
    client,
    templateId,
  );

  const dirty = doc !== null && JSON.stringify(doc) !== original;
  const allowNavigation = useUnsavedGuard(dirty && saving === null);

  if (notFound) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">This {labels.singular.toLowerCase()} could not be found.</p>
        <Link
          to={DOCUMENT_ROUTES[type]}
          className="text-primary-700 mt-4 inline-block text-sm font-medium"
        >
          Back to {labels.plural.toLowerCase()}
        </Link>
      </Card>
    );
  }
  if (!doc || !result || !clients || !products || !taxRates) {
    return <Spinner className="py-24" label="Loading…" />;
  }

  const update = (patch: Partial<InvoiceDocument>) => setDoc((d) => (d ? { ...d, ...patch } : d));
  const money = (amount: number) => fmt.money(amount, doc.currency);
  const symbol = currencySymbol(doc.currency, fmt.locale);
  const isNew = !id;
  const showLineTaxes = company.defaults.lineTaxes || doc.items.some((i) => i.taxes.length > 0);

  const termsDays = doc.dueDate ? daysBetween(doc.issueDate, doc.dueDate) : null;
  const termsOptions = type === 'quote' ? QUOTE_VALIDITY : PAYMENT_TERMS;
  const termsValue =
    termsDays === null ? 'none' : termsOptions.includes(termsDays) ? String(termsDays) : 'custom';

  const selectClient = (clientId: string) => {
    const picked = clients.find((c) => c.id === clientId);
    setErrors((e) => ({ ...e, client: undefined }));
    setDoc((d) => {
      if (!d) return d;
      const next: InvoiceDocument = { ...d, clientId };
      if (picked) {
        if (isNew || d.totals.paid === 0) next.currency = picked.currency || company.currency;
        if (type === 'invoice' && isNew) {
          next.dueDate = addDaysISO(
            d.issueDate,
            picked.paymentTermsDays ?? company.defaults.paymentTermsDays,
          );
        }
      }
      return next;
    });
  };

  const save = async (intent: SaveIntent) => {
    const found: typeof errors = {};
    if (!doc.clientId) found.client = 'Choose who this is for.';
    const hasContent = doc.items.some(
      (i) => i.kind === 'item' && (i.name.trim() || i.description.trim() || i.unitPrice !== 0),
    );
    if (!hasContent) found.items = 'Add at least one item.';
    if (doc.number.trim() && (await isNumberTaken(company.id, type, doc.number, doc.id))) {
      found.number = 'This number is already used.';
    }
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error('Please fix the highlighted fields.');
      return;
    }
    setSaving(intent);
    try {
      const saved = await saveDocument({
        ...doc,
        items: doc.items.filter((i) =>
          i.kind === 'heading'
            ? i.name.trim() || i.description.trim()
            : i.name.trim() || i.description.trim() || i.unitPrice !== 0,
        ),
        charges: doc.charges.filter((c) => c.label.trim() || c.amount !== 0),
      });
      if (intent === 'sent') await markSent(saved.id);
      toast.success(`${labels.singular} ${saved.number} saved`);
      allowNavigation();
      navigate(`${DOCUMENT_ROUTES[type]}/${saved.id}`, {
        state: intent === 'download' ? { download: true } : undefined,
      });
    } catch (error) {
      if (error instanceof DuplicateNumberError)
        setErrors({ number: 'This number is already used.' });
      toast.error(error instanceof Error ? error.message : 'Could not save.');
      setSaving(null);
    }
  };

  // Vendors only show up once they are also marked as clients.
  const clientOptions = clients
    .filter((c) => (!c.archived && isCustomer(c)) || c.id === doc.clientId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      value: c.id,
      label: c.name,
      detail: [c.contacts.find((x) => x.primary)?.email || c.email, c.address.city]
        .filter(Boolean)
        .join(' · '),
      keywords: c.number,
    }));

  const preview = <PdfPreview blob={pdf.blob} loading={pdf.loading} error={pdf.error} />;

  const templateSelect = (
    <Select
      aria-label="Template"
      value={doc.templateId ?? ''}
      onChange={(e) => update({ templateId: e.target.value || null })}
      className="h-8 text-xs"
    >
      <option value="">
        Default ({TEMPLATE_META.find((t) => t.id === company.branding.templateId)?.name ?? 'Modern'}
        )
      </option>
      {TEMPLATE_META.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </Select>
  );

  const saveButtons = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" onClick={() => navigate(-1)}>
        Cancel
      </Button>
      <div className="flex">
        <Button
          onClick={() => save('save')}
          loading={saving === 'save'}
          disabled={saving !== null}
          className="rounded-e-none"
        >
          <Save /> Save
        </Button>
        <DropdownMenu>
          <DropdownTrigger asChild>
            <Button
              className="border-primary-500 rounded-s-none border-s px-2"
              disabled={saving !== null}
              aria-label="More save options"
            >
              <ChevronDown />
            </Button>
          </DropdownTrigger>
          <DropdownContent>
            {doc.status === 'draft' ? (
              <DropdownItem icon={<Send />} onSelect={() => void save('sent')}>
                Save and mark as sent
              </DropdownItem>
            ) : null}
            <DropdownItem icon={<FileText />} onSelect={() => void save('download')}>
              Save and download PDF
            </DropdownItem>
          </DropdownContent>
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-sm text-slate-500">
            <Link to={DOCUMENT_ROUTES[type]} className="hover:text-slate-700">
              {labels.plural}
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {isNew
              ? `New ${labels.singular.toLowerCase()}`
              : `Edit ${labels.singular.toLowerCase()} ${doc.number}`}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="xl:hidden" onClick={() => setMobilePreview(true)}>
            <Eye /> Preview
          </Button>
          <Button
            variant="outline"
            className="hidden xl:inline-flex"
            onClick={() => setShowPreview((s) => !s)}
          >
            {showPreview ? <EyeOff /> : <Eye />} {showPreview ? 'Hide preview' : 'Show preview'}
          </Button>
          {saveButtons}
        </div>
      </div>

      <div
        className={cn(
          'grid gap-6',
          showPreview && 'xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_540px]',
        )}
      >
        <div className="min-w-0 space-y-6">
          <Card>
            <CardBody className="grid gap-4 md:grid-cols-2">
              <Field
                label={type === 'quote' ? 'Prepared for' : 'Bill to'}
                error={errors.client}
                className="md:col-span-2"
              >
                {(fid) => (
                  <Combobox
                    id={fid}
                    value={doc.clientId || null}
                    onChange={selectClient}
                    options={clientOptions}
                    placeholder="Choose a client…"
                    searchPlaceholder="Search clients…"
                    onCreate={(name) => setClientDialog({ open: true, name })}
                    createLabel="New client"
                  />
                )}
              </Field>
              <Field
                label={`${labels.singular} number`}
                error={errors.number}
                hint={isNew && !doc.number ? 'Assigned automatically when saved.' : undefined}
              >
                {(fid) => (
                  <Input
                    id={fid}
                    value={doc.number}
                    placeholder={numberHint}
                    onChange={(e) => {
                      update({ number: e.target.value });
                      setErrors((x) => ({ ...x, number: undefined }));
                    }}
                    aria-invalid={Boolean(errors.number)}
                  />
                )}
              </Field>
              <Field label="PO / reference" optional>
                {(fid) => (
                  <Input
                    id={fid}
                    value={doc.poNumber}
                    onChange={(e) => update({ poNumber: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Issue date">
                {(fid) => (
                  <Input
                    id={fid}
                    type="date"
                    value={doc.issueDate}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (!value) return;
                      update({
                        issueDate: value,
                        dueDate:
                          doc.dueDate && termsDays !== null
                            ? addDaysISO(value, termsDays)
                            : doc.dueDate,
                      });
                    }}
                  />
                )}
              </Field>
              {type !== 'credit' ? (
                <Field label={type === 'quote' ? 'Valid until' : 'Due date'}>
                  {(fid) => (
                    <div className="flex flex-wrap gap-2">
                      <Select
                        aria-label={type === 'quote' ? 'Validity' : 'Payment terms'}
                        value={termsValue}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === 'none') update({ dueDate: null });
                          else if (v !== 'custom')
                            update({ dueDate: addDaysISO(doc.issueDate, Number(v)) });
                        }}
                        className="w-36"
                      >
                        {type === 'invoice' ? <option value="none">No due date</option> : null}
                        {termsOptions.map((d) => (
                          <option key={d} value={d}>
                            {type === 'quote'
                              ? `${d} days`
                              : d === 0
                                ? 'Due on receipt'
                                : `Net ${d}`}
                          </option>
                        ))}
                        <option value="custom">Custom</option>
                      </Select>
                      <Input
                        id={fid}
                        type="date"
                        value={doc.dueDate ?? ''}
                        onChange={(e) => update({ dueDate: e.target.value || null })}
                        className="min-w-36 flex-1"
                      />
                    </div>
                  )}
                </Field>
              ) : (
                <div />
              )}
              {type !== 'credit' ? (
                <>
                  <Field label={t('Delivery date')} optional>
                    {(fid) => (
                      <Input
                        id={fid}
                        type="date"
                        value={doc.deliveryDate ?? ''}
                        onChange={(e) => update({ deliveryDate: e.target.value || null })}
                      />
                    )}
                  </Field>
                  <Field label={t('Delivery place')} optional>
                    {(fid) => (
                      <Input
                        id={fid}
                        value={doc.deliveryPlace ?? ''}
                        placeholder={t('Site, warehouse or address')}
                        onChange={(e) => update({ deliveryPlace: e.target.value })}
                      />
                    )}
                  </Field>
                </>
              ) : null}
              <Field label="Currency">
                {(fid) => (
                  <CurrencySelect
                    id={fid}
                    value={doc.currency}
                    onChange={(currency) => update({ currency })}
                  />
                )}
              </Field>
              {doc.currency !== company.currency && type !== 'quote' ? (
                <Field
                  label="Exchange rate"
                  hint={`1 ${doc.currency} = ${doc.exchangeRate || '?'} ${company.currency}, used for your books`}
                >
                  {(fid) => (
                    <NumberInput
                      id={fid}
                      value={doc.exchangeRate ?? 0}
                      onValueChange={(exchangeRate) => update({ exchangeRate })}
                      allowNegative={false}
                    />
                  )}
                </Field>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Items"
              description={
                errors.items ? (
                  <span className="text-red-600">{errors.items}</span>
                ) : (
                  'Type to search your products & services.'
                )
              }
            />
            <CardBody>
              <LineItemsEditor
                items={doc.items}
                onChange={(items) => {
                  update({ items });
                  setErrors((x) => ({ ...x, items: undefined }));
                }}
                lines={result.lines}
                products={products}
                taxRates={taxRates}
                showTaxes={showLineTaxes}
                defaultTaxes={company.defaults.lineTaxes ? defaultTaxes : []}
                currencySymbol={symbol}
                formatMoney={money}
                formatPrice={(amount) => formatUnitPrice(amount, doc.currency, fmt.locale)}
                language={client?.language ?? company.language}
              />
            </CardBody>
          </Card>

          <div className={cn('grid gap-6', !showPreview && 'lg:grid-cols-2')}>
            <Card className={cn(!showPreview && 'lg:order-1')}>
              <CardHeader title="Notes & terms" />
              <CardBody className="space-y-4">
                <Field label="Notes" hint="Shown on the document.">
                  {(fid) => (
                    <Textarea
                      id={fid}
                      value={doc.notes}
                      onChange={(e) => update({ notes: e.target.value })}
                      rows={3}
                    />
                  )}
                </Field>
                <Field label="Terms & conditions">
                  {(fid) => (
                    <Textarea
                      id={fid}
                      value={doc.terms}
                      onChange={(e) => update({ terms: e.target.value })}
                      rows={3}
                    />
                  )}
                </Field>
                <Field label="Footer">
                  {(fid) => (
                    <Input
                      id={fid}
                      value={doc.footer}
                      onChange={(e) => update({ footer: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Private notes" hint="Only visible to you, never printed.">
                  {(fid) => (
                    <Textarea
                      id={fid}
                      value={doc.privateNotes}
                      onChange={(e) => update({ privateNotes: e.target.value })}
                      rows={2}
                    />
                  )}
                </Field>
              </CardBody>
            </Card>
            <Card className={cn('-order-1', !showPreview && 'lg:order-2')}>
              <CardHeader title="Totals" />
              <CardBody>
                <TotalsPanel
                  doc={doc}
                  onChange={update}
                  result={result}
                  taxRates={taxRates}
                  showDocumentTaxes={company.defaults.documentTaxes}
                  showLineTaxes={showLineTaxes}
                  defaultTaxes={defaultTaxes}
                  currencySymbol={symbol}
                  money={money}
                  percent={fmt.percent}
                  taxExempt={Boolean(client?.taxExempt)}
                />
              </CardBody>
            </Card>
          </div>

          <div className="flex justify-end border-t border-slate-200 pt-4 xl:hidden">
            {saveButtons}
          </div>
        </div>

        {showPreview ? (
          <aside className="hidden xl:block">
            <div className="sticky top-20 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-700">Live preview</p>
                <div className="w-48">{templateSelect}</div>
              </div>
              <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-xl bg-slate-200/60 p-4">
                {preview}
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      <Dialog open={mobilePreview} onOpenChange={setMobilePreview}>
        <DialogContent title="Preview" size="xl">
          <div className="space-y-3 bg-slate-100 p-4">
            <div className="max-w-56">{templateSelect}</div>
            {preview}
          </div>
        </DialogContent>
      </Dialog>

      {clientDialog.open ? (
        <ClientDialog
          open
          onOpenChange={(open) => setClientDialog((s) => ({ ...s, open }))}
          company={company}
          initialName={clientDialog.name}
          onSaved={(saved) => selectClient(saved.id)}
        />
      ) : null}
    </div>
  );
}
