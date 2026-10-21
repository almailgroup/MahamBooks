import { db } from './db';
import {
  createClient,
  createDocument,
  createProduct,
  defaultNumbering,
  nowStamp,
} from './defaults';
import { logActivity } from './activity';
import { applyTotals } from './documents';
import {
  assertUnlocked,
  createAccount,
  createJournal,
  newJournalLine,
  saveJournal,
} from './accounting';
import { accountingSettings } from './chart-setup';
import {
  addStockEntry,
  ensureDefaultWarehouse,
  ensureStockAccounts,
  nextItemCodes,
  productKind,
  recost,
  reserveItemCodes,
  skuKey,
  type StockEntryInput,
} from './inventory';
import type {
  Account,
  Address,
  Client,
  Company,
  DocumentType,
  Employee,
  ID,
  ISODate,
  InvoiceDocument,
  LineItem,
  Product,
  ProductKind,
  StockEntry,
  StockMovement,
  Warehouse,
} from './types';
import {
  commitEmployeeImport,
  planEmployeeRows,
  type EmployeeImportProgress,
  type EmployeeImportSummary,
  type EmployeeRecord,
} from './import-employees';
import {
  IMPORT_COLUMNS,
  missingColumns,
  normalizeHeader,
  type ColumnMapping,
  type ImportKind,
} from '@/features/company/import-columns';
import {
  parseAmount,
  parseStatementDate,
  type DateFormat as CsvDateFormat,
} from '@/lib/banking/statement';
import { countryOptions, emptyAddress } from '@/lib/geo';
import { findArea, findGovernorate, isValidCivilId, normalizeKuwaitPhone } from '@/lib/kuwait';
import { currencyPrecision, dec, fromMinor, normalizeDigits, round, toMinor } from '@/lib/money';
import { allocateNumber, canReserveCounters, type ReservedCounter } from '@/lib/numbering';
import { stockLevels } from '@/lib/inventory/costing';
import { stockAccounts } from '@/lib/inventory/sources';
import { findUnit, matchUnit } from '@/lib/units';
import { isValidEmail } from '@/lib/email';
import { addDaysISO, isISODate, today } from '@/lib/dates';
import { shortId } from '@/lib/ids';
import { msg, t } from '@/i18n';
import { localName } from '@/i18n/names';

/**
 * Bringing a business's records over from a spreadsheet or another system:
 * customers and vendors, products and services, opening balances and the
 * invoices and bills still open on the day the business starts here.
 *
 * `planImport` checks every row without touching the database (the preview
 * and dry-run summary); `commitImport` plans again inside one transaction and
 * writes the rows that are ready, so the books never hold half an import.
 *
 * Opening balances keep the books right: account balances go into one posted
 * journal whose difference lands on Opening balance equity, and open invoices
 * and bills (and contacts' opening balances) become issued documents whose
 * only line is booked to Opening balance equity, so receivables and payables
 * are right per customer and vendor without counting old sales twice.
 *
 * Products can bring their stock: with the quantity column matched, new stock
 * items (and items without stock history) get opening stock at the file's
 * cost, one opening entry per warehouse against Opening balance equity, and
 * items with stock history are counted, the differences posted as one count
 * adjustment per warehouse. Such a file is imported only when every row is
 * right.
 */

export class ImportError extends Error {}

export interface ImportOptions {
  /** Contacts: who the rows are when the file has no Type column. */
  contactType: 'customer' | 'vendor';
  /** Open documents: invoices (customers owe you) or bills (you owe vendors). */
  documentType: 'invoice' | 'bill';
  /** Opening balances, contacts' opening balances and items' stock are as at this date. */
  asOf: ISODate;
  /** How dates are written in the file. */
  dateFormat: CsvDateFormat;
  fileName: string;
  /** Shows a date in messages (defaults to yyyy-MM-dd). */
  formatDate?: (date: ISODate) => string;
  /**
   * Employees and products: rows for employees or items already in the
   * company update them (else they are skipped; items' stock is still taken).
   */
  updateExisting?: boolean;
  /** Products: where the stock of rows that name no warehouse goes (defaults to the main one). */
  warehouseId?: ID;
  /** Employees: the day documents' expiry and joining dates are judged on (defaults to today). */
  today?: ISODate;
}

export interface ImportContext {
  company: Company;
  clients: Client[];
  products: Product[];
  accounts: Account[];
  documents: Pick<InvoiceDocument, 'type' | 'number'>[];
  employees: Employee[];
  /** Products: the warehouses and the stock on record (loaded for products only). */
  warehouses?: Warehouse[];
  stock?: ImportStock;
}

/** What is in stock already, for products files that bring quantities. */
export interface ImportStock {
  /** Items with stock history (movements or stock entries): their quantities are counts. */
  history: Set<ID>;
  movements: Pick<StockMovement, 'productId' | 'warehouseId' | 'date' | 'quantity' | 'value'>[];
  /** What the opening balances already put on the inventory account, in minor units (debit positive). */
  inBooks: number;
}

export type RowStatus = 'ready' | 'skipped' | 'error';

export interface RowIssue {
  /** error: not imported; skip: left out on purpose; warning/info: imported. */
  level: 'error' | 'skip' | 'warning' | 'info';
  text: string;
}

export interface ContactRecord {
  client: Client;
  /** Positive: they owe you (customer) or you owe them (vendor). */
  openingBalance: number;
}

export interface OpeningRecord {
  accountId: ID;
  debit: number;
  credit: number;
  description: string;
}

export interface DocumentRecord {
  doc: InvoiceDocument;
  /** A contact to add first (shared by every row naming it). */
  newContact: Client | null;
  /** An existing contact that also needs the customer or vendor role. */
  promote: Client | null;
}

/** Stock a products row brings in, when the file's quantity column is matched. */
export interface ProductStock {
  /** '' for the main store, added on import when the company has no warehouse. */
  warehouseId: ID;
  quantity: number;
  /** Opening stock: cost of one unit (company currency). */
  unitCost: number;
  /**
   * opening: stock the item starts with, at the cost; count: what is on hand
   * of an item with stock history, the difference from the books posted as a
   * count adjustment at average cost.
   */
  as: 'opening' | 'count';
  /** Counts: the quantity on record in the warehouse at the end of the stock date. */
  onRecord: number;
}

export interface ProductRecord {
  product: Product;
  /** new: the row adds the item; existing: one already here; repeat: one an earlier row has. */
  source: 'new' | 'existing' | 'repeat';
  /** Existing items: the row changes their details (Update existing items). */
  update: boolean;
  stock: ProductStock | null;
}

/** The stock a products file brings in. */
export interface StockImportSummary {
  /** Value of the opening stock, in minor units of the company currency. */
  value: number;
  /** Items getting opening stock, and the warehouses it goes to. */
  opening: number;
  warehouses: number;
  /** Items with stock history whose quantity is a count, and how many differ from the books. */
  counted: number;
  differences: number;
}

export type ImportRecord =
  | { kind: 'contacts'; value: ContactRecord }
  | { kind: 'products'; value: ProductRecord }
  | { kind: 'opening'; value: OpeningRecord }
  | { kind: 'documents'; value: DocumentRecord }
  | { kind: 'employees'; value: EmployeeRecord };

