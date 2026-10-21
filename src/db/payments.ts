import Dexie from 'dexie';
import { db } from './db';
import { defaultNumbering, nowStamp } from './defaults';
import { logActivity } from './activity';
import { recalculateDocuments } from './documents';
import { accountingSettings } from './chart-setup';
import { assertUnlocked, createAccount } from './accounting';
import { assertChequeConfirmed, chequeWaits, rulesContext, waitingCheques } from './cheque-rules';
import type {
  Account,
  ChequeDetails,
  Company,
  ID,
  InvoiceDocument,
  Payment,
  PaymentAllocation,
  PaymentLink,
  PaymentMethod,
} from './types';
import { allocateNumber } from '@/lib/numbering';
import { formatMoney } from '@/lib/format';
import { dec, round, currencyPrecision, toMinor } from '@/lib/money';
import { isPosted, PAYMENT_POSTING_RULES } from '@/lib/accounting/ledger';
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
import { printedFaceChanged, spoilPrintedLeaf } from '@/lib/cheque-print';
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
  // A cheque with printed leaves is cancelled instead, so its leaves stay on record.
  const printed = Boolean(payment.cheque?.printedAt || payment.cheque?.spoiledLeaves?.length);
  return !payment.voided && !isChequeSettled(payment) && !printed;
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

/** The record of a cheque's prints; set by the cheque print page (db/cheque-print.ts), never by the form. */
const CHEQUE_PRINT = [
  'printedAt',
  'printCount',
  'printedLayoutId',
  'printedText',
  'crossed',
  'spoiledLeaves',
] as const satisfies readonly (keyof ChequeDetails)[];

/** `details` with the print record of the stored cheque, whatever the form sent. */
function withPrintRecord(details: ChequeDetails, stored: ChequeDetails | null | undefined) {
  const out: Partial<ChequeDetails> = details;
  for (const key of CHEQUE_PRINT) {
    if (stored?.[key] !== undefined) (out as Record<string, unknown>)[key] = stored[key];
    else delete out[key];
  }
  return details;
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
    arabic: { name: account.nameAr },
  });
  return account;
}

/**
 * Why a cheque number can't be recorded again: it is on another payment
 * (from the same client, for cheques received), or a cheque waiting for an
 * approver's confirmation has it. Null when it is free. Reads `payments` and
 * `approvals`.
 */
