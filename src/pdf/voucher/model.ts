import type {
  Account,
  Client,
  Company,
  Expense,
  InvoiceDocument,
  Payment,
  VoucherSignatureLine,
} from '@/db/types';
import { bankName } from '@/lib/cheques';
import { normalizeHex } from '@/lib/color';
import { formatDate, formatMoney } from '@/lib/format';
import { formatAddressLines } from '@/lib/geo';
import { formatHijri } from '@/lib/kuwait';
import { methodInfo, providerLabel } from '@/lib/payment-methods';
import { amountInWords } from '@/lib/words';
import { t } from '@/i18n';
import arabic from '@/i18n/ar/payments';

/**
 * A receipt voucher (سند قبض) for money received, or a payment voucher
 * (سند صرف) for money paid or spent: what it prints, worked out once for the
 * printed page and the PDF. Vouchers read the same in both languages, so
 * every label is in English and Arabic.
 */

export interface Bilingual {
  en: string;
  ar: string;
}

const EN = 'en-KW';
const AR = 'ar-KW-u-nu-latn';

/** Wording printed on vouchers, always in both languages. */
export const VOUCHER_WORDS = {
  receipt: { en: 'Receipt voucher', ar: 'سند قبض' },
  payment: { en: 'Payment voucher', ar: 'سند صرف' },
  number: { en: 'No.', ar: 'رقم' },
  date: { en: 'Date', ar: 'التاريخ' },
  amount: { en: 'Amount', ar: 'المبلغ' },
  receivedFrom: { en: 'Received from', ar: 'استلمنا من' },
  paidTo: { en: 'Paid to', ar: 'اصرفوا إلى' },
  sum: { en: 'The sum of', ar: 'مبلغ وقدره' },
  method: { en: 'Paid by', ar: 'طريقة الدفع' },
  paidFrom: { en: 'Paid from', ar: 'الدفع من' },
  cheque: { en: 'Cheque no.', ar: 'شيك رقم' },
  bank: { en: 'Bank', ar: 'البنك' },
  chequeDate: { en: 'Cheque date', ar: 'تاريخ الشيك' },
  drawer: { en: 'Drawer', ar: 'الساحب' },
  payee: { en: 'Pay to', ar: 'ادفعوا لأمر' },
  being: { en: 'Being', ar: 'وذلك عن' },
  reference: { en: 'Reference', ar: 'المرجع' },
  receivedBy: { en: 'Received by', ar: 'المستلم' },
  accountant: { en: 'Accountant', ar: 'المحاسب' },
  approvedBy: { en: 'Approved by', ar: 'اعتمده' },
  payer: { en: 'Customer', ar: 'العميل' },
  receiver: { en: 'Receiver’s signature', ar: 'توقيع المستلم' },
  void: { en: 'VOID', ar: 'ملغى' },
  invoices: { en: 'Payment of invoices', ar: 'سداد الفواتير' },
  bills: { en: 'Payment of bills', ar: 'سداد فواتير المشتريات' },
} satisfies Record<string, Bilingual>;

/** Money received, or paid (payments made and expenses). */
export type VoucherDirection = 'in' | 'out';

/** The signature lines printed when a company has not set its own. */
export const STANDARD_VOUCHER_LINES: Record<VoucherDirection, VoucherSignatureLine[]> = {
  in: [VOUCHER_WORDS.receivedBy, VOUCHER_WORDS.accountant, VOUCHER_WORDS.payer],
  out: [VOUCHER_WORDS.accountant, VOUCHER_WORDS.approvedBy, VOUCHER_WORDS.receiver],
};

/** Most signature lines a voucher has room for. */
export const MAX_VOUCHER_LINES = 4;

/** The signature lines a company's vouchers print. */
export function voucherLines(
  company: Company,
  direction: VoucherDirection,
): VoucherSignatureLine[] {
  const own = company.vouchers?.lines?.[direction];
  return own && own.length > 0 ? own : STANDARD_VOUCHER_LINES[direction];
}

/** A piece of a printed value, in its own direction (none: as the sheet reads). */
export interface VoucherPart {
  text: string;
  dir?: 'ltr' | 'rtl' | 'auto';
}

/** One line of a printed value: its parts side by side, with " / " between. */
export interface VoucherLine {
  parts: VoucherPart[];
  strong?: boolean;
  /** Keeps the line breaks it was typed with (notes). */
  multiline?: boolean;
}

export interface VoucherRow {
  key: string;
  label: Bilingual;
  lines: VoucherLine[];
}

export interface VoucherSignature {
  label: VoucherSignatureLine;
  /** The company's signature and stamp, over the line of the person signing for it. */
  signature: string | null;
  stamp: string | null;
}

