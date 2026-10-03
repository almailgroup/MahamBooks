import type {
  Client,
  Company,
  DocumentLanguage,
  SalesDocumentType,
  InvoiceDocument,
  PageSize,
} from '@/db/types';
import { computeDocument } from '@/lib/document-calc';
import {
  formatDate,
  formatMoney,
  formatPercent,
  formatQuantity,
  formatUnitPrice,
} from '@/lib/format';
import { formatAddressLines, isAddressEmpty } from '@/lib/geo';
import { normalizeHex } from '@/lib/color';
import type { FontId } from './fonts';
import { getLabels, type Labels } from './labels';
import { salesType } from '@/lib/document-types';

export interface RenderItem {
  kind: 'item' | 'heading';
  /** Main line (item name, or the description when there is no name). */
  title: string;
  /** Secondary text under the title. */
  detail: string;
  quantity: string;
  unit: string;
  /** Quantity followed by its unit, e.g. "1,500 pcs". */
  quantityWithUnit: string;
  unitPrice: string;
  discount: string;
  tax: string;
  amount: string;
}

export type TotalKind =
  'subtotal' | 'discount' | 'charge' | 'tax' | 'total' | 'included-tax' | 'paid' | 'balance';

export interface RenderTotal {
  kind: TotalKind;
  label: string;
  value: string;
}

export interface RenderMeta {
  label: string;
  value: string;
}

export interface RenderCompany {
  name: string;
  logo: string | null;
  addressLines: string[];
  email: string;
  phone: string;
  website: string;
  /** e.g. "VAT No.: GB123456789" */
  taxLine: string;
  /** e.g. "Company No.: 01234567" */
  registrationLine: string;
}

export interface RenderClient {
  name: string;
  contactName: string;
  addressLines: string[];
  email: string;
  phone: string;
  taxLine: string;
}

export interface RenderModel {
  type: SalesDocumentType;
  language: DocumentLanguage;
  labels: Labels;
  /** Document title, e.g. "Invoice". */
  title: string;
  number: string;
  numberLabel: string;
  /** Issue date, due date / valid until, PO number. */
  meta: RenderMeta[];
  issueDate: string;
  dueDate: string;
  /** "Bill to" for invoices, "Prepared for" for quotes. */
  recipientLabel: string;
  company: RenderCompany;
  client: RenderClient;
  shipTo: { name: string; lines: string[] } | null;
  items: RenderItem[];
  columns: { discount: boolean; tax: boolean };
  totals: RenderTotal[];
  grandTotal: RenderTotal;
  amountDue: { label: string; value: string; caption: string };
  deposit: { label: string; value: string; caption: string } | null;
  stamp: { text: string; tone: 'green' | 'red' | 'gray' } | null;
  notes: string;
  terms: string;
  footer: string;
  payment: { details: string; instructions: string; link: string; qr: string | null } | null;
  currency: string;
  pageSize: PageSize;
  accent: string;
  fontId: FontId | null;
  /** Used as the PDF title and file name. */
  documentTitle: string;
}

export type RenderableDocument = Pick<
  InvoiceDocument,
  | 'type'
  | 'number'
  | 'status'
  | 'issueDate'
  | 'dueDate'
  | 'poNumber'
  | 'currency'
  | 'items'
  | 'discount'
  | 'discountType'
  | 'taxes'
  | 'charges'
  | 'pricesIncludeTax'
  | 'deposit'
  | 'depositDueDate'
  | 'notes'
  | 'terms'
  | 'footer'
> & { totals: Pick<InvoiceDocument['totals'], 'paid'> };

export interface BuildModelOptions {
  /** Data URL of the payment-link QR code, if any. */
  qrCode?: string | null;
  /** Accent override (template gallery previews). */
  accent?: string;
}

const clean = (s: string | null | undefined) => (s ?? '').trim();

/** Keeps phone numbers and tax ids on one line by using non-breaking spaces. */
const unbreakable = (s: string | null | undefined) => clean(s).replace(/ /g, '\u00a0');

