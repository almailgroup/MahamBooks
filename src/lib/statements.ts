import type {
  ChequeStatus,
  Client,
  ID,
  ISODate,
  InvoiceDocument,
  Payment,
  PaymentMethod,
} from '@/db/types';
import { msg } from '@/i18n';
import { computeDocument } from './document-calc';
import { daysBetween } from './dates';
import { currencyPrecision, dec, toMinor, type Numeric } from './money';
import { isOpenCheque } from './cheques';
import { presetRange, type DateRange } from './reports';

/**
 * Statements of account (كشف حساب): every invoice, credit note, payment,
 * returned cheque and retention of one customer (or vendor) in a period,
 * with the balance before it, a running balance and the balance after it,
 * aged by due date. Customers reconcile them before they release cheques.
 *
 * All amounts are integer minor units (fils) of the statement currency, so
 * running balances are exact. The balance is what is owed: by the customer
 * to the company, or by the company to the vendor.
 */

export type StatementSide = 'customer' | 'vendor';

export type StatementEntryKind =
  | 'invoice'
  | 'bill'
  | 'opening'
  | 'credit'
  | 'vendor_credit'
  | 'retention'
  | 'release'
  | 'release_undone'
  | 'payment'
  | 'payment_void';

export interface StatementEntry {
  /** Unique within the statement (for React keys). */
  key: string;
  date: ISODate;
  kind: StatementEntryKind;
  /** Document or payment number. */
  number: string;
  /** PO number, vendor reference, cheque or certificate number. */
  reference: string;
  dueDate: ISODate | null;
  /** Change to what is owed (positive: owed more). */
  amount: number;
  /** In our books: invoices, bills paid… on the debit side. */
  debit: number;
  credit: number;
  /** Balance after this entry. */
  balance: number;
  documentId: ID | null;
  paymentId: ID | null;
  method: PaymentMethod | null;
  /** Retention lines: the percent held back. */
  percent: number | null;
  /** Payments by cheque. */
  cheque: { number: string; bank: string; date: ISODate } | null;
  /** Payments that were voided later (returned or cancelled cheque). */
  voided: boolean;
  /** Payment reversals: why (returned or cancelled cheque, or voided payment). */
  voidKind: 'returned' | 'cancelled' | 'voided' | null;
}

export interface ChequeInHand {
  paymentId: ID;
  /** Payment number. */
  number: string;
  chequeNumber: string;
  bank: string;
  /** Date written on the cheque. */
  date: ISODate;
  amount: number;
  status: ChequeStatus;
}

export interface StatementAging {
  /** Open documents by days past due: current, 1–30, 31–60, 61–90, 90+. */
  buckets: [number, number, number, number, number];
  /** Payments and credit notes not applied to a document yet (shown as a deduction). */
  unapplied: number;
  /** Equals the closing balance. */
  total: number;
}

export interface Statement {
  side: StatementSide;
  currency: string;
  /** Minor-unit digits of the currency. */
  precision: number;
  from: ISODate;
  to: ISODate;
  opening: number;
  closing: number;
  entries: StatementEntry[];
  /** Sums of the period's debit and credit columns. */
  debits: number;
  credits: number;
  aging: StatementAging;
  /** Retention held back on the statement date: not due yet, so not in the balance. */
  retentionHeld: number;
  /** Cheques received (or issued) by the statement date that had not cleared by then. */
  cheques: ChequeInHand[];
  chequesTotal: number;
  /** Documents in other currencies that this statement leaves out. */
  otherCurrencies: string[];
}

export interface StatementInput {
  side: StatementSide;
  /** The contact's documents (any type and status); others are ignored. */
  documents: InvoiceDocument[];
  /** The contact's payments (both directions; voided ones too). */
  payments: Payment[];
  from: ISODate;
  to: ISODate;
  currency: string;
  /**
   * Company currency: when the statement is in it and `convert` is set, records in
   * other currencies are included at their own exchange rate (credit control).
   */
  companyCurrency?: string;
  convert?: boolean;
}

const START: ISODate = '0000-01-01';

/** Documents that are part of the books (issued and not void). */
const counted = (d: InvoiceDocument) => d.status !== 'draft' && d.status !== 'void';

/**
 * An opening-balance document made by the import: its only line is the
 * import's "Opening balance" item (OPENING_ITEM in db/import.ts).
 */
export function isOpeningDocument(doc: Pick<InvoiceDocument, 'items'>): boolean {
  const [item] = doc.items;
  return (
    doc.items.length === 1 && item.name === 'Opening balance' && item.nameAr === 'رصيد افتتاحي'
  );
}

