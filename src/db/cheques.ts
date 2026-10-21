import Dexie from 'dexie';
import { db } from './db';
import { logActivity } from './activity';
import { assertUnlocked, createJournal, newJournalLine, roleMap, saveJournal } from './accounting';
import { recalculateDocuments } from './documents';
import { createExpense, saveExpense } from './purchases';
import {
  createPayment,
  ensurePaymentAccount,
  newCheque,
  PaymentError,
  savePayment,
} from './payments';
import { nowStamp } from './defaults';
import {
  assertChequeConfirmed,
  rulesContext,
  type CashInput,
  type RulesContext,
} from './cheque-rules';
import type {
  ChequeDetails,
  Company,
  ID,
  ISODate,
  ManualJournal,
  Payment,
  PaymentAllocation,
  SecurityCheque,
} from './types';
import { paymentMinor } from '@/lib/cheques';
import { currencyPrecision, dec, fromMinor, round, toMinor } from '@/lib/money';
import { isValidCivilId } from '@/lib/kuwait';
import { newId } from '@/lib/ids';
import { msg, t } from '@/i18n';

/**
 * The life of a cheque after it is recorded with a payment:
 *
 * - received: the payment debits 1150 Post-dated cheques received. Clearing
 *   posts Dr bank / Cr 1150 on the clearing date.
 * - issued: the payment credits 2150 Post-dated cheques issued. Clearing
 *   posts Dr 2150 / Cr bank.
 * - returned: the payment is voided, so its invoices or bills are open
 *   again. Its entries stay on its own date and are reversed on the return
 *   date (with the clearing, if it cleared), so closed periods never change;
 *   the bank's charge can be recorded as an expense.
 * - cancelled: a cheque that was never presented is voided and reversed on
 *   the cancellation date the same way.
 *
 * Security cheques are a memo register only; cashing one records a payment.
 */

export class ChequeError extends PaymentError {}

const TABLES = () => [
  db.payments,
  db.documents,
  db.clients,
  db.companies,
  db.accounts,
  db.journals,
  db.expenses,
  db.activities,
  db.securityCheques,
  // Cheques waiting for confirmation are recorded already (savePayment checks them).
  db.approvals,
];

/** The company's cheque rules for the person, read before a transaction (none inside one). */
async function rulesFor(
  table: 'payments' | 'securityCheques',
  id: ID,
): Promise<RulesContext | undefined> {
  if (Dexie.currentTransaction) return undefined;
  const found = await (table === 'payments' ? db.payments.get(id) : db.securityCheques.get(id));
  return found ? rulesContext(found.companyId) : undefined;
}

type ChequePayment = Payment & { cheque: ChequeDetails };

async function load(paymentId: ID): Promise<{ payment: ChequePayment; company: Company }> {
  const payment = await db.payments.get(paymentId);
  if (!payment?.cheque || payment.method !== 'cheque') {
    throw new ChequeError(t('Cheque not found.'));
  }
  const company = await db.companies.get(payment.companyId);
  if (!company) throw new ChequeError(t('Company not found.'));
  return { payment: payment as ChequePayment, company };
}

function isOut(payment: Payment): boolean {
  return payment.direction === 'out';
}

/** The cheque's value in the company currency, as the payment posted it. */
function companyAmount(payment: Payment, company: Company): number {
  const p = currencyPrecision(company.currency);
  return fromMinor(paymentMinor(payment, company.currency, p), p);
}

async function bankAccount(company: Company, id: ID | null | undefined, out: boolean) {
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const chosen = id ? accounts.find((a) => a.id === id) : undefined;
  const account = chosen ?? accounts.find((a) => a.id === roleMap(accounts).bank);
  if (!account || account.type !== 'asset_cash') {
    throw new ChequeError(
      out
        ? t('Choose the bank account the cheque was paid from.')
        : t('Choose the bank account the cheque cleared into.'),
    );
  }
  return account;
}

/** The post-dated cheques account the payment posted to. */
async function chequesAccount(company: Company, payment: Payment): Promise<ID> {
  const account = payment.accountId ? await db.accounts.get(payment.accountId) : undefined;
  if (account && account.companyId === company.id) return account.id;
  return (await ensurePaymentAccount(company, isOut(payment) ? 'chequesIssued' : 'chequesReceived'))
    .id;
}