export function buildRenderModel(
  doc: RenderableDocument,
  company: Company,
  client: Client | null,
  options: BuildModelOptions = {},
): RenderModel {
  const language = client?.language ?? company.language ?? 'en';
  const labels = getLabels(language, company.labels);
  const locale = company.locale || 'en-KW';
  const currency = doc.currency || company.currency || 'KWD';
  const money = (n: number) => formatMoney(n, currency, locale);
  const date = (d: string | null) => formatDate(d, company.dateFormat, locale);

  const result = computeDocument(doc, { paid: doc.totals.paid, taxExempt: client?.taxExempt });

  const type = salesType(doc.type);
  const title = labels[type];
  const numberLabel =
    doc.type === 'invoice'
      ? labels.invoiceNumber
      : doc.type === 'quote'
        ? labels.quoteNumber
        : labels.creditNumber;

  const meta: RenderMeta[] = [{ label: labels.issueDate, value: date(doc.issueDate) }];
  if (doc.dueDate) {
    meta.push({
      label: doc.type === 'quote' ? labels.validUntil : labels.dueDate,
      value: date(doc.dueDate),
    });
  }
  if (clean(doc.poNumber)) meta.push({ label: labels.poNumber, value: clean(doc.poNumber) });

  const items: RenderItem[] = doc.items.map((item, i) => {
    const name = clean(item.name);
    const description = clean(item.description);
    if (item.kind === 'heading') {
      return {
        kind: 'heading',
        title: name || description,
        detail: name ? description : '',
        quantity: '',
        unit: '',
        quantityWithUnit: '',
        unitPrice: '',
        discount: '',
        tax: '',
        amount: '',
      };
    }
    const line = result.lines[i];
    const quantity = formatQuantity(item.quantity, locale);
    const unit = clean(item.unit);
    const taxes = client?.taxExempt ? [] : item.taxes.filter((t) => clean(t.name) !== '');
    return {
      kind: 'item',
      title: name || description,
      detail: name ? description : '',
      quantity,
      unit,
      quantityWithUnit: unit ? `${quantity} ${unit}` : quantity,
      unitPrice: formatUnitPrice(item.unitPrice, currency, locale),
      discount:
        item.discount && item.discount !== 0
          ? item.discountType === 'percent'
            ? formatPercent(item.discount, locale)
            : money(item.discount)
          : '',
      tax: taxes.map((t) => formatPercent(t.rate, locale)).join(' + '),
      amount: money(line.net),
    };
  });

  const totals: RenderTotal[] = [
    { kind: 'subtotal', label: labels.subtotal, value: money(result.subtotal) },
  ];
  if (result.discount !== 0) {
    totals.push({
      kind: 'discount',
      label:
        doc.discountType === 'percent'
          ? `${labels.discount} (${formatPercent(doc.discount, locale)})`
          : labels.discount,
      value: money(-result.discount),
    });
  }
  doc.charges.forEach((charge) => {
    if (charge.amount === 0 && !clean(charge.label)) return;
    totals.push({ kind: 'charge', label: clean(charge.label) || '—', value: money(charge.amount) });
  });
  const taxLabel = (name: string, rate: number) => `${name} ${formatPercent(rate, locale)}`;
  // Reverse charge is shown for information under the total: the buyer pays it.
  const charged = result.taxes.filter((t) => t.kind !== 'reverse_charge');
  const reverse = result.taxes.filter((t) => t.kind === 'reverse_charge');
  if (!doc.pricesIncludeTax) {
    charged.forEach((t) =>
      totals.push({ kind: 'tax', label: taxLabel(t.name, t.rate), value: money(t.amount) }),
    );
  }
  const grandTotal: RenderTotal = {
    kind: 'total',
    label: labels.total,
    value: money(result.total),
  };
  totals.push(grandTotal);
  if (doc.pricesIncludeTax) {
    charged.forEach((t) =>
      totals.push({
        kind: 'included-tax',
        label: `${labels.includes} ${taxLabel(t.name, t.rate)}`,
        value: money(t.amount),
      }),
    );
  }
  reverse.forEach((t) =>
    totals.push({
      kind: 'included-tax',
      label: `${labels.reverseCharge} ${taxLabel(t.name, t.rate)}`,
      value: money(t.amount),
    }),
  );

  const isVoid = doc.status === 'void';
  let amountDue: RenderModel['amountDue'];
  if (doc.type === 'quote') {
    amountDue = {
      label: labels.total,
      value: money(result.total),
      caption: doc.dueDate ? `${labels.validUntil} ${date(doc.dueDate)}` : '',
    };
  } else {
    if (result.paid !== 0) {
      totals.push({ kind: 'paid', label: labels.paid, value: money(-result.paid) });
      totals.push({
        kind: 'balance',
        label: doc.type === 'credit' ? labels.creditRemaining : labels.balanceDue,
        value: money(isVoid ? 0 : result.balance),
      });
    }
    amountDue = {
      label:
        doc.type === 'credit'
          ? result.paid !== 0
            ? labels.creditRemaining
            : labels.total
          : result.paid !== 0
            ? labels.balanceDue
            : labels.amountDue,
      value: money(isVoid ? 0 : result.balance),
      caption:
        doc.type === 'invoice' && doc.dueDate ? `${labels.dueDate}: ${date(doc.dueDate)}` : '',
    };
  }

  const deposit =
    doc.type === 'invoice' && result.depositDue > 0 && !isVoid
      ? {
          label: labels.depositDue,
          value: money(result.depositDue),
          caption: doc.depositDueDate ? date(doc.depositDueDate) : '',
        }
      : null;

  let stamp: RenderModel['stamp'] = null;
  if (company.branding.showStatusStamp) {
    if (doc.status === 'paid') stamp = { text: labels.paidStamp, tone: 'green' };
    else if (doc.status === 'void') stamp = { text: labels.voidStamp, tone: 'gray' };
    else if (doc.status === 'accepted') stamp = { text: labels.acceptedStamp, tone: 'green' };
  }

  const pay = company.payment;
  // Payment instructions only make sense while something is still owed.
  const showPayment = doc.type === 'invoice' && !isVoid && result.balance > 0;
  const payment =
    showPayment && (clean(pay.bankDetails) || clean(pay.instructions) || clean(pay.paymentLink))
      ? {
          details: clean(pay.bankDetails),
          instructions: clean(pay.instructions),
          link: clean(pay.paymentLink),
          qr: pay.showQrCode && clean(pay.paymentLink) ? (options.qrCode ?? null) : null,
        }
      : null;

  const taxLine = (label: string, value: string) =>
    clean(value) ? `${clean(label) || 'Tax ID'}: ${unbreakable(value)}` : '';

  const shipping = client?.shippingAddress;
  const shipTo =
    client && shipping && !isAddressEmpty(shipping)
      ? { name: client.name, lines: formatAddressLines(shipping, locale) }
      : null;

  const primaryContact = client?.contacts.find((c) => c.primary) ?? client?.contacts[0];

  return {
    type,
    language,
    labels,
    title,
    number: clean(doc.number),
    numberLabel,
    meta,
    issueDate: date(doc.issueDate),
    dueDate: date(doc.dueDate),
    recipientLabel: doc.type === 'quote' ? labels.quoteTo : labels.billTo,
    company: {
      name: clean(company.legalName) || clean(company.name),
      logo: company.branding.logo,
      addressLines: formatAddressLines(company.address, locale),
      email: clean(company.email),
      phone: unbreakable(company.phone),
      website: clean(company.website),
      taxLine: taxLine(company.taxIdLabel, company.taxId),
      registrationLine: taxLine(
        company.registrationLabel || 'Reg. No.',
        company.registrationNumber,
      ),
    },
    client: {
      name: clean(client?.name),
      contactName:
        clean(primaryContact?.name) !== clean(client?.name) ? clean(primaryContact?.name) : '',
      // The country is left out for domestic clients.
      addressLines: formatAddressLines(
        client?.address,
        locale,
        !client || client.address.country !== company.address.country,
      ),
      email: clean(primaryContact?.email) || clean(client?.email),
      phone: unbreakable(clean(client?.phone) || clean(primaryContact?.phone)),
      taxLine: taxLine(company.taxIdLabel, client?.taxId ?? ''),
    },
    shipTo,
    items,
    columns: {
      discount: items.some((i) => i.discount !== ''),
      tax: items.some((i) => i.tax !== ''),
    },
    totals,
    grandTotal,
    amountDue,
    deposit,
    stamp,
    notes: clean(doc.notes),
    terms: clean(doc.terms),
    footer: clean(doc.footer),
    payment,
    currency,
    pageSize: company.defaults.pageSize,
    accent: normalizeHex(options.accent ?? company.branding.accentColor),
    fontId: (company.branding.fontId as FontId | null) ?? null,
    documentTitle: `${title} ${clean(doc.number)}`.trim(),
  };
}