/** When a voided payment left the books (return or cancellation date). */
export function voidDate(payment: Payment): ISODate {
  return payment.voidedOn ?? payment.cheque?.returnedOn ?? payment.date;
}

/** A payment as it stood on a date: void only once the void happened. */
const voidedBy = (payment: Payment, date: ISODate) =>
  Boolean(payment.voided) && voidDate(payment) <= date;

/** Releases of a document's retention, with when they were undone. */
const releasesOf = (doc: InvoiceDocument) => doc.retentionReleases ?? [];

/** Retention released by a date (and not undone by then). */
const releasedOn = (doc: InvoiceDocument, asOf: ISODate) =>
  releasesOf(doc)
    .filter((r) => r.date <= asOf && !(r.reversedOn && r.reversedOn <= asOf))
    .reduce((acc, r) => acc.plus(dec(r.amount)), dec(0));

interface Sides {
  charge: InvoiceDocument['type'];
  credit: InvoiceDocument['type'];
  /** Payments that count: received from customers, or made to vendors. */
  direction: 'in' | 'out';
}

const SIDES: Record<StatementSide, Sides> = {
  customer: { charge: 'invoice', credit: 'credit', direction: 'in' },
  vendor: { charge: 'bill', credit: 'vendor_credit', direction: 'out' },
};

function paymentDirection(p: Payment): 'in' | 'out' {
  return p.direction === 'out' ? 'out' : 'in';
}

