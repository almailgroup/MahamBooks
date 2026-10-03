import type {
  Client,
  Company,
  DocumentLanguage,
  InvoiceDocument,
  ISODate,
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
import { bankFromIban, formatHijri, formatIban, isValidIban } from '@/lib/kuwait';
import { amountInWords } from '@/lib/words';
import { isISODate, today } from '@/lib/dates';
import type { FontId } from './fonts';
import { documentLabels, isRtlLanguage, type LabelKey, type Labels } from './labels';
import { ltr } from './bidi';
import { hasPrices, isPrintable, type PrintableDocumentType } from '@/lib/document-types';

export interface RenderItem {
  kind: 'item' | 'heading';
  /** Main line (item name, or the description when there is no name). */
  title: string;
  /** English name under the Arabic one in bilingual documents. */
  titleSecondary: string;
  /** Secondary text under the title. */
  detail: string;
  /** e.g. "Serial no.: SN-0042"; empty when not set. */
  serial: string;
  /** The serial number alone, for the serial number column of delivery notes. */
  serialNo: string;
  /** "New" or "Used" in the document language; empty when not set. */
  condition: string;
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
  /** English label in bilingual documents. */
  secondary?: string;
  value: string;
}

export interface RenderMeta {
  label: string;
  /** English label in bilingual documents. */
  secondary?: string;
  value: string;
}

export interface RenderCompany {
  /** Arabic name in Arabic and bilingual documents (when there is one). */
  name: string;
  /** English name under the Arabic one in bilingual documents. */
  nameSecondary: string;
  logo: string | null;
  addressLines: string[];
  email: string;
  phone: string;
  website: string;
  /** e.g. "VAT No.: GB123456789" */
  taxLine: string;
  /** e.g. "CR No.: 123456" */
  registrationLine: string;
  /** e.g. "Licence No.: 2024/1234" (Kuwaiti commercial licence). */
  licenceLine: string;
}

export interface RenderClient {
  name: string;
  /** English name under the Arabic one in bilingual documents. */
  nameSecondary: string;
  contactName: string;
  addressLines: string[];
  email: string;
  phone: string;
  taxLine: string;
}

export interface RenderModel {
  type: PrintableDocumentType;
  language: DocumentLanguage;
  /** Right to left for Arabic and bilingual documents. */
  dir: 'ltr' | 'rtl';
  labels: Labels;
  /** English words printed next to the Arabic in bilingual documents; null otherwise. */
  secondary: Labels | null;
  /** Document title, e.g. "Invoice" (Arabic in Arabic documents). */
  title: string;
  /** English title in bilingual documents. */
  titleSecondary: string;
  number: string;
  numberLabel: string;
  numberLabelSecondary: string;
  /** Issue date, Hijri date, due date / valid until, PO number, delivery. */
  meta: RenderMeta[];
  issueDate: string;
  dueDate: string;
  /** "Bill to" for invoices, "Prepared for" for quotes, "Supplier", "Delivered to". */
  recipientLabel: string;
  recipientLabelSecondary: string;
  company: RenderCompany;
  client: RenderClient;
  shipTo: { name: string; lines: string[] } | null;
  items: RenderItem[];
  /**
   * Columns of the items table. Delivery notes have no prices: quantity,
   * unit and serial number columns instead.
   */
  columns: {
    prices: boolean;
    discount: boolean;
    tax: boolean;
    condition: boolean;
    unit: boolean;
    serial: boolean;
  };
  totals: RenderTotal[];
  grandTotal: RenderTotal;
  amountDue: { label: string; secondary?: string; value: string; caption: string };
  deposit: { label: string; secondary?: string; value: string; caption: string } | null;
  /** The total in words: Arabic, then English in bilingual documents. Empty when off. */
  amountInWords: string[];
  stamp: { text: string; secondary?: string; tone: 'green' | 'red' | 'gray' } | null;
  /** Signature, company stamp and "received by" boxes; null when not printed. */
  signatures: { signature: string | null; stamp: string | null; receivedBy: boolean } | null;
  /**
   * Delivery notes: both sides sign and stamp, with who received the goods
   * (blank lines to fill in by hand until it is marked as delivered).
   */
  receipt: { name: string; civilId: string; date: string } | null;
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
  | 'paymentLink'
  | 'deliveryDate'
  | 'deliveryPlace'
  | 'receiverName'
  | 'receiverCivilId'
> & { totals: Pick<InvoiceDocument['totals'], 'paid'> };

const TITLE_KEYS: Record<PrintableDocumentType, LabelKey> = {
  invoice: 'invoice',
  quote: 'quote',
  credit: 'credit',
  proforma: 'proforma',
  sales_order: 'salesOrder',
  purchase_order: 'purchaseOrder',
  delivery_note: 'deliveryNote',
};

const NUMBER_KEYS: Record<PrintableDocumentType, LabelKey> = {
  invoice: 'invoiceNumber',
  quote: 'quoteNumber',
  credit: 'creditNumber',
  proforma: 'proformaNumber',
  sales_order: 'salesOrderNumber',
  purchase_order: 'purchaseOrderNumber',
  delivery_note: 'deliveryNoteNumber',
};

const RECIPIENT_KEYS: Record<PrintableDocumentType, LabelKey> = {
  invoice: 'billTo',
  quote: 'quoteTo',
  credit: 'billTo',
  proforma: 'billTo',
  sales_order: 'billTo',
  purchase_order: 'supplier',
  delivery_note: 'deliveredTo',
};

export interface BuildModelOptions {
  /** Data URL of the payment-link QR code, if any. */
  qrCode?: string | null;
  /** Accent override (template gallery previews). */
  accent?: string;
  /** Language override (template gallery previews). */
  language?: DocumentLanguage;
}

/** Numbers and dates in Arabic documents: Arabic words, Western digits. */
export const ARABIC_LOCALE = 'ar-KW-u-nu-latn';

const clean = (s: string | null | undefined) => (s ?? '').trim();

/** Keeps phone numbers and tax ids on one line by using non-breaking spaces. */
const unbreakable = (s: string | null | undefined) => clean(s).replace(/ /g, '\u00a0');

const arabicLongDate = new Intl.DateTimeFormat(ARABIC_LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Language the document is printed in: the client's, else the company's. */
export function documentLanguage(company: Company, client: Client | null): DocumentLanguage {
  return client?.language ?? company.language ?? 'en';
}

/** Kuwaiti companies print the amount in words unless they turn it off. */
export function showsAmountInWords(company: Company): boolean {
  return (
    company.defaults.showAmountInWords ??
    (company.address.country === 'KW' || company.currency === 'KWD')
  );
}

/** The payment link printed on a document: its own (unless expired), else the company's. */
export function paymentLinkOf(
  doc: Pick<InvoiceDocument, 'paymentLink'>,
  company: Company,
  on: ISODate = today(),
): string {
  const own = doc.paymentLink;
  if (own && clean(own.url) && !(own.expiresAt && own.expiresAt < on)) return clean(own.url);
  return clean(company.payment.paymentLink);
}

const IBAN_PATTERN = /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){10,30}\b/g;

/**
 * Bank details as printed: IBANs grouped in fours (and labelled when they
 * stand alone), the bank's name in the document language when the IBAN
 * shows it, and the WAMD number.
 */
function paymentDetails(
  text: string,
  labels: Labels,
  secondary: Labels | null,
  language: DocumentLanguage,
  wamdPhone: string,
): string {
  const rtl = isRtlLanguage(language);
  let bank: ReturnType<typeof bankFromIban>;
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const alone = isValidIban(line);
      const formatted = line.replace(IBAN_PATTERN, (match) => {
        if (!isValidIban(match)) return match;
        bank ??= bankFromIban(match);
        return formatIban(match);
      });
      // A bare IBAN gets its label on the line above, so it never wraps.
      return alone ? `${labels.iban}\n${formatted}` : formatted;
    });
  if (bank) {
    const lower = text.toLowerCase();
    const mentioned = [bank.name.en, bank.name.ar].some((n) => lower.includes(n.toLowerCase()));
    if (!mentioned) {
      // Bilingual documents name the bank in both languages, one per line.
      const names = rtl ? [`${labels.bank}: ${bank.name.ar}`] : [`${labels.bank}: ${bank.name.en}`];
      if (secondary) names.push(`${secondary.bank}: ${bank.name.en}`);
      lines.unshift(...names);
    }
  }
  if (clean(wamdPhone)) {
    const label = secondary ? `${labels.wamd} · ${ltr(secondary.wamd)}` : labels.wamd;
    lines.push(`${label}: ${rtl ? ltr(unbreakable(wamdPhone)) : unbreakable(wamdPhone)}`);
  }
  return lines.join('\n');
}

