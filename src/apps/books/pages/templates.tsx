import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle2, Eye, Lock } from 'lucide-react';
import type {
  Company,
  DocumentLanguage,
  DocumentLayout,
  LogoPosition,
  LogoSize,
  QrContent,
} from '@/db/types';
import { TEMPLATE_META, type TemplateMeta } from '@/pdf/template-meta';
import { sampleClient, sampleCompany, sampleDocument } from '@/pdf/sample';
import { showsAmountInWords } from '@/pdf/model';
import {
  documentLayout,
  typeAccent,
  typeDesign,
  typeTemplate,
  withSameAsInvoices,
  withTypeDesign,
  type DesignedType,
} from '@/pdf/template-resolve';
import { isAddressEmpty } from '@/lib/geo';
import { cn } from '@/lib/cn';
import { msg, t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader, Segmented } from '@/components/ui/misc';
import { Field, Select, Switch } from '@/components/ui/form';
import { ColorField } from '@/components/fields';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { PdfPreview } from '@/components/pdf/pdf-preview';
import { useLivePdf } from '@/components/pdf/use-pdf';
import { useRoleView } from '@/features/cloud/role-gates';
import { SaveBar, useCompanyDraft } from '@/pages/settings/shared';

const FONT_CHOICES = [
  { value: '', label: msg('Template default') },
  { value: 'inter', label: msg('Inter (modern sans)') },
  { value: 'manrope', label: msg('Manrope (geometric sans)') },
  { value: 'plexsans', label: msg('IBM Plex Sans (technical)') },
  { value: 'spacegrotesk', label: msg('Space Grotesk (bold)') },
  { value: 'lora', label: msg('Lora (classic serif)') },
];

/** The types of document with a design of their own: the page's tabs (`?type=quote`). */
const TYPES: { value: DesignedType; label: string; design: string }[] = [
  { value: 'invoice', label: msg('Invoices'), design: msg('Invoice design') },
  { value: 'quote', label: msg('Quotes'), design: msg('Quote design') },
  { value: 'credit', label: msg('Credit notes'), design: msg('Credit note design') },
];

const LOGO_SIZES: { value: LogoSize; label: string }[] = [
  { value: 'small', label: msg('Small') },
  { value: 'medium', label: msg('Medium (as designed)') },
  { value: 'large', label: msg('Large') },
];

const LOGO_POSITIONS: { value: LogoPosition | ''; label: string }[] = [
  { value: '', label: msg('Where the template puts it') },
  { value: 'start', label: msg('On top, left') },
  { value: 'center', label: msg('On top, centred') },
  { value: 'end', label: msg('On top, right') },
];

/** Leaves out what prints as before, so a layout nobody changed stays empty. */
function tidyLayout(layout: DocumentLayout): DocumentLayout {
  return Object.fromEntries(
    Object.entries(layout).filter(([, v]) => v !== undefined && v !== false && v !== 'medium'),
  );
}

type PreviewLanguage = Extract<DocumentLanguage, 'en' | 'ar' | 'ar-en'>;

/** Thumbnails in public/templates, one set per language (see scripts/make-thumbnails.sh). */
const THUMBNAIL_SUFFIX: Record<PreviewLanguage, string> = { en: '', ar: '-ar', 'ar-en': '-ar-en' };

/** The user's own company (falling back to sample details) for previews. */
function previewCompany(company: Company): Company {
  const sample = sampleCompany();
  return {
    ...company,
    nameAr: company.nameAr || (company.name ? '' : sample.nameAr),
    address: isAddressEmpty(company.address) ? sample.address : company.address,
    email: company.email || sample.email,
    phone: company.phone || sample.phone,
    payment:
      company.payment.bankDetails || company.payment.paymentLink ? company.payment : sample.payment,
  };
}