/** Builds the statement of one contact for a period. */
export function buildStatement(input: StatementInput): Statement {
  const { side, from, to, currency } = input;
  const p = currencyPrecision(currency);
  const sides = SIDES[side];
  const convert = Boolean(input.convert && input.companyCurrency === currency);
  const included = (record: { currency: string }) => convert || record.currency === currency;
  const rate = (record: { currency: string; exchangeRate?: number }) =>
    record.currency === currency
      ? 1
      : record.exchangeRate && record.exchangeRate > 0
        ? record.exchangeRate
        : 1;
  const minor = (amount: Numeric, record: { currency: string; exchangeRate?: number }) =>
    toMinor(dec(amount).times(dec(rate(record))), p);

  const docs = input.documents.filter(
    (d) => (d.type === sides.charge || d.type === sides.credit) && counted(d),
  );
  const otherCurrencies = [
    ...new Set(docs.filter((d) => !included(d)).map((d) => d.currency)),
  ].sort();
  const shown = docs.filter(included);
  const payments = input.payments.filter(
    (pay) =>
      paymentDirection(pay) === sides.direction && pay.method !== 'credit_note' && included(pay),
  );

  // Every event that changes the balance, with a key that keeps an invoice's
  // retention right under it on the same day.
  type Draft = Omit<StatementEntry, 'debit' | 'credit' | 'balance'> & { order: string };
  const events: Draft[] = [];
  const blank = {
    reference: '',
    dueDate: null,
    documentId: null,
    paymentId: null,
    method: null,
    percent: null,
    cheque: null,
    voided: false,
    voidKind: null,
  } as const;

  for (const doc of shown) {
    const charge = doc.type === sides.charge;
    // Saved totals: worked out with the contact's tax exemption, as the ledger posts them.
    const result = { total: doc.totals.total, retention: doc.totals.retention ?? 0 };
    const reference = (side === 'vendor' ? doc.vendorReference : doc.poNumber)?.trim() ?? '';
    const kind: StatementEntryKind = charge
      ? isOpeningDocument(doc)
        ? 'opening'
        : sides.charge === 'invoice'
          ? 'invoice'
          : 'bill'
      : side === 'customer'
        ? 'credit'
        : 'vendor_credit';
    events.push({
      ...blank,
      key: `doc-${doc.id}`,
      order: `${doc.issueDate}|0|${charge ? 0 : 1}|${doc.number}|0`,
      date: doc.issueDate,
      kind,
      number: doc.number,
      reference,
      dueDate: charge ? doc.dueDate : null,
      amount: (charge ? 1 : -1) * minor(result.total, doc),
      documentId: doc.id,
    });
    if (!charge || result.retention === 0) continue;
    events.push({
      ...blank,
      key: `ret-${doc.id}`,
      order: `${doc.issueDate}|0|0|${doc.number}|1`,
      date: doc.issueDate,
      kind: 'retention',
      number: doc.number,
      amount: -minor(result.retention, doc),
      documentId: doc.id,
      percent: doc.retentionPercent ?? null,
    });
    // Released parts become due again; undoing a release holds them back again.
    for (const release of releasesOf(doc)) {
      const value = minor(release.amount, doc);
      events.push({
        ...blank,
        key: `rel-${release.id}`,
        order: `${release.date}|3|${doc.number}|${release.id}|0`,
        date: release.date,
        kind: 'release',
        number: doc.number,
        reference: release.reference,
        amount: value,
        documentId: doc.id,
      });
      if (release.reversedOn) {
        events.push({
          ...blank,
          key: `relx-${release.id}`,
          order: `${release.reversedOn}|3|${doc.number}|${release.id}|1`,
          date: release.reversedOn,
          kind: 'release_undone',
          number: doc.number,
          reference: release.reference,
          amount: -value,
          documentId: doc.id,
        });
      }
    }
  }

  for (const pay of payments) {
    const value = minor(pay.amount, pay);
    const cheque = pay.method === 'cheque' && pay.cheque ? pay.cheque : null;
    const details = cheque ? { number: cheque.number, bank: cheque.bank, date: cheque.date } : null;
    events.push({
      ...blank,
      key: `pay-${pay.id}`,
      order: `${pay.date}|1|${pay.number}|0`,
      date: pay.date,
      kind: 'payment',
      number: pay.number,
      reference: cheque?.number ?? pay.reference.trim(),
      amount: -value,
      paymentId: pay.id,
      method: pay.method,
      cheque: details,
      voided: Boolean(pay.voided),
    });
    if (pay.voided) {
      events.push({
        ...blank,
        key: `void-${pay.id}`,
        order: `${voidDate(pay)}|2|${pay.number}|0`,
        date: voidDate(pay),
        kind: 'payment_void',
        number: pay.number,
        reference: cheque?.number ?? pay.reference.trim(),
        amount: value,
        paymentId: pay.id,
        method: pay.method,
        cheque: details,
        voidKind:
          cheque?.status === 'returned'
            ? 'returned'
            : cheque?.status === 'cancelled'
              ? 'cancelled'
              : 'voided',
      });
    }
  }

  events.sort((a, b) => a.order.localeCompare(b.order));
  let opening = 0;
  for (const e of events) if (e.date < from) opening += e.amount;
  let balance = opening;
  let debits = 0;
  let credits = 0;
  const entries: StatementEntry[] = [];
  for (const event of events) {
    if (event.date < from || event.date > to) continue;
    const { order: _order, ...e } = event;
    balance += e.amount;
    // A customer's account is a debtor (invoices are debits); a vendor's a creditor.
    const debit = side === 'customer' ? Math.max(e.amount, 0) : Math.max(-e.amount, 0);
    const credit = side === 'customer' ? Math.max(-e.amount, 0) : Math.max(e.amount, 0);
    debits += debit;
    credits += credit;
    entries.push({ ...e, debit, credit, balance });
  }

  return {
    side,
    currency,
    precision: p,
    from,
    to,
    opening,
    closing: balance,
    entries,
    debits,
    credits,
    aging: agingOn(shown, payments, input.payments, sides, to, balance, minor),
    retentionHeld: retentionHeldOn(shown, sides, to, minor),
    ...chequesOn(payments, to, minor),
    otherCurrencies,
  };
}

/** Days past due to aging bucket: current, 1–30, 31–60, 61–90, 90+. */
export function agingBucket(dueDate: ISODate | null, asOf: ISODate): 0 | 1 | 2 | 3 | 4 {
  const late = dueDate ? daysBetween(dueDate, asOf) : 0;
  return late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
}

type Minor = (amount: Numeric, record: { currency: string; exchangeRate?: number }) => number;

/** What was still owed on each document at `asOf`, minor units. */
function openOn(
  docs: InvoiceDocument[],
  counting: Payment[],
  all: Payment[],
  sides: Sides,
  asOf: ISODate,
  minor: Minor,
): Map<ID, number> {
  const applied = new Map<ID, ReturnType<typeof dec>>();
  const apply = (pay: Payment) => {
    if (pay.date > asOf || voidedBy(pay, asOf)) return;
    for (const a of pay.allocations) {
      applied.set(a.documentId, (applied.get(a.documentId) ?? dec(0)).plus(dec(a.amount)));
    }
  };
  counting.forEach(apply);
  // Credit notes applied to invoices (they move no money).
  all.filter((pay) => pay.method === 'credit_note').forEach(apply);
  const open = new Map<ID, number>();
  for (const doc of docs) {
    if (doc.type !== sides.charge || doc.issueDate > asOf) continue;
    const released = releasedOn(doc, asOf);
    const owed = dec(doc.totals.total)
      .minus(dec(doc.totals.retention ?? 0))
      .plus(released)
      .minus(applied.get(doc.id) ?? dec(0));
    open.set(doc.id, minor(owed, doc));
  }
  return open;
}

