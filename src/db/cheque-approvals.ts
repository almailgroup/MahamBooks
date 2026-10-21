import { db } from './db';
import { nowStamp } from './defaults';
import { ApprovalError, logRequest, pendingRequestFor, REQUEST_TABLES } from './approvals';
import {
  checkDeletable,
  chequeNumberTaken,
  deletePayment,
  PaymentError,
  savePayment,
  validatePayment,
} from './payments';
import {
  cashSecurityCheque,
  checkReplacement,
  ChequeError,
  deleteSecurityCheque,
  replaceCheque,
  saveSecurityCheque,
  validateSecurityCheque,
  type ReplacementInput,
} from './cheques';
import { proposedPayment, type CashInput, type ChequeAsk } from './cheque-rules';
import type {
  ApprovalKind,
  ApprovalRequest,
  ID,
  Payment,
  PaymentAllocation,
  SecurityCheque,
} from './types';
import { sameData } from '@/cloud/roles';
import { formatMoney } from '@/lib/format';
import { currencyPrecision, dec, round, toMinor } from '@/lib/money';
import { newId } from '@/lib/ids';
import { t } from '@/i18n';

/**
 * Cheque requests (#9 of docs/requirements-plan.md): what a person who isn't
 * an approver asks for when the company's rules keep a cheque for approvers
 * (see cheque-rules.ts), and how an approver's device carries it out once
 * they confirm it. The request holds the cheque as it would be recorded
 * (`after`); confirming records it with the normal payment and cheque
 * functions, so it is numbered and posted only then, dated as asked.
 */

/** The fields of a payment a change asks for (and the approver sees). */
export const PAYMENT_EDIT_FIELDS = [
  'method',
  'direction',
  'clientId',
  'date',
  'amount',
  'currency',
  'exchangeRate',
  'accountId',
  'provider',
  'fee',
  'feeAccountId',
  'creditId',
  'reference',
  'notes',
  'allocations',
] as const;

/** The fields of its cheque a change asks for. */
export const CHEQUE_EDIT_FIELDS = ['number', 'bank', 'date', 'drawer', 'drawerCivilId'] as const;

/** The fields of a security cheque a change asks for. */
export const SECURITY_EDIT_FIELDS = [
  'direction',
  'clientId',
  'number',
  'bank',
  'date',
  'amount',
  'currency',
  'drawer',
  'drawerCivilId',
  'purpose',
  'notes',
] as const;

type Parts = Record<string, unknown>;

function pick(record: object | null | undefined, fields: readonly string[]): Parts {
  const row = (record ?? {}) as Parts;
  const out: Parts = {};
  for (const field of fields)
    if (row[field] !== undefined) out[field] = structuredClone(row[field]);
  return out;
}

/** What a change of a payment is about: its fields and its cheque's, as `before` keeps them. */
export function paymentParts(payment: Payment): Parts {
  return {
    ...pick(payment, PAYMENT_EDIT_FIELDS),
    cheque: payment.cheque ? pick(payment.cheque, CHEQUE_EDIT_FIELDS) : null,
  };
}

/** The same for a security cheque. */
export function securityParts(cheque: SecurityCheque): Parts {
  return pick(cheque, SECURITY_EDIT_FIELDS);
}

/** A request about to be written, before it is stamped. */
interface Asked {
  companyId: ID;
  kind: ApprovalKind;
  subjectTbl: 'payments' | 'securityCheques';
  subjectId: ID;
  subjectNumber: string;
  before: Parts | null;
  after: Parts;
}

const chequeNumberOf = (payment: Pick<Payment, 'cheque' | 'number'>) =>
  payment.cheque?.number.trim() || payment.number;

