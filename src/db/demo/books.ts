import { db } from '../db';
import { defaultNumbering } from '../defaults';
import { draftDocument, saveDocument, convertDocument } from '../documents';
import { createFromOrder, markDelivered, type PartTarget } from '../orders';
import { createPayment, newCheque, savePayment } from '../payments';
import { createExpense, saveExpense } from '../purchases';
import { createJournal, newJournalLine, saveJournal } from '../accounting';
import { saveTransfer } from '../banking';
import type {
  Account,
  ChequeDetails,
  Client,
  Company,
  DocumentType,
  Employee,
  ID,
  ISODate,
  InvoiceDocument,
  LineItem,
  Payment,
  PaymentMethod,
  PaymentProvider,
  Product,
  Warehouse,
} from '../types';
import { addDaysISO } from '@/lib/dates';
import { shortId } from '@/lib/ids';
import { currentCounter, formatNumber } from '@/lib/numbering';
import { retentionDefaults } from '@/lib/retention';
import { issuedStatus } from '@/lib/status';
import { dec, fromMinor, round, toMinor } from '@/lib/money';
import type { Calendar } from './calendar';
import { both, type CustomerKey, type EmployeeKey, type ItemKey, type VendorKey } from './data';

const P = 3;
const minor = (amount: number) => toMinor(amount, P);

/** Where money is kept: the company's bank, cash and card accounts. */
export type MoneyKey = 'nbk' | 'kfh' | 'cash' | 'card';

const MONEY_CODES: Record<MoneyKey, string> = {
  nbk: '1000',
  kfh: '1005',
  cash: '1010',
  card: '2050',
};

/** Fees kept by KNET, the payment link provider and buy now, pay later. */
const FEE_RATES: Partial<Record<PaymentMethod, number>> = { knet: 0.004, link: 0.025, bnpl: 0.04 };

export interface ReceiveInput {
  date: ISODate;
  method: PaymentMethod;
  /** Defaults to the documents' balance. */
  amount?: number;
  reference?: string;
  provider?: PaymentProvider;
  cheque?: Partial<ChequeDetails>;
  exchangeRate?: number;
  /** Money account for transfers and WAMD; NBK when not given. */
  into?: MoneyKey;
  notes?: string;
}

/**
 * The demo's books: what was created so far, and helpers that create
 * documents, payments and entries through the modules' own functions,
 * dated on their business date.
 */
export class DemoBooks {
  company!: Company;
  readonly accounts = new Map<string, Account>();
  readonly customers = {} as Record<CustomerKey, Client>;
  readonly vendors = {} as Record<VendorKey, Client>;
  readonly items = {} as Record<ItemKey, Product>;
  readonly employees = {} as Record<EmployeeKey, Employee>;
  warehouses!: { store: Warehouse; showroom: Warehouse };

  /** KNET, link and buy-now-pay-later receipts waiting in 1020 to be settled (minor units, by date). */
  readonly clearing: { date: ISODate; amount: number }[] = [];
  /** Petty cash on hand (minor units). */
  cash = 0;
  /** Spent on the company card and not yet repaid (minor units). */
  card = 0;
  /** Last month's PIFSS contributions, owed on the opening date. */
  openingPifss = 0;
  /** Stock on hand by warehouse, to keep sales within what is there. */
  readonly stock = { store: new Map<ItemKey, number>(), showroom: new Map<ItemKey, number>() };

  constructor(readonly calendar: Calendar) {}

  get id(): ID {
    return this.company.id;
  }

  async refresh(): Promise<Company> {
    this.company = (await db.companies.get(this.company.id))!;
    return this.company;
  }

  async loadAccounts(): Promise<void> {
    const all = await db.accounts.where('companyId').equals(this.company.id).toArray();
    this.accounts.clear();
    for (const account of all) this.accounts.set(account.code, account);
  }

  account(code: string): Account {
    const account = this.accounts.get(code);
    if (!account) throw new Error(`Account ${code} is missing`);
    return account;
  }

  money(key: MoneyKey): ID {
    return this.account(MONEY_CODES[key]).id;
  }

  /* ------------------------------------------------------------------------ */
  /* Lines                                                                    */
  /* ------------------------------------------------------------------------ */

  /** A line for one of the demo's items, at its price unless another is given. */
  line(
    key: ItemKey,
    quantity: number,
    overrides: Partial<LineItem> & { from?: 'store' | 'showroom' } = {},
  ): LineItem {
    const product = this.items[key];
    const { from, ...rest } = overrides;
    const line: LineItem = {
      id: shortId(),
      kind: 'item',
      productId: product.id,
      name: product.name,
      nameAr: product.nameAr,
      description: '',
      quantity,
      unit: product.unit,
      unitPrice: product.unitPrice,
      discount: 0,
      discountType: 'percent',
      taxes: [],
      ...rest,
    };
    if (product.kind === 'stock') {
      line.warehouseId = this.warehouses[from ?? 'store'].id;
    }
    return line;
  }