function agingOn(
  docs: InvoiceDocument[],
  counting: Payment[],
  all: Payment[],
  sides: Sides,
  asOf: ISODate,
  closing: number,
  minor: Minor,
): StatementAging {
  const buckets: StatementAging['buckets'] = [0, 0, 0, 0, 0];
  const open = openOn(docs, counting, all, sides, asOf, minor);
  for (const doc of docs) {
    const owed = open.get(doc.id) ?? 0;
    if (owed > 0) buckets[agingBucket(doc.dueDate, asOf)] += owed;
  }
  // Whatever the open documents don't explain is credit not applied yet.
  const unapplied = buckets.reduce((a, b) => a + b, 0) - closing;
  return { buckets, unapplied, total: closing };
}

function retentionHeldOn(
  docs: InvoiceDocument[],
  sides: Sides,
  asOf: ISODate,
  minor: Minor,
): number {
  let held = 0;
  for (const doc of docs) {
    if (doc.type !== sides.charge || doc.issueDate > asOf || !doc.totals.retention) continue;
    held += minor(dec(doc.totals.retention).minus(releasedOn(doc, asOf)), doc);
  }
  return held;
}

function chequesOn(
  payments: Payment[],
  asOf: ISODate,
  minor: Minor,
): { cheques: ChequeInHand[]; chequesTotal: number } {
  const cheques: ChequeInHand[] = [];
  for (const pay of payments) {
    const c = pay.cheque;
    // Not received yet, or returned or cancelled by then.
    if (pay.method !== 'cheque' || !c || pay.date > asOf || voidedBy(pay, asOf)) continue;
    if (c.status === 'cleared' && (!c.clearedOn || c.clearedOn <= asOf)) continue;
    // Cleared, returned or cancelled only later: it was in hand or at the bank then.
    const deposited =
      (c.status === 'deposited' || !isOpenCheque(c.status)) &&
      Boolean(c.depositedOn) &&
      c.depositedOn! <= asOf;
    cheques.push({
      paymentId: pay.id,
      number: pay.number,
      chequeNumber: c.number,
      bank: c.bank,
      date: c.date,
      amount: minor(pay.amount, pay),
      status: deposited ? 'deposited' : 'held',
    });
  }
  cheques.sort(
    (a, b) => a.date.localeCompare(b.date) || a.chequeNumber.localeCompare(b.chequeNumber),
  );
  return { cheques, chequesTotal: cheques.reduce((s, c) => s + c.amount, 0) };
}

/* -------------------------------------------------------------------------- */
/* Periods                                                                    */
/* -------------------------------------------------------------------------- */

export type StatementPeriod = 'this-month' | 'last-month' | 'this-quarter' | 'this-year' | 'custom';

export const STATEMENT_PERIODS: { value: StatementPeriod; label: string }[] = [
  { value: 'this-month', label: msg('This month') },
  { value: 'last-month', label: msg('Last month') },
  { value: 'this-quarter', label: msg('This quarter') },
  { value: 'this-year', label: msg('This year') },
  { value: 'custom', label: msg('Custom') },
];

/** Dates of a statement period; a custom period keeps the dates given. */
export function statementRange(
  period: StatementPeriod,
  todayIso: ISODate,
  custom?: DateRange,
): DateRange {
  if (period === 'custom') {
    const range = custom ?? presetRange('this-month', todayIso);
    return range.from <= range.to ? range : { from: range.to, to: range.from };
  }
  return presetRange(period, todayIso);
}

/* -------------------------------------------------------------------------- */
/* Credit control                                                             */
/* -------------------------------------------------------------------------- */

export interface Exposure {
  /** What the customer owes now (open documents less unapplied credit), company currency. */
  balance: number;
  /** Part of the balance past its due date. */
  overdue: number;
  /** Cheques received and not cleared yet: paid on paper, still a risk. */
  uncleared: number;
  unclearedCount: number;
  /** Balance plus uncleared cheques (never below zero). */
  exposure: number;
  /** Retention held back by the customer (not due, not counted against the limit). */
  retentionHeld: number;
  /** Credit limit in minor units, or null for none. */
  limit: number | null;
  /** Limit less exposure (null without a limit). */
  available: number | null;
  lastPayment: { date: ISODate; amount: number; number: string; id: ID } | null;
  precision: number;
}

