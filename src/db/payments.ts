import { db } from './db';
import { defaultNumbering, nowStamp } from './defaults';
import { logActivity } from './activity';
import { recalculateDocuments } from './documents';
import type { ID, Payment, PaymentAllocation, PaymentMethod } from './types';
import { allocateNumber } from '@/lib/numbering';
import { formatMoney } from '@/lib/format';
import { dec, round, currencyPrecision } from '@/lib/money';
import { newId } from '@/lib/ids';
import { today } from '@/lib/dates';
import { assertUnlocked } from './accounting';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'stripe', label: 'Stripe' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'credit_note', label: 'Credit note' },
  { value: 'other', label: 'Other' },
];

export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

export function createPayment(companyId: ID, overrides: Partial<Payment> = {}): Payment {
  const stamp = nowStamp();
  return {
    id: newId(),
    companyId,
    clientId: '',
    number: '',
    date: today(),
    amount: 0,
    currency: 'KWD',
    method: 'bank_transfer',
    reference: '',
    notes: '',
    allocations: [],
    documentIds: [],
    creditId: null,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

/** Merges allocations per document and drops empty ones. */
export function normalizeAllocations(
  allocations: PaymentAllocation[],
  precision = 2,
): PaymentAllocation[] {
  const byDoc = new Map<string, number>();
  for (const a of allocations) {
    if (!a.documentId) continue;
    byDoc.set(
      a.documentId,
      dec(byDoc.get(a.documentId) ?? 0)
        .plus(dec(a.amount))
        .toNumber(),
    );
  }
  return [...byDoc.entries()]
    .map(([documentId, amount]) => ({ documentId, amount: round(amount, precision) }))
    .filter((a) => a.amount !== 0);
}

export function unappliedAmount(payment: Pick<Payment, 'amount' | 'allocations'>): number {
  return payment.allocations
    .reduce((rest, a) => rest.minus(dec(a.amount)), dec(payment.amount))
    .toNumber();
}

export class AllocationError extends Error {}

export async function savePayment(input: Payment): Promise<Payment> {
  return db.transaction(
    'rw',
    [db.payments, db.documents, db.clients, db.companies, db.activities],
    async () => {
      const company = await db.companies.get(input.companyId);
      if (!company) throw new Error('Company not found');
      const existing = await db.payments.get(input.id);
      assertUnlocked(company, input.date, existing?.date);
      const precision = currencyPrecision(input.currency);
      const allocations = normalizeAllocations(input.allocations, precision);
      const amount = round(input.amount, precision);
      const allocated = allocations.reduce((s, a) => s + a.amount, 0);
      if (amount >= 0 && round(allocated, precision) > amount) {
        throw new AllocationError(
          `The amounts applied to ${input.direction === 'out' ? 'bills' : 'invoices'} are larger than the payment.`,
        );
      }
      let payment: Payment = {
        ...input,
        amount,
        allocations,
        documentIds: allocations.map((a) => a.documentId),
        updatedAt: nowStamp(),
      };
      if (!payment.number.trim()) {
        const taken = new Set(
          (await db.payments.where('companyId').equals(company.id).toArray()).map((p) =>
            p.number.toLowerCase(),
          ),
        );
        // Payments made have their own series, like bills.
        const key = payment.direction === 'out' ? 'payment_made' : 'payment';
        const rule = company.numbering[key] ?? defaultNumbering()[key];
        const allocatedNumber = allocateNumber(rule, payment.date, (n) =>
          taken.has(n.toLowerCase()),
        );
        payment = { ...payment, number: allocatedNumber.number };
        await db.companies.put({
          ...company,
          numbering: { ...company.numbering, [key]: allocatedNumber.rule },
        });
      }
      if (!existing) payment.createdAt = payment.updatedAt;
      await db.payments.put(payment);

      await recalculateDocuments([
        ...(existing?.documentIds ?? []),
        ...payment.documentIds,
        ...(existing?.creditId ? [existing.creditId] : []),
        ...(payment.creditId ? [payment.creditId] : []),
      ]);

      const docs = await db.documents.bulkGet(payment.documentIds);
      const numbers = docs.filter(Boolean).map((d) => d!.number);
      const money = formatMoney(payment.amount, payment.currency, company.locale);
      await logActivity(
        company.id,
        'payment',
        payment.id,
        existing ? 'updated' : 'created',
        `Payment ${payment.number} of ${money} ${existing ? 'updated' : 'recorded'}${numbers.length ? ` for ${numbers.join(', ')}` : ''}`,
        { clientId: payment.clientId || null, documentId: payment.documentIds[0] ?? null },
      );
      return payment;
    },
  );
}

export async function deletePayment(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.payments, db.documents, db.clients, db.companies, db.activities],
    async () => {
      const payment = await db.payments.get(id);
      if (!payment) return;
      const company = await db.companies.get(payment.companyId);
      if (company) assertUnlocked(company, payment.date);
      await db.payments.delete(id);
      await recalculateDocuments([
        ...payment.documentIds,
        ...(payment.creditId ? [payment.creditId] : []),
      ]);
      await logActivity(
        payment.companyId,
        'payment',
        payment.id,
        'deleted',
        `Payment ${payment.number} deleted`,
        {
          clientId: payment.clientId || null,
        },
      );
    },
  );
}