/** A record's name in the document language; English goes under Arabic in bilingual documents. */
function names(
  english: string,
  arabic: string | undefined,
  language: DocumentLanguage,
): { name: string; nameSecondary: string } {
  const ar = clean(arabic);
  if (!ar || !isRtlLanguage(language)) return { name: english, nameSecondary: '' };
  return { name: ar, nameSecondary: language === 'ar-en' && ar !== english ? english : '' };
}

export function buildRenderModel(
  doc: RenderableDocument,
  company: Company,
  client: Client | null,
  options: BuildModelOptions = {},
): RenderModel {
  const language = options.language ?? documentLanguage(company, client);
  const rtl = isRtlLanguage(language);
  const { primary: labels, secondary } = documentLabels(language, company.labels);
  const en = (key: LabelKey) => secondary?.[key] ?? '';
  /** "Arabic · English" in bilingual documents. */
  const both = (key: LabelKey) =>
    secondary ? `${labels[key]} · ${ltr(secondary[key])}` : labels[key];
  // Arabic documents write amounts the Arabic way ("1,234.500 د.ك"); bilingual
  // ones keep "KD 1,234.500", which both readers know.
  const locale = language === 'ar' ? ARABIC_LOCALE : company.locale || 'en-KW';
  const addressLocale = rtl ? 'ar-KW' : locale;
  const currency = doc.currency || company.currency || 'KWD';
  const display = company.currencyDisplay ?? 'local';
  const money = (n: number) => formatMoney(n, currency, locale, display);
  const date = (d: string | null | undefined) => {
    if (!d) return '';
    // Month names in Arabic; numeric formats stay as they are.
    if (language === 'ar' && company.dateFormat.includes('MMM') && isISODate(d)) {
      return arabicLongDate.format(new Date(`${d}T00:00:00Z`));
    }
    return formatDate(d, company.dateFormat, locale);
  };

  const result = computeDocument(doc, { paid: doc.totals.paid, taxExempt: client?.taxExempt });

  if (!isPrintable(doc.type)) throw new Error(`${doc.type} documents are not printed`);
  const type = doc.type;
  const numberKey = NUMBER_KEYS[type];
  const priced = hasPrices(type);
  const note = type === 'delivery_note';
  // Quotes and proformas are valid until a date; invoices are due on one.
  const validity = type === 'quote' || type === 'proforma';
  const row = (key: LabelKey, value: string): RenderMeta => ({
    label: labels[key],
    secondary: en(key),
    value,
  });

  const meta: RenderMeta[] = [row('issueDate', date(doc.issueDate))];
  if (company.defaults.showHijriDate && isISODate(doc.issueDate)) {
    meta.push(row('hijriDate', formatHijri(doc.issueDate, rtl ? 'ar' : 'en')));
  }
  if (doc.dueDate) meta.push(row(validity ? 'validUntil' : 'dueDate', date(doc.dueDate)));
  // A purchase order's own number is its PO number.
  if (clean(doc.poNumber) && type !== 'purchase_order') {
    meta.push(row('poNumber', clean(doc.poNumber)));
  }
  // Delivery notes show the date large and the place as the "delivered to" address.
  if (doc.deliveryDate && !note) meta.push(row('deliveryDate', date(doc.deliveryDate)));
  if (clean(doc.deliveryPlace) && !note) {
    meta.push(row('deliveryPlace', clean(doc.deliveryPlace)));
  }

  const items: RenderItem[] = doc.items.map((item, i) => {
    const named = names(clean(item.name), item.nameAr, language);
    const description = clean(item.description);
    const base = {
      title: named.name || description,
      titleSecondary: named.nameSecondary,
      detail: named.name ? description : '',
    };
    if (item.kind === 'heading') {
      return {
        kind: 'heading',
        ...base,
        serial: '',
        serialNo: '',
        condition: '',
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
    const serial = clean(item.serialNumber);
    const condition = item.condition === 'new' || item.condition === 'used' ? item.condition : null;
    return {
      kind: 'item',
      ...base,
      serial: serial ? `${both('serialNumber')}: ${rtl ? ltr(serial) : serial}` : '',
      serialNo: serial ? (rtl ? ltr(serial) : serial) : '',
      condition: condition ? both(condition === 'new' ? 'conditionNew' : 'conditionUsed') : '',
      quantity,
      unit,
      quantityWithUnit: unit ? `${quantity} ${unit}` : quantity,
      unitPrice: formatUnitPrice(item.unitPrice, currency, locale, display),
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

  const total = (kind: RenderTotal['kind'], key: LabelKey, value: number): RenderTotal => ({
    kind,
    label: labels[key],
    secondary: en(key),
    value: money(value),
  });

  const totals: RenderTotal[] = [total('subtotal', 'subtotal', result.subtotal)];
  if (result.discount !== 0) {
    const percent =
      doc.discountType === 'percent' ? ` (${formatPercent(doc.discount, locale)})` : '';
    totals.push({
      ...total('discount', 'discount', -result.discount),
      label: `${labels.discount}${percent}`,
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
  const grandTotal = total('total', 'total', result.total);
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
  if (note) {
    // No money on a delivery note: the delivery date takes the place of the amount.
    totals.length = 0;
    amountDue = {
      label: labels.deliveryDate,
      secondary: en('deliveryDate'),
      value: date(doc.deliveryDate || doc.issueDate),
      caption: '',
    };
  } else if (type !== 'invoice' && type !== 'credit') {
    amountDue = {
      label: labels.total,
      secondary: en('total'),
      value: money(result.total),
      caption: validity && doc.dueDate ? `${labels.validUntil} ${date(doc.dueDate)}` : '',
    };
  } else {
    const balanceKey: LabelKey = doc.type === 'credit' ? 'creditRemaining' : 'balanceDue';
    if (result.paid !== 0) {
      totals.push(total('paid', 'paid', -result.paid));
      totals.push(total('balance', balanceKey, isVoid ? 0 : result.balance));
    }
    const dueKey: LabelKey =
      result.paid !== 0 ? balanceKey : doc.type === 'credit' ? 'total' : 'amountDue';
    amountDue = {
      label: labels[dueKey],
      secondary: en(dueKey),
      value: money(isVoid ? 0 : result.balance),
      caption:
        doc.type === 'invoice' && doc.dueDate ? `${labels.dueDate}: ${date(doc.dueDate)}` : '',
    };
  }

  const deposit =
    (type === 'invoice' || type === 'proforma') && result.depositDue > 0 && !isVoid
      ? {
          label: labels.depositDue,
          secondary: en('depositDue'),
          value: money(result.depositDue),
          caption: doc.depositDueDate ? date(doc.depositDueDate) : '',
        }
      : null;

  const words: string[] = [];
  if (showsAmountInWords(company) && result.total !== 0 && priced) {
    if (rtl) words.push(amountInWords(result.total, currency, 'ar'));
    if (language !== 'ar') words.push(amountInWords(result.total, currency, 'en'));
  }

  let stamp: RenderModel['stamp'] = null;
  if (company.branding.showStatusStamp) {
    const of = (key: LabelKey, tone: 'green' | 'gray') => ({
      text: labels[key],
      secondary: en(key),
      tone,
    });
    if (doc.status === 'paid') stamp = of('paidStamp', 'green');
    else if (doc.status === 'void') stamp = of('voidStamp', 'gray');
    else if (doc.status === 'accepted') stamp = of('acceptedStamp', 'green');
    else if (doc.status === 'delivered') stamp = of('deliveredStamp', 'green');
    else if (doc.status === 'cancelled') stamp = of('cancelledStamp', 'gray');
  }

  const signatureImage = company.branding.signature ?? null;
  const stampImage = company.branding.stamp ?? null;
  // Kuwaiti invoices carry the supplier's signature and stamp, so Arabic and
  // bilingual documents always leave room for them.
  // Delivery notes are always signed and stamped by both sides.
  const signatures =
    rtl || signatureImage || stampImage || note
      ? {
          signature: signatureImage,
          stamp: stampImage,
          receivedBy: type === 'invoice' || type === 'credit' || note,
        }
      : null;
  const delivered = note && doc.status === 'delivered';
  const receipt = note
    ? {
        name: delivered ? clean(doc.receiverName) : '',
        civilId: delivered ? clean(doc.receiverCivilId) : '',
        date: delivered ? date(doc.deliveryDate) : '',
      }
    : null;

  const pay = company.payment;
  const link = paymentLinkOf(doc, company);
  // Payment instructions only make sense while something is still owed (or, on
  // a proforma, asked for in advance).
  const showPayment = (type === 'invoice' || type === 'proforma') && !isVoid && result.balance > 0;
  const details = paymentDetails(
    clean(pay.bankDetails),
    labels,
    secondary,
    language,
    company.kuwait?.wamdPhone ?? '',
  );
  const payment =
    showPayment && (details || clean(pay.instructions) || link)
      ? {
          details,
          instructions: clean(pay.instructions),
          link,
          qr: pay.showQrCode && link ? (options.qrCode ?? null) : null,
        }
      : null;

  const idLine = (label: string, value: string) =>
    clean(value) ? `${clean(label) || 'Tax ID'}: ${unbreakable(value)}` : '';
  // The usual English labels have words of their own in Arabic documents.
  const knownLabel = (custom: string, key: LabelKey, defaults: string[]) =>
    rtl && (!clean(custom) || defaults.includes(clean(custom))) ? labels[key] : custom;
  const taxIdLabel = knownLabel(company.taxIdLabel, 'taxCard', ['Tax card no.']);

  const shipping = client?.shippingAddress;
  const clientNames = names(clean(client?.name), client?.nameAr, language);
  const hasShipping = Boolean(client && shipping && !isAddressEmpty(shipping));
  // A supplier is never shipped to; a delivery note names where the goods went.
  const shipTo =
    client && shipping && hasShipping && type !== 'purchase_order' && !note
      ? { name: clientNames.name, lines: formatAddressLines(shipping, addressLocale) }
      : null;
  // The country is left out for domestic clients.
  const foreign = !client || client.address.country !== company.address.country;
  const clientAddress =
    note && clean(doc.deliveryPlace)
      ? clean(doc.deliveryPlace)
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      : formatAddressLines(
          note && hasShipping ? shipping : client?.address,
          addressLocale,
          foreign,
        );

  const primaryContact = client?.contacts.find((c) => c.primary) ?? client?.contacts[0];
  const companyNames = names(
    clean(company.legalName) || clean(company.name),
    company.nameAr,
    language,
  );
  const titleKey = TITLE_KEYS[type];
  const title = labels[titleKey];
  const titleSecondary = en(titleKey);

  return {
    type,
    language,
    dir: rtl ? 'rtl' : 'ltr',
    labels,
    secondary,
    title,
    titleSecondary,
    number: clean(doc.number),
    numberLabel: labels[numberKey],
    numberLabelSecondary: en(numberKey),
    meta,
    issueDate: date(doc.issueDate),
    dueDate: date(doc.dueDate),
    recipientLabel: labels[RECIPIENT_KEYS[type]],
    recipientLabelSecondary: en(RECIPIENT_KEYS[type]),
    company: {
      ...companyNames,
      logo: company.branding.logo,
      addressLines: formatAddressLines(company.address, addressLocale),
      email: clean(company.email),
      phone: unbreakable(company.phone),
      website: clean(company.website),
      taxLine: idLine(taxIdLabel, company.taxId),
      registrationLine: idLine(
        knownLabel(company.registrationLabel || 'Reg. No.', 'crNumber', ['CR No.', 'Reg. No.']),
        company.registrationNumber,
      ),
      licenceLine: idLine(labels.licenceNumber, company.kuwait?.licenceNumber ?? ''),
    },
    client: {
      ...clientNames,
      contactName:
        clean(primaryContact?.name) !== clean(client?.name) ? clean(primaryContact?.name) : '',
      addressLines: clientAddress,
      email: clean(primaryContact?.email) || clean(client?.email),
      phone: unbreakable(clean(client?.phone) || clean(primaryContact?.phone)),
      taxLine: idLine(taxIdLabel, client?.taxId ?? ''),
    },
    shipTo,
    items,
    columns: {
      prices: priced,
      discount: priced && items.some((i) => i.discount !== ''),
      tax: priced && items.some((i) => i.tax !== ''),
      condition: items.some((i) => i.condition !== ''),
      unit: !priced && items.some((i) => i.unit !== ''),
      serial: !priced && items.some((i) => i.serialNo !== ''),
    },
    totals,
    grandTotal,
    amountDue,
    deposit,
    amountInWords: [...new Set(words)],
    stamp,
    signatures,
    receipt,
    notes: clean(doc.notes),
    terms: clean(doc.terms),
    footer: clean(doc.footer),
    payment: priced ? payment : null,
    currency,
    pageSize: company.defaults.pageSize,
    accent: normalizeHex(options.accent ?? company.branding.accentColor),
    fontId: (company.branding.fontId as FontId | null) ?? null,
    documentTitle: `${titleSecondary || title} ${clean(doc.number)}`.trim(),
  };
}
