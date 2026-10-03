import type { DiscountType, TaxKind, TaxLine } from '@/lib/calc';

export type { DiscountType, TaxKind, TaxLine };

export type ID = string;
/** Calendar date in `yyyy-MM-dd` form (no time zone). */
export type ISODate = string;
/** Full ISO 8601 timestamp. */
export type Timestamp = string;

export interface Address {
  line1: string;
  line2: string;
  /** Area in Kuwait (e.g. "Salmiya"), city elsewhere. */
  city: string;
  /** Governorate in Kuwait (e.g. "Hawalli"), state or region elsewhere. */
  state: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2 code, e.g. "KW". */
  country: string;
  /** Kuwaiti addresses: block (قطعة). */
  block?: string;
  street?: string;
  /** Avenue (جادة). */
  avenue?: string;
  /** Building or house number. */
  building?: string;
  floor?: string;
  /** Office, flat or shop number. */
  unit?: string;
  /** PACI automated address number (الرقم الآلي للعنوان). */
  paci?: string;
}

/** Sales documents (invoice, quote, credit) and purchase documents (bill, vendor credit). */
export type DocumentType = 'invoice' | 'quote' | 'credit' | 'bill' | 'vendor_credit';
export type SalesDocumentType = 'invoice' | 'quote' | 'credit';
export type PurchaseDocumentType = 'bill' | 'vendor_credit';

export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'void';
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'invoiced';
export type CreditStatus = 'draft' | 'sent' | 'partial' | 'applied' | 'void';
export type DocumentStatus = InvoiceStatus | QuoteStatus | CreditStatus;

export type NumberedEntity =
  DocumentType | 'payment' | 'payment_made' | 'client' | 'journal' | 'expense' | 'employee';

export type CounterReset = 'never' | 'yearly' | 'monthly';

export interface NumberingRule {
  /** e.g. "INV-{year}-{counter}". See lib/numbering.ts for placeholders. */
  pattern: string;
  /** Next counter value to use. */
  next: number;
  /** Minimum digits of the counter (zero padded). */
  padding: number;
  reset: CounterReset;
  /** Period key ("2026" or "2026-10") the counter was last used in; drives resets. */
  period: string;
}

export type DateFormat =
  | 'locale'
  | 'dd/MM/yyyy'
  | 'MM/dd/yyyy'
  | 'yyyy-MM-dd'
  | 'dd.MM.yyyy'
  | 'dd-MM-yyyy'
  | 'd MMM yyyy'
  | 'MMM d, yyyy';

export type PageSize = 'A4' | 'LETTER';

/** Language used for the words printed on documents. */
export type DocumentLanguage = 'en' | 'fr' | 'es' | 'de' | 'pt' | 'it' | 'nl';

export interface DocumentDefaults {
  /** Days between issue date and due date for new invoices. */
  paymentTermsDays: number;
  /** Days a quote stays valid. */
  quoteValidDays: number;
  invoiceNotes: string;
  invoiceTerms: string;
  quoteNotes: string;
  quoteTerms: string;
  creditNotes: string;
  creditTerms: string;
  footer: string;
  pricesIncludeTax: boolean;
  /** Show per-line tax selection in the editor. */
  lineTaxes: boolean;
  /** Show document-level (whole invoice) taxes in the editor. */
  documentTaxes: boolean;
  /** Tax rates applied automatically to new lines (line mode) or new documents (document mode). */
  defaultTaxRateIds: ID[];
  pageSize: PageSize;
}

export interface Branding {
  /** Hex color used as the accent in templates, e.g. "#4f46e5". */
  accentColor: string;
  /** Default template id (see pdf/templates). */
  templateId: string;
  /** Logo as a data URL (PNG/JPEG), stored locally. */
  logo: string | null;
  /** Font override; null uses the template's own font pairing. */
  fontId: string | null;
  /** Print a PAID / VOID stamp on settled or cancelled documents. */
  showStatusStamp: boolean;
  /** Company stamp (seal) image as a data URL, printed near the signature. */
  stamp?: string | null;
  /** Authorised signature image as a data URL. */
  signature?: string | null;
}