export async function chequeNumberTaken(
  companyId: ID,
  cheque: { id: ID; direction: 'in' | 'out'; clientId: ID; number: string; bank: string },
): Promise<string | null> {
  const out = cheque.direction === 'out';
  const number = cheque.number.trim();
  const duplicate = await db.payments
    .where('companyId')
    .equals(companyId)
    .filter(
      (p) =>
        p.id !== cheque.id &&
        !p.voided &&
        p.method === 'cheque' &&
        Boolean(p.cheque) &&
        (p.direction === 'out') === out &&
        (out || p.clientId === cheque.clientId) &&
        p.cheque!.number.trim() === number &&
        sameBank(p.cheque!.bank, cheque.bank),
    )
    .first();
  if (duplicate) {
    return t('Cheque {number} is already recorded on payment {payment}.', {
      number,
      payment: duplicate.number,
    });
  }
  // A cheque waiting for an approver's confirmation is recorded already.
  const waiting = (await waitingCheques(companyId)).find(
    (w) =>
      w.subjectId !== cheque.id &&
      (w.direction === 'out') === out &&
      (out || w.clientId === cheque.clientId) &&
      w.number === number &&
      sameBank(w.bank, cheque.bank),
  );
  return waiting ? t('Cheque {number} is already waiting for confirmation.', { number }) : null;
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
  const taken = await chequeNumberTaken(input.companyId, {
    id: input.id,
    direction: out ? 'out' : 'in',
    clientId: input.clientId,
    number,
    bank: cheque.bank,
  });
  if (taken) throw new PaymentError(taken);
  // A leaf recorded as spoiled was destroyed: its number is not used again.
  if (out && number !== existing?.cheque?.number.trim()) {
    const isSpoiled = (p: Payment) =>
      p.direction === 'out' &&
      Boolean(p.cheque && sameBank(p.cheque.bank, cheque.bank)) &&
      (p.cheque?.spoiledLeaves ?? []).some((leaf) => leaf.number.trim() === number);
    const spoiled =
      (existing && isSpoiled(existing)) ||
      (await db.payments
        .where('companyId')
        .equals(input.companyId)
        .filter((p) => p.id !== input.id && isSpoiled(p))
        .first());
    if (spoiled) {
      throw new PaymentError(t('Leaf {number} is spoiled: enter the next one.', { number }));
    }
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
  return withPrintRecord(details, existing?.cheque);
}

/** Why nothing (more) can be applied to a document that is not in the books. */
function notIssuedError(doc: InvoiceDocument): AllocationError {
  const number = doc.number;
  if (doc.status === 'void') {
    return new AllocationError(
      t('{number} is void, so nothing more can be applied to it.', { number }),
    );
  }
  switch (doc.type) {
    case 'invoice':
      return new AllocationError(t('Issue invoice {number} first.', { number }));
    case 'bill':
      return new AllocationError(t('Mark bill {number} as open first.', { number }));
    case 'credit':
      return new AllocationError(t('Issue credit note {number} first.', { number }));
    case 'vendor_credit':
      return new AllocationError(t('Mark vendor credit {number} as open first.', { number }));
    default:
      return new AllocationError(t('{number} can’t take payments.', { number }));
  }
}

/**
 * Payments and credits are only applied to documents in the books: a draft
 * is issued first. What a payment already holds on a document that has
 * since left the books (voided) may stay or shrink, so its notes can still
 * be edited.
 */
function checkIssued(
  allocations: PaymentAllocation[],
  docs: Map<ID, InvoiceDocument>,
  existing: Payment | undefined,
  precision: number,
): void {
  for (const a of allocations) {
    const doc = docs.get(a.documentId);
    if (!doc || isPosted(doc)) continue;
    const before = existing?.allocations.find((x) => x.documentId === a.documentId)?.amount ?? 0;
    if (toMinor(a.amount, precision) > toMinor(before, precision)) throw notIssuedError(doc);
  }
}

/**
 * Whether saving `next` over `before` leaves the books as they are: only the
 * documents it is applied to (or its notes) change, and everything is in the
 * company currency, so moving money between documents moves no amount.
 * Such a change is allowed in a locked period, e.g. applying an advance
 * received before the lock date to a later invoice.
 */
function sameEntries(
  before: Payment,
  next: Payment,
  docs: Map<ID, InvoiceDocument>,
  company: Company,
): boolean {
  const currency = company.currency;
  const precision = currencyPrecision(currency);
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (
    before.currency !== currency ||
    next.currency !== currency ||
    before.date !== next.date ||
    toMinor(before.amount, precision) !== toMinor(next.amount, precision) ||
    (before.direction ?? 'in') !== (next.direction ?? 'in') ||
    before.method !== next.method ||
    before.clientId !== next.clientId ||
    !same(before.accountId, next.accountId) ||
    !same(before.fee || null, next.fee || null) ||
    !same(before.feeAccountId, next.feeAccountId) ||
    !same(before.creditId, next.creditId) ||
    Boolean(before.voided) !== Boolean(next.voided)
  ) {
    return false;
  }
  const ids = [...before.documentIds, ...next.documentIds, before.creditId, next.creditId];
  return ids.every((id) => !id || docs.get(id)?.currency === currency);
}

/** What saving a payment checks before it writes anything (see checkPayment). */
interface CheckedPayment {
  company: Company;
  existing: Payment | undefined;
  docs: Map<ID, InvoiceDocument>;
  direction: 'in' | 'out';
  precision: number;
  /** The payment as it would be stored, but for its accounts and its number. */
  payment: Payment;
  /** The printed cheque whose leaf the change spoils, if it does. */
  printed: ChequeDetails | null;
  spoiled: boolean;
}

/**
 * Everything savePayment checks before it writes: the amounts applied, the
 * documents, the credit, the cheque and the fee. Reads only.
 */
async function checkPayment(input: Payment): Promise<CheckedPayment> {
  const company = await db.companies.get(input.companyId);
  if (!company) throw new PaymentError(t('Company not found.'));
  const existing = await db.payments.get(input.id);
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
  const creditId = input.creditId ?? null;
  const related = [
    ...new Set(
      [
        ...allocations.map((a) => a.documentId),
        ...(existing?.documentIds ?? []),
        creditId,
        existing?.creditId,
      ].filter((id): id is ID => Boolean(id)),
    ),
  ];
  const docs = new Map(
    (await db.documents.bulkGet(related))
      .filter((d): d is InvoiceDocument => Boolean(d))
      .map((d) => [d.id, d]),
  );
  checkIssued(allocations, docs, existing, precision);
  if (input.method === 'credit_note' && creditId) {
    const credit = docs.get(creditId);
    const kept =
      existing?.creditId === creditId &&
      toMinor(amount, precision) <= toMinor(existing.amount, precision);
    if (credit && !isPosted(credit) && !kept) throw notIssuedError(credit);
  }

  let cheque = await checkCheque(input, existing);
  // A printed cheque that changes no longer matches its leaf: the leaf is
  // spoiled (destroyed) and the cheque is printed again. Only while the
  // leaf is still in hand: once presented, cleared or returned, the bank
  // has had it, and its print stays on record.
  const printed =
    existing?.cheque?.printedAt && existing.cheque.status === 'held' ? existing.cheque : null;
  const spoiled = printed !== null && printedFaceChanged(existing!, { ...input, amount, cheque });
  if (printed && spoiled) {
    if (!cheque) {
      throw new PaymentError(
        t('This cheque was printed. Cancel the cheque instead of paying another way.'),
      );
    }
    cheque = spoilPrintedLeaf(printed, cheque, t('Changed after printing'), nowStamp());
  }

  const fee = takesFee(input.method, direction) ? round(input.fee ?? 0, precision) : 0;
  if (fee < 0) throw new PaymentError(t('The fee cannot be negative.'));
  if (fee > 0 && toMinor(fee, precision) >= toMinor(amount, precision)) {
    throw new PaymentError(t('The fee must be less than the amount received.'));
  }

  const payment: Payment = {
    ...input,
    amount,
    allocations,
    documentIds: allocations.map((a) => a.documentId),
    provider: providersFor(input.method).length ? (input.provider ?? null) : null,
    fee,
    cheque,
    // Saved now, it posts under the current rules (an earlier payment
    // moves to them here, in an open period).
    postingRules: PAYMENT_POSTING_RULES,
  };
  if (!fee) delete payment.fee;
  return { company, existing, docs, direction, precision, payment, printed, spoiled };
}

/** The money a settled cheque keeps: its own entries are booked on it. */
function assertSettledKept(
  existing: Payment | undefined,
  next: Payment,
  precision: number,
  accountId: ID | null | undefined,
): void {
  if (!existing || !isChequeSettled(existing)) return;
  const changed =
    toMinor(existing.amount, precision) !== toMinor(next.amount, precision) ||
    existing.currency !== next.currency ||
    (existing.exchangeRate ?? 1) !== (next.exchangeRate ?? 1) ||
    existing.method !== next.method ||
    (existing.direction ?? 'in') !== (next.direction ?? 'in') ||
    (accountId !== undefined && (existing.accountId ?? null) !== accountId);
  if (changed) {
    throw new PaymentError(
      t(
        'This cheque has its own entries now. Only the notes and the documents it pays can change.',
      ),
    );
  }
}

/**
 * Checks a payment as savePayment would, without saving it: the payment as
 * it would be stored, but for its accounts and its number (given when it is
 * saved). For a cheque sent for an approver's confirmation.
 */
export async function validatePayment(input: Payment): Promise<Payment> {
  return db.transaction('r', [db.payments, db.documents, db.companies, db.approvals], async () => {
    const { company, existing, docs, precision, payment } = await checkPayment(input);
    assertSettledKept(existing, payment, precision, undefined);
    // The account of a cheque is the post-dated cheques account either way.
    const comparable =
      existing && existing.method === 'cheque' && payment.method === 'cheque'
        ? { ...payment, accountId: existing.accountId }
        : payment;
    if (!existing || !sameEntries(existing, comparable, docs, company)) {
      assertUnlocked(company, payment.date, existing?.date);
    }
    return payment;
  });
}

export async function savePayment(input: Payment): Promise<Payment> {
  // The company's cheque rules, for a person who isn't an approver.
  const rules = await rulesContext(input.companyId);
  return db.transaction(
    'rw',
    [db.payments, db.documents, db.clients, db.companies, db.accounts, db.activities, db.approvals],
    async () => {
      const checked = await checkPayment(input);
      const { company, existing, docs, direction, precision, printed, spoiled } = checked;
      const out = direction === 'out';
      // A cheque the company's rules keep for approvers: sent for confirmation
      // instead. A cheque's account is the cheques account whatever was sent
      // (set below), so it is compared where it is booked now.
      const asked =
        existing?.method === 'cheque' && checked.payment.method === 'cheque'
          ? { ...checked.payment, accountId: existing.accountId }
          : checked.payment;
      assertChequeConfirmed(rules, 'payments', existing, asked, () => ({
        action: 'save',
        table: 'payments',
        record: checked.payment,
      }));
      const { cheque, fee } = checked.payment;
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
        // Whoever can't change what was confirmed on a cheque leaves it booked where it is.
        if (
          existing?.accountId &&
          rules &&
          chequeWaits(rules.company, rules.link, 'payments', existing, {
            ...checked.payment,
            accountId,
          })
        ) {
          accountId = existing.accountId;
        }
      } else {
        // Leaving the cheque method: the cheques account is not a money account.
        if (accountId && chequeAccounts.has(accountId)) accountId = null;
        if (!accountId && defaultDestination(input.method, direction) === 'clearing') {
          accountId = (await ensurePaymentAccount(company, 'clearing', accounts)).id;
        }
      }

      let feeAccountId: ID | null = null;
      if (fee && fee > 0) {
        feeAccountId =
          input.feeAccountId && accounts.some((a) => a.id === input.feeAccountId)
            ? input.feeAccountId
            : (await ensurePaymentAccount(company, 'cardFees', accounts)).id;
      }

      assertSettledKept(existing, checked.payment, precision, accountId);

      let payment: Payment = {
        ...checked.payment,
        accountId,
        feeAccountId,
        updatedAt: nowStamp(),
      };
      // A closed period keeps its entries; a change that posts nothing new
      // (applying an advance to another invoice) is fine.
      if (!existing || !sameEntries(existing, payment, docs, company)) {
        assertUnlocked(company, payment.date, existing?.date);
      }
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

      const paid = await db.documents.bulkGet(payment.documentIds);
      const numbers = paid.filter(Boolean).map((d) => d!.number);
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
      const money = { amount: { amount: payment.amount, currency: payment.currency } };
      await logActivity(
        company.id,
        'payment',
        payment.id,
        existing ? 'updated' : 'created',
        existing
          ? { text: msg('Payment {number} of {amount} updated'), vars, money }
          : numbers.length
            ? { text: msg('Payment {number} of {amount} recorded for {documents}'), vars, money }
            : { text: msg('Payment {number} of {amount} recorded'), vars, money },
        { clientId: payment.clientId || null, documentId: payment.documentIds[0] ?? null },
      );
      if (printed && spoiled) {
        await logActivity(
          company.id,
          'payment',
          payment.id,
          'cheque_leaf_spoiled',
          {
            text: msg('Cheque leaf {number} spoiled: payment {payment} changed after printing'),
            vars: { number: printed.number, payment: payment.number },
          },
          { clientId: payment.clientId || null, documentId: payment.documentIds[0] ?? null },
        );
      }
      return payment;
    },
  );
}

