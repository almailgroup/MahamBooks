import type { ChequeDetails, InvoiceDocument, Payment } from '@/db/types';
import { retentionOf } from '@/lib/calc';

/** Hand-made documents and payments for statement tests (no database). */
const stamp = '2026-01-01T00:00:00.000Z';

export function doc(
  type: InvoiceDocument['type'],
  number: string,
  issueDate: string,
  total: number,
  extra: Partial<InvoiceDocument> = {},
): InvoiceDocument {
  const retention = extra.totals?.retention;
  return {
    id: number,
    companyId: 'c',
    type,
    number,
    status: 'sent',
    clientId: 'client',
    issueDate,
    dueDate: null,
    poNumber: '',
    currency: 'KWD',
    items: [
      {
        id: `${number}-1`,
        kind: 'item',
        productId: null,
        name: 'Works',
        description: '',
        quantity: 1,
        unit: '',
        unitPrice: total,
        discount: 0,
        discountType: 'percent',
        taxes: [],
      },
    ],
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
    totals: {
      subtotal: total,
      discount: 0,
      taxTotal: 0,
      total,
      paid: 0,
      balance: total,
      retention,
    },
    sentAt: stamp,
    paidAt: null,
    sourceId: null,
    convertedToId: null,
    recurringId: null,
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  };
}

export function payment(
  number: string,
  date: string,
  amount: number,
  allocations: { documentId: string; amount: number }[],
  extra: Partial<Payment> = {},
): Payment {
  return {
    id: number,
    companyId: 'c',
    direction: 'in',
    clientId: 'client',
    number,
    date,
    amount,
    currency: 'KWD',
    method: 'bank_transfer',
    reference: '',
    notes: '',
    allocations,
    documentIds: allocations.map((a) => a.documentId),
    creditId: null,
    createdAt: `${date}T08:00:00.000Z`,
    updatedAt: stamp,
    ...extra,
  };
}

export const cheque = (
  number: string,
  date: string,
  extra: Partial<ChequeDetails> = {},
): ChequeDetails => ({
  number,
  bank: 'NBOK',
  date,
  drawer: 'Gulf Contracting',
  status: 'held',
  ...extra,
});

/**
 * An opening balance, an invoice with a 5% retention and a partial payment
 * in July; an invoice, a credit note, a cheque that came back and its
 * replacement (a post-dated cheque still in hand) in August.
 */
export function history() {
  const opening = doc('invoice', 'OB-1', '2026-06-15', 200, { dueDate: '2026-07-15' });
  opening.items[0] = { ...opening.items[0], name: 'Opening balance', nameAr: 'رصيد افتتاحي' };
  const first = doc('invoice', 'INV-1', '2026-07-01', 1234.567, {
    dueDate: '2026-07-31',
    poNumber: 'PO-77',
    retentionPercent: 5,
    totals: {
      subtotal: 1234.567,
      discount: 0,
      taxTotal: 0,
      total: 1234.567,
      paid: 500,
      balance: 672.839,
      retention: retentionOf(1234.567, 5, 3),
    },
  });
  const second = doc('invoice', 'INV-2', '2026-08-05', 300, { dueDate: '2026-09-04' });
  const credit = doc('credit', 'CN-1', '2026-08-10', 50);
  const drafts = [
    doc('invoice', 'INV-3', '2026-08-06', 999, { status: 'draft' }),
    doc('invoice', 'INV-4', '2026-08-07', 999, { status: 'void' }),
    doc('quote', 'QT-1', '2026-08-07', 999),
  ];
  const payments = [
    payment('PAY-1', '2026-07-20', 500, [{ documentId: 'INV-1', amount: 500 }]),
    payment('CN-USE', '2026-08-10', 50, [{ documentId: 'INV-2', amount: 50 }], {
      method: 'credit_note',
      creditId: 'CN-1',
    }),
    payment('PAY-2', '2026-08-12', 250, [{ documentId: 'INV-2', amount: 250 }], {
      method: 'cheque',
      cheque: cheque('000777', '2026-08-12', { status: 'returned', returnedOn: '2026-08-25' }),
      voided: true,
      voidedOn: '2026-08-25',
      voidReason: 'Insufficient funds',
    }),
    payment('PAY-3', '2026-08-26', 250, [{ documentId: 'INV-2', amount: 250 }], {
      method: 'cheque',
      cheque: cheque('000778', '2026-09-30'),
    }),
    // A refund paid out is not part of the customer's account.
    payment('PAY-OUT', '2026-08-28', 10, [], { direction: 'out' }),
  ];
  return { documents: [opening, first, second, credit, ...drafts], payments };
}