export interface PaymentSettings {
  /** Free text shown on documents, e.g. bank name, IBAN, SWIFT. */
  bankDetails: string;
  /** Short instruction such as "Please quote the invoice number as reference." */
  instructions: string;
  /** Online payment link (Stripe Payment Link, PayPal.me, ...). */
  paymentLink: string;
  /** Print a QR code for the payment link on documents. */
  showQrCode: boolean;
}

export interface EmailTemplate {
  subject: string;
  body: string;
}

export interface EmailTemplates {
  invoice: EmailTemplate;
  quote: EmailTemplate;
  credit: EmailTemplate;
  reminder: EmailTemplate;
  payment: EmailTemplate;
}

/* -------------------------------------------------------------------------- */
/* Accounting                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What an account is. The type decides where it appears in the financial
 * statements, so reports never depend on account codes.
 */
export type AccountType =
  | 'asset_cash'
  | 'asset_receivable'
  | 'asset_current'
  | 'asset_prepayments'
  | 'asset_fixed'
  | 'asset_non_current'
  | 'liability_payable'
  | 'liability_credit_card'
  | 'liability_current'
  | 'liability_non_current'
  | 'equity'
  | 'income'
  | 'income_other'
  | 'expense_direct_cost'
  | 'expense'
  | 'expense_depreciation'
  | 'expense_other';

/** System accounts the app posts to automatically (one per role and company). */
export type AccountRole =
  | 'receivable'
  | 'payable'
  | 'bank'
  | 'cash'
  | 'credit_card'
  | 'sales'
  | 'charges'
  | 'output_tax'
  | 'input_tax'
  | 'tax_settlement'
  | 'fx'
  | 'capital'
  | 'drawings'
  | 'retained_earnings'
  | 'opening_balance'
  | 'cost_of_sales'
  | 'expense'
  | 'bank_fees';

export interface BankDetails {
  institution: string;
  accountNumber: string;
  iban: string;
  bic: string;
}