async function updateCheque(
  payment: ChequePayment,
  patch: Partial<Payment>,
  cheque: Partial<ChequeDetails>,
) {
  const next: Payment = {
    ...payment,
    ...patch,
    cheque: { ...payment.cheque, ...cheque },
    updatedAt: nowStamp(),
  };
  await db.payments.put(next);
  return next;
}

function chequeVars(payment: ChequePayment) {
  return { number: payment.cheque.number, payment: payment.number };
}

/** Records that a cheque in hand was deposited at the bank (no entry until it clears). */
export async function depositCheque(
  paymentId: ID,
  input: { date: ISODate; bankAccountId?: ID | null },
): Promise<Payment> {
  return db.transaction('rw', TABLES(), async () => {
    const { payment, company } = await load(paymentId);
    if (payment.voided || payment.cheque.status !== 'held' || isOut(payment)) {
      throw new ChequeError(t('Only a cheque in hand can be deposited.'));
    }
    if (input.date < payment.date) {
      throw new ChequeError(t('The cheque can’t be deposited before the payment date.'));
    }
    if (input.bankAccountId) await bankAccount(company, input.bankAccountId, false);
    const next = await updateCheque(
      payment,
      {},
      {
        status: 'deposited',
        depositedOn: input.date,
        ...(input.bankAccountId ? { bankAccountId: input.bankAccountId } : {}),
      },
    );
    await logActivity(
      company.id,
      'payment',
      payment.id,
      'cheque_deposited',
      { text: msg('Cheque {number} on payment {payment} deposited'), vars: chequeVars(payment) },
      { clientId: payment.clientId || null, documentId: payment.documentIds[0] ?? null },
    );
    return next;
  });
}

/**
 * Marks a cheque as cleared: the money reached (or left) the bank. Posts a
 * journal on the clearing date moving the amount between the post-dated
 * cheques account and the bank.
 */
export async function clearCheque(
  paymentId: ID,
  input: { date: ISODate; bankAccountId?: ID | null },
): Promise<Payment> {
  return db.transaction('rw', TABLES(), async () => {
    const { payment, company } = await load(paymentId);
    const status = payment.cheque.status;
    if (payment.voided || (status !== 'held' && status !== 'deposited')) {
      throw new ChequeError(t('This cheque can no longer be cleared.'));
    }
    if (
      input.date < payment.date ||
      (payment.cheque.depositedOn && input.date < payment.cheque.depositedOn)
    ) {
      throw new ChequeError(
        t('The clearing date can’t be before the cheque was received or deposited.'),
      );
    }
    const out = isOut(payment);
    const bank = await bankAccount(
      company,
      input.bankAccountId ?? payment.cheque.bankAccountId,
      out,
    );
    const holding = await chequesAccount(company, payment);
    const amount = companyAmount(payment, company);
    const reference = t('Cheque {number} cleared', { number: payment.cheque.number });
    const contactId = payment.clientId || null;
    const journal = await saveJournal(
      createJournal(company.id, {
        date: input.date,
        kind: 'cheque_clearing',
        paymentId: payment.id,
        reference,
        status: 'posted',
        lines: out
          ? [
              newJournalLine({
                accountId: holding,
                debit: amount,
                description: reference,
                contactId,
              }),
              newJournalLine({ accountId: bank.id, credit: amount, description: reference }),
            ]
          : [
              newJournalLine({ accountId: bank.id, debit: amount, description: reference }),
              newJournalLine({
                accountId: holding,
                credit: amount,
                description: reference,
                contactId,
              }),
            ],
      }),
    );
    const next = await updateCheque(
      payment,
      {},
      {
        status: 'cleared',
        clearedOn: input.date,
        bankAccountId: bank.id,
        clearingJournalId: journal.id,
      },
    );
    await logActivity(
      company.id,
      'payment',
      payment.id,
      'cheque_cleared',
      { text: msg('Cheque {number} on payment {payment} cleared'), vars: chequeVars(payment) },
      { clientId: payment.clientId || null, documentId: payment.documentIds[0] ?? null },
    );
    return next;
  });
}

/** Common reasons banks give for returning a cheque. */
export const RETURN_REASONS = [
  msg('Insufficient funds'),
  msg('Signature differs'),
  msg('Account closed'),
  msg('Payment stopped by the drawer'),
  msg('Post-dated or out of date'),
  msg('Amount in words and figures differ'),
] as const;

export interface ReturnInput {
  date: ISODate;
  reason: string;
  /** The bank's charge for the returned cheque, in the company currency. */
  charge?: number;
  /** Account the charge was taken from (defaults to the cheque's bank). */
  chargeAccountId?: ID | null;
}