/** Checks what is asked for as the save would, and turns it into a request. */
async function asked(ask: ChequeAsk): Promise<Asked> {
  if (ask.action === 'save' && ask.table === 'payments') {
    const existing = await db.payments.get(ask.record.id);
    const valid = await validatePayment(ask.record);
    if (existing && sameData(paymentParts(existing), paymentParts(valid))) {
      throw new ApprovalError(t('Nothing has changed.'));
    }
    return {
      companyId: valid.companyId,
      kind: existing ? 'cheque_edit' : 'cheque_create',
      subjectTbl: 'payments',
      subjectId: valid.id,
      subjectNumber: valid.cheque?.number || (existing ? chequeNumberOf(existing) : ''),
      before: existing ? paymentParts(existing) : null,
      // Numbered when it is recorded, as confirmed.
      after: { ...(existing ? valid : { ...valid, number: '' }) } as unknown as Parts,
    };
  }
  if (ask.action === 'save') {
    const existing = await db.securityCheques.get(ask.record.id);
    const valid = await validateSecurityCheque(ask.record);
    if (existing && sameData(securityParts(existing), securityParts(valid))) {
      throw new ApprovalError(t('Nothing has changed.'));
    }
    return {
      companyId: valid.companyId,
      kind: existing ? 'cheque_edit' : 'cheque_create',
      subjectTbl: 'securityCheques',
      subjectId: valid.id,
      subjectNumber: valid.number,
      before: existing ? securityParts(existing) : null,
      after: { ...valid } as unknown as Parts,
    };
  }
  if (ask.action === 'delete' && ask.table === 'payments') {
    const payment = await db.payments.get(ask.id);
    if (!payment) throw new ChequeError(t('Cheque not found.'));
    checkDeletable(payment);
    return {
      companyId: payment.companyId,
      kind: 'cheque_delete',
      subjectTbl: 'payments',
      subjectId: payment.id,
      subjectNumber: chequeNumberOf(payment),
      before: paymentParts(payment),
      after: { action: 'delete' },
    };
  }
  if (ask.action === 'delete') {
    const cheque = await db.securityCheques.get(ask.id);
    if (!cheque) throw new ChequeError(t('Cheque not found.'));
    if (cheque.status !== 'held') {
      throw new ChequeError(t('Only a security cheque that is still held can be deleted.'));
    }
    return {
      companyId: cheque.companyId,
      kind: 'cheque_delete',
      subjectTbl: 'securityCheques',
      subjectId: cheque.id,
      subjectNumber: cheque.number,
      before: securityParts(cheque),
      after: { action: 'delete' },
    };
  }
  if (ask.action === 'replace') {
    const old = await db.payments.get(ask.id);
    if (!old?.cheque || old.method !== 'cheque') throw new ChequeError(t('Cheque not found.'));
    checkReplacement(old, ask.input);
    const number = ask.input.cheque.number.trim();
    if (!number) throw new PaymentError(t('Enter the cheque number.'));
    const direction = old.direction === 'out' ? 'out' : 'in';
    const taken = await chequeNumberTaken(old.companyId, {
      id: newId(),
      direction,
      clientId: old.clientId,
      number,
      bank: ask.input.cheque.bank,
    });
    if (taken) throw new PaymentError(taken);
    const input: ReplacementInput = {
      ...ask.input,
      amount: round(ask.input.amount, currencyPrecision(old.currency)),
      cheque: { ...ask.input.cheque, number, bank: ask.input.cheque.bank.trim() },
    };
    return {
      companyId: old.companyId,
      kind: 'cheque_replace',
      subjectTbl: 'payments',
      subjectId: old.id,
      subjectNumber: old.cheque.number,
      before: paymentParts(old),
      after: {
        action: 'replace',
        sourceId: old.id,
        input: structuredClone(input),
        direction,
        clientId: old.clientId,
        number,
        bank: input.cheque.bank,
        amount: input.amount,
        currency: old.currency,
        date: input.date,
        chequeDate: input.cheque.date,
        drawer: input.cheque.drawer.trim(),
      },
    };
  }
  const cheque = await db.securityCheques.get(ask.id);
  if (!cheque) throw new ChequeError(t('Cheque not found.'));
  if (cheque.status !== 'held') {
    throw new ChequeError(t('Only a security cheque that is still held can be cashed.'));
  }
  const clientId = ask.input.clientId || cheque.clientId;
  if (!clientId) {
    throw new ChequeError(
      cheque.direction === 'out' ? t('Choose the vendor.') : t('Choose the client.'),
    );
  }
  const taken = await chequeNumberTaken(cheque.companyId, {
    id: newId(),
    direction: cheque.direction,
    clientId,
    number: cheque.number,
    bank: cheque.bank,
  });
  if (taken) throw new PaymentError(taken);
  const input: CashInput = {
    date: ask.input.date,
    clientId,
    applyToOpen: Boolean(ask.input.applyToOpen),
  };
  return {
    companyId: cheque.companyId,
    kind: 'security_cheque_cash',
    subjectTbl: 'securityCheques',
    subjectId: cheque.id,
    subjectNumber: cheque.number,
    before: securityParts(cheque),
    after: {
      action: 'cash',
      sourceId: cheque.id,
      input: { ...input },
      direction: cheque.direction,
      clientId,
      number: cheque.number,
      bank: cheque.bank,
      amount: cheque.amount,
      currency: cheque.currency,
      date: input.date,
      chequeDate: cheque.date,
      drawer: cheque.drawer,
    },
  };
}

