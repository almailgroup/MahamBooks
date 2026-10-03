import type {
  Client,
  Company,
  EmailTemplates,
  InvoiceDocument,
  NumberingRule,
  NumberedEntity,
  Product,
  RecurringProfile,
  TaxRate,
  DocumentType,
} from './types';
import { emptyAddress } from '@/lib/geo';
import { newId } from '@/lib/ids';
import { today } from '@/lib/dates';

export const nowStamp = () => new Date().toISOString();

const rule = (pattern: string, padding = 4): NumberingRule => ({
  pattern,
  next: 1,
  padding,
  reset: 'never',
  period: '',
});

export function defaultNumbering(): Record<NumberedEntity, NumberingRule> {
  return {
    invoice: rule('INV-{year}-{counter}'),
    quote: rule('QUO-{year}-{counter}'),
    credit: rule('CN-{year}-{counter}'),
    payment: rule('PAY-{counter}'),
    payment_made: rule('PM-{counter}'),
    client: rule('C-{counter}'),
    journal: rule('JE-{year}-{counter}'),
    bill: rule('BILL-{year}-{counter}'),
    vendor_credit: rule('VC-{year}-{counter}'),
    expense: rule('EXP-{year}-{counter}'),
  };
}

export const EMAIL_PLACEHOLDERS = [
  '{client}',
  '{contact}',
  '{number}',
  '{amount}',
  '{balance}',
  '{issueDate}',
  '{dueDate}',
  '{company}',
  '{paymentLink}',
] as const;

export function defaultEmailTemplates(): EmailTemplates {
  return {
    invoice: {
      subject: 'Invoice {number} from {company}',
      body:
        'Hello {contact},\n\nPlease find attached invoice {number} for {amount}, due on {dueDate}.\n\n' +
        '{paymentLink}\n\nThank you for your business.\n\nKind regards,\n{company}',
    },
    quote: {
      subject: 'Quote {number} from {company}',
      body:
        'Hello {contact},\n\nPlease find attached quote {number} for {amount}, valid until {dueDate}.\n\n' +
        'Let us know if you have any questions.\n\nKind regards,\n{company}',
    },
    credit: {
      subject: 'Credit note {number} from {company}',
      body:
        'Hello {contact},\n\nPlease find attached credit note {number} for {amount}.\n\n' +
        'Kind regards,\n{company}',
    },
    reminder: {
      subject: 'Reminder: invoice {number} is due',
      body:
        'Hello {contact},\n\nThis is a friendly reminder that invoice {number} has a balance of ' +
        '{balance}, due on {dueDate}.\n\n{paymentLink}\n\nIf you have already paid, please ignore ' +
        'this message.\n\nKind regards,\n{company}',
    },
    payment: {
      subject: 'Payment received — thank you',
      body:
        'Hello {contact},\n\nWe have received your payment of {amount}. Thank you!\n\n' +
        'Kind regards,\n{company}',
    },
  };
}

export function createCompany(overrides: Partial<Company> = {}): Company {
  const stamp = nowStamp();
  const locale = overrides.locale ?? 'en-KW';
  const usLetter = /-(US|CA)$/.test(locale);
  return {
    id: newId(),
    name: '',
    legalName: '',
    email: '',
    phone: '',
    website: '',
    taxIdLabel: 'Tax card no.',
    taxId: '',
    registrationLabel: 'CR No.',
    registrationNumber: '',
    address: emptyAddress('KW'),
    currency: 'KWD',
    locale,
    dateFormat: 'dd/MM/yyyy',
    language: 'en',
    branding: {
      accentColor: '#4f46e5',
      templateId: 'modern',
      logo: null,
      fontId: null,
      showStatusStamp: true,
    },
    defaults: {
      paymentTermsDays: 30,
      quoteValidDays: 30,
      invoiceNotes: 'Thank you for your business.',
      invoiceTerms: '',
      quoteNotes: 'We look forward to working with you.',
      quoteTerms: '',
      creditNotes: '',
      creditTerms: '',
      footer: '',
      pricesIncludeTax: false,
      lineTaxes: true,
      documentTaxes: false,
      defaultTaxRateIds: [],
      pageSize: usLetter ? 'LETTER' : 'A4',
    },
    numbering: defaultNumbering(),
    payment: { bankDetails: '', instructions: '', paymentLink: '', showQrCode: true },
    labels: {},
    emailTemplates: defaultEmailTemplates(),
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

export function createClient(companyId: string, overrides: Partial<Client> = {}): Client {
  const stamp = nowStamp();
  return {
    id: newId(),
    companyId,
    number: '',
    name: '',
    contacts: [],
    email: '',
    phone: '',
    website: '',
    taxId: '',
    address: emptyAddress(),
    shippingAddress: null,
    currency: null,
    paymentTermsDays: null,
    language: null,
    taxExempt: false,
    notes: '',
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

export function createProduct(companyId: string, overrides: Partial<Product> = {}): Product {
  const stamp = nowStamp();
  return {
    id: newId(),
    companyId,
    sku: '',
    name: '',
    description: '',
    unitPrice: 0,
    unit: '',
    taxRateIds: [],
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

export function createTaxRate(companyId: string, overrides: Partial<TaxRate> = {}): TaxRate {
  const stamp = nowStamp();
  return {
    id: newId(),
    companyId,
    name: '',
    rate: 0,
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

export function emptyTotals(): InvoiceDocument['totals'] {
  return { subtotal: 0, discount: 0, taxTotal: 0, total: 0, paid: 0, balance: 0 };
}

export function createDocument(
  companyId: string,
  type: DocumentType,
  overrides: Partial<InvoiceDocument> = {},
): InvoiceDocument {
  const stamp = nowStamp();
  return {
    id: newId(),
    companyId,
    type,
    number: '',
    status: 'draft',
    clientId: '',
    issueDate: today(),
    dueDate: null,
    poNumber: '',
    currency: 'KWD',
    items: [],
    discount: 0,
    discountType: 'percent',
    taxes: [],
    charges: [],
    pricesIncludeTax: false,
    deposit: 0,
    depositDueDate: null,
    notes: '',
    terms: '',
    footer: '',
    privateNotes: '',
    templateId: null,
    totals: emptyTotals(),
    sentAt: null,
    paidAt: null,
    sourceId: null,
    convertedToId: null,
    recurringId: null,
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

export function createRecurring(
  companyId: string,
  overrides: Partial<RecurringProfile> = {},
): RecurringProfile {
  const stamp = nowStamp();
  const start = today();
  return {
    id: newId(),
    companyId,
    clientId: '',
    name: '',
    frequency: 'monthly',
    startDate: start,
    nextIssueDate: start,
    remainingCycles: null,
    dueDays: 30,
    markSent: false,
    status: 'active',
    template: {
      currency: 'KWD',
      items: [],
      discount: 0,
      discountType: 'percent',
      taxes: [],
      charges: [],
      pricesIncludeTax: false,
      poNumber: '',
      notes: '',
      terms: '',
      footer: '',
      privateNotes: '',
      templateId: null,
    },
    issuedCount: 0,
    lastIssuedAt: null,
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}