export interface PlannedRow {
  /** Line number in the file (the header is line 1). */
  line: number;
  status: RowStatus;
  issues: RowIssue[];
  /** The row's values by column key, for the preview. */
  cells: Record<string, string>;
  record: ImportRecord | null;
}

export interface ImportPlan {
  kind: ImportKind;
  rows: PlannedRow[];
  ready: number;
  skipped: number;
  errors: number;
  /** Contacts the import adds on the way (open documents). */
  newContacts: number;
  /** Opening balances, in minor units of the company currency. */
  totals: { debit: number; credit: number; difference: number };
  /** Employees: what the file holds and what to check. */
  employees?: EmployeeImportSummary;
  /** Products: the stock the file brings in, when it has quantities (all or nothing). */
  stock?: StockImportSummary;
  /** Products: new items without an SKU that get the next item codes (items.autoSku). */
  itemCodes?: number;
  /** Products: rows naming items already here (updated with updateExisting, else skipped). */
  existing?: number;
}

export interface ImportResult {
  kind: ImportKind;
  added: number;
  /** Employees already in the company that were updated. */
  updated?: number;
  /** Employees: whether the file had salaries (false: add them before payroll). */
  salaries?: boolean;
  skipped: number;
  newContacts: number;
  /** Opening documents created for contacts' opening balances. */
  documents: number;
  journalNumber: string | null;
  /** Products: the stock entries posted (opening stock per warehouse, then counts). */
  stockEntries?: Pick<StockEntry, 'id' | 'number' | 'kind'>[];
}

export const OPENING_ITEM = { name: 'Opening balance', nameAr: 'رصيد افتتاحي' };
const OPENING_ACCOUNT = { code: '3900', name: 'Opening balance equity', nameAr: 'أرصدة افتتاحية' };

const key = (text: string) => normalizeHeader(text);

function cellsOf(kind: ImportKind, row: string[], mapping: ColumnMapping): Record<string, string> {
  const cells: Record<string, string> = {};
  for (const column of IMPORT_COLUMNS[kind]) {
    const index = mapping[column.key];
    cells[column.key] = index === null || index === undefined ? '' : (row[index] ?? '').trim();
  }
  return cells;
}

/** Amount in the company currency, or a message saying what is wrong with it. */
function readMoney(
  value: string,
  currency: string,
  places = currencyPrecision(currency),
): { amount: number } | { problem: string } {
  const amount = parseAmount(value);
  if (amount === null) return { problem: t('“{value}” is not an amount.', { value }) };
  if (dec(amount).decimalPlaces() > places) {
    return {
      problem: t('Amounts in {currency} have at most {places} decimals.', { currency, places }),
    };
  }
  return { amount };
}

/**
 * A date from the file: yyyy-MM-dd as Excel's own date cells are read (see
 * lib/xlsx.ts), whatever the format chosen for dates written as text; else
 * as the file writes dates.
 */
export function readFileDate(value: string, format: CsvDateFormat): ISODate | null {
  const v = normalizeDigits(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && isISODate(v)) return v;
  return parseStatementDate(v, format);
}

function contactRole(value: string, fallback: 'customer' | 'vendor') {
  const v = key(value);
  if (!v) return { customer: fallback === 'customer', vendor: fallback === 'vendor', known: true };
  if (/^(both|كلاهما|عميل ومورد|customer and vendor|customer vendor)$/.test(v))
    return { customer: true, vendor: true, known: true };
  if (/^(customer|client|عميل|العميل|زبون)$/.test(v))
    return { customer: true, vendor: false, known: true };
  if (/^(vendor|supplier|مورد|المورد)$/.test(v))
    return { customer: false, vendor: true, known: true };
  return { customer: fallback === 'customer', vendor: fallback === 'vendor', known: false };
}

function countryCode(value: string): string | null {
  const v = value.trim();
  if (!v) return 'KW';
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  const wanted = key(v);
  for (const locale of ['en', 'ar']) {
    const found = countryOptions(locale).find((o) => key(o.label) === wanted);
    if (found) return found.value;
  }
  return null;
}

/** All the names a contact is known by, for matching rows to existing contacts. */
function contactKeys(c: Pick<Client, 'name' | 'nameAr' | 'number'>): string[] {
  return [c.name, c.nameAr ?? '', c.number].map(key).filter(Boolean);
}

function emptyPlan(kind: ImportKind): ImportPlan {
  return {
    kind,
    rows: [],
    ready: 0,
    skipped: 0,
    errors: 0,
    newContacts: 0,
    totals: { debit: 0, credit: 0, difference: 0 },
  };
}

function finish(plan: ImportPlan): ImportPlan {
  plan.ready = plan.rows.filter((r) => r.status === 'ready').length;
  plan.skipped = plan.rows.filter((r) => r.status === 'skipped').length;
  plan.errors = plan.rows.filter((r) => r.status === 'error').length;
  return plan;
}

function statusOf(issues: RowIssue[]): RowStatus {
  if (issues.some((i) => i.level === 'error')) return 'error';
  if (issues.some((i) => i.level === 'skip')) return 'skipped';
  return 'ready';
}

/**
 * Checks every row of a file (the first row holds the column names) and
 * prepares the records to add. Nothing is written.
 */