export interface Account {
  id: ID;
  companyId: ID;
  code: string;
  name: string;
  /** Arabic name, shown in the Arabic interface and Arabic reports. */
  nameAr?: string;
  type: AccountType;
  description: string;
  /** Set on the accounts the app posts to automatically. */
  role: AccountRole | null;
  /** Bank, cash and card accounts can hold the details printed on documents. */
  bank: BankDetails | null;
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface JournalLine {
  id: ID;
  accountId: ID;
  description: string;
  debit: number;
  credit: number;
  /** Client or vendor the line relates to (for receivable/payable accounts). */
  contactId: ID | null;
}

/** A manual journal entry in the company currency. */
export interface ManualJournal {
  id: ID;
  companyId: ID;
  number: string;
  date: ISODate;
  reference: string;
  notes: string;
  status: 'draft' | 'posted';
  lines: JournalLine[];
  /** Set on the entry that closes a VAT return (see VatReturn). */
  vatReturnId?: ID | null;
  /**
   * What the entry records when it was made by the app: money moved between
   * two of the company's own accounts, a cheque clearing, or the reversal of
   * a clearing when the cheque came back.
   */
  kind?: 'transfer' | 'cheque_clearing' | 'cheque_return';
  /** Payment the entry belongs to (cheque clearings and their reversals). */
  paymentId?: ID | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ChartTemplateId = 'kw' | 'generic' | 'uk' | 'ae';

export interface AccountingSettings {
  /** Chart of accounts the company started from. */
  template: ChartTemplateId;
  /** Last day of the financial year, e.g. { month: 12, day: 31 }. */
  fiscalYearEnd: { month: number; day: number };
  /** Transactions dated on or before this date can't be added, changed or deleted. */
  lockDate: ISODate | null;
  /** Missing until VAT returns are set up; see vatSettings(). */
  vat?: VatSettings;
}

export type VatFormat = 'uk' | 'ae' | 'generic';

export interface VatSettings {
  registered: boolean;
  /** Which return the boxes follow. */
  format: VatFormat;
  frequency: 'monthly' | 'quarterly';
  /** Month (1–12) a quarter starts in (the UK "stagger"). */
  startMonth: number;
  /** UAE: emirate code (AZ, DU, SH, AJ, UQ, RK, FU) the business is established in. */
  emirate: string | null;
}

/** Where a bank statement line was found in the books. */
export interface BankMatch {
  source: 'payment' | 'expense' | 'journal';
  id: ID;
}

/** A line of an imported bank statement. */
export interface BankTransaction {
  id: ID;
  companyId: ID;
  /** The bank, cash or card account the statement belongs to. */
  accountId: ID;
  date: ISODate;
  description: string;
  reference: string;
  /** Company currency; positive is money in, negative money out. */
  amount: number;
  /** Running balance after the line, when the statement gives it. */
  balance: number | null;
  /** Identifies the line so a statement imported twice adds nothing. */
  fingerprint: string;
  importId: ID;
  /** Order within the import, to keep same-day lines in statement order. */
  position: number;
  match: BankMatch | null;
  /** Left out of the reconciliation on purpose. */
  ignored: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** A filed VAT return: the boxes as filed and the entry that closed it. */
export interface VatReturnRecord {
  id: ID;
  companyId: ID;
  periodStart: ISODate;
  periodEnd: ISODate;
  format: VatFormat;
  /** Minor units of `currency`, as filed. */
  boxes: { id: string; label: string; amount: number; vat?: number }[];
  /** Positive: paid to the tax office; negative: reclaimed. Minor units. */
  net: number;
  currency: string;
  filedOn: ISODate;
  /** Submission receipt or reference from the tax office. */
  reference: string;
  /** Manual journal moving the period's VAT to the VAT liability account. */
  journalId: ID | null;
  /** Manual journal recording the payment (or refund). */
  paymentJournalId: ID | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Legal form of a Kuwaiti business; decides statutory reserve and levies. */
export type LegalForm =
  | 'sole_proprietorship'
  | 'wll'
  | 'spc'
  | 'general_partnership'
  | 'limited_partnership'
  | 'kscc'
  | 'ksc_listed'
  | 'foreign_branch'
  | 'freelance'
  | 'other';

/** Business activity; some activities may not take cash (see lib/kuwait-rules.ts). */
export type BusinessActivity =
  | 'general'
  | 'health'
  | 'salon'
  | 'sports_club'
  | 'pest_control'
  | 'vehicles'
  | 'gold_jewellery'
  | 'real_estate';

/** Kuwaiti registration details. Missing on companies created before; see kuwaitProfile(). */
export interface KuwaitProfile {
  legalForm: LegalForm;
  /** Commercial licence number (رقم الرخصة التجارية). The CR number is registrationNumber. */
  licenceNumber: string;
  activity: BusinessActivity;
  /** Share of the company owned by non-GCC foreign shareholders, 0–100 (15% income tax). */
  foreignOwnershipPercent: number;
  /** Paid-up capital in the company currency (the statutory reserve stops at 50% of it). */
  capital: number;
  /** Public Authority for Manpower company file number. */
  pamFileNumber: string;
  /** PIFSS employer (social security) number. */
  pifssEmployerNumber: string;
  /** Ministry of Finance tax card number. */
  mofTaxCardNumber: string;
  /** Kuwait Chamber of Commerce and Industry membership number. */
  kcciNumber: string;
  /** MOCI digital commerce registration number (online sellers). */
  digitalCommerceNumber: string;
  /** Mobile number registered for WAMD instant payments. */
  wamdPhone: string;
}

/**
 * The bank account printed on documents. `payment.bankDetails` (the text the
 * documents print) is composed from it; see features/company/bank.ts.
 */
export interface CompanyBankAccount {
  /** First four letters of the SWIFT code of a Kuwaiti bank (KUWAIT_BANKS), or '' for another bank. */
  bankCode: string;
  /** Name of a bank that is not in the list. */
  bankName: string;
  accountName: string;
  /** Stored without spaces, upper case. */
  iban: string;
  accountNumber: string;
  swift: string;
  /** Free text printed after the account details. */
  extra: string;
}

/** A public holiday as the company observes it (overrides the official estimates). */
export interface CompanyHoliday {
  date: ISODate;
  name: string;
  nameAr: string;
}

export interface Company {
  id: ID;
  name: string;
  /** Trade name in Arabic, printed on Arabic and bilingual documents. */
  nameAr?: string;
  legalName: string;
  email: string;
  phone: string;
  website: string;
  /** Label for the tax number, e.g. "VAT No.", "TRN", "EIN", "GST No.". */
  taxIdLabel: string;
  taxId: string;
  registrationLabel: string;
  registrationNumber: string;
  address: Address;
  currency: string;
  /**
   * "local" writes Kuwaiti dinars as KD / د.ك (the default in Kuwait),
   * "code" as KWD. Missing means "local".
   */
  currencyDisplay?: 'code' | 'local';
  /** BCP 47 locale used for number and date formatting, e.g. "en-KW". */
  locale: string;
  dateFormat: DateFormat;
  language: DocumentLanguage;
  branding: Branding;
  defaults: DocumentDefaults;
  numbering: Record<NumberedEntity, NumberingRule>;
  payment: PaymentSettings;
  /** Overrides for words printed on documents (see pdf/labels.ts). */
  labels: Record<string, string>;
  emailTemplates: EmailTemplates;
  /** Missing on companies created before accounting existed (see ensureAccounting). */
  accounting?: AccountingSettings;
  kuwait?: KuwaitProfile;
  /**
   * The business charges tax (VAT or sales tax). Missing on companies created
   * before: they charge tax when they have tax rates (see taxesEnabled()).
   */
  taxesEnabled?: boolean;
  /** Bank account printed on documents; missing until set up. */
  bankAccount?: CompanyBankAccount;
  /**
   * Public holidays the company changed. Years without an entry use the
   * official estimates (kuwaitHolidays).
   */
  holidays?: CompanyHoliday[];
  /** Date the opening balances were imported as at, and the entries that hold them. */
  openingBalances?: { date: ISODate; journalIds: ID[] };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ClientContact {
  id: ID;
  name: string;
  email: string;
  phone: string;
  /** Receives documents by email. */
  primary: boolean;
}

export interface Client {
  id: ID;
  companyId: ID;
  number: string;
  name: string;
  /** Name in Arabic, printed on Arabic and bilingual documents. */
  nameAr?: string;
  /** Civil ID of an individual customer or of a cheque drawer. */
  civilId?: string;
  contacts: ClientContact[];
  email: string;
  phone: string;
  website: string;
  taxId: string;
  address: Address;
  shippingAddress: Address | null;
  /** Overrides the company currency for this client's documents. */
  currency: string | null;
  /** Overrides the company payment terms (days). */
  paymentTermsDays: number | null;
  /** Overrides the company document language. */
  language: DocumentLanguage | null;
  /** Taxes are not applied to this client's documents. */
  taxExempt: boolean;
  /** Buys from you (shown under Clients). Missing means true for older records. */
  isCustomer?: boolean;
  /** Sells to you (shown under Vendors). */
  isVendor?: boolean;
  /** Internal notes, never printed. */
  notes: string;
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TaxRate {
  id: ID;
  companyId: ID;
  name: string;
  rate: number;
  /** How it is reported on VAT returns; guessed from the rate when missing. */
  kind?: TaxKind;
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Product {
  id: ID;
  companyId: ID;
  sku: string;
  name: string;
  /** Name in Arabic, copied to document lines. */
  nameAr?: string;
  description: string;
  descriptionAr?: string;
  unitPrice: number;
  unit: string;
  taxRateIds: ID[];
  /** Income account for sales of this item; null uses the company's sales account. */
  incomeAccountId?: ID | null;
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface LineItem {
  id: ID;
  kind: 'item' | 'heading';
  productId: ID | null;
  name: string;
  /** Arabic name of the item, printed on Arabic and bilingual documents. */
  nameAr?: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discount: number;
  discountType: DiscountType;
  /** Snapshot of the taxes at the time they were added. */
  taxes: TaxLine[];
  /** Ledger account override; null uses the product's or the company's default. */
  accountId?: ID | null;
}

export interface Charge {
  id: ID;
  label: string;
  amount: number;
  taxes: TaxLine[];
}

export interface DocumentTotals {
  subtotal: number;
  discount: number;
  taxTotal: number;
  total: number;
  paid: number;
  balance: number;
}

export interface InvoiceDocument {
  id: ID;
  companyId: ID;
  type: DocumentType;
  number: string;
  status: DocumentStatus;
  clientId: ID;
  issueDate: ISODate;
  /** Due date for invoices, "valid until" for quotes. */
  dueDate: ISODate | null;
  poNumber: string;
  /** Bills: the supplier's own invoice number. */
  vendorReference?: string;
  currency: string;
  /** Company-currency value of 1 unit of `currency` (1 when they are the same). */
  exchangeRate?: number;
  items: LineItem[];
  discount: number;
  discountType: DiscountType;
  /** Document-level taxes applied to all items. */
  taxes: TaxLine[];
  charges: Charge[];
  pricesIncludeTax: boolean;
  /** Deposit / partial payment requested up front (0 = none). */
  deposit: number;
  depositDueDate: ISODate | null;
  notes: string;
  terms: string;
  footer: string;
  /** Internal notes, never printed. */
  privateNotes: string;
  /** Template override; null uses the company default. */
  templateId: string | null;
  /** Cached result of the calculation; recomputed on every save. */
  totals: DocumentTotals;
  sentAt: Timestamp | null;
  paidAt: Timestamp | null;
  /** Quote this invoice was created from, or invoice a credit note refers to. */
  sourceId: ID | null;
  /** Invoice created from this quote. */
  convertedToId: ID | null;
  /** Recurring profile that generated this invoice. */
  recurringId: ID | null;
  /** Online payment link for this document (overrides the company's link). */
  paymentLink?: PaymentLink | null;
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Payment providers that issue payment links in Kuwait. */
export type PaymentLinkProvider =
  'myfatoorah' | 'tap' | 'upayments' | 'hesabe' | 'ottu' | 'bank' | 'other';

export interface PaymentLink {
  provider: PaymentLinkProvider;
  url: string;
  /** Links from some providers stop working after a while. */
  expiresAt: ISODate | null;
}

/**
 * How money was paid. KNET (local debit cards), WAMD (instant transfer to a
 * mobile number), payment links, buy-now-pay-later and cash on delivery are
 * the everyday methods in Kuwait. PayPal, Stripe and mobile money are kept
 * for older records only.
 */
export type PaymentMethod =
  | 'bank_transfer'
  | 'knet'
  | 'wamd'
  | 'card'
  | 'cash'
  | 'cheque'
  | 'link'
  | 'bnpl'
  | 'cod'
  | 'paypal'
  | 'stripe'
  | 'mobile_money'
  | 'credit_note'
  | 'other';

/** Who collected a link or buy-now-pay-later payment. */
export type PaymentProvider = PaymentLinkProvider | 'taly' | 'deema' | 'tabby';

/**
 * Where a cheque is: in hand (or issued and not yet presented), deposited at
 * the bank, cleared, returned unpaid, or cancelled before it was presented.
 */
export type ChequeStatus = 'held' | 'deposited' | 'cleared' | 'returned' | 'cancelled';

/** A cheque received from a customer or issued to a vendor. */
export interface ChequeDetails {
  number: string;
  /** Bank code from KUWAIT_BANKS (e.g. "NBOK") or the bank's name. */
  bank: string;
  /** Date written on the cheque; a post-dated cheque has a later date than the payment. */
  date: ISODate;
  /** Who signed the cheque (received) or who it is payable to (issued). */
  drawer: string;
  drawerCivilId?: string;
  status: ChequeStatus;
  depositedOn?: ISODate | null;
  clearedOn?: ISODate | null;
  /** Bank account the cheque cleared into (received) or was paid from (issued). */
  bankAccountId?: ID | null;
  returnedOn?: ISODate | null;
  returnReason?: string;
  /** Journal moving the cheque from the post-dated cheques account to the bank. */
  clearingJournalId?: ID | null;
  /** Journal reversing the clearing when a cleared cheque came back. */
  reversalJournalId?: ID | null;
  /** Expense recording the bank's charge for a returned cheque. */
  returnChargeExpenseId?: ID | null;
  /** Payment recorded with the cheque that replaced this one. */
  replacedById?: ID | null;
  /** Payment whose cheque this one replaces. */
  replacesId?: ID | null;
}

export interface PaymentAllocation {
  documentId: ID;
  amount: number;
}

export interface Payment {
  id: ID;
  companyId: ID;
  /** Received from a client (default) or paid to a vendor. */
  direction?: 'in' | 'out';
  /** The client or vendor. */
  clientId: ID;
  number: string;
  date: ISODate;
  amount: number;
  currency: string;
  /** Company-currency value of 1 unit of `currency` (1 when they are the same). */
  exchangeRate?: number;
  /** Bank, cash or card account the money went into (or came out of); null picks one from the method. */
  accountId?: ID | null;
  method: PaymentMethod;
  /** Transaction / cheque reference. */
  reference: string;
  notes: string;
  allocations: PaymentAllocation[];
  /** Index helper: ids of the documents in `allocations`. */
  documentIds: ID[];
  /** Credit note consumed by this payment (method "credit_note"). */
  creditId: ID | null;
  /** Payment link or buy-now-pay-later provider. */
  provider?: PaymentProvider | null;
  /**
   * Fee kept by KNET, the card acquirer, the link or the buy-now-pay-later
   * provider, in the payment currency. Posted as an expense against the
   * account the payment went into.
   */
  fee?: number;
  /** Expense account for the fee (6180 KNET and card fees). */
  feeAccountId?: ID | null;
  cheque?: ChequeDetails | null;
  /**
   * A void payment stays on record (a returned or cancelled cheque) but no
   * longer counts: it leaves the books and the balances of its documents.
   */
  voided?: boolean;
  voidReason?: string;
  voidedOn?: ISODate | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Status of a cheque held as a guarantee (never on the ledger). */
export type SecurityChequeStatus = 'held' | 'returned' | 'cashed';

/**
 * A security (guarantee) cheque, e.g. a tenant's rent deposit cheque. It is
 * kept in a memo register only; cashing it records a real payment.
 */
export interface SecurityCheque {
  id: ID;
  companyId: ID;
  /** Received from someone (default) or given to someone. */
  direction: 'in' | 'out';
  /** The client or vendor, when known. */
  clientId: ID | null;
  number: string;
  /** Bank code from KUWAIT_BANKS or the bank's name. */
  bank: string;
  /** Security cheques are often left undated. */
  date: ISODate | null;
  amount: number;
  currency: string;
  /** Who signed it (received) or who holds it (given). */
  drawer: string;
  drawerCivilId?: string;
  /** What it guarantees, e.g. "Rent deposit, flat 12". */
  purpose: string;
  notes: string;
  status: SecurityChequeStatus;
  returnedOn: ISODate | null;
  cashedOn: ISODate | null;
  /** Payment recorded when the cheque was cashed. */
  paymentId: ID | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type Frequency =
  'weekly' | 'biweekly' | 'monthly' | 'bimonthly' | 'quarterly' | 'semiannually' | 'yearly';

export type RecurringStatus = 'active' | 'paused' | 'completed';

export type RecurringTemplate = Pick<
  InvoiceDocument,
  | 'currency'
  | 'items'
  | 'discount'
  | 'discountType'
  | 'taxes'
  | 'charges'
  | 'pricesIncludeTax'
  | 'poNumber'
  | 'notes'
  | 'terms'
  | 'footer'
  | 'privateNotes'
  | 'templateId'
>;

export interface RecurringProfile {
  id: ID;
  companyId: ID;
  clientId: ID;
  /** Internal name, e.g. "Monthly mailing retainer". */
  name: string;
  frequency: Frequency;
  startDate: ISODate;
  /** Next date an invoice will be issued; null when completed. */
  nextIssueDate: ISODate | null;
  /** Number of invoices left to issue; null means no limit. */
  remainingCycles: number | null;
  /** Days between issue date and due date of generated invoices. */
  dueDays: number;
  /** Generated invoices are marked as sent instead of draft. */
  markSent: boolean;
  status: RecurringStatus;
  template: RecurringTemplate;
  issuedCount: number;
  lastIssuedAt: Timestamp | null;
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ActivityEntity =
  | 'invoice'
  | 'quote'
  | 'credit'
  | 'bill'
  | 'vendor_credit'
  | 'expense'
  | 'payment'
  | 'client'
  | 'product'
  | 'recurring'
  | 'company'
  | 'account'
  | 'journal'
  | 'vat_return'
  | 'bank'
  | 'employee'
  | 'compliance'
  | 'cheque';

export interface Activity {
  id: ID;
  companyId: ID;
  at: Timestamp;
  entity: ActivityEntity;
  entityId: ID;
  /** Document or client the event relates to, for timelines. */
  clientId: ID | null;
  documentId: ID | null;
  action: string;
  /** The message in English as it was logged. */
  message: string;
  /** Translation key and values, to show the message in the reader's language. */
  messageKey?: string;
  messageVars?: Record<string, string | number>;
}

/** Money spent without a bill: fuel, a train ticket, a software subscription. */
export interface Expense {
  id: ID;
  companyId: ID;
  number: string;
  date: ISODate;
  /** Who was paid, when known. */
  vendorId: ID | null;
  /** Expense category (an expense or asset account). */
  accountId: ID;
  description: string;
  /** Amount paid, including tax. */
  amount: number;
  /** Tax included in the amount (one rate in practice). */
  taxes: TaxLine[];
  currency: string;
  exchangeRate?: number;
  /** Bank, cash, card or owner account the money came from; null uses the bank. */
  paidFromAccountId: ID | null;
  reference: string;
  notes: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** A file kept with a record, e.g. a receipt photo. Stored as a data URL so backups stay JSON. */
export interface Attachment {
  id: ID;
  companyId: ID;
  /** Record the file belongs to (bill, expense…); the only link to it. */
  ownerId: ID;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  createdAt: Timestamp;
}

export interface KeyValue {
  key: string;
  value: unknown;
}

/* -------------------------------------------------------------------------- */
/* People and compliance                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Kuwaitis and GCC nationals are insured with PIFSS and need no residency;
 * expatriates need an Article 18 residency and a PAM work permit; domestic
 * workers (Article 20) are outside Labour Law 6/2010.
 */
export type EmployeeCategory = 'kuwaiti' | 'gcc' | 'expat' | 'domestic';

export type EmployeeStatus = 'active' | 'on_leave' | 'left';

export type ContractType = 'unlimited' | 'fixed';

/** How the wage is paid; decides the end-of-service rates (Labour Law art. 51). */
export type PayBasis = 'monthly' | 'daily' | 'hourly' | 'piece';

export type LeavingReason =
  'resignation' | 'termination' | 'contract_end' | 'retirement' | 'dismissal' | 'death' | 'other';

export interface EmployeeAllowance {
  id: ID;
  name: string;
  nameAr?: string;
  /** Monthly amount in the company currency. */
  amount: number;
  /** Part of the wage the end-of-service indemnity is calculated on. */
  countsForEos: boolean;
}

/**
 * A person on the payroll and their personnel file (Labour Law art. 80). The
 * identity documents (Civil ID, passport, residency, work permit) and the
 * contract end date live here only; the documents register shows them
 * without copying them (see lib/compliance.ts, employeeDocuments).
 */
export interface Employee {
  id: ID;
  companyId: ID;
  number: string;
  name: string;
  nameAr?: string;
  /** ISO 3166-1 alpha-2 code. */
  nationality: string;
  category: EmployeeCategory;
  civilId: string;
  civilIdExpiry: ISODate | null;
  passportNumber: string;
  passportExpiry: ISODate | null;
  /** Residency article ("18" private sector, "20" domestic worker…); not for Kuwaitis. */
  residencyArticle: string;
  residencyNumber: string;
  residencyExpiry: ISODate | null;
  workPermitNumber: string;
  /** Job title registered with the Public Authority for Manpower. */
  pamJobTitle: string;
  /** Salary on the work permit (company currency). */
  permitSalary: number;
  workPermitExpiry: ISODate | null;
  jobTitle: string;
  jobTitleAr?: string;
  department: string;
  hireDate: ISODate | null;
  probationEnd: ISODate | null;
  contractType: ContractType;
  /** Fixed-term contracts only. */
  contractEnd: ISODate | null;
  payBasis: PayBasis;
  /** Monthly basic salary (company currency, 3 decimals in KWD). */
  basicSalary: number;
  allowances: EmployeeAllowance[];
  /** First four letters of the bank's SWIFT code (see KUWAIT_BANKS) or a bank name. */
  bank: string;
  iban: string;
  /** PIFSS (social security) number of Kuwaiti and GCC staff. */
  pifssNumber: string;
  phone: string;
  email: string;
  status: EmployeeStatus;
  leavingDate: ISODate | null;
  leavingReason: LeavingReason | null;
  notes: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Kinds of documents with an expiry date that the register tracks. */
export type ComplianceDocumentType =
  // Company
  | 'commercial_licence'
  | 'commercial_registration'
  | 'pam_company_file'
  | 'authorised_signatories'
  | 'pam_salary_certificate'
  | 'mof_tax_card'
  | 'tax_clearance'
  | 'kcci_membership'
  | 'municipality_licence'
  | 'fire_licence'
  | 'lease_contract'
  // Employees (the first five are read from the employee record)
  | 'civil_id'
  | 'passport'
  | 'residency'
  | 'work_permit'
  | 'employment_contract'
  | 'health_insurance'
  | 'driving_licence'
  // Vehicles
  | 'vehicle_registration'
  | 'vehicle_insurance'
  | 'other';

export type DocumentOwnerType = 'company' | 'employee' | 'vehicle' | 'other';

/** A document kept in the register (company licences, vehicles, extra employee papers). */
export interface ComplianceDocument {
  id: ID;
  companyId: ID;
  type: ComplianceDocumentType;
  /** Free title; the type's name is shown when empty. */
  title: string;
  number: string;
  issuer: string;
  issueDate: ISODate | null;
  expiryDate: ISODate | null;
  /** Expected cost of the next renewal (company currency). */
  renewalCost: number;
  /** Days before expiry to remind, largest first; null uses the company setting. */
  reminderDays: number[] | null;
  ownerType: DocumentOwnerType;
  employeeId: ID | null;
  /** Vehicle (plate or model) or other owner's name. */
  ownerName: string;
  notes: string;
  /** No longer tracked (vehicle sold, licence cancelled); kept with its history. */
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** One renewal of a document: the old and new expiry and the fee paid, if any. */
export interface DocumentRenewal {
  id: ID;
  companyId: ID;
  /** "doc:<id>" for register records, "emp:<employeeId>:<type>" for employee documents. */
  documentKey: string;
  documentId: ID | null;
  employeeId: ID | null;
  type: ComplianceDocumentType;
  renewedOn: ISODate;
  previousExpiry: ISODate | null;
  newExpiry: ISODate;
  /** Fee paid (company currency), 0 when none. */
  fee: number;
  /** Expense recording the fee. */
  expenseId: ID | null;
  note: string;
  createdAt: Timestamp;
}

/** A statutory deadline marked as done, e.g. "income_tax_return:2026-12-31". */
export interface ComplianceMark {
  id: ID;
  companyId: ID;
  key: string;
  doneOn: ISODate;
  note: string;
  createdAt: Timestamp;
}

/** Employee and compliance settings of a company (one row per company, id = companyId). */
export interface PeopleSettings {
  id: ID;
  companyId: ID;
  /** Kuwaiti share of the workforce to aim for, in percent; null when not set. */
  kuwaitizationTarget: number | null;
  /** Working days in a month used for the daily wage (end of service). */
  eosDailyDivisor: number;
  /** Days before an expiry to remind, largest first (60/30/7). */
  reminderDays: number[];
  /** Months after the year end to file the audited statements with MOCI. */
  auditFilingMonths: number;
  /** Day of the following month PIFSS contributions are paid by. */
  pifssDueDay: number;
  updatedAt: Timestamp;
}