  /** A purchase line for an item, at its cost (or the price given, in the bill's currency). */
  purchase(key: ItemKey, quantity: number, unitPrice?: number): LineItem {
    const product = this.items[key];
    return this.line(key, quantity, { unitPrice: unitPrice ?? product.costPrice ?? 0 });
  }

  /** A line without an item, booked to an account when a code is given. */
  custom(
    name: string,
    nameAr: string,
    quantity: number,
    unitPrice: number,
    code?: string,
    unit = '',
  ): LineItem {
    return {
      id: shortId(),
      kind: 'item',
      productId: null,
      name,
      nameAr,
      description: '',
      quantity,
      unit,
      unitPrice,
      discount: 0,
      discountType: 'percent',
      taxes: [],
      ...(code ? { accountId: this.account(code).id } : {}),
    };
  }

  heading(name: string, nameAr: string): LineItem {
    return { ...this.custom(name, nameAr, 0, 0), kind: 'heading' };
  }

  /* ------------------------------------------------------------------------ */
  /* Stock on hand                                                            */
  /* ------------------------------------------------------------------------ */

  addStock(where: 'store' | 'showroom', key: ItemKey, quantity: number): void {
    const map = this.stock[where];
    map.set(key, (map.get(key) ?? 0) + quantity);
  }

  /** Takes stock out, refusing to go below zero (a mistake in the story). */
  takeStock(where: 'store' | 'showroom', lines: LineItem[]): void {
    for (const line of lines) {
      const key = this.itemKey(line.productId);
      if (!key || this.items[key].kind !== 'stock') continue;
      const left = (this.stock[where].get(key) ?? 0) - line.quantity;
      if (left < 0) throw new Error(`Not enough ${key} in the ${where} for ${line.quantity}`);
      this.stock[where].set(key, left);
    }
  }

  available(where: 'store' | 'showroom', key: ItemKey): number {
    return this.stock[where].get(key) ?? 0;
  }

  itemKey(productId: ID | null): ItemKey | undefined {
    if (!productId) return undefined;
    return (Object.keys(this.items) as ItemKey[]).find((k) => this.items[k].id === productId);
  }

  /* ------------------------------------------------------------------------ */
  /* Documents                                                                */
  /* ------------------------------------------------------------------------ */

  private dueDate(type: DocumentType, contact: Client, date: ISODate): ISODate | null {
    const d = this.company.defaults;
    if (type === 'invoice' || type === 'bill') {
      return addDaysISO(date, contact.paymentTermsDays ?? d.paymentTermsDays);
    }
    if (type === 'quote' || type === 'proforma') return addDaysISO(date, d.quoteValidDays);
    return null;
  }

  /**
   * Creates a document dated `date`, issued (sent, open, confirmed or issued)
   * unless `draft`. Invoices and credit notes take their stock from the
   * warehouse their lines name; bills bring it into the store.
   */
  async document(
    type: DocumentType,
    contact: Client,
    date: ISODate,
    items: LineItem[],
    extra: Partial<InvoiceDocument> = {},
    options: { draft?: boolean } = {},
  ): Promise<InvoiceDocument> {
    const draft = await draftDocument(this.company, type, contact);
    const saved = await saveDocument({
      ...draft,
      ...retentionDefaults(contact, type, date),
      issueDate: date,
      dueDate: this.dueDate(type, contact, date),
      deliveryDate: type === 'delivery_note' ? date : null,
      items,
      status: options.draft ? 'draft' : (issuedStatus(type) ?? 'draft'),
      ...extra,
    });
    this.trackStock(type, items, options.draft);
    return saved;
  }

  private trackStock(type: DocumentType, items: LineItem[], draft?: boolean): void {
    if (draft) return;
    const where = (line: LineItem) =>
      line.warehouseId === this.warehouses.showroom.id ? 'showroom' : 'store';
    for (const line of items) {
      const key = this.itemKey(line.productId);
      if (!key || this.items[key].kind !== 'stock') continue;
      if (type === 'invoice' || type === 'vendor_credit') this.takeStock(where(line), [line]);
      if (type === 'bill' || type === 'credit') this.addStock(where(line), key, line.quantity);
    }
  }

  /** The number the document would have had if it was created on its own date. */
  private async numberOn(type: DocumentType, date: ISODate) {
    const company = (await db.companies.get(this.company.id))!;
    const rule = company.numbering[type] ?? defaultNumbering()[type];
    return { rule, counter: currentCounter(rule, date) };
  }

