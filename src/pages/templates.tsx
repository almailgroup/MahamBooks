import { useMemo, useState } from 'react';
import { CheckCircle2, Eye } from 'lucide-react';
import type { Company, DocumentLanguage } from '@/db/types';
import { TEMPLATE_META, type TemplateMeta } from '@/pdf/template-meta';
import { sampleClient, sampleCompany, sampleDocument } from '@/pdf/sample';
import { showsAmountInWords } from '@/pdf/model';
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
import { SaveBar, useCompanyDraft } from './settings/shared';

const FONT_CHOICES = [
  { value: '', label: msg('Template default') },
  { value: 'inter', label: msg('Inter (modern sans)') },
  { value: 'manrope', label: msg('Manrope (geometric sans)') },
  { value: 'plexsans', label: msg('IBM Plex Sans (technical)') },
  { value: 'spacegrotesk', label: msg('Space Grotesk (bold)') },
  { value: 'lora', label: msg('Lora (classic serif)') },
];

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
  language,
  onClose,
  onUse,
}: {
  template: TemplateMeta;
  company: Company;
  language: PreviewLanguage;
  onClose: () => void;
  onUse: () => void;
}) {
  const data = useMemo(() => {
    const c = previewCompany(company);
    const client = sampleClient(c.id);
    return {
      company: c,
      client,
      doc: sampleDocument(c, client, 'invoice', { currency: c.currency }, language),
    };
  }, [company, language]);
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
          <Button onClick={onUse}>{t('Use as default')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TemplatesPage() {
  const { draft, update, dirty, saving, save, saveWith, reset } = useCompanyDraft();
  const [previewing, setPreviewing] = useState<TemplateMeta | null>(null);
  const [language, setLanguage] = useState<PreviewLanguage>(() =>
    draft.language === 'ar' || draft.language === 'ar-en' ? draft.language : 'en',
  );
  const branding = draft.branding;
  const setBranding = (patch: Partial<Company['branding']>) =>
    update({ branding: { ...branding, ...patch } });
  const setDefaults = (patch: Partial<Company['defaults']>) =>
    update({ defaults: { ...draft.defaults, ...patch } });

  const applyTemplate = async (id: string) => {
    const meta = TEMPLATE_META.find((m) => m.id === id);
    await saveWith(
      { branding: { ...branding, templateId: id } },
      t('{name} is now your default template', { name: meta ? t(meta.name) : id }),
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

      <Card className="mb-6 grid gap-6 p-4 sm:p-6 lg:grid-cols-3">
        <Field label={t('Brand colour')} hint={t('Used for headings, highlights and the total.')}>
          {(id) => (
            <ColorField
              id={id}
              value={branding.accentColor}
              onChange={(accentColor) => setBranding({ accentColor })}
            />
          )}
        </Field>
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
        <div className="space-y-4">
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
          const active = branding.templateId === meta.id;
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
                  {!active ? (
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
          language={language}
          onClose={() => setPreviewing(null)}
          onUse={() => void applyTemplate(previewing.id)}
        />
      ) : null}
    </div>
  );
}