export function planImport(
  kind: ImportKind,
  rows: string[][],
  mapping: ColumnMapping,
  options: ImportOptions,
  ctx: ImportContext,
): ImportPlan {
  const plan = emptyPlan(kind);
  const missing = missingColumns(kind, mapping);
  const body = rows.slice(1);
  if (missing.length || body.length === 0) return plan;
  if (kind === 'employees') {
    return finish(planEmployeeRows(plan, body, mapping, options, ctx, rows[0] ?? []));
  }
  const fmtDate = options.formatDate ?? ((d: ISODate) => d);
  const lock = accountingSettings(ctx.company).lockDate;
  const locked = (date: ISODate) => Boolean(lock && date <= lock);
  const lockText = () =>
    t('This is on or before the lock date ({date}).', { date: fmtDate(lock!) });
  const currency = ctx.company.currency;
  const precision = currencyPrecision(currency);

  if (kind === 'contacts') {
    const seen = new Set(ctx.clients.flatMap(contactKeys));
    body.forEach((row, i) => {
      const cells = cellsOf(kind, row, mapping);
      const issues: RowIssue[] = [];
      const name = cells.name || cells.nameAr;
      if (!name) issues.push({ level: 'error', text: t('Enter a name.') });
      const names = [cells.name, cells.nameAr].map(key).filter(Boolean);
      if (name && names.some((n) => seen.has(n))) {
        issues.push({ level: 'skip', text: t('{name} is already in your contacts.', { name }) });
      }
      const role = contactRole(cells.type, options.contactType);
      if (!role.known) {
        issues.push({
          level: 'warning',
          text: t('Type “{value}” not recognised; imported as set above.', { value: cells.type }),
        });
      }
      const country = countryCode(cells.country);
      if (country === null) {
        issues.push({
          level: 'warning',
          text: t('Country “{value}” not recognised; Kuwait is used.', { value: cells.country }),
        });
      }
      const inKuwait = (country ?? 'KW') === 'KW';
      let phone = normalizeDigits(cells.phone);
      if (phone && inKuwait) {
        const normalized = normalizeKuwaitPhone(phone);
        if (normalized) phone = normalized;
        else issues.push({ level: 'warning', text: t('Phone number kept as written.') });
      }
      if (cells.email && !isValidEmail(cells.email)) {
        issues.push({ level: 'warning', text: t('The email address looks wrong.') });
      }
      const civilId = normalizeDigits(cells.civilId).replace(/\s/g, '');
      if (civilId && !isValidCivilId(civilId)) {
        issues.push({ level: 'warning', text: t('The Civil ID looks wrong.') });
      }
      const governorate = cells.governorate ? findGovernorate(cells.governorate) : undefined;
      const area = cells.area ? findArea(cells.area) : undefined;
      let openingBalance = 0;
      if (cells.openingBalance) {
        const money = readMoney(cells.openingBalance, currency);
        if ('problem' in money) issues.push({ level: 'error', text: money.problem });
        else openingBalance = money.amount;
      }
      if (openingBalance !== 0 && locked(options.asOf)) {
        issues.push({ level: 'error', text: lockText() });
      }
      let paymentTermsDays: number | null = null;
      if (cells.paymentTerms) {
        const days = Number(normalizeDigits(cells.paymentTerms).replace(/[^\d.]/g, ''));
        if (Number.isInteger(days) && days >= 0 && days <= 3650) paymentTermsDays = days;
        else
          issues.push({ level: 'warning', text: t('Payment terms should be a number of days.') });
      }
      const status = statusOf(issues);
      let record: ImportRecord | null = null;
      if (status === 'ready') {
        names.forEach((n) => seen.add(n));
        const address: Address = {
          ...emptyAddress(country ?? 'KW'),
          line1: cells.line1,
          city: area?.en ?? cells.area,
          state: governorate?.name.en ?? cells.governorate,
          postalCode: cells.postalCode,
          ...(cells.block ? { block: cells.block } : {}),
          ...(cells.street ? { street: cells.street } : {}),
          ...(cells.avenue ? { avenue: cells.avenue } : {}),
          ...(cells.building ? { building: cells.building } : {}),
          ...(cells.floor ? { floor: cells.floor } : {}),
          ...(cells.unit ? { unit: cells.unit } : {}),
          ...(cells.paci ? { paci: cells.paci } : {}),
        };
        const notes = [
          cells.crNumber ? `${t('CR No.')}: ${cells.crNumber}` : '',
          cells.notes,
        ].filter(Boolean);
        const email = cells.email.trim();
        const contacts =
          cells.contactPerson || email
            ? [
                {
                  id: shortId(),
                  name: cells.contactPerson || cells.name || cells.nameAr,
                  email,
                  phone,
                  primary: true,
                },
              ]
            : [];
        const client = createClient(ctx.company.id, {
          name: (cells.name || cells.nameAr).trim(),
          ...(cells.nameAr ? { nameAr: cells.nameAr.trim() } : {}),
          ...(civilId ? { civilId } : {}),
          email,
          phone,
          taxId: cells.taxId,
          address,
          contacts,
          paymentTermsDays,
          notes: notes.join('\n'),
          isCustomer: role.customer,
          isVendor: role.vendor,
        });
        record = { kind: 'contacts', value: { client, openingBalance } };
      }
      plan.rows.push({ line: i + 2, status, issues, cells, record });
    });
  }

  if (kind === 'products') planProducts(plan, body, mapping, options, ctx);

  if (kind === 'opening') {
    const byCode = new Map(ctx.accounts.map((a) => [key(a.code), a]));
    const byName = new Map<string, Account | null>();
    for (const a of ctx.accounts) {
      for (const n of [a.name, a.nameAr ?? ''].map(key).filter(Boolean)) {
        // Two accounts with the same name can't be told apart.
        byName.set(n, byName.has(n) ? null : a);
      }
    }
    if (locked(options.asOf)) {
      plan.rows = body.map((row, i) => ({
        line: i + 2,
        status: 'error' as const,
        issues: [{ level: 'error' as const, text: lockText() }],
        cells: cellsOf(kind, row, mapping),
        record: null,
      }));
      return finish(plan);
    }
    body.forEach((row, i) => {
      const cells = cellsOf(kind, row, mapping);
      const issues: RowIssue[] = [];
      const account = cells.code
        ? byCode.get(key(cells.code))
        : cells.account
          ? (byName.get(key(cells.account)) ?? undefined)
          : undefined;
      if (!cells.code && !cells.account) {
        issues.push({ level: 'error', text: t('Enter the account code.') });
      } else if (!account) {
        issues.push({
          level: 'error',
          text: cells.code
            ? t('No account has the code {code}.', { code: cells.code })
            : t('No account is called {name}.', { name: cells.account }),
        });
      } else if (account.role === 'receivable' || account.role === 'payable') {
        issues.push({
          level: 'error',
          text:
            account.role === 'receivable'
              ? t('Receivables come from open invoices. Import them as open invoices instead.')
              : t('Payables come from open bills. Import them as open bills instead.'),
        });
      }
      let debit = 0;
      let credit = 0;
      const read = (value: string) => {
        if (!value) return 0;
        const money = readMoney(value, currency);
        if ('problem' in money) {
          issues.push({ level: 'error', text: money.problem });
          return 0;
        }
        return money.amount;
      };
      if (cells.debit || cells.credit) {
        debit = read(cells.debit);
        credit = read(cells.credit);
        // A negative debit is a credit and the other way round.
        if (debit < 0) [credit, debit] = [credit - debit, 0];
        if (credit < 0) [debit, credit] = [debit - credit, 0];
        if (debit !== 0 && credit !== 0) {
          issues.push({
            level: 'error',
            text: t('Give a debit or a credit on each row, not both.'),
          });
        }
      } else if (cells.balance) {
        const balance = read(cells.balance);
        if (balance > 0) debit = balance;
        else credit = -balance;
      }
      if (!issues.length && debit === 0 && credit === 0) {
        issues.push({ level: 'skip', text: t('No amount.') });
      }
      const status = statusOf(issues);
      let record: ImportRecord | null = null;
      if (status === 'ready' && account) {
        plan.totals.debit += toMinor(debit, precision);
        plan.totals.credit += toMinor(credit, precision);
        record = {
          kind: 'opening',
          value: { accountId: account.id, debit, credit, description: account.name },
        };
        cells.matched = localName(account);
      }
      plan.rows.push({ line: i + 2, status, issues, cells, record });
    });
    plan.totals.difference = plan.totals.debit - plan.totals.credit;
  }

  if (kind === 'documents') {
    const type = options.documentType;
    const sales = type === 'invoice';
    const taken = new Set(ctx.documents.filter((d) => d.type === type).map((d) => key(d.number)));
    const contacts = new Map<string, Client>();
    for (const c of ctx.clients)
      for (const k of contactKeys(c)) if (!contacts.has(k)) contacts.set(k, c);
    const created = new Map<string, Client>();
    const promoted = new Set<ID>();
    body.forEach((row, i) => {
      const cells = cellsOf(kind, row, mapping);
      const issues: RowIssue[] = [];
      if (!cells.number) issues.push({ level: 'error', text: t('Enter the document number.') });
      else if (taken.has(key(cells.number))) {
        issues.push({
          level: 'skip',
          text: t('Number {number} is already used.', { number: cells.number }),
        });
      }
      if (!cells.contact) {
        issues.push({
          level: 'error',
          text: sales ? t('Enter the customer.') : t('Enter the vendor.'),
        });
      }
      const date = cells.date ? readFileDate(cells.date, options.dateFormat) : null;
      if (!cells.date) issues.push({ level: 'error', text: t('Enter the date.') });
      else if (!date) {
        issues.push({ level: 'error', text: t('“{value}” is not a date.', { value: cells.date }) });
      } else if (locked(date)) issues.push({ level: 'error', text: lockText() });
      let dueDate: ISODate | null = null;
      if (cells.dueDate) {
        dueDate = readFileDate(cells.dueDate, options.dateFormat);
        if (!dueDate) {
          issues.push({
            level: 'error',
            text: t('“{value}” is not a date.', { value: cells.dueDate }),
          });
        } else if (date && dueDate < date) {
          issues.push({ level: 'error', text: t('The due date is before the date.') });
        }
      }
      let amount = 0;
      if (!cells.amount) issues.push({ level: 'error', text: t('Enter the amount due.') });
      else {
        const money = readMoney(cells.amount, currency);
        if ('problem' in money) issues.push({ level: 'error', text: money.problem });
        else if (money.amount <= 0) {
          issues.push({ level: 'error', text: t('The amount due must be more than zero.') });
        } else amount = money.amount;
      }
      const contactKey = key(cells.contact);
      const existing = contactKey ? contacts.get(contactKey) : undefined;
      const status = statusOf(issues);
      let record: ImportRecord | null = null;
      if (status === 'ready' && date) {
        taken.add(key(cells.number));
        let contact = existing ?? created.get(contactKey) ?? null;
        let newContact: Client | null = null;
        let promote: Client | null = null;
        if (!contact) {
          newContact = createClient(ctx.company.id, {
            name: cells.contact,
            address: emptyAddress('KW'),
            isCustomer: sales,
            isVendor: !sales,
          });
          created.set(contactKey, newContact);
          contact = newContact;
          issues.push({
            level: 'info',
            text: sales
              ? t('New customer {name} will be added.', { name: cells.contact })
              : t('New vendor {name} will be added.', { name: cells.contact }),
          });
        } else if (existing && !promoted.has(existing.id)) {
          const missingRole = sales ? existing.isCustomer === false : !existing.isVendor;
          if (missingRole) {
            promote = existing;
            promoted.add(existing.id);
          }
        }
        const terms = contact.paymentTermsDays ?? ctx.company.defaults.paymentTermsDays;
        const doc = openingDocument(ctx.company, type, {
          number: cells.number,
          clientId: contact.id,
          issueDate: date,
          dueDate: dueDate ?? addDaysISO(date, terms),
          amount,
          reference: cells.reference,
          notes: cells.notes,
          fileName: options.fileName,
        });
        record = { kind: 'documents', value: { doc, newContact, promote } };
      }
      plan.rows.push({ line: i + 2, status, issues, cells, record });
    });
    plan.newContacts = created.size;
  }

  return finish(plan);
}