  /**
   * Dates a document made by another module (from an order or a conversion)
   * on its own day, with the number it would have had then, and issues it.
   */
  private async redate(
    made: InvoiceDocument,
    date: ISODate,
    numbering: Awaited<ReturnType<DemoBooks['numberOn']>>,
    extra: Partial<InvoiceDocument>,
    draft = false,
  ): Promise<InvoiceDocument> {
    const contact = await db.clients.get(made.clientId);
    const type = made.type;
    return saveDocument({
      ...made,
      ...(type === 'invoice' || type === 'bill'
        ? retentionDefaults(contact ?? null, type, date)
        : {}),
      number: formatNumber(numbering.rule, numbering.counter, date),
      issueDate: date,
      dueDate: contact ? this.dueDate(type, contact, date) : made.dueDate,
      deliveryDate: type === 'delivery_note' ? date : made.deliveryDate,
      status: draft ? 'draft' : (issuedStatus(type) ?? 'draft'),
      ...extra,
    });
  }

  /** An invoice, bill or delivery note made from an order (all that is left, or the quantities by line). */
  async fromOrder(
    order: InvoiceDocument,
    target: PartTarget,
    date: ISODate,
    quantities?: Partial<Record<ID, number>>,
    extra: Partial<InvoiceDocument> = {},
  ): Promise<InvoiceDocument> {
    const numbering = await this.numberOn(target, date);
    const made = await createFromOrder(order.id, target, quantities as Record<ID, number>);
    const saved = await this.redate(made, date, numbering, extra);
    if (target !== 'delivery_note') this.trackStock(target, saved.items);
    return saved;
  }

  /** Records that a delivery note was handed over. */
  async delivered(note: InvoiceDocument, date: ISODate, receiverName: string, civilId = '') {
    await markDelivered(note.id, { date, receiverName, receiverCivilId: civilId });
  }

  /** A quote turned into a sales order, proforma or invoice on `date`. */
  async convert(
    source: InvoiceDocument,
    to: 'invoice' | 'proforma' | 'sales_order',
    date: ISODate,
    extra: Partial<InvoiceDocument> = {},
    options: { draft?: boolean } = {},
  ): Promise<InvoiceDocument> {
    const numbering = await this.numberOn(to, date);
    const made = await convertDocument(source.id, to);
    const saved = await this.redate(made, date, numbering, extra, options.draft);
    if (to === 'invoice' && !options.draft) this.trackStock('invoice', saved.items);
    return saved;
  }

  /* ------------------------------------------------------------------------ */
  /* Payments                                                                 */
  /* ------------------------------------------------------------------------ */

  /** Money received for one or more invoices, by any method. */
  async receive(docs: InvoiceDocument | InvoiceDocument[], input: ReceiveInput): Promise<Payment> {
    const list = Array.isArray(docs) ? docs : [docs];
    const fresh = await Promise.all(list.map(async (d) => (await db.documents.get(d.id))!));
    const due = fresh.reduce((sum, d) => sum.plus(dec(d.totals.balance)), dec(0)).toNumber();
    const amount = round(input.amount ?? due, P);
    // Apply oldest first, never more than each document asks for.
    let left = dec(amount);
    const allocations = fresh.map((d) => {
      const share = dec(Math.min(Math.max(0, d.totals.balance), left.toNumber()));
      left = left.minus(share);
      return { documentId: d.id, amount: round(share, P) };
    });
    const rate = FEE_RATES[input.method];
    const fee = rate ? round(Math.max(0.1, amount * rate), P) : 0;
    const first = fresh[0];
    const payment = await savePayment(
      createPayment(this.company.id, {
        direction: 'in',
        clientId: first.clientId,
        date: input.date,
        amount,
        currency: first.currency,
        exchangeRate: input.exchangeRate,
        method: input.method,
        reference: input.reference ?? '',
        notes: input.notes ?? '',
        allocations: allocations.filter((a) => a.amount > 0),
        accountId:
          input.method === 'bank_transfer' || input.method === 'wamd'
            ? this.money(input.into ?? 'nbk')
            : null,
        fee: fee || undefined,
        provider: input.provider ?? null,
        cheque: input.method === 'cheque' ? newCheque({ date: input.date, ...input.cheque }) : null,
      }),
    );
    if (input.method === 'knet' || input.method === 'link' || input.method === 'bnpl') {
      this.clearing.push({ date: input.date, amount: minor(amount) - minor(fee) });
    }
    if (input.method === 'cash') this.cash += minor(amount);
    return payment;
  }