/**
 * Sends a cheque for an approver's confirmation: a new cheque, a change of
 * one, deleting one, a replacement or cashing a security cheque, checked as
 * saving it would be. Nothing is recorded as a payment until it is
 * confirmed. One request waits on a cheque at a time. Returns the request.
 */
export async function requestChequeConfirmation(
  ask: ChequeAsk,
  options: {
    /** A note for the approver (optional). */
    reason?: string;
    /** The name the team knows the person by, shown with the request. */
    byName?: string;
  } = {},
): Promise<ApprovalRequest> {
  const parts = await asked(ask);
  const link = await db.syncState.get(parts.companyId);
  const reason = (options.reason ?? '').trim();
  const byName = options.byName?.trim();
  return db.transaction('rw', REQUEST_TABLES(), async () => {
    if (await pendingRequestFor(parts.subjectId)) {
      throw new ApprovalError(
        t('Cheque {number} is already waiting for confirmation.', {
          number: parts.subjectNumber,
        }),
      );
    }
    const now = nowStamp();
    const request: ApprovalRequest = {
      id: newId(),
      ...parts,
      reason,
      status: 'pending',
      // The cloud stamps both with its own.
      requestedBy: link?.userId ?? '',
      ...(byName ? { requestedByName: byName.slice(0, 200) } : {}),
      requestedAt: now,
      decidedBy: null,
      decidedAt: null,
      decisionNote: '',
      createdAt: now,
      updatedAt: now,
    };
    await db.approvals.add(request);
    await logRequest(request, 'asked');
    return request;
  });
}

/* -------------------------------------------------------------------------- */
/* Confirming                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The change asked for carried onto the payment as it is now: only what the
 * request changed, so what happened since (deposited, other notes) stays.
 */
export function mergePaymentEdit(current: Payment, before: Parts, proposal: Payment): Payment {
  const asked = paymentParts(proposal);
  const merged: Parts = { ...current };
  for (const field of PAYMENT_EDIT_FIELDS) {
    if (sameData(before[field], asked[field])) continue;
    const value = (proposal as unknown as Parts)[field];
    if (value === undefined) delete merged[field];
    else merged[field] = structuredClone(value);
  }
  if (!sameData(before.cheque, asked.cheque)) {
    if (!proposal.cheque) {
      merged.cheque = null;
    } else {
      const cheque: Parts = { ...(current.cheque ?? proposal.cheque) };
      for (const field of CHEQUE_EDIT_FIELDS) {
        const value = (proposal.cheque as unknown as Parts)[field];
        if (value === undefined) delete cheque[field];
        else cheque[field] = value;
      }
      merged.cheque = cheque;
    }
  }
  return merged as unknown as Payment;
}

/**
 * The documents a cheque pays are still open for what it pays: one paid
 * meanwhile (by another payment) can't take it, and the approver is told so.
 */