export interface VoucherModel {
  direction: VoucherDirection;
  source: 'payment' | 'expense';
  title: Bilingual;
  /** e.g. "Receipt voucher PAY-2026-0001": the window, the PDF and its file. */
  documentTitle: string;
  /** The other party, for the file name. */
  partyName: string;
  number: string;
  date: string;
  hijri: string;
  amount: Bilingual;
  voided: boolean;
  accent: string;
  paper: 'A4' | 'LETTER' | 'A5';
  company: {
    name: string;
    nameAr: string;
    logo: string | null;
    registration: string;
    phone: string;
    /** With the stamp and signature only (`vouchers.images`). */
    address: Bilingual | null;
    email: string;
  };
  rows: VoucherRow[];
  signatures: VoucherSignature[];
}

export type VoucherInput =
  | {
      kind: 'payment';
      source: Payment;
      company: Company;
      party: Client | null;
      /** The invoices or bills it paid. */
      documents: Pick<InvoiceDocument, 'number'>[];
    }
  | {
      kind: 'expense';
      source: Expense;
      company: Company;
      /** The vendor, when there is one. */
      party: Client | null;
      /** Where the money came from (the bank when the expense names none). */
      paidFrom: Pick<Account, 'name' | 'nameAr'> | null;
      category: Pick<Account, 'name' | 'nameAr'> | null;
    };

/**
 * A credit note applied to an invoice (or a vendor credit to a bill) moved
 * no money, so it has no voucher.
 */
export function hasVoucher(payment: Pick<Payment, 'method'>): boolean {
  return payment.method !== 'credit_note';
}

/** Arabic of a label from the payments dictionary. */
function inArabic(text: string): string {
  const found = (arabic as Record<string, unknown>)[text];
  return typeof found === 'string' ? found : text;
}

const clean = (s: string | null | undefined) => (s ?? '').trim();

/** An English and an Arabic name side by side; the Arabic only when it differs. */
function names(record: { name: string; nameAr?: string }): VoucherPart[] {
  const ar = clean(record.nameAr);
  return ar && ar !== record.name
    ? [
        { text: record.name, dir: 'auto' },
        { text: ar, dir: 'rtl' },
      ]
    : [{ text: record.name, dir: 'auto' }];
}

/** The party: its name, with the Arabic one under it when it differs. */
function partyLines(party: Client | null, fallback: string): VoucherLine[] {
  if (!party) {
    const text = fallback || '—';
    return [{ parts: [{ text, dir: fallback ? 'auto' : undefined }], strong: true }];
  }
  const ar = clean(party.nameAr) || party.name;
  return [
    { parts: [{ text: party.name }], strong: true },
    ...(ar !== party.name ? [{ parts: [{ text: ar, dir: 'rtl' as const }], strong: true }] : []),
  ];
}

const notesLine = (notes: string): VoucherLine[] =>
  clean(notes) ? [{ parts: [{ text: notes.trim(), dir: 'auto' }], multiline: true }] : [];