  /** A payment made to a vendor for one or more bills. */
  async pay(
    docs: InvoiceDocument | InvoiceDocument[],
    input: Omit<ReceiveInput, 'provider'> & { from?: MoneyKey },
  ): Promise<Payment> {
    const list = Array.isArray(docs) ? docs : [docs];
    const fresh = await Promise.all(list.map(async (d) => (await db.documents.get(d.id))!));
    const due = fresh.reduce((sum, d) => sum.plus(dec(d.totals.balance)), dec(0)).toNumber();
    const amount = round(input.amount ?? due, 3);
    let left = dec(amount);
    const allocations = fresh.map((d) => {
      const share = dec(Math.min(Math.max(0, d.totals.balance), left.toNumber()));
      left = left.minus(share);
      return { documentId: d.id, amount: share.toNumber() };
    });
    const first = fresh[0];
    const payment = await savePayment(
      createPayment(this.company.id, {
        direction: 'out',
        clientId: first.clientId,
        date: input.date,
        amount,
        currency: first.currency,
        exchangeRate: input.exchangeRate,
        method: input.method,
        reference: input.reference ?? '',
        notes: input.notes ?? '',
        allocations: allocations.filter((a) => a.amount > 0),
        accountId: input.method === 'cheque' ? null : this.money(input.from ?? 'nbk'),
        cheque: input.method === 'cheque' ? newCheque({ date: input.date, ...input.cheque }) : null,
      }),
    );
    if (input.from === 'cash') this.cash -= minor(amount);
    return payment;
  }

  /** A credit note or vendor credit used against an invoice or bill. */
  async applyCredit(credit: InvoiceDocument, target: InvoiceDocument, date: ISODate) {
    const out = credit.type === 'vendor_credit';
    await savePayment(
      createPayment(this.company.id, {
        direction: out ? 'out' : 'in',
        clientId: credit.clientId,
        date,
        amount: credit.totals.total,
        currency: credit.currency,
        method: 'credit_note',
        creditId: credit.id,
        reference: credit.number,
        allocations: [{ documentId: target.id, amount: credit.totals.total }],
      }),
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Expenses and entries                                                     */
  /* ------------------------------------------------------------------------ */

  async expense(input: {
    date: ISODate;
    code: string;
    description: string;
    amount: number;
    from: MoneyKey;
    vendor?: VendorKey;
    reference?: string;
  }) {
    const expense = await saveExpense(
      createExpense(this.company.id, {
        date: input.date,
        accountId: this.account(input.code).id,
        description: input.description,
        amount: input.amount,
        currency: this.company.currency,
        paidFromAccountId: this.money(input.from),
        vendorId: input.vendor ? this.vendors[input.vendor].id : null,
        reference: input.reference ?? '',
      }),
    );
    if (input.from === 'cash') this.cash -= minor(input.amount);
    if (input.from === 'card') this.card += minor(input.amount);
    return expense;
  }

  /**
   * Settles into NBK what KNET and the providers collected up to two days
   * before `date` (they pay out a day or two later).
   */
  async settleClearing(date: ISODate) {
    const cutoff = addDaysISO(date, -2);
    const due = this.clearing.filter((c) => c.date <= cutoff);
    const amount = due.reduce((s, c) => s + c.amount, 0);
    if (amount <= 0) return;
    await this.transfer(
      '1020',
      'nbk',
      date,
      fromMinor(amount, P),
      both('KNET settlement', 'تسوية كي نت'),
    );
    for (const c of due) this.clearing.splice(this.clearing.indexOf(c), 1);
  }

  async transfer(
    from: MoneyKey | '1020',
    to: MoneyKey,
    date: ISODate,
    amount: number,
    reference: string,
  ) {
    const fromId = from === '1020' ? this.account('1020').id : this.money(from);
    await saveTransfer({
      companyId: this.company.id,
      from: fromId,
      to: this.money(to),
      date,
      amount: round(amount, P),
      reference,
    });
    if (from === 'cash') this.cash -= minor(amount);
    if (to === 'cash') this.cash += minor(amount);
    if (to === 'card') this.card -= minor(amount);
  }

  /** A plain journal entry; lines are [account code, debit, credit, description?]. */
  async journal(
    date: ISODate,
    reference: string,
    lines: [code: string, debit: number, credit: number, description?: string][],
    notes = '',
  ) {
    return saveJournal(
      createJournal(this.company.id, {
        date,
        reference,
        notes,
        status: 'posted',
        lines: lines.map(([code, debit, credit, description]) =>
          newJournalLine({
            accountId: this.account(code).id,
            debit: round(debit, P),
            credit: round(credit, P),
            description: description ?? '',
          }),
        ),
      }),
    );
  }

  /** Money in minor units as an amount. */
  static amount(minorUnits: number): number {
    return fromMinor(minorUnits, P);
  }
}