/**
 * Records a cheque the bank returned unpaid. The payment is voided so the
 * documents it paid are open again; the payment and any clearing are
 * reversed on the return date; the bank's charge is recorded as an expense.
 */
export async function returnCheque(paymentId: ID, input: ReturnInput): Promise<Payment> {
  return db.transaction('rw', TABLES(), async () => {
    const { payment, company } = await load(paymentId);
    const status = payment.cheque.status;
    if (payment.voided || (status !== 'held' && status !== 'deposited' && status !== 'cleared')) {
      throw new ChequeError(t('This cheque can no longer be marked as returned.'));
    }
    if (input.date < payment.date) {
      throw new ChequeError(t('The return date can’t be before the payment date.'));
    }
    // The payment keeps its entries on its own date; the return is booked on
    // the day the cheque came back, so a closed period never changes.
    assertUnlocked(company, input.date);
    const out = isOut(payment);
    const reason = input.reason.trim() || t('Cheque returned');
    const precision = currencyPrecision(company.currency);
    const charge = round(input.charge ?? 0, precision);
    if (charge < 0) throw new ChequeError(t('The bank charge cannot be negative.'));

    let reversal: ManualJournal | null = null;
    if (status === 'cleared') {
      const bank = await bankAccount(company, payment.cheque.bankAccountId, out);
      const holding = await chequesAccount(company, payment);
      const amount = companyAmount(payment, company);
      const reference = t('Cheque {number} returned', { number: payment.cheque.number });
      const contactId = payment.clientId || null;
      reversal = await saveJournal(
        createJournal(company.id, {
          date: input.date,
          kind: 'cheque_return',
          paymentId: payment.id,
          reference,
          status: 'posted',
          lines: out
            ? [
                newJournalLine({ accountId: bank.id, debit: amount, description: reference }),
                newJournalLine({
                  accountId: holding,
                  credit: amount,
                  description: reference,
                  contactId,
                }),
              ]
            : [
                newJournalLine({
                  accountId: holding,
                  debit: amount,
                  description: reference,
                  contactId,
                }),
                newJournalLine({ accountId: bank.id, credit: amount, description: reference }),
              ],
        }),
      );
    }

    let chargeExpenseId: ID | null = null;
    if (charge > 0) {
      const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
      const roles = roleMap(accounts);
      const category = roles.bank_fees ?? roles.expense;
      if (!category) throw new ChequeError(t('Set up a bank charges account first.'));
      const paidFrom = await bankAccount(
        company,
        input.chargeAccountId ?? payment.cheque.bankAccountId,
        true,
      );
      const expense = await saveExpense(
        createExpense(company.id, {
          date: input.date,
          accountId: category,
          description: t('Returned cheque charge, cheque {number}', {
            number: payment.cheque.number,
          }),
          amount: charge,
          currency: company.currency,
          paidFromAccountId: paidFrom.id,
          vendorId: null,
          reference: payment.cheque.number,
        }),
      );
      chargeExpenseId = expense.id;
    }

    const next = await updateCheque(
      payment,
      { voided: true, voidReason: reason, voidedOn: input.date },
      {
        status: 'returned',
        returnedOn: input.date,
        returnReason: reason,
        ...(reversal ? { reversalJournalId: reversal.id } : {}),
        ...(chargeExpenseId ? { returnChargeExpenseId: chargeExpenseId } : {}),
      },
    );
    await recalculateDocuments([
      ...payment.documentIds,
      ...(payment.creditId ? [payment.creditId] : []),
    ]);
    await logActivity(
      company.id,
      'payment',
      payment.id,
      'cheque_returned',
      {
        text: msg('Cheque {number} on payment {payment} returned: {reason}'),
        vars: { ...chequeVars(payment), reason },
      },
      { clientId: payment.clientId || null, documentId: payment.documentIds[0] ?? null },
    );
    return next;
  });
}

/**
 * Cancels a cheque that was never presented (given back, lost or stopped).
 * The payment is voided like a returned cheque and reversed on the
 * cancellation date; nothing reached the bank.
 */
