import { useState } from 'react';
import type { DocumentLanguage } from '@/db/types';
import {
  defaultLabels,
  LABEL_KEYS,
  overrideKey,
  type LabelKey,
  type LabelLanguage,
} from '@/pdf/labels';
import { DOCUMENT_LANGUAGES } from '@/pdf/languages';
import { msg, t } from '@/i18n';
import { Field, Input, Select } from '@/components/ui/form';
import { Segmented } from '@/components/ui/misc';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

const HUMAN: Record<LabelKey, string> = {
  invoice: msg('Invoice title'),
  quote: msg('Quote title'),
  credit: msg('Credit note title'),
  invoiceNumber: msg('Invoice number'),
  quoteNumber: msg('Quote number'),
  creditNumber: msg('Credit note number'),
  issueDate: msg('Issue date'),
  dueDate: msg('Due date'),
  validUntil: msg('Valid until'),
  poNumber: msg('PO number'),
  hijriDate: msg('Hijri date'),
  deliveryDate: msg('Delivery date'),
  deliveryPlace: msg('Delivery place'),
  from: msg('From'),
  billTo: msg('Bill to'),
  quoteTo: msg('Prepared for'),
  shipTo: msg('Ship to'),
  description: msg('Description column'),
  condition: msg('Condition column'),
  conditionNew: msg('New (condition)'),
  conditionUsed: msg('Used (condition)'),
  serialNumber: msg('Serial number'),
  quantity: msg('Quantity column'),
  unitPrice: msg('Unit price column'),
  discount: msg('Discount'),
  tax: msg('Tax column'),
  amount: msg('Amount column'),
  subtotal: msg('Subtotal'),
  total: msg('Total'),
  paid: msg('Amount paid'),
  balanceDue: msg('Balance due'),
  amountDue: msg('Amount due'),
  creditRemaining: msg('Credit remaining'),
  depositDue: msg('Deposit due'),
  includes: msg('Includes (tax-inclusive)'),
  reverseCharge: msg('Reverse charge (tax the client accounts for)'),
  amountInWords: msg('Amount in words'),
  notes: msg('Notes'),
  terms: msg('Terms'),
  paymentDetails: msg('Payment details'),
  bank: msg('Bank'),
  iban: msg('IBAN'),
  accountName: msg('Account name'),
  accountNumber: msg('Account number'),
  swift: msg('SWIFT code'),
  wamd: msg('WAMD'),
  payOnline: msg('Pay online'),
  scanToPay: msg('Scan to pay'),
  crNumber: msg('CR number'),
  licenceNumber: msg('Commercial licence number'),
  taxCard: msg('Tax card number'),
  signature: msg('Authorised signature'),
  stamp: msg('Stamp'),
  receivedBy: msg('Received by'),
  page: msg('Page'),
  of: msg('of'),
  paidStamp: msg('Paid stamp'),
  voidStamp: msg('Void stamp'),
  overdueStamp: msg('Overdue stamp'),
  acceptedStamp: msg('Accepted stamp'),
  proforma: msg('Proforma invoice title'),
  salesOrder: msg('Sales order title'),
  purchaseOrder: msg('Purchase order title'),
  deliveryNote: msg('Delivery note title'),
  proformaNumber: msg('Proforma number'),
  salesOrderNumber: msg('Sales order number'),
  purchaseOrderNumber: msg('Purchase order number'),
  deliveryNoteNumber: msg('Delivery note number'),
  supplier: msg('Supplier'),
  deliveredTo: msg('Delivered to'),
  deliveredBy: msg('Delivered by'),
  receiverName: msg('Name of the person receiving'),
  civilId: msg('Civil ID number'),
  date: msg('Date'),
  unit: msg('Unit column'),
  receivedInGoodOrder: msg('Receipt wording on delivery notes'),
  deliveredStamp: msg('Delivered stamp'),
  cancelledStamp: msg('Cancelled stamp'),
  receiverSignature: msg('Signature of the person receiving'),
};

const HINTS: Partial<Record<LabelKey, string>> = {
  invoice: msg('For example “Tax invoice”'),
  quote: msg('For example “Estimate” or “Quotation”'),
};

/** The sets of words a document language prints (bilingual documents print two). */
function wordingLanguages(language: DocumentLanguage): LabelLanguage[] {
  return language === 'ar-en' ? ['ar', 'en'] : [language];
}

export default function LabelSettings() {
  const { draft, update, dirty, saving, save, reset } = useCompanyDraft();
  const languages = wordingLanguages(draft.language);
  const [picked, setPicked] = useState<LabelLanguage>(languages[0]);
  const editing = languages.includes(picked) ? picked : languages[0];
  const defaults = defaultLabels(editing);
  const arabic = editing === 'ar';

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('Document language')}
        description={t('Language of the words printed on invoices, quotes and credit notes.')}
      >
        <Field
          label={t('Language')}
          hint={t(
            'Arabic and English prints both, Arabic first. Clients can have their own language.',
          )}
        >
          {(id) => (
            <Select
              id={id}
              value={draft.language}
              onChange={(e) => update({ language: e.target.value as DocumentLanguage })}
              className="max-w-xs"
            >
              {DOCUMENT_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {t(l.label)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </SettingsSection>

      <SettingsSection
        title={t('Custom wording')}
        description={t(
          'Change any printed word, for example “Tax invoice” instead of “Invoice”. Leave a field empty to use the standard word.',
        )}
        actions={
          languages.length > 1 ? (
            <Segmented
              size="sm"
              value={editing}
              onChange={setPicked}
              options={[
                { value: 'ar', label: t('Arabic') },
                { value: 'en', label: t('English') },
              ]}
            />
          ) : null
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LABEL_KEYS.map((key) => {
            const stored = overrideKey(editing, key);
            const hint = HINTS[key];
            return (
              <Field key={key} label={t(HUMAN[key])} hint={hint ? t(hint) : undefined}>
                {(id) => (
                  <Input
                    id={id}
                    dir={arabic ? 'rtl' : 'ltr'}
                    lang={arabic ? 'ar' : undefined}
                    value={draft.labels[stored] ?? ''}
                    placeholder={defaults[key]}
                    onChange={(e) => {
                      const labels = { ...draft.labels };
                      if (e.target.value) labels[stored] = e.target.value;
                      else delete labels[stored];
                      update({ labels });
                    }}
                  />
                )}
              </Field>
            );
          })}
        </div>
      </SettingsSection>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}
