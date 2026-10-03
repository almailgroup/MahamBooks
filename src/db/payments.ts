import { db } from './db';
import { defaultNumbering, nowStamp } from './defaults';
import { logActivity } from './activity';
import { recalculateDocuments } from './documents';
import { accountingSettings } from './chart-setup';
import { assertUnlocked, createAccount } from './accounting';
import type {
  Account,
  ChequeDetails,
  Company,
  ID,
  Payment,
  PaymentAllocation,
  PaymentLink,
  PaymentMethod,
} from './types';
import { allocateNumber } from '@/lib/numbering';
import { formatMoney } from '@/lib/format';
import { dec, round, currencyPrecision, toMinor } from '@/lib/money';
import { newId } from '@/lib/ids';
import { today } from '@/lib/dates';
import { isValidCivilId } from '@/lib/kuwait';
import {
  defaultDestination,
  findPaymentAccount,
  freeAccountCode,
  methodInfo,
  PAYMENT_ACCOUNTS,
  providersFor,
  takesFee,
  type PaymentAccountKey,
} from '@/lib/payment-methods';
import { isValidPaymentLink } from '@/lib/whatsapp';
import { msg, t } from '@/i18n';

export { PAYMENT_METHODS } from '@/lib/payment-methods';

/** The method's name in the interface language. */
export function paymentMethodLabel(method: PaymentMethod): string {
  return t(methodInfo(method).label);
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

/** Empty cheque details for a new cheque payment. */
export function newCheque(overrides: Partial<ChequeDetails> = {}): ChequeDetails {
  return {
    number: '',
    bank: '',
    date: today(),
    drawer: '',
    status: 'held',
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

/** Payments that count: everything except void ones (returned or cancelled cheques). */
export function isActivePayment(payment: Pick<Payment, 'voided'>): boolean {
  return !payment.voided;
}

/**
 * A cheque that has cleared, come back or been cancelled has entries of its
 * own; the payment's amount, currency, method and account can't change any
 * more.
 */
export function isChequeSettled(payment: Pick<Payment, 'cheque'>): boolean {
  const status = payment.cheque?.status;
  return status === 'cleared' || status === 'returned' || status === 'cancelled';
}

/** Whether the payment can still be edited in the form. */
export function canEditPayment(payment: Pick<Payment, 'voided'>): boolean {
  return !payment.voided;
}

/** Whether the payment can be deleted (void payments and cleared cheques stay on record). */
export function canDeletePayment(payment: Pick<Payment, 'voided' | 'cheque'>): boolean {
  return !payment.voided && !isChequeSettled(payment);
}

export class PaymentError extends Error {}
export class AllocationError extends PaymentError {}

/** Lifecycle fields of a cheque; set by the cheque register, never by the payment form. */
const CHEQUE_LIFECYCLE = [
  'status',
  'depositedOn',
  'clearedOn',
  'bankAccountId',
  'returnedOn',
  'returnReason',
  'clearingJournalId',
  'reversalJournalId',
  'returnChargeExpenseId',
  'replacedById',
  'replacesId',
] as const satisfies readonly (keyof ChequeDetails)[];

function lifecycleOf(cheque: ChequeDetails): Partial<ChequeDetails> {
  const out: Partial<ChequeDetails> = {};
  for (const key of CHEQUE_LIFECYCLE) {
    if (cheque[key] !== undefined) (out as Record<string, unknown>)[key] = cheque[key];
  }
  return out;
}

/** Same bank, whether written as a code ("NBOK") or a name. */
function sameBank(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * One of the accounts payments post to (1020, 1150, 2150, 6180). Companies
 * that started from another chart get it created, with a free code.
 * Must run inside a transaction that can write accounts and activities.
 */
export async function ensurePaymentAccount(
  company: Company,
  key: PaymentAccountKey,
  accounts?: Account[],
): Promise<Account> {
  const list = accounts ?? (await db.accounts.where('companyId').equals(company.id).toArray());
  const found = findPaymentAccount(list, key, accountingSettings(company).template);
  if (found) return found;
  const spec = PAYMENT_ACCOUNTS[key];
  const account = createAccount(company.id, {
    code: freeAccountCode(list, spec.code),
    name: spec.name,
    nameAr: spec.nameAr,
    type: spec.type,
  });
  await db.accounts.add(account);
  list.push(account);
  await logActivity(company.id, 'account', account.id, 'created', {
    text: msg('Account {code} {name} created'),
    vars: { code: account.code, name: account.name },
  });
  return account;
}

async function checkCheque(
  input: Payment,
  existing: Payment | undefined,
): Promise<ChequeDetails | null> {
  if (input.method !== 'cheque') return null;
  const cheque = input.cheque;
  if (!cheque) {
    // Cheque payments recorded before cheques were tracked keep posting to the bank.
    if (existing?.method === 'cheque' && !existing.cheque) return null;
    throw new PaymentError(t('Enter the cheque number.'));
  }
  const number = cheque.number.trim();
  if (!number) throw new PaymentError(t('Enter the cheque number.'));
  const civilId = (cheque.drawerCivilId ?? '').replace(/\s/g, '');
  if (civilId && !isValidCivilId(civilId)) {
    throw new PaymentError(t('Check the Civil ID number: it has 12 digits.'));
  }
  const out = input.direction === 'out';
  const duplicate = await db.payments
    .where('companyId')
    .equals(input.companyId)
    .filter(
      (p) =>
        p.id !== input.id &&
        !p.voided &&
        p.method === 'cheque' &&
        Boolean(p.cheque) &&
        (p.direction === 'out') === out &&
        (out || p.clientId === input.clientId) &&
        p.cheque!.number.trim() === number &&
        sameBank(p.cheque!.bank, cheque.bank),
    )
    .first();
  if (duplicate) {
    throw new PaymentError(
      t('Cheque {number} is already recorded on payment {payment}.', {
        number,
        payment: duplicate.number,
      }),
    );
  }
  const details: ChequeDetails = {
    ...cheque,
    number,
    bank: cheque.bank.trim(),
    date: cheque.date || input.date,
    drawer: cheque.drawer.trim(),
    status: cheque.status ?? 'held',
    ...(existing?.cheque ? lifecycleOf(existing.cheque) : {}),
  };
  if (civilId) details.drawerCivilId = civilId;
  else delete details.drawerCivilId;
  return details;
}

export async function savePayment(input: Payment): Promise<Payment> {
  return db.transaction(
    'rw',
    [db.payments, db.documents, db.clients, db.companies, db.accounts, db.activities],
    async () => {
      const company = await db.companies.get(input.companyId);
      if (!company) throw new PaymentError(t('Company not found.'));
      const existing = await db.payments.get(input.id);
      assertUnlocked(company, input.date, existing?.date);
      if (existing?.voided) {
        throw new PaymentError(t('This payment is void and can no longer be changed.'));
      }
      const out = input.direction === 'out';
      const direction = out ? 'out' : 'in';
      const precision = currencyPrecision(input.currency);
      const allocations = normalizeAllocations(input.allocations, precision);
      const amount = round(input.amount, precision);
      const allocated = allocations.reduce((s, a) => s.plus(dec(a.amount)), dec(0));
      if (amount >= 0 && toMinor(allocated, precision) > toMinor(amount, precision)) {
        throw new AllocationError(
          out
            ? t('The amounts applied to bills are larger than the payment.')
            : t('The amounts applied to invoices are larger than the payment.'),
        );
      }

      const cheque = await checkCheque(input, existing);
      const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
      const template = accountingSettings(company).template;
      const chequeAccounts = new Set(
        (['chequesReceived', 'chequesIssued'] as const)
          .map((key) => findPaymentAccount(accounts, key, template)?.id)
          .filter(Boolean),
      );
      let accountId = input.accountId ?? null;
      if (cheque) {
        const key = out ? 'chequesIssued' : 'chequesReceived';
        accountId = (await ensurePaymentAccount(company, key, accounts)).id;
      } else {
        // Leaving the cheque method: the cheques account is not a money account.
        if (accountId && chequeAccounts.has(accountId)) accountId = null;
        if (!accountId && defaultDestination(input.method, direction) === 'clearing') {
          accountId = (await ensurePaymentAccount(company, 'clearing', accounts)).id;
        }
      }

      const fee = takesFee(input.method, direction) ? round(input.fee ?? 0, precision) : 0;
      if (fee < 0) throw new PaymentError(t('The fee cannot be negative.'));
      if (fee > 0 && toMinor(fee, precision) >= toMinor(amount, precision)) {
        throw new PaymentError(t('The fee must be less than the amount received.'));
      }
      let feeAccountId: ID | null = null;
      if (fee > 0) {
        feeAccountId =
          input.feeAccountId && accounts.some((a) => a.id === input.feeAccountId)
            ? input.feeAccountId
            : (await ensurePaymentAccount(company, 'cardFees', accounts)).id;
      }

      if (existing && isChequeSettled(existing)) {
        const changed =
          toMinor(existing.amount, precision) !== toMinor(amount, precision) ||
          existing.currency !== input.currency ||
          (existing.exchangeRate ?? 1) !== (input.exchangeRate ?? 1) ||
          existing.method !== input.method ||
          (existing.direction ?? 'in') !== direction ||
          (existing.accountId ?? null) !== accountId;
        if (changed) {
          throw new PaymentError(
            t(
              'This cheque has its own entries now. Only the notes and the documents it pays can change.',
            ),
          );
        }
      }

      let payment: Payment = {
        ...input,
        amount,
        allocations,
        documentIds: allocations.map((a) => a.documentId),
        accountId,
        provider: providersFor(input.method).length ? (input.provider ?? null) : null,
        fee,
        feeAccountId,
        cheque,
        updatedAt: nowStamp(),
      };
      if (!fee) delete payment.fee;
      if (!payment.number.trim()) {
        const taken = new Set(
          (await db.payments.where('companyId').equals(company.id).toArray()).map((p) =>
            p.number.toLowerCase(),
          ),
        );
        // Payments made have their own series, like bills.
        const key = out ? 'payment_made' : 'payment';
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
      const vars = {
        number: payment.number,
        amount: formatMoney(
          payment.amount,
          payment.currency,
          company.locale,
          company.currencyDisplay ?? 'local',
        ),
        documents: numbers.join(', '),
      };
      await logActivity(
        company.id,
        'payment',
        payment.id,
        existing ? 'updated' : 'created',
        existing
          ? { text: msg('Payment {number} of {amount} updated'), vars }
          : numbers.length
            ? { text: msg('Payment {number} of {amount} recorded for {documents}'), vars }
            : { text: msg('Payment {number} of {amount} recorded'), vars },
        { clientId: payment.clientId || null, documentId: payment.documentIds[0] ?? null },
      );
      return payment;
    },
  );
}

export async function deletePayment(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.payments, db.documents, db.clients, db.companies, db.activities, db.securityCheques],
    async () => {
      const payment = await db.payments.get(id);
      if (!payment) return;
      if (payment.voided) {
        throw new PaymentError(t('A void payment stays on record and cannot be deleted.'));
      }
      if (isChequeSettled(payment)) {
        throw new PaymentError(
          t('This cheque has its own entries now. Mark it returned instead of deleting it.'),
        );
      }
      const company = await db.companies.get(payment.companyId);
      if (company) assertUnlocked(company, payment.date);
      await db.payments.delete(id);
      // A replacement cheque that is deleted no longer replaces anything.
      const replaced = payment.cheque?.replacesId
        ? await db.payments.get(payment.cheque.replacesId)
        : undefined;
      if (replaced?.cheque?.replacedById === id) {
        await db.payments.put({
          ...replaced,
          cheque: { ...replaced.cheque, replacedById: null },
          updatedAt: nowStamp(),
        });
      }
      // A cashed security cheque whose payment is deleted is held again.
      const security = await db.securityCheques
        .where('companyId')
        .equals(payment.companyId)
        .filter((s) => s.paymentId === id)
        .toArray();
      for (const s of security) {
        await db.securityCheques.put({
          ...s,
          status: 'held',
          cashedOn: null,
          paymentId: null,
          updatedAt: nowStamp(),
        });
      }
      await recalculateDocuments([
        ...payment.documentIds,
        ...(payment.creditId ? [payment.creditId] : []),
      ]);
      await logActivity(
        payment.companyId,
        'payment',
        payment.id,
        'deleted',
        { text: msg('Payment {number} deleted'), vars: { number: payment.number } },
        { clientId: payment.clientId || null },
      );
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Payment links                                                              */
/* -------------------------------------------------------------------------- */

/** Adds, changes or removes the online payment link of an invoice or quote. */
export async function setPaymentLink(documentId: ID, link: PaymentLink | null): Promise<void> {
  await db.transaction('rw', [db.documents, db.activities], async () => {
    const doc = await db.documents.get(documentId);
    if (!doc) throw new PaymentError(t('Document not found.'));
    let value: PaymentLink | null = null;
    if (link) {
      const url = link.url.trim();
      if (!isValidPaymentLink(url)) {
        throw new PaymentError(t('Enter the full link, starting with https://'));
      }
      value = { provider: link.provider, url, expiresAt: link.expiresAt || null };
    }
    await db.documents.put({ ...doc, paymentLink: value, updatedAt: nowStamp() });
    await logActivity(
      doc.companyId,
      doc.type,
      doc.id,
      value ? 'payment_link' : 'payment_link_removed',
      value
        ? { text: msg('Payment link added to {number}'), vars: { number: doc.number } }
        : { text: msg('Payment link removed from {number}'), vars: { number: doc.number } },
      { clientId: doc.clientId || null, documentId: doc.id },
    );
  });
}