/** The kind of item a Type cell names: null when blank, undefined when not recognised. */
function itemKind(value: string): ProductKind | null | undefined {
  const v = key(value);
  if (!v) return null;
  if (
    /^(non stock|non stock item|non inventory|non inventory item|غير مخزني|غير مخزون|صنف غير مخزني)$/.test(
      v,
    )
  )
    return 'non_stock';
  if (/^(stock|stock item|inventory|inventory item|مخزون|مخزني|صنف مخزني|صنف مخزون)$/.test(v))
    return 'stock';
  if (/^(service|services|خدمه|خدمات)$/.test(v)) return 'service';
  return undefined;
}

/** A quantity from the file (at most 6 decimals), or null when it isn't a number. */
function readQuantity(value: string): number | null {
  const cleaned = normalizeDigits(value).replace(/[\s,]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  return round(Number(cleaned), 6);
}

/** Names of the warehouse ensureDefaultWarehouse adds. */
const MAIN_STORE = ['Main store', 'المستودع الرئيسي'].map(key);

/** What an Update existing items row may change. */
const UPDATED_FIELDS = [
  'name',
  'nameAr',
  'description',
  'descriptionAr',
  'unit',
  'unitId',
  'unitPrice',
  'costPrice',
  'reorderLevel',
  'barcode',
] as const;

/**
 * Products and services, with their stock when the quantity column is
 * matched. Rows for items already here are skipped as before, unless they
 * bring stock (taken as opening stock, or as a count for items with stock
 * history) or `updateExisting` is set. A later row may give an item of an
 * earlier one stock in another warehouse.
 */
function planProducts(
  plan: ImportPlan,
  body: string[][],
  mapping: ColumnMapping,
  options: ImportOptions,
  ctx: ImportContext,
) {
  const company = ctx.company;
  const currency = company.currency;
  const precision = currencyPrecision(currency);
  const fmtDate = options.formatDate ?? ((d: ISODate) => d);
  const lock = accountingSettings(company).lockDate;
  const stockLocked = Boolean(lock && options.asOf <= lock);
  const units = Boolean(company.items?.units);
  const quantityAt = mapping.quantity;
  const stockFile = quantityAt != null && body.some((row) => (row[quantityAt] ?? '').trim() !== '');

  const live = (ctx.warehouses ?? []).filter((w) => !w.archived);
  const main =
    live.find((w) => w.id === options.warehouseId) ?? live.find((w) => w.isDefault) ?? live[0];
  const warehouses = new Map<string, Warehouse | null>();
  for (const w of live) {
    for (const n of [w.name, w.nameAr ?? ''].map(key).filter(Boolean)) {
      // Two warehouses with the same name can't be told apart.
      warehouses.set(n, warehouses.has(n) && warehouses.get(n)?.id !== w.id ? null : w);
    }
  }
  const levels = stockLevels(
    stockFile ? (ctx.stock?.movements ?? []) : [],
    precision,
    options.asOf,
  );
  const history = ctx.stock?.history ?? new Set<ID>();

  // Items already here, by SKU and by name (null: more than one has it).
  const bySku = new Map<string, Product>();
  const english = new Map<string, Product | null>();
  const arabic = new Map<string, Product | null>();
  const note = (map: Map<string, Product | null>, text: string | undefined, p: Product) => {
    const k = key(text ?? '');
    if (k) map.set(k, map.has(k) && map.get(k)?.id !== p.id ? null : p);
  };
  for (const p of ctx.products) {
    const k = key(p.sku);
    if (k && !bySku.has(k)) bySku.set(k, p);
    note(english, p.name, p);
    note(arabic, p.nameAr, p);
  }
  // Rows planned so far, by item; and the SKUs and names of the items they add.
  const planned = new Map<ID, ProductRecord>();
  const fileSkus = new Map<string, ID>();
  const fileNames = new Map<string, ID>();
  const stocked = new Set<string>();
  const summary: StockImportSummary = {
    value: 0,
    opening: 0,
    warehouses: 0,
    counted: 0,
    differences: 0,
  };
  const openingWarehouses = new Set<ID>();
  let itemCodes = 0;
  let existingRows = 0;

  body.forEach((row, i) => {
    const cells = cellsOf('products', row, mapping);
    const issues: RowIssue[] = [];
    const error = (text: string) => issues.push({ level: 'error', text });
    const name = (cells.name || cells.nameAr).trim();
    if (!name) error(t('Enter a name.'));
    const wantsStock = stockFile && cells.quantity !== '';

    // The item: one an earlier row has, one already here, or a new one.
    const codeKey = key(cells.sku);
    const nameKey = key(name);
    let earlier: ProductRecord | undefined;
    let existing: Product | undefined;
    let ambiguous = false;
    let nameTaken = false;
    if (codeKey) {
      earlier = planned.get(fileSkus.get(codeKey) ?? '');
      existing = earlier ? undefined : bySku.get(codeKey);
      // A new SKU with a name another item has.
      nameTaken =
        !earlier &&
        !existing &&
        Boolean(nameKey) &&
        (fileNames.has(nameKey) || english.has(nameKey) || (!cells.name && arabic.has(nameKey)));
    } else if (nameKey) {
      earlier = planned.get(fileNames.get(nameKey) ?? '');
      if (!earlier) {
        const found = cells.name
          ? english.get(nameKey)
          : (english.get(nameKey) ?? arabic.get(nameKey));
        if (found === null) ambiguous = true;
        else existing = found;
      }
    }
    if (existing && planned.has(existing.id)) {
      earlier = planned.get(existing.id);
      existing = undefined;
    }
    if (existing || earlier?.source === 'existing') existingRows += 1;
    const takenText =
      codeKey && (earlier || existing)
        ? t('SKU {sku} is already used.', { sku: cells.sku })
        : t('{name} is already in your items.', { name });

    // Values, checked whatever the row turns out to be.
    let price: number | null = null;
    if (cells.price) {
      // Unit prices may be finer than the currency (e.g. 0.0375 a piece).
      const money = readMoney(cells.price, currency, 6);
      if ('problem' in money) error(money.problem);
      else if (money.amount < 0) error(t('The price cannot be negative.'));
      else price = money.amount;
    }
    let cost: number | null = null;
    if (cells.cost) {
      const money = readMoney(cells.cost, currency, 6);
      if ('problem' in money) error(money.problem);
      else if (money.amount < 0) error(t('The cost can’t be negative.'));
      else cost = money.amount;
    }
    let reorderLevel: number | null = null;
    if (cells.reorderLevel) {
      const level = readQuantity(cells.reorderLevel);
      if (level === null) error(t('“{value}” is not a number.', { value: cells.reorderLevel }));
      else if (level < 0) error(t('The reorder level can’t be negative.'));
      else reorderLevel = level;
    }
    let unit = cells.unit;
    let unitId: ID | undefined;
    if (units && cells.unit) {
      // Units come from the list (Settings → Items and units).
      const found = findUnit(company, matchUnit(cells.unit, company));
      if (found) {
        unit = found.name;
        unitId = found.id;
      } else {
        issues.push({
          level: 'info',
          text: t('The unit {unit} is not in the list of units; it is kept as written.', {
            unit: cells.unit,
          }),
        });
      }
    }
    const typed = itemKind(cells.type);
    let quantity = 0;
    let warehouse = main;
    if (wantsStock) {
      const read = readQuantity(cells.quantity);
      if (read === null) error(t('“{value}” is not a quantity.', { value: cells.quantity }));
      else if (read < 0) error(t('The quantity can’t be negative.'));
      else quantity = read;
      if (cells.warehouse) {
        const found = warehouses.get(key(cells.warehouse));
        if (found) warehouse = found;
        // The main store, added on import when the company has no warehouse yet.
        else if (!(live.length === 0 && MAIN_STORE.includes(key(cells.warehouse)))) {
          error(t('No warehouse is called {name}.', { name: cells.warehouse }));
        }
      }
      if (stockLocked) {
        error(t('This is on or before the lock date ({date}).', { date: fmtDate(lock!) }));
      }
    }

    let source: ProductRecord['source'] = 'new';
    let product: Product | null = null;
    let update = false;
    if (earlier) {
      if (!wantsStock) issues.push({ level: 'skip', text: takenText });
      source = 'repeat';
      product = earlier.product;
    } else if (existing) {
      const before = existing;
      source = 'existing';
      product = before;
      if (options.updateExisting) {
        const next: Product = { ...before };
        // Matched by its SKU: the file's name is the item's name.
        if (codeKey && cells.name) next.name = cells.name.trim();
        if (cells.nameAr) next.nameAr = cells.nameAr.trim();
        if (cells.description) next.description = cells.description;
        if (cells.descriptionAr) next.descriptionAr = cells.descriptionAr;
        if (cells.unit) {
          next.unit = unit;
          if (unitId) next.unitId = unitId;
          else delete next.unitId;
        }
        if (price !== null) next.unitPrice = price;
        if (cost !== null) next.costPrice = cost;
        if (reorderLevel !== null && productKind(before) === 'stock') {
          next.reorderLevel = reorderLevel;
        }
        if (cells.barcode) next.barcode = cells.barcode;
        update = UPDATED_FIELDS.some((f) => (next[f] ?? null) !== (before[f] ?? null));
        if (update) {
          product = next;
          issues.push({ level: 'info', text: t('Updates the item already in your items.') });
        }
      }
      if (!wantsStock && !update) {
        issues.push({
          level: 'skip',
          text: options.updateExisting ? t('Nothing to change.') : takenText,
        });
      } else if (!update) {
        issues.push({ level: 'info', text: t('Already in your items: only its stock is taken.') });
      }
      if (typed && typed !== productKind(before) && (wantsStock || update)) {
        issues.push({
          level: 'warning',
          text: t('The type of an item already in your items is not changed by an import.'),
        });
      }
    } else if (ambiguous || nameTaken) {
      const text = ambiguous
        ? t('More than one item is called {name}. Add the SKU to say which.', { name })
        : t('{name} is already in your items.', { name });
      issues.push({
        level: wantsStock || (ambiguous && options.updateExisting) ? 'error' : 'skip',
        text,
      });
    } else if (name) {
      if (typed === undefined) {
        issues.push({
          level: 'warning',
          text: wantsStock
            ? t('Type “{value}” not recognised; imported as a stock item, as it has a quantity.', {
                value: cells.type,
              })
            : t('Type “{value}” not recognised; imported as a service.', { value: cells.type }),
        });
      }
      // Without a type, a row with a quantity is a stock item; others are services as before.
      const kind = typed ?? (wantsStock ? 'stock' : undefined);
      product = createProduct(company.id, {
        name,
        ...(cells.nameAr ? { nameAr: cells.nameAr.trim() } : {}),
        sku: cells.sku,
        unit,
        ...(unitId ? { unitId } : {}),
        unitPrice: price ?? 0,
        description: cells.description,
        ...(cells.descriptionAr ? { descriptionAr: cells.descriptionAr } : {}),
        taxRateIds: [...company.defaults.defaultTaxRateIds],
        ...(kind ? { kind } : {}),
        ...(cost !== null ? { costPrice: cost } : {}),
        ...(kind === 'stock' ? { reorderLevel } : {}),
        ...(cells.barcode ? { barcode: cells.barcode } : {}),
      });
    }

    let stock: ProductStock | null = null;
    if (wantsStock && product) {
      const warehouseId = warehouse?.id ?? '';
      if (productKind(product) !== 'stock') {
        error(t('{name} is not a stock item, so it can’t have a quantity.', { name }));
      } else if (stocked.has(`${product.id}|${warehouseId}`)) {
        error(t('{name} already has a quantity for this warehouse on another row.', { name }));
      }
      const counted = source !== 'new' && history.has(product.id);
      const onRecord = counted ? (levels.get(product.id)?.byWarehouse.get(warehouseId) ?? 0) : 0;
      const unitCost = cost ?? product.costPrice ?? 0;
      stock = { warehouseId, quantity, unitCost, as: counted ? 'count' : 'opening', onRecord };
      if (counted) {
        issues.push({
          level: 'info',
          text: t('It has stock history, so the quantity is a count: {quantity} on record.', {
            quantity: onRecord,
          }),
        });
      } else if (quantity > 0 && unitCost === 0) {
        issues.push({
          level: 'warning',
          text: t('No cost price: this stock is valued at nothing.'),
        });
      }
    }

    const status = statusOf(issues);
    let record: ImportRecord | null = null;
    if (status === 'ready' && product) {
      const value: ProductRecord = { product, source, update, stock };
      record = { kind: 'products', value };
      if (source !== 'repeat') planned.set(product.id, value);
      if (source === 'new') {
        if (codeKey) fileSkus.set(codeKey, product.id);
        fileNames.set(nameKey, product.id);
        if (company.items?.autoSku && !product.sku.trim()) itemCodes += 1;
      }
      if (stock) {
        stocked.add(`${product.id}|${stock.warehouseId}`);
        if (stock.as === 'count') {
          summary.counted += 1;
          if (!dec(stock.quantity).eq(dec(stock.onRecord))) summary.differences += 1;
        } else if (stock.quantity > 0) {
          summary.opening += 1;
          openingWarehouses.add(stock.warehouseId);
          summary.value += toMinor(
            round(dec(stock.quantity).times(dec(stock.unitCost)), precision),
            precision,
          );
        }
      }
    }
    plan.rows.push({ line: i + 2, status, issues, cells, record });
  });
  summary.warehouses = openingWarehouses.size;
  if (stockFile) plan.stock = summary;
  plan.itemCodes = itemCodes;
  plan.existing = existingRows;
}

/** An issued document for money owed before the books start here. */
function openingDocument(
  company: Company,
  type: DocumentType,
  input: {
    number: string;
    clientId: ID;
    issueDate: ISODate;
    dueDate: ISODate | null;
    amount: number;
    reference?: string;
    notes?: string;
    fileName: string;
    accountId?: ID | null;
  },
): InvoiceDocument {
  const item: LineItem = {
    id: shortId(),
    kind: 'item',
    productId: null,
    name: OPENING_ITEM.name,
    nameAr: OPENING_ITEM.nameAr,
    description: '',
    quantity: 1,
    unit: '',
    unitPrice: input.amount,
    discount: 0,
    discountType: 'percent',
    taxes: [],
    accountId: input.accountId ?? null,
  };
  const purchase = type === 'bill' || type === 'vendor_credit';
  const privateNotes = [
    t('Opening balance imported from {file}.', { file: input.fileName || 'CSV' }),
    input.notes ?? '',
  ]
    .filter(Boolean)
    .join('\n');
  return createDocument(company.id, type, {
    number: input.number,
    status: 'sent',
    clientId: input.clientId,
    issueDate: input.issueDate,
    dueDate: type === 'invoice' || type === 'bill' ? input.dueDate : null,
    currency: company.currency,
    items: [item],
    pricesIncludeTax: false,
    ...(purchase
      ? { vendorReference: input.reference ?? '' }
      : { poNumber: input.reference ?? '' }),
    privateNotes,
    sentAt: nowStamp(),
  });
}

/**
 * Everything a plan needs to know about the company's existing records; the
 * stock only for products (or when no kind is given).
 */
export async function loadImportContext(companyId: ID, kind?: ImportKind): Promise<ImportContext> {
  const company = await db.companies.get(companyId);
  if (!company) throw new ImportError(t('Company not found.'));
  const [clients, products, accounts, documents, employees] = await Promise.all([
    db.clients.where('companyId').equals(companyId).toArray(),
    db.products.where('companyId').equals(companyId).toArray(),
    db.accounts.where('companyId').equals(companyId).toArray(),
    db.documents.where('companyId').equals(companyId).toArray(),
    db.employees.where('companyId').equals(companyId).toArray(),
  ]);
  const ctx: ImportContext = { company, clients, products, accounts, documents, employees };
  if (kind && kind !== 'products') return ctx;
  const [warehouses, movements, entries, journals] = await Promise.all([
    db.warehouses.where('companyId').equals(companyId).toArray(),
    db.stockMovements.where('companyId').equals(companyId).toArray(),
    db.stockEntries.where('companyId').equals(companyId).toArray(),
    db.journals.bulkGet(company.openingBalances?.journalIds ?? []),
  ]);
  const history = new Set<ID>(movements.map((m) => m.productId));
  for (const entry of entries) for (const line of entry.lines) history.add(line.productId);
  // Stock already in the opening balances would be counted twice.
  const precision = currencyPrecision(company.currency);
  const inventory = stockAccounts(accounts, accountingSettings(company).template).inventory;
  let inBooks = 0;
  for (const journal of journals) {
    if (!journal || journal.status !== 'posted') continue;
    for (const line of journal.lines) {
      if (line.accountId !== inventory?.id) continue;
      inBooks += toMinor(line.debit, precision) - toMinor(line.credit, precision);
    }
  }
  return { ...ctx, warehouses, stock: { history, movements, inBooks } };
}

/**
 * Imports employees: plans the file against the company as it is now, then
 * saves the employees in batches (see import-employees.ts), with progress.
 */
export async function importEmployees(
  companyId: ID,
  rows: string[][],
  mapping: ColumnMapping,
  options: ImportOptions,
  onProgress?: (progress: EmployeeImportProgress) => void,
): Promise<ImportResult> {
  const ctx = await loadImportContext(companyId, 'employees');
  const plan = planImport('employees', rows, mapping, options, ctx);
  return commitEmployeeImport(companyId, plan, onProgress);
}

/** The Opening balance equity account, added when the chart has none. */
async function openingAccount(company: Company): Promise<Account> {
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const found =
    accounts.find((a) => a.role === 'opening_balance' && !a.archived) ??
    accounts.find((a) => a.role === 'opening_balance');
  if (found) return found;
  const codes = new Set(accounts.map((a) => a.code));
  let code = Number(OPENING_ACCOUNT.code);
  while (codes.has(String(code))) code += 1;
  const account = createAccount(company.id, {
    code: String(code),
    name: OPENING_ACCOUNT.name,
    nameAr: OPENING_ACCOUNT.nameAr,
    type: 'equity',
    role: 'opening_balance',
  });
  await db.accounts.add(account);
  await logActivity(company.id, 'account', account.id, 'created', {
    text: msg('Account {code} {name} created'),
    vars: { code: account.code, name: account.name },
    arabic: { name: account.nameAr },
  });
  return account;
}

/**
 * For new items of a products file that get item codes, in a company kept in
 * the cloud: a block of the cloud's counter, taken before the import's
 * transaction (see reserveItemCodes). Null to number on this device.
 */
async function reserveImportCodes(
  companyId: ID,
  rows: string[][],
  mapping: ColumnMapping,
  options: ImportOptions,
): Promise<ReservedCounter | null> {
  if (!canReserveCounters()) return null;
  const ctx = await loadImportContext(companyId, 'products');
  if (!ctx.company.items?.autoSku) return null;
  const count = planImport('products', rows, mapping, options, ctx).itemCodes ?? 0;
  return count ? reserveItemCodes(companyId, count) : null;
}

/**
 * Posts the stock of a products file: one opening stock entry per warehouse
 * for items without stock history, then one count adjustment per warehouse
 * for the differences of items with history. Runs in the import's
 * transaction, after the items are saved.
 */
async function postImportedStock(
  company: Company,
  items: ProductRecord[],
  options: ImportOptions,
): Promise<Pick<StockEntry, 'id' | 'number' | 'kind'>[]> {
  const stocked = items.flatMap((r) => (r.stock ? [{ ...r, stock: r.stock }] : []));
  const opening = stocked.filter((r) => r.stock.as === 'opening' && r.stock.quantity > 0);
  const counts = stocked.filter(
    (r) => r.stock.as === 'count' && !dec(r.stock.quantity).eq(dec(r.stock.onRecord)),
  );
  if (opening.length === 0 && counts.length === 0) return [];
  const main = stocked.some((r) => !r.stock.warehouseId)
    ? (await ensureDefaultWarehouse(company.id)).id
    : '';
  // Opening stock is booked against opening balance equity.
  if (opening.length) await openingAccount(company);
  const fresh = (await db.companies.get(company.id)) ?? company;
  const byWarehouse = (rows: typeof stocked) => {
    const groups = new Map<ID, typeof stocked>();
    for (const r of rows) {
      const id = r.stock.warehouseId || main;
      const group = groups.get(id);
      if (group) group.push(r);
      else groups.set(id, [r]);
    }
    return groups;
  };
  const base = {
    date: options.asOf,
    reference: options.fileName,
    notes: t('Imported from {file}.', { file: options.fileName || 'CSV' }),
  };
  const entries: StockEntry[] = [];
  for (const [warehouseId, rows] of byWarehouse(opening)) {
    const input: StockEntryInput = {
      ...base,
      kind: 'opening',
      warehouseId,
      lines: rows.map((r) => ({
        productId: r.product.id,
        quantity: r.stock.quantity,
        unitCost: r.stock.unitCost,
      })),
    };
    entries.push(await addStockEntry(fresh, input));
  }
  for (const [warehouseId, rows] of byWarehouse(counts)) {
    const input: StockEntryInput = {
      ...base,
      kind: 'adjustment',
      reason: 'count',
      warehouseId,
      lines: rows.map((r) => ({
        productId: r.product.id,
        quantity: dec(r.stock.quantity).minus(dec(r.stock.onRecord)).toNumber(),
      })),
    };
    entries.push(await addStockEntry(fresh, input));
  }
  return entries.map(({ id, number, kind }) => ({ id, number, kind }));
}

/** Gives new contacts their numbers (C-0001…), skipping numbers already used. */
function numberContacts(company: Company, existing: Client[], fresh: Client[]): Company {
  const taken = new Set(existing.map((c) => c.number.toLowerCase()));
  let rule = company.numbering.client ?? defaultNumbering().client;
  const date = today();
  for (const client of fresh) {
    const allocated = allocateNumber(rule, date, (n) => taken.has(n.toLowerCase()));
    client.number = allocated.number;
    taken.add(allocated.number.toLowerCase());
    rule = allocated.rule;
  }
  return { ...company, numbering: { ...company.numbering, client: rule } };
}

/**
 * Imports the ready rows of a file in one transaction: either everything is
 * added or nothing is. Opening balances are only imported when every row is
 * right, because a partial trial balance would leave the books wrong.
 */
export async function commitImport(
  companyId: ID,
  kind: ImportKind,
  rows: string[][],
  mapping: ColumnMapping,
  options: ImportOptions,
): Promise<ImportResult> {
  // Employees are saved in batches, not in one transaction.
  if (kind === 'employees') return importEmployees(companyId, rows, mapping, options);
  const reserved =
    kind === 'products' ? await reserveImportCodes(companyId, rows, mapping, options) : null;
  return db.transaction(
    'rw',
    [
      db.companies,
      db.clients,
      db.products,
      db.documents,
      db.journals,
      db.accounts,
      db.payments,
      db.activities,
      // Read by loadImportContext.
      db.employees,
      // Opening stock (see stockTables).
      db.warehouses,
      db.stockMovements,
      db.stockEntries,
      db.landedCosts,
    ],
    async () => {
      const ctx = await loadImportContext(companyId, kind);
      const plan = planImport(kind, rows, mapping, options, ctx);
      // A partial trial balance, or stock of part of a file, would leave the books wrong.
      if ((kind === 'opening' || plan.stock) && plan.errors > 0) {
        throw new ImportError(t('Fix the rows with problems first. Nothing was imported.'));
      }
      if (plan.ready === 0) throw new ImportError(t('There is nothing to import.'));
      let company = ctx.company;
      const records = plan.rows.flatMap((r) => (r.record ? [r.record] : []));
      const result: ImportResult = {
        kind,
        added: plan.ready,
        skipped: plan.skipped + plan.errors,
        newContacts: 0,
        documents: 0,
        journalNumber: null,
      };
      const takenNumbers = (type: DocumentType) =>
        new Set(ctx.documents.filter((d) => d.type === type).map((d) => key(d.number)));

      if (kind === 'contacts') {
        const items = records.flatMap((r) => (r.kind === 'contacts' ? [r.value] : []));
        company = numberContacts(
          company,
          ctx.clients,
          items.map((i) => i.client),
        );
        await db.clients.bulkAdd(items.map((i) => i.client));
        for (const { client } of items) {
          await logActivity(
            company.id,
            'client',
            client.id,
            'created',
            {
              text:
                client.isCustomer === false
                  ? msg('Vendor {name} imported')
                  : msg('Client {name} imported'),
              vars: { name: client.name },
              arabic: { name: client.nameAr },
            },
            { clientId: client.id },
          );
        }
        const withBalance = items.filter((i) => i.openingBalance !== 0);
        if (withBalance.length) {
          assertUnlocked(company, options.asOf);
          const account = await openingAccount(company);
          const docs: InvoiceDocument[] = [];
          const taken = new Map<DocumentType, Set<string>>();
          for (const { client, openingBalance } of withBalance) {
            const customer = client.isCustomer !== false;
            const type: DocumentType = customer
              ? openingBalance > 0
                ? 'invoice'
                : 'credit'
              : openingBalance > 0
                ? 'bill'
                : 'vendor_credit';
            if (!taken.has(type)) taken.set(type, takenNumbers(type));
            const used = taken.get(type)!;
            let number = `OB-${client.number}`;
            for (let n = 2; used.has(key(number)); n++) number = `OB-${client.number}-${n}`;
            used.add(key(number));
            const doc = openingDocument(company, type, {
              number,
              clientId: client.id,
              issueDate: options.asOf,
              dueDate: options.asOf,
              amount: Math.abs(openingBalance),
              fileName: options.fileName,
              accountId: account.id,
            });
            docs.push(applyTotals(doc, 0, client));
          }
          await db.documents.bulkAdd(docs);
          for (const doc of docs) {
            await logActivity(
              company.id,
              doc.type,
              doc.id,
              'created',
              { text: msg('Opening balance {number} added'), vars: { number: doc.number } },
              { clientId: doc.clientId, documentId: doc.id },
            );
          }
          result.documents = docs.length;
        }
        await db.companies.put({ ...company, updatedAt: nowStamp() });
      }

      if (kind === 'products') {
        const items = records.flatMap((r) => (r.kind === 'products' ? [r.value] : []));
        const fresh = items.filter((r) => r.source === 'new').map((r) => r.product);
        // New items without an SKU get the next item codes, as when saved one by one.
        const uncoded = company.items?.autoSku ? fresh.filter((p) => !p.sku.trim()) : [];
        if (uncoded.length) {
          const taken = new Set(
            [...ctx.products, ...fresh].map((p) => skuKey(p.sku)).filter(Boolean),
          );
          const { codes, rule } = nextItemCodes(company, taken, uncoded.length, reserved);
          uncoded.forEach((p, i) => (p.sku = codes[i]));
          company = { ...company, numbering: { ...company.numbering, product: rule } };
          await db.companies.put({ ...company, updatedAt: nowStamp() });
        }
        await db.products.bulkAdd(fresh);
        for (const p of fresh) {
          await logActivity(company.id, 'product', p.id, 'created', {
            text: msg('Item {name} imported'),
            vars: { name: p.name },
            arabic: { name: p.nameAr },
          });
        }
        const changed = items.filter((r) => r.source === 'existing' && r.update);
        if (changed.length) {
          const stamp = nowStamp();
          await db.products.bulkPut(changed.map((r) => ({ ...r.product, updatedAt: stamp })));
          for (const { product: p } of changed) {
            await logActivity(company.id, 'product', p.id, 'updated', {
              text: msg('Item {name} updated'),
              vars: { name: p.name },
            });
          }
          // The cost price values sales made before any stock had a cost.
          const before = new Map(ctx.products.map((p) => [p.id, p]));
          await recost(
            company,
            changed
              .map((r) => r.product)
              .filter(
                (p) => productKind(p) === 'stock' && before.get(p.id)?.costPrice !== p.costPrice,
              )
              .map((p) => p.id),
          );
        }
        if (fresh.some((p) => productKind(p) === 'stock')) {
          await ensureStockAccounts(company);
          await ensureDefaultWarehouse(company.id);
        }
        result.added = fresh.length;
        result.updated = changed.length;
        result.stockEntries = await postImportedStock(company, items, options);
      }

      if (kind === 'opening') {
        const lines = records.flatMap((r) => (r.kind === 'opening' ? [r.value] : []));
        const precision = currencyPrecision(company.currency);
        const account = await openingAccount(company);
        const journalLines = lines.map((l) =>
          newJournalLine({
            accountId: l.accountId,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
          }),
        );
        const difference = plan.totals.difference;
        if (difference !== 0) {
          journalLines.push(
            newJournalLine({
              accountId: account.id,
              description: OPENING_ACCOUNT.name,
              debit: difference < 0 ? fromMinor(-difference, precision) : 0,
              credit: difference > 0 ? fromMinor(difference, precision) : 0,
            }),
          );
        }
        if (journalLines.length < 2) {
          // One account against itself: nothing moves.
          throw new ImportError(t('There is nothing to import.'));
        }
        const journal = await saveJournal(
          createJournal(company.id, {
            date: options.asOf,
            reference: t('Opening balances'),
            notes: t('Imported from {file}.', { file: options.fileName || 'CSV' }),
            lines: journalLines,
          }),
        );
        // saveJournal may have advanced the journal numbering.
        company = (await db.companies.get(company.id)) ?? company;
        const before = company.openingBalances;
        await db.companies.put({
          ...company,
          openingBalances: {
            date: options.asOf,
            journalIds: [...(before?.journalIds ?? []), journal.id],
          },
          updatedAt: nowStamp(),
        });
        result.journalNumber = journal.number;
      }

      if (kind === 'documents') {
        const items = records.flatMap((r) => (r.kind === 'documents' ? [r.value] : []));
        const fresh = items.flatMap((i) => (i.newContact ? [i.newContact] : []));
        if (fresh.length) {
          company = numberContacts(company, ctx.clients, fresh);
          await db.clients.bulkAdd(fresh);
          await db.companies.put({ ...company, updatedAt: nowStamp() });
          for (const client of fresh) {
            await logActivity(
              company.id,
              'client',
              client.id,
              'created',
              {
                text:
                  client.isCustomer === false
                    ? msg('Vendor {name} imported')
                    : msg('Client {name} imported'),
                vars: { name: client.name },
                arabic: { name: client.nameAr },
              },
              { clientId: client.id },
            );
          }
        }
        for (const { promote } of items) {
          if (!promote) continue;
          await db.clients.update(promote.id, {
            ...(options.documentType === 'invoice' ? { isCustomer: true } : { isVendor: true }),
            updatedAt: nowStamp(),
          });
        }
        const account = await openingAccount(company);
        const clients = new Map([...ctx.clients, ...fresh].map((c) => [c.id, c]));
        const docs = items.map(({ doc }) =>
          applyTotals(
            { ...doc, items: doc.items.map((i) => ({ ...i, accountId: account.id })) },
            0,
            clients.get(doc.clientId) ?? null,
          ),
        );
        await db.documents.bulkAdd(docs);
        for (const doc of docs) {
          await logActivity(
            company.id,
            doc.type,
            doc.id,
            'created',
            { text: msg('Opening balance {number} added'), vars: { number: doc.number } },
            { clientId: doc.clientId, documentId: doc.id },
          );
        }
        result.newContacts = fresh.length;
        result.documents = docs.length;
      }

      return result;
    },
  );
}
