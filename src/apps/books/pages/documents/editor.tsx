import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  RotateCcw,
  Save,
  Send,
} from 'lucide-react';
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
import {
  DOCUMENT_LABELS,
  DOCUMENT_ROUTES,
  documentNoun,
  useCompany,
  useFormat,
} from '@/app/company';
import { computeDocument, documentTaxExempt } from '@/lib/document-calc';
import { addDaysISO, daysBetween } from '@/lib/dates';
import { currencySymbol, formatUnitPrice } from '@/lib/format';
import { hasPrices, postsToLedger } from '@/lib/document-types';
import { cn } from '@/lib/cn';
import { TEMPLATE_META } from '@/pdf/template-meta';
import { documentAccent, documentTemplate, typeTemplate } from '@/pdf/template-resolve';
import { normalizeHex } from '@/lib/color';
import { t, tp } from '@/i18n';
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
import { LineItemsEditor } from '@/apps/books/features/editor/line-items';
import { TotalsPanel } from '@/apps/books/features/editor/totals-panel';
import { ClientDialog } from '@/features/clients/client-dialog';
import { contactOptions } from '@/features/clients/contact-option';
import { useCreditCheck } from '@/features/clients/credit-check';
import { retentionDefaults } from '@/lib/retention';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { StickyActions } from '@/components/ui/sticky-actions';
import { isCustomer } from '@/db/purchases';
import { DateField } from '@/components/ui/date-field';

const PAYMENT_TERMS = [0, 7, 14, 15, 30, 45, 60, 90];
const QUOTE_VALIDITY = [7, 14, 30, 45, 60, 90];

type SaveIntent = 'save' | 'sent' | 'download';

/** Who the document is for, as the client field calls it. */
function clientLabel(type: DocumentType): string {
  if (type === 'quote') return t('Prepared for');
  if (type === 'sales_order' || type === 'delivery_note') return t('Customer');
  return t('Bill to');
}