function PreviewDialog({
  template,
  company,
  type,
  language,
  canUse,
  onClose,
  onUse,
}: {
  template: TemplateMeta;
  company: Company;
  type: DesignedType;
  language: PreviewLanguage;
  canUse: boolean;
  onClose: () => void;
  onUse: () => void;
}) {
  const data = useMemo(() => {
    const c = previewCompany(company);
    const client = sampleClient(c.id);
    // A quote shows the company's introduction, as new quotes get it.
    const intro = type === 'quote' ? (c.defaults.quoteIntro ?? '') : '';
    return {
      company: c,
      client,
      doc: sampleDocument(c, client, type, { currency: c.currency, intro }, language),
    };
  }, [company, type, language]);
  const pdf = useLivePdf(data.doc, data.company, data.client, template.id, {
    delay: 0,
    language,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('{name} template', { name: t(template.name) })}
        description={t('Previewed with your company details and sample items.')}
        size="xl"
      >
        <div className="bg-slate-100 p-4 sm:p-6">
          <div className="mx-auto max-w-[680px]">
            <PdfPreview blob={pdf.blob} loading={pdf.loading} error={pdf.error} maxPages={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
          {canUse ? <Button onClick={onUse}>{t('Use as default')}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TemplatesPage() {
  const { draft, setDraft, update, dirty, saving, save, saveWith, reset } = useCompanyDraft();
  const { role, readOnly } = useRoleView();
  // The design belongs to the company: staff and viewers only look at it.
  const locked = readOnly.readOnly || role === 'staff';
  const [params, setParams] = useSearchParams();
  const type = TYPES.find((x) => x.value === params.get('type'))?.value ?? 'invoice';
  const kind = TYPES.find((x) => x.value === type)!;
  const setType = (next: DesignedType) =>
    setParams(next === 'invoice' ? {} : { type: next }, { replace: true });
  const [previewing, setPreviewing] = useState<TemplateMeta | null>(null);
  const [language, setLanguage] = useState<PreviewLanguage>(() =>
    draft.language === 'ar' || draft.language === 'ar-en' ? draft.language : 'en',
  );
  const branding = draft.branding;
  const setBranding = (patch: Partial<Company['branding']>) =>
    update({ branding: { ...branding, ...patch } });
  const setDefaults = (patch: Partial<Company['defaults']>) =>
    update({ defaults: { ...draft.defaults, ...patch } });

  // Quotes and credit notes print like invoices until they get a design of their own.
  const same = type !== 'invoice' && !typeDesign(draft, type);
  const editable = !locked && !same;
  const templateId = typeTemplate(draft, type);
  const layout = documentLayout({ type }, draft);
  const setLayout = (patch: Partial<DocumentLayout>) =>
    setDraft((c) =>
      withTypeDesign(c, type, { layout: tidyLayout({ ...documentLayout({ type }, c), ...patch }) }),
    );

  const applyTemplate = async (id: string) => {
    const meta = TEMPLATE_META.find((m) => m.id === id);
    const name = meta ? t(meta.name) : id;
    await saveWith(
      (c) => withTypeDesign(c, type, { templateId: id }),
      type === 'quote'
        ? t('Quotes now print with {name}', { name })
        : type === 'credit'
          ? t('Credit notes now print with {name}', { name })
          : t('{name} is now your default template', { name }),
    );
    setPreviewing(null);
  };

  return (
    <div>
      <PageHeader
        title={t('Templates')}
        description={t(
          'Pick the look of your invoices, quotes and credit notes. You can also choose a template per document.',
        )}
      />

      {role === 'staff' ? (
        <p
          role="note"
          className="mb-5 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200"
        >
          <Lock className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
          {t('Owners, admins and accountants choose the design of documents. You can look at it.')}
        </p>
      ) : null}

      <Segmented
        className="mb-4"
        value={type}
        onChange={setType}
        options={TYPES.map((x) => ({ value: x.value, label: t(x.label) }))}
      />

      <Card className="mb-6 p-4 sm:p-6">
        <div className="mb-5">
          <h2 className="text-base font-semibold text-slate-900">{t(kind.design)}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {type === 'invoice'
              ? t(
                  'Proformas, orders and delivery notes print like invoices, and so do quotes and credit notes until they have a design of their own.',
                )
              : t(
                  'Documents downloaded again later print with the design set here, unless they have a template or colour of their own.',
                )}
          </p>
        </div>
        <fieldset disabled={locked} className="space-y-6">
          {type !== 'invoice' ? (
            <Switch
              checked={same}
              onChange={(value) => setDraft((c) => withSameAsInvoices(c, type, value))}
              label={t('Same as invoices')}
              description={
                same
                  ? t('Turn this off to give them a template, colour and layout of their own.')
                  : t('They have a design of their own, set below.')
              }
            />
          ) : null}
          <fieldset disabled={!editable} className="grid gap-6 lg:grid-cols-3">
            <Field
              label={t('Brand colour')}
              hint={t('Used for headings, highlights and the total.')}
            >
              {(id) => (
                <ColorField
                  id={id}
                  value={typeAccent(draft, type)}
                  onChange={(accentColor) =>
                    setDraft((c) => withTypeDesign(c, type, { accentColor }))
                  }
                />
              )}
            </Field>
            <div className="space-y-4">
              <Field label={t('Logo size')}>
                {(id) => (
                  <Select
                    id={id}
                    value={layout.logoSize ?? 'medium'}
                    onChange={(e) => setLayout({ logoSize: e.target.value as LogoSize })}
                  >
                    {LOGO_SIZES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(o.label)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label={t('Logo position')}
                hint={t('Arabic documents read from the right, so left and right swap.')}
              >
                {(id) => (
                  <Select
                    id={id}
                    value={layout.logoPosition ?? ''}
                    onChange={(e) =>
                      setLayout({
                        logoPosition: (e.target.value as LogoPosition | '') || undefined,
                      })
                    }
                  >
                    {LOGO_POSITIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(o.label)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div className="space-y-4">
              <Switch
                checked={Boolean(layout.showSku)}
                onChange={(showSku) => setLayout({ showSku })}
                label={t('SKU column')}
                description={t('The code of each line picked from your items.')}
              />
              <Switch
                checked={Boolean(layout.showItemImages)}
                onChange={(showItemImages) => setLayout({ showItemImages })}
                // Items have pictures once the owner turns them on; a design
                // that prints them can still be turned off.
                disabled={!draft.items?.images && !layout.showItemImages}
                label={t('Item pictures')}
                description={
                  draft.items?.images
                    ? t('The main picture of each item that has one, beside it.')
                    : t('Turn on item pictures in Settings → Items and units first.')
                }
              />
              {type !== 'credit' ? (
                <Switch
                  checked={Boolean(layout.showAcceptance)}
                  onChange={(showAcceptance) => setLayout({ showAcceptance })}
                  label={t('Customer acceptance box')}
                  description={t(
                    'On quotes and proformas: a box for the customer to sign, stamp and date.',
                  )}
                />
              ) : null}
            </div>
          </fieldset>
        </fieldset>
      </Card>

      <Card className="mb-6 p-4 sm:p-6">
        <h2 className="mb-5 text-base font-semibold text-slate-900">{t('On every document')}</h2>
        <fieldset disabled={locked} className="grid gap-6 lg:grid-cols-3">
          <Field label={t('Font')} hint={t('Replaces the template’s typeface for English text.')}>
            {(id) => (
              <Select
                id={id}
                value={branding.fontId ?? ''}
                onChange={(e) => setBranding({ fontId: e.target.value || null })}
              >
                {FONT_CHOICES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {t(f.label)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="space-y-4 lg:col-span-2">
            <Switch
              checked={branding.showStatusStamp}
              onChange={(showStatusStamp) => setBranding({ showStatusStamp })}
              label={t('Paid and void stamp')}
              description={t('Stamp settled, cancelled and accepted documents.')}
            />
            <Switch
              checked={showsAmountInWords(draft)}
              onChange={(showAmountInWords) => setDefaults({ showAmountInWords })}
              label={t('Amount in words')}
              description={t('Print the total in words under the totals.')}
            />
            <Switch
              checked={Boolean(draft.defaults.showHijriDate)}
              onChange={(showHijriDate) => setDefaults({ showHijriDate })}
              label={t('Hijri date')}
              description={t('Print the Hijri date next to the issue date.')}
            />
          </div>
        </fieldset>
      </Card>

      <Card className="mb-6 grid gap-x-6 gap-y-3 p-4 sm:p-6 lg:grid-cols-3">
        <Field
          label={t('The QR code opens')}
          hint={t('Printed on unpaid invoices and proformas, for paying by phone.')}
        >
          {(id) => (
            <Select
              id={id}
              value={draft.defaults.qrContent ?? 'payment_link'}
              onChange={(e) => setDefaults({ qrContent: e.target.value as QrContent })}
              disabled={locked || !draft.payment.showQrCode}
            >
              <option value="payment_link">{t('The payment link')}</option>
              <option value="pay_page" disabled>
                {t('The invoice’s pay page (with online payments)')}
              </option>
            </Select>
          )}
        </Field>
        <p className="text-sm text-slate-500 lg:col-span-2 lg:self-center">
          {draft.payment.showQrCode
            ? t('The QR code is on.')
            : t('The QR code is off, so documents print none.')}{' '}
          <Link to="/settings/payments" className="text-primary-700 font-medium underline">
            {t('Turn it on or off in Payment details')}
          </Link>
        </p>
      </Card>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">{t('Designs')}</h2>
        <Segmented
          size="sm"
          value={language}
          onChange={setLanguage}
          options={[
            { value: 'en', label: 'English' },
            { value: 'ar', label: 'العربية' },
            { value: 'ar-en', label: t('Bilingual') },
          ]}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {TEMPLATE_META.map((meta) => {
          const active = templateId === meta.id;
          const name = t(meta.name);
          return (
            <Card
              key={meta.id}
              className={cn(
                'group flex flex-col overflow-hidden transition-shadow hover:shadow-md',
                active && 'ring-primary-500 ring-2',
              )}
            >
              <button
                type="button"
                onClick={() => setPreviewing(meta)}
                className="relative block aspect-[1/1.18] overflow-hidden border-b border-slate-100 bg-slate-100"
                aria-label={t('Preview the {name} template', { name })}
              >
                <img
                  src={`${import.meta.env.BASE_URL}templates/${meta.id}${THUMBNAIL_SUFFIX[language]}.jpg`}
                  alt={t('{name} invoice template', { name })}
                  loading="lazy"
                  className="absolute inset-x-0 top-0 w-full transition-transform duration-300 group-hover:scale-[1.02]"
                />
                <span className="bg-overlay/0 group-hover:bg-overlay/30 group-focus-visible:bg-overlay/30 absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                  <span className="bg-surface flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-slate-900 shadow">
                    <Eye className="size-4" /> {t('Preview with my details')}
                  </span>
                </span>
              </button>
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900">{name}</h3>
                  {active ? (
                    <Badge tone="blue">
                      <CheckCircle2 className="size-3" /> {t('Default')}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 flex-1 text-sm text-slate-500">{t(meta.description)}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1">
                    {meta.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                      >
                        {t(tag)}
                      </span>
                    ))}
                  </div>
                  {!active && editable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void applyTemplate(meta.id)}
                      aria-label={t('Use {name} as the default template', { name })}
                    >
                      {t('Use')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-slate-500">
        {t('Thumbnails show sample data. Previews use your logo, colour and details.')}
      </p>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />

      {previewing ? (
        <PreviewDialog
          template={previewing}
          company={draft}
          type={type}
          language={language}
          canUse={editable && templateId !== previewing.id}
          onClose={() => setPreviewing(null)}
          onUse={() => void applyTemplate(previewing.id)}
        />
      ) : null}
    </div>
  );
}