/**
 * Where a contact stands today, in the company currency (minor units): what
 * they owe (customers) or what is owed to them (vendors), overdue, cheques
 * not cleared yet, retention held and, for customers, credit used.
 */
export function contactPosition(input: {
  side: StatementSide;
  client: Pick<Client, 'creditLimit'>;
  documents: InvoiceDocument[];
  payments: Payment[];
  companyCurrency: string;
  todayIso: ISODate;
}): Exposure {
  const { side, companyCurrency, todayIso } = input;
  const p = currencyPrecision(companyCurrency);
  const statement = buildStatement({
    side,
    documents: input.documents,
    payments: input.payments,
    from: START,
    to: todayIso,
    currency: companyCurrency,
    companyCurrency,
    convert: true,
  });
  const balance = statement.closing;
  const overdue = statement.aging.buckets.slice(1).reduce((a, b) => a + b, 0);
  // Cheques not cleared by today: paid on paper, still a risk.
  const uncleared = statement.chequesTotal;
  const exposure = Math.max(0, balance + uncleared);
  const limitValue = side === 'customer' ? input.client.creditLimit : null;
  const limit =
    limitValue !== null && limitValue !== undefined && Number.isFinite(limitValue)
      ? toMinor(limitValue, p)
      : null;
  const paid = input.payments
    .filter(
      (pay) =>
        paymentDirection(pay) === SIDES[side].direction &&
        pay.method !== 'credit_note' &&
        !pay.voided,
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const last = paid[0];
  return {
    balance,
    overdue,
    uncleared,
    unclearedCount: statement.cheques.length,
    exposure,
    retentionHeld: statement.retentionHeld,
    limit,
    available: limit === null ? null : limit - exposure,
    lastPayment: last
      ? {
          date: last.date,
          amount: toMinor(
            dec(last.amount).times(last.currency === companyCurrency ? 1 : last.exchangeRate || 1),
            p,
          ),
          number: last.number,
          id: last.id,
        }
      : null,
    precision: p,
  };
}

/** A customer's credit exposure today, in the company currency (minor units). */
export function customerExposure(input: Omit<Parameters<typeof contactPosition>[0], 'side'>) {
  return contactPosition({ ...input, side: 'customer' });
}

export type CreditCheckResult =
  | { status: 'ok' }
  | { status: 'hold'; projected: number }
  | { status: 'over_limit'; projected: number; limit: number; over: number };

/**
 * Whether saving a document that adds `increase` (minor units) to what the
 * customer owes is within their credit: customers on credit hold get nothing
 * new, others warn above their limit.
 */
export function creditCheck(
  client: Pick<Client, 'creditHold'>,
  exposure: Pick<Exposure, 'exposure' | 'limit'>,
  increase: number,
  isNew: boolean,
): CreditCheckResult {
  if (increase <= 0 && !isNew) return { status: 'ok' };
  const projected = exposure.exposure + Math.max(increase, 0);
  if (client.creditHold) return { status: 'hold', projected };
  if (exposure.limit !== null && increase > 0 && projected > exposure.limit) {
    return {
      status: 'over_limit',
      projected,
      limit: exposure.limit,
      over: projected - exposure.limit,
    };
  }
  return { status: 'ok' };
}

/**
 * How much saving `doc` adds to what the customer owes, in company-currency
 * minor units: its amount due (total less retention and payments) less what
 * the saved version already counted. Sales orders count in full: they commit
 * the credit before they are invoiced.
 */
export function exposureIncrease(
  doc: InvoiceDocument,
  saved: InvoiceDocument | null | undefined,
  companyCurrency: string,
  taxExempt = false,
): number {
  const p = currencyPrecision(companyCurrency);
  const value = (d: InvoiceDocument) => {
    const result = computeDocument(d, { paid: d.totals.paid, taxExempt });
    const due = d.type === 'sales_order' ? dec(result.total) : dec(result.balance);
    const rate = d.currency === companyCurrency ? 1 : d.exchangeRate || 1;
    return toMinor(due.times(rate), p);
  };
  const before = saved && saved.type === 'invoice' && counted(saved) ? value(saved) : 0;
  return value(doc) - before;
}

/** Customers' statements in one run: those with a balance or activity in the period. */
export function statementWorthSending(statement: Statement): boolean {
  return statement.closing !== 0 || statement.entries.length > 0 || statement.retentionHeld !== 0;
}