/** Everything a voucher prints. Throws for a credit note applied, which has none. */
export function buildVoucherModel(input: VoucherInput): VoucherModel {
  const { company } = input;
  if (input.kind === 'payment' && !hasVoucher(input.source)) {
    throw new Error(t('A credit note applied moved no money, so it has no voucher.'));
  }
  const record = input.source;
  const direction: VoucherDirection =
    input.kind === 'expense' || input.source.direction === 'out' ? 'out' : 'in';
  const title = direction === 'out' ? VOUCHER_WORDS.payment : VOUCHER_WORDS.receipt;
  const voided = input.kind === 'payment' && Boolean(input.source.voided);
  const display = company.currencyDisplay ?? 'local';
  const date = (d: string) => formatDate(d, company.dateFormat, EN);
  const rows: VoucherRow[] = [];
  const words: VoucherRow = {
    key: 'sum',
    label: VOUCHER_WORDS.sum,
    lines: [
      { parts: [{ text: amountInWords(record.amount, record.currency, 'en'), dir: 'ltr' }] },
      { parts: [{ text: amountInWords(record.amount, record.currency, 'ar'), dir: 'rtl' }] },
    ],
  };
  const reference = (skip?: string) =>
    record.reference && record.reference !== skip
      ? [
          {
            key: 'reference',
            label: VOUCHER_WORDS.reference,
            lines: [{ parts: [{ text: record.reference, dir: 'ltr' as const }] }],
          },
        ]
      : [];

  if (input.kind === 'payment') {
    const payment = input.source;
    rows.push({
      key: 'party',
      label: direction === 'out' ? VOUCHER_WORDS.paidTo : VOUCHER_WORDS.receivedFrom,
      lines: partyLines(input.party, ''),
    });
    rows.push(words);
    const method = methodInfo(payment.method).label;
    const provider = payment.provider ? providerLabel(payment.provider) : '';
    rows.push({
      key: 'method',
      label: VOUCHER_WORDS.method,
      lines: [
        {
          parts: [
            { text: provider ? `${method} (${provider})` : method, dir: 'ltr' },
            {
              text: provider ? `${inArabic(method)} (${inArabic(provider)})` : inArabic(method),
              dir: 'rtl',
            },
          ],
        },
      ],
    });
    const cheque = payment.cheque;
    if (cheque) {
      rows.push({
        key: 'cheque',
        label: VOUCHER_WORDS.cheque,
        lines: [{ parts: [{ text: cheque.number, dir: 'ltr' }], strong: true }],
      });
      if (cheque.bank) {
        const en = bankName(cheque.bank, 'en');
        const ar = bankName(cheque.bank, 'ar');
        rows.push({
          key: 'bank',
          label: VOUCHER_WORDS.bank,
          lines: [
            {
              parts: [
                { text: en, dir: 'ltr' },
                ...(ar !== en ? [{ text: ar, dir: 'rtl' as const }] : []),
              ],
            },
          ],
        });
      }
      rows.push({
        key: 'chequeDate',
        label: VOUCHER_WORDS.chequeDate,
        lines: [{ parts: [{ text: date(cheque.date), dir: 'ltr' }] }],
      });
      if (cheque.drawer) {
        rows.push({
          key: 'drawer',
          label: direction === 'out' ? VOUCHER_WORDS.payee : VOUCHER_WORDS.drawer,
          lines: [{ parts: [{ text: cheque.drawer }] }],
        });
      }
    }
    const numbers = input.documents.map((d) => d.number).join(', ');
    if (numbers || clean(payment.notes)) {
      const paid = direction === 'out' ? VOUCHER_WORDS.bills : VOUCHER_WORDS.invoices;
      rows.push({
        key: 'being',
        label: VOUCHER_WORDS.being,
        lines: [
          ...(numbers
            ? [
                { parts: [{ text: `${paid.en} ${numbers}`, dir: 'ltr' as const }] },
                { parts: [{ text: `${paid.ar} ${numbers}`, dir: 'rtl' as const }] },
              ]
            : []),
          ...notesLine(payment.notes),
        ],
      });
    }
    rows.push(...reference(cheque?.number));
  } else {
    const expense = input.source;
    rows.push({
      key: 'party',
      label: VOUCHER_WORDS.paidTo,
      lines: partyLines(input.party, clean(expense.payee)),
    });
    rows.push(words);
    if (input.paidFrom) {
      rows.push({
        key: 'paidFrom',
        label: VOUCHER_WORDS.paidFrom,
        lines: [{ parts: names(input.paidFrom) }],
      });
    }
    const description = clean(expense.description);
    const being: VoucherLine[] = [
      ...(description
        ? [{ parts: [{ text: description, dir: 'auto' as const }] }]
        : input.category
          ? [{ parts: names(input.category) }]
          : []),
      ...notesLine(expense.notes),
    ];
    if (being.length) rows.push({ key: 'being', label: VOUCHER_WORDS.being, lines: being });
    rows.push(...reference());
  }

  // The stamp and signature sign for the company: over the last line but one
  // (the last is the other party's), and never on a void voucher.
  const images = Boolean(company.vouchers?.images) && !voided;
  const lines = voucherLines(company, direction);
  const signer = Math.max(0, lines.length - 2);
  const signatures = lines.map((label, i) => ({
    label,
    signature: images && i === signer ? (company.branding.signature ?? null) : null,
    stamp: images && i === signer ? (company.branding.stamp ?? null) : null,
  }));

  const address = images
    ? {
        en: formatAddressLines(company.address, 'en', false).join(', '),
        ar: formatAddressLines(company.address, 'ar-KW', false).join('، '),
      }
    : null;
  const party = input.party?.name ?? (input.kind === 'expense' ? clean(input.source.payee) : '');

  return {
    direction,
    source: input.kind,
    title,
    documentTitle: `${title.en} ${record.number}`,
    partyName: party,
    number: record.number,
    date: date(record.date),
    hijri: formatHijri(record.date, 'ar'),
    amount: {
      en: formatMoney(record.amount, record.currency, EN, display),
      ar: formatMoney(record.amount, record.currency, AR, display),
    },
    voided,
    accent: normalizeHex(company.branding.accentColor),
    paper: company.vouchers?.paper === 'A5' ? 'A5' : company.defaults.pageSize,
    company: {
      name: company.name,
      nameAr: clean(company.nameAr) || company.name,
      logo: company.branding.logo,
      registration: company.registrationNumber
        ? `${company.registrationLabel} ${company.registrationNumber}`
        : '',
      phone: company.phone,
      address: address && (address.en || address.ar) ? address : null,
      email: images ? clean(company.email) : '',
    },
    rows,
    signatures,
  };
}