export async function cancelCheque(
  paymentId: ID,
  input: { date: ISODate; reason: string },
): Promise<Payment> {
  return db.transaction('rw', TABLES(), async () => {
    const { payment, company } = await load(paymentId);
    const status = payment.cheque.status;
    if (payment.voided || (status !== 'held' && status !== 'deposited')) {
      throw new ChequeError(t('Only a cheque that has not cleared can be cancelled.'));
    }
    if (input.date < payment.date) {
      throw new ChequeError(t('The cancellation date can’t be before the payment date.'));
    }
    assertUnlocked(company, input.date);
    const reason = input.reason.trim() || t('Cheque cancelled');
    const next = await updateCheque(
      payment,
      { voided: true, voidReason: reason, voidedOn: input.date },
      { status: 'cancelled' },
    );
    await recalculateDocuments([
      ...payment.documentIds,
      ...(payment.creditId ? [payment.creditId] : []),
    ]);
    await logActivity(
      company.id,
      'payment',
      payment.id,
      'cheque_cancelled',
      {
        text: msg('Cheque {number} on payment {payment} cancelled: {reason}'),
        vars: { ...chequeVars(payment), reason },
      },
      { clientId: payment.clientId || null, documentId: payment.documentIds[0] ?? null },
    );
    return next;
  });
}

export interface ReplacementInput {
  cheque: Pick<ChequeDetails, 'number' | 'bank' | 'date' | 'drawer' | 'drawerCivilId'>;
  amount: number;
  /** Date the new cheque was received or issued. */
  date: ISODate;
}

/** Why a cheque can't be replaced as asked, before anything is done. */
export function checkReplacement(old: Payment, input: ReplacementInput): void {
  if (old.cheque?.replacedById) {
    throw new ChequeError(t('This cheque has already been replaced.'));
  }
  if (old.cheque?.status === 'cleared') {
    throw new ChequeError(t('A cleared cheque can’t be replaced. Mark it returned first.'));
  }
  const amount = round(input.amount, currencyPrecision(old.currency));
  if (!(amount > 0)) throw new ChequeError(t('Enter the amount of the new cheque.'));
}

/**
 * Records the cheque that replaces a returned (or still unpresented) one.
 * The old cheque is cancelled first when it is still open. The new payment
 * pays the same documents, as far as they are still open.
 */
export async function replaceCheque(oldPaymentId: ID, input: ReplacementInput): Promise<Payment> {
  const rules = await rulesFor('payments', oldPaymentId);
  return db.transaction('rw', TABLES(), async () => {
    const { payment: old, company } = await load(oldPaymentId);
    checkReplacement(old, input);
    // The new cheque is one the company's rules keep for approvers: asked for instead.
    assertChequeConfirmed(
      rules,
      'payments',
      undefined,
      { method: 'cheque', direction: old.direction ?? 'in' },
      () => ({ action: 'replace', id: old.id, input }),
    );
    const status = old.cheque.status;
    if (status === 'held' || status === 'deposited') {
      await cancelCheque(old.id, {
        date: input.date,
        reason: t('Replaced by cheque {number}', { number: input.cheque.number.trim() }),
      });
    }
    const precision = currencyPrecision(old.currency);
    const amount = round(input.amount, precision);
    // Pay the same documents again, as far as they are open now.
    let remaining = dec(amount);
    const allocations: PaymentAllocation[] = [];
    for (const a of old.allocations) {
      const doc = await db.documents.get(a.documentId);
      if (!doc || doc.status === 'void' || remaining.lte(0)) continue;
      const share = Math.min(a.amount, Math.max(0, doc.totals.balance), remaining.toNumber());
      const value = round(share, precision);
      if (toMinor(value, precision) <= 0) continue;
      allocations.push({ documentId: doc.id, amount: value });
      remaining = remaining.minus(dec(value));
    }
    const replacement = await savePayment(
      createPayment(company.id, {
        direction: old.direction ?? 'in',
        clientId: old.clientId,
        date: input.date,
        amount,
        currency: old.currency,
        exchangeRate: old.exchangeRate,
        method: 'cheque',
        reference: input.cheque.number.trim(),
        notes: '',
        allocations,
        cheque: newCheque({ ...input.cheque, status: 'held', replacesId: old.id }),
      }),
    );
    const current = (await db.payments.get(old.id)) as ChequePayment;
    await updateCheque(current, {}, { replacedById: replacement.id });
    await logActivity(
      company.id,
      'payment',
      old.id,
      'cheque_replaced',
      {
        text: msg('Cheque {number} replaced by cheque {replacement}'),
        vars: { number: old.cheque.number, replacement: replacement.cheque?.number ?? '' },
      },
      { clientId: old.clientId || null, documentId: old.documentIds[0] ?? null },
    );
    return replacement;
  });
}