async function assertStillOpen(
  companyId: ID,
  allocations: PaymentAllocation[],
  current: Payment | undefined,
): Promise<void> {
  const company = await db.companies.get(companyId);
  for (const a of allocations) {
    const doc = await db.documents.get(a.documentId);
    if (!doc) {
      throw new ApprovalError(
        t('A document this cheque pays is no longer here. Reject the request and record it again.'),
      );
    }
    const precision = currencyPrecision(doc.currency);
    const held = current?.allocations.find((x) => x.documentId === a.documentId)?.amount ?? 0;
    const open = round(dec(Math.max(0, doc.totals.balance)).plus(dec(held)), precision);
    if (toMinor(a.amount, precision) > toMinor(open, precision)) {
      throw new ApprovalError(
        t(
          '{number} has been paid meanwhile: only {amount} is left to pay. Reject this request, and record the cheque again if it is still needed.',
          {
            number: doc.number,
            amount: formatMoney(
              open,
              doc.currency,
              company?.locale ?? 'en',
              company?.currencyDisplay ?? 'local',
            ),
          },
        ),
      );
    }
  }
}

const cannot = () => new ApprovalError(t('This version of the app can’t carry out this request.'));

/**
 * Carries out a confirmed cheque request on this (the approver's) device,
 * with the normal payment and cheque functions: the payment is numbered and
 * posted now, dated as asked. Returns what it made (the payment, or the
 * security cheque), or null for a deletion. A period locked meanwhile, a
 * document paid meanwhile or a cheque number taken meanwhile stops it with
 * a message: the request stays approved, to be carried out again or
 * rejected.
 */
export async function applyChequeRequest(request: ApprovalRequest): Promise<ID | null> {
  const after = (request.after ?? {}) as Parts;
  const before = (request.before ?? {}) as Parts;
  if (request.subjectTbl === 'payments') {
    if (request.kind === 'cheque_create') {
      // Recorded already (carried out on another device of an approver).
      if (await db.payments.get(request.subjectId)) return request.subjectId;
      const proposal = proposedPayment(request);
      if (!proposal) throw cannot();
      await assertStillOpen(request.companyId, proposal.allocations ?? [], undefined);
      const saved = await savePayment({
        ...proposal,
        id: request.subjectId,
        companyId: request.companyId,
        number: '',
        approvalId: request.id,
      });
      return saved.id;
    }
    if (request.kind === 'cheque_edit') {
      const current = await db.payments.get(request.subjectId);
      if (!current) throw new ApprovalError(t('The payment of this request no longer exists.'));
      const proposal = proposedPayment(request);
      if (!proposal) throw cannot();
      const merged = mergePaymentEdit(current, before, proposal);
      await assertStillOpen(request.companyId, merged.allocations ?? [], current);
      const saved = await savePayment({ ...merged, approvalId: request.id });
      return saved.id;
    }
    if (request.kind === 'cheque_delete') {
      if (await db.payments.get(request.subjectId)) await deletePayment(request.subjectId);
      return null;
    }
    if (request.kind === 'cheque_replace') {
      const input = after.input as ReplacementInput | undefined;
      if (!input || typeof after.sourceId !== 'string') throw cannot();
      const replacement = await replaceCheque(after.sourceId, input);
      return replacement.id;
    }
    throw cannot();
  }
  if (request.subjectTbl === 'securityCheques') {
    if (request.kind === 'cheque_create') {
      if (await db.securityCheques.get(request.subjectId)) return request.subjectId;
      const saved = await saveSecurityCheque({
        ...(after as unknown as SecurityCheque),
        id: request.subjectId,
        companyId: request.companyId,
      });
      return saved.id;
    }
    if (request.kind === 'cheque_edit') {
      const current = await db.securityCheques.get(request.subjectId);
      if (!current) throw new ApprovalError(t('The cheque of this request no longer exists.'));
      const merged: Parts = { ...current };
      for (const field of SECURITY_EDIT_FIELDS) {
        if (sameData(before[field], after[field])) continue;
        if (after[field] === undefined) delete merged[field];
        else merged[field] = structuredClone(after[field]);
      }
      const saved = await saveSecurityCheque(merged as unknown as SecurityCheque);
      return saved.id;
    }
    if (request.kind === 'cheque_delete') {
      await deleteSecurityCheque(request.subjectId);
      return null;
    }
    if (request.kind === 'security_cheque_cash') {
      const input = after.input as CashInput | undefined;
      if (!input || typeof after.sourceId !== 'string') throw cannot();
      const payment = await cashSecurityCheque(after.sourceId, input);
      return payment.id;
    }
  }
  throw cannot();
}