export default function DocumentEditorPage({ type }: { type: DocumentType }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const company = useCompany();
  const fmt = useFormat();
  const labels = DOCUMENT_LABELS[type];
  const priced = hasPrices(type);
  // Quotes and proformas are valid until a date; invoices are due on one.
  const validity = type === 'quote' || type === 'proforma';
  const dated = type === 'invoice' || validity;

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

  const checkCredit = useCreditCheck();

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
      doc
        ? computeDocument(doc, {
            paid: doc.totals.paid,
            // An issued document keeps the tax exemption it was issued with.
            taxExempt: documentTaxExempt(doc, client),
          })
        : null,
    [doc, client],
  );

  const previewDoc = useMemo(
    () => (doc ? { ...doc, number: doc.number || numberHint } : null),
    [doc, numberHint],
  );
  const templateId = doc ? documentTemplate(doc, company) : company.branding.templateId;
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
        <p className="text-slate-600">{t('This document could not be found.')}</p>
        <Link
          to={DOCUMENT_ROUTES[type]}
          className="text-primary-700 mt-4 inline-block text-sm font-medium"
        >
          {t('Back to {list}', { list: t(labels.plural).toLowerCase() })}
        </Link>
      </Card>
    );
  }
  if (!doc || !result || !clients || !products || !taxRates) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }

  const update = (patch: Partial<InvoiceDocument>) => setDoc((d) => (d ? { ...d, ...patch } : d));
  const money = (amount: number) => fmt.money(amount, doc.currency);
  const symbol = currencySymbol(doc.currency, fmt.locale);
  const isNew = !id;
  const showLineTaxes = company.defaults.lineTaxes || doc.items.some((i) => i.taxes.length > 0);

  const termsDays = doc.dueDate ? daysBetween(doc.issueDate, doc.dueDate) : null;
  const termsOptions = validity ? QUOTE_VALIDITY : PAYMENT_TERMS;
  const termsValue =
    termsDays === null ? 'none' : termsOptions.includes(termsDays) ? String(termsDays) : 'custom';

  const selectClient = (clientId: string) => {
    const picked = clients.find((c) => c.id === clientId);
    setErrors((e) => ({ ...e, client: undefined }));
    setDoc((d) => {
      if (!d) return d;
      const next: InvoiceDocument = { ...d, clientId };
      // Another client: it is issued with that client's tax exemption.
      if (clientId !== d.clientId) delete next.posting;
      if (picked) {
        if (isNew || d.totals.paid === 0) next.currency = picked.currency || company.currency;
        if (type === 'invoice' && isNew) {
          next.dueDate = addDaysISO(
            d.issueDate,
            picked.paymentTermsDays ?? company.defaults.paymentTermsDays,
          );
          Object.assign(next, retentionDefaults(picked, type, d.issueDate));
        }
      }
      return next;
    });
  };

  const save = async (intent: SaveIntent) => {
    const found: typeof errors = {};
    if (!doc.clientId) found.client = t('Choose who this is for.');
    const hasContent = doc.items.some(
      (i) => i.kind === 'item' && (i.name.trim() || i.description.trim() || i.unitPrice !== 0),
    );
    if (!hasContent) found.items = t('Add at least one item.');
    if (doc.number.trim() && (await isNumberTaken(company.id, type, doc.number, doc.id))) {
      found.number = t('This number is already used.');
    }
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error(t('Please fix the highlighted fields.'));
      return;
    }
    // Customers on credit hold, or going over their limit, need a confirmation.
    if (!(await checkCredit(doc, client))) return;
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
      toast.success(
        t('{document} {number} saved', { document: t(labels.singular), number: saved.number }),
      );
      allowNavigation();
      navigate(`${DOCUMENT_ROUTES[type]}/${saved.id}`, {
        state: intent === 'download' ? { download: true } : undefined,
      });
    } catch (error) {
      if (error instanceof DuplicateNumberError)
        setErrors({ number: t('This number is already used.') });
      toast.error(error instanceof Error ? error.message : t('Could not save.'));
      setSaving(null);
    }
  };

  // Vendors only show up once they are also marked as clients.
  const clientOptions = contactOptions(
    clients.filter((c) => (!c.archived && isCustomer(c)) || c.id === doc.clientId),
  );

  const preview = <PdfPreview blob={pdf.blob} loading={pdf.loading} error={pdf.error} />;

  const defaultTemplate = t(
    TEMPLATE_META.find((m) => m.id === typeTemplate(company, type))?.name ?? TEMPLATE_META[0].name,
  );
  const templateSelect = (
    <Select
      aria-label={t('Template')}
      value={doc.templateId ?? ''}
      onChange={(e) => update({ templateId: e.target.value || null })}
      className="h-8 text-xs"
    >
      <option value="">{t('Default ({name})', { name: defaultTemplate })}</option>
      {TEMPLATE_META.map((m) => (
        <option key={m.id} value={m.id}>
          {t(m.name)}
        </option>
      ))}
    </Select>
  );
  // This document's colour, over its type's (Templates) or the company's.
  const accent = documentAccent(doc, company);
  const accentPicker = (
    <div className="flex shrink-0 items-center">
      <label
        className="relative size-8 cursor-pointer overflow-hidden rounded-lg border border-slate-300 shadow-xs"
        style={{ backgroundColor: accent }}
        title={t('Colour of this document')}
      >
        <input
          type="color"
          value={normalizeHex(accent)}
          onChange={(e) => update({ accentColor: e.target.value })}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={t('Colour of this document')}
        />
      </label>
      {doc.accentColor ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setDoc((d) => {
              if (!d) return d;
              const { accentColor: _own, ...rest } = d;
              return rest;
            })
          }
          aria-label={t('Use the default colour')}
          title={t('Use the default colour')}
        >
          <RotateCcw />
        </Button>
      ) : null}
    </div>
  );
  const design = (
    <div className="flex items-center gap-2">
      <div className="w-48">{templateSelect}</div>
      {accentPicker}
    </div>
  );

  // Sales orders are confirmed rather than sent; delivery notes are marked as
  // delivered from their page, with who signed for them.
  const sendLabel =
    type === 'sales_order'
      ? t('Save and confirm')
      : type === 'delivery_note'
        ? null
        : t('Save and mark as sent');

  const saveButtons = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" onClick={() => navigate(-1)}>
        {t('Cancel')}
      </Button>
      <div className="flex">
        <Button
          onClick={() => save('save')}
          loading={saving === 'save'}
          disabled={saving !== null}
          className="rounded-e-none"
        >
          <Save /> {t('Save')}
        </Button>
        <DropdownMenu>
          <DropdownTrigger asChild>
            <Button
              className="border-primary-500 rounded-s-none border-s px-2"
              disabled={saving !== null}
              aria-label={t('More save options')}
            >
              <ChevronDown />
            </Button>
          </DropdownTrigger>
          <DropdownContent>
            {doc.status === 'draft' && sendLabel ? (
              <DropdownItem
                icon={type === 'sales_order' ? <CheckCircle2 /> : <Send />}
                onSelect={() => void save('sent')}
              >
                {sendLabel}
              </DropdownItem>
            ) : null}
            <DropdownItem icon={<FileText />} onSelect={() => void save('download')}>
              {t('Save and download PDF')}
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
              {t(labels.plural)}
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {isNew
              ? t(labels.create)
              : t('Edit {document} {number}', { document: documentNoun(type), number: doc.number })}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="xl:hidden" onClick={() => setMobilePreview(true)}>
            <Eye /> {t('Preview')}
          </Button>
          <Button
            variant="outline"
            className="hidden xl:inline-flex"
            onClick={() => setShowPreview((s) => !s)}
          >
            {showPreview ? <EyeOff /> : <Eye />}{' '}
            {showPreview ? t('Hide preview') : t('Show preview')}
          </Button>
          <StickyActions>{saveButtons}</StickyActions>
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
              <Field label={clientLabel(type)} error={errors.client} className="md:col-span-2">
                {(fid) => (
                  <Combobox
                    id={fid}
                    value={doc.clientId || null}
                    onChange={selectClient}
                    options={clientOptions}
                    placeholder={t('Choose a client…')}
                    searchPlaceholder={t('Search clients…')}
                    onCreate={(name) => setClientDialog({ open: true, name })}
                    createLabel={t('New client')}
                  />
                )}
              </Field>
              <Field
                label={t(labels.numberLabel)}
                error={errors.number}
                hint={isNew && !doc.number ? t('Assigned automatically when saved.') : undefined}
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
              <Field label={t('PO / reference')} optional>
                {(fid) => (
                  <Input
                    id={fid}
                    value={doc.poNumber}
                    onChange={(e) => update({ poNumber: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('Issue date')}>
                {(fid) => (
                  <DateField
                    id={fid}
                    value={doc.issueDate}
                    onChange={(iso) => {
                      const value = iso;
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
              {dated ? (
                <Field label={validity ? t('Valid until') : t('Due date')}>
                  {(fid) => (
                    <div className="flex flex-wrap gap-2">
                      <Select
                        aria-label={validity ? t('Validity') : t('Payment terms')}
                        value={termsValue}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === 'none') update({ dueDate: null });
                          else if (v !== 'custom')
                            update({ dueDate: addDaysISO(doc.issueDate, Number(v)) });
                        }}
                        className="w-36"
                      >
                        <option value="none">
                          {validity ? t('No end date') : t('No due date')}
                        </option>
                        {termsOptions.map((d) => (
                          <option key={d} value={d}>
                            {validity
                              ? tp(d, '{count} day', '{count} days')
                              : d === 0
                                ? t('Due on receipt')
                                : t('Net {days}', { days: d })}
                          </option>
                        ))}
                        <option value="custom">{t('Custom')}</option>
                      </Select>
                      <DateField
                        id={fid}
                        value={doc.dueDate ?? ''}
                        onChange={(iso) => update({ dueDate: iso || null })}
                        className="min-w-36 flex-1"
                      />
                    </div>
                  )}
                </Field>
              ) : type === 'credit' ? (
                <div />
              ) : null}
              {type !== 'credit' ? (
                <>
                  <Field label={t('Delivery date')} optional={type !== 'delivery_note'}>
                    {(fid) => (
                      <DateField
                        id={fid}
                        value={doc.deliveryDate ?? ''}
                        onChange={(iso) => update({ deliveryDate: iso || null })}
                      />
                    )}
                  </Field>
                  <Field
                    label={type === 'delivery_note' ? t('Deliver to') : t('Delivery place')}
                    optional
                  >
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
              {type === 'delivery_note' && doc.status === 'delivered' ? (
                <>
                  <Field label={t('Received by')}>
                    {(fid) => (
                      <Input
                        id={fid}
                        value={doc.receiverName ?? ''}
                        onChange={(e) => update({ receiverName: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={t('Civil ID number')} optional>
                    {(fid) => (
                      <Input
                        id={fid}
                        dir="ltr"
                        inputMode="numeric"
                        value={doc.receiverCivilId ?? ''}
                        onChange={(e) => update({ receiverCivilId: e.target.value })}
                      />
                    )}
                  </Field>
                </>
              ) : null}
              {priced ? (
                <Field
                  label={t('Currency')}
                  hint={
                    doc.totals.paid !== 0
                      ? t('Payments or credits are recorded on it, so its currency stays.')
                      : undefined
                  }
                >
                  {(fid) => (
                    <CurrencySelect
                      id={fid}
                      value={doc.currency}
                      onChange={(currency) => update({ currency })}
                      disabled={doc.totals.paid !== 0}
                    />
                  )}
                </Field>
              ) : null}
              {doc.currency !== company.currency && postsToLedger(type) ? (
                <Field
                  label={t('Exchange rate')}
                  hint={t('1 {currency} = {rate} {base}, used for your books', {
                    currency: doc.currency,
                    rate: doc.exchangeRate || '?',
                    base: company.currency,
                  })}
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
              title={t('Items')}
              description={
                errors.items ? (
                  <span className="text-red-600">{errors.items}</span>
                ) : (
                  t('Type to search your products & services.')
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
                prices={priced}
                stockUse={type === 'credit' ? 'receive' : 'sell'}
              />
            </CardBody>
          </Card>

          <div className={cn('grid gap-6', !showPreview && priced && 'lg:grid-cols-2')}>
            <Card className={cn(!showPreview && 'lg:order-1')}>
              <CardHeader title={t('Notes & terms')} />
              <CardBody className="space-y-4">
                {type === 'quote' ? (
                  <Field label={t('Introduction')} hint={t('Printed above the items.')}>
                    {(fid) => (
                      <Textarea
                        id={fid}
                        value={doc.intro ?? ''}
                        onChange={(e) => update({ intro: e.target.value })}
                        rows={2}
                      />
                    )}
                  </Field>
                ) : null}
                <Field label={t('Notes')} hint={t('Shown on the document.')}>
                  {(fid) => (
                    <Textarea
                      id={fid}
                      value={doc.notes}
                      onChange={(e) => update({ notes: e.target.value })}
                      rows={3}
                    />
                  )}
                </Field>
                <Field label={t('Terms & conditions')}>
                  {(fid) => (
                    <Textarea
                      id={fid}
                      value={doc.terms}
                      onChange={(e) => update({ terms: e.target.value })}
                      rows={3}
                    />
                  )}
                </Field>
                <Field label={t('Footer')}>
                  {(fid) => (
                    <Input
                      id={fid}
                      value={doc.footer}
                      onChange={(e) => update({ footer: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={t('Private notes')} hint={t('Only visible to you, never printed.')}>
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
            {priced ? (
              <Card className={cn('-order-1', !showPreview && 'lg:order-2')}>
                <CardHeader title={t('Totals')} />
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
                    taxExempt={documentTaxExempt(doc, client)}
                    allowDeposit={type === 'invoice' || type === 'proforma'}
                    contact={client}
                  />
                </CardBody>
              </Card>
            ) : null}
          </div>

          <div className="hidden justify-end border-t border-slate-200 pt-4 lg:flex xl:hidden">
            {saveButtons}
          </div>
        </div>

        {showPreview ? (
          <aside className="hidden xl:block">
            <div className="sticky top-20 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-700">{t('Live preview')}</p>
                {design}
              </div>
              <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-xl bg-slate-200/60 p-4">
                {preview}
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      <Dialog open={mobilePreview} onOpenChange={setMobilePreview}>
        <DialogContent title={t('Preview')} size="xl">
          <div className="space-y-3 bg-slate-100 p-4">
            {design}
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