/** Cheques a customer gave that came back unpaid, newest first. */
export async function returnedCheques(clientId: ID): Promise<Payment[]> {
  const payments = await db.payments
    .where('clientId')
    .equals(clientId)
    .filter((p) => p.direction !== 'out' && p.cheque?.status === 'returned')
    .toArray();
  return payments.sort((a, b) =>
    (b.cheque?.returnedOn ?? b.date).localeCompare(a.cheque?.returnedOn ?? a.date),
  );
}

/* -------------------------------------------------------------------------- */
/* Security cheques                                                           */
/* -------------------------------------------------------------------------- */

export function createSecurityCheque(
  companyId: ID,
  overrides: Partial<SecurityCheque> = {},
): SecurityCheque {
  const stamp = nowStamp();
  return {
    id: newId(),
    companyId,
    direction: 'in',
    clientId: null,
    number: '',
    bank: '',
    date: null,
    amount: 0,
    currency: 'KWD',
    drawer: '',
    purpose: '',
    notes: '',
    status: 'held',
    returnedOn: null,
    cashedOn: null,
    paymentId: null,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

/** The security cheque as saveSecurityCheque would store it, or why it can't be. */
function checkSecurityCheque(
  input: SecurityCheque,
  existing: SecurityCheque | undefined,
): SecurityCheque {
  if (existing && existing.status !== 'held') {
    throw new ChequeError(t('Only a security cheque that is still held can be changed.'));
  }
  const number = input.number.trim();
  if (!number) throw new ChequeError(t('Enter the cheque number.'));
  const amount = round(input.amount, currencyPrecision(input.currency));
  if (!(amount > 0)) throw new ChequeError(t('Enter the amount of the cheque.'));
  const civilId = (input.drawerCivilId ?? '').replace(/\s/g, '');
  if (civilId && !isValidCivilId(civilId)) {
    throw new ChequeError(t('Check the Civil ID number: it has 12 digits.'));
  }
  const cheque: SecurityCheque = {
    ...input,
    number,
    amount,
    bank: input.bank.trim(),
    drawer: input.drawer.trim(),
    purpose: input.purpose.trim(),
    date: input.date || null,
    status: existing?.status ?? 'held',
    updatedAt: nowStamp(),
  };
  if (civilId) cheque.drawerCivilId = civilId;
  else delete cheque.drawerCivilId;
  return cheque;
}

/** Checks a security cheque as saveSecurityCheque would, without saving it. */
export async function validateSecurityCheque(input: SecurityCheque): Promise<SecurityCheque> {
  return checkSecurityCheque(input, await db.securityCheques.get(input.id));
}

export async function saveSecurityCheque(input: SecurityCheque): Promise<SecurityCheque> {
  const rules = Dexie.currentTransaction ? undefined : await rulesContext(input.companyId);
  return db.transaction('rw', [db.securityCheques, db.activities], async () => {
    const existing = await db.securityCheques.get(input.id);
    const cheque = checkSecurityCheque(input, existing);
    const number = cheque.number;
    // One the company's rules keep for approvers (given to someone): asked for instead.
    assertChequeConfirmed(rules, 'securityCheques', existing, cheque, () => ({
      action: 'save',
      table: 'securityCheques',
      record: cheque,
    }));
    if (!existing) cheque.createdAt = cheque.updatedAt;
    await db.securityCheques.put(cheque);
    await logActivity(
      cheque.companyId,
      'cheque',
      cheque.id,
      existing ? 'updated' : 'created',
      existing
        ? { text: msg('Security cheque {number} updated'), vars: { number } }
        : { text: msg('Security cheque {number} recorded'), vars: { number } },
      { clientId: cheque.clientId },
    );
    return cheque;
  });
}

/** The security cheque went back to the person who gave it (or came back to us). */
export async function returnSecurityCheque(id: ID, date: ISODate): Promise<SecurityCheque> {
  return db.transaction('rw', [db.securityCheques, db.activities], async () => {
    const cheque = await db.securityCheques.get(id);
    if (!cheque) throw new ChequeError(t('Cheque not found.'));
    if (cheque.status !== 'held') {
      throw new ChequeError(t('Only a security cheque that is still held can be given back.'));
    }
    const next: SecurityCheque = {
      ...cheque,
      status: 'returned',
      returnedOn: date,
      updatedAt: nowStamp(),
    };
    await db.securityCheques.put(next);
    await logActivity(
      cheque.companyId,
      'cheque',
      cheque.id,
      'returned',
      { text: msg('Security cheque {number} given back'), vars: { number: cheque.number } },
      { clientId: cheque.clientId },
    );
    return next;
  });
}

/**
 * Cashes a security cheque: it becomes a real payment (received or made),
 * deposited on the given date, optionally paying the contact's open
 * invoices (or bills), oldest first.
 */
export async function cashSecurityCheque(id: ID, input: CashInput): Promise<Payment> {
  const rules = await rulesFor('securityCheques', id);
  return db.transaction('rw', TABLES(), async () => {
    const cheque = await db.securityCheques.get(id);
    if (!cheque) throw new ChequeError(t('Cheque not found.'));
    if (cheque.status !== 'held') {
      throw new ChequeError(t('Only a security cheque that is still held can be cashed.'));
    }
    const clientId = input.clientId || cheque.clientId;
    if (!clientId) {
      throw new ChequeError(
        cheque.direction === 'out' ? t('Choose the vendor.') : t('Choose the client.'),
      );
    }
    // The payment it becomes is a cheque the company's rules keep for approvers: asked for instead.
    assertChequeConfirmed(
      rules,
      'payments',
      undefined,
      { method: 'cheque', direction: cheque.direction },
      () => ({ action: 'cash', id, input }),
    );
    const out = cheque.direction === 'out';
    const precision = currencyPrecision(cheque.currency);
    const allocations: PaymentAllocation[] = [];
    if (input.applyToOpen) {
      const open = (await db.documents.where('clientId').equals(clientId).toArray())
        .filter(
          (d) =>
            d.type === (out ? 'bill' : 'invoice') &&
            (d.status === 'sent' || d.status === 'partial') &&
            d.currency === cheque.currency &&
            d.totals.balance > 0,
        )
        .sort((a, b) => (a.dueDate ?? a.issueDate).localeCompare(b.dueDate ?? b.issueDate));
      let remaining = dec(cheque.amount);
      for (const d of open) {
        if (remaining.lte(0)) break;
        const value = round(Math.min(d.totals.balance, remaining.toNumber()), precision);
        if (value <= 0) continue;
        allocations.push({ documentId: d.id, amount: value });
        remaining = remaining.minus(dec(value));
      }
    }
    const payment = await savePayment(
      createPayment(cheque.companyId, {
        direction: cheque.direction,
        clientId,
        date: input.date,
        amount: cheque.amount,
        currency: cheque.currency,
        method: 'cheque',
        reference: cheque.number,
        notes: cheque.purpose,
        allocations,
        cheque: newCheque({
          number: cheque.number,
          bank: cheque.bank,
          date: cheque.date ?? input.date,
          drawer: cheque.drawer,
          ...(cheque.drawerCivilId ? { drawerCivilId: cheque.drawerCivilId } : {}),
          status: out ? 'held' : 'deposited',
          depositedOn: out ? null : input.date,
        }),
      }),
    );
    await db.securityCheques.put({
      ...cheque,
      clientId,
      status: 'cashed',
      cashedOn: input.date,
      paymentId: payment.id,
      updatedAt: nowStamp(),
    });
    await logActivity(
      cheque.companyId,
      'cheque',
      cheque.id,
      'cashed',
      {
        text: msg('Security cheque {number} cashed as payment {payment}'),
        vars: { number: cheque.number, payment: payment.number },
      },
      { clientId },
    );
    return payment;
  });
}

/** Removes a security cheque entered by mistake (only while held; nothing was posted). */
export async function deleteSecurityCheque(id: ID): Promise<void> {
  const rules = await rulesFor('securityCheques', id);
  await db.transaction('rw', [db.securityCheques, db.activities], async () => {
    const cheque = await db.securityCheques.get(id);
    if (!cheque) return;
    if (cheque.status !== 'held') {
      throw new ChequeError(t('Only a security cheque that is still held can be deleted.'));
    }
    assertChequeConfirmed(rules, 'securityCheques', cheque, undefined, () => ({
      action: 'delete',
      table: 'securityCheques',
      id,
    }));
    await db.securityCheques.delete(id);
    await logActivity(
      cheque.companyId,
      'cheque',
      cheque.id,
      'deleted',
      { text: msg('Security cheque {number} deleted'), vars: { number: cheque.number } },
      { clientId: cheque.clientId },
    );
  });
}