/** Why a payment can't be deleted: void ones, cleared cheques and printed ones stay on record. */
export function checkDeletable(payment: Payment): void {
  if (payment.voided) {
    throw new PaymentError(t('A void payment stays on record and cannot be deleted.'));
  }
  if (isChequeSettled(payment)) {
    throw new PaymentError(
      t('This cheque has its own entries now. Mark it returned instead of deleting it.'),
    );
  }
  // Its printed and spoiled leaves are on record so their numbers are never used again.
  if (payment.cheque?.printedAt || payment.cheque?.spoiledLeaves?.length) {
    throw new PaymentError(
      t('Leaves of this cheque were printed. Cancel the cheque instead of deleting it.'),
    );
  }
}

/** Deletes a payment with its files (scans of the cheque or the transfer). */
export async function deletePayment(id: ID): Promise<void> {
  // The company's cheque rules, for a person who isn't an approver.
  const found = Dexie.currentTransaction ? undefined : await db.payments.get(id);
  const rules = found ? await rulesContext(found.companyId) : undefined;
  await db.transaction(
    'rw',
    [
      db.payments,
      db.documents,
      db.clients,
      db.companies,
      db.activities,
      db.securityCheques,
      db.attachments,
    ],
    async () => {
      const payment = await db.payments.get(id);
      if (!payment) return;
      checkDeletable(payment);
      // A cheque the company's rules keep for approvers: deleting it is asked for instead.
      assertChequeConfirmed(rules, 'payments', payment, undefined, () => ({
        action: 'delete',
        table: 'payments',
        id,
      }));
      const company = await db.companies.get(payment.companyId);
      if (company) assertUnlocked(company, payment.date);
      await db.payments.delete(id);
      await db.attachments.where('ownerId').equals(id).delete();
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
