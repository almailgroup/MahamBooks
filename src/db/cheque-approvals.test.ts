import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import { draftDocument, saveDocument } from './documents';
import { loadLedger, LockedPeriodError } from './accounting';
import { saveClient, saveCompany, setupCompany } from './records';
import {
  createPayment,
  deletePayment,
  ensurePaymentAccount,
  newCheque,
  PaymentError,
  savePayment,
} from './payments';
import {
  cashSecurityCheque,
  clearCheque,
  createSecurityCheque,
  deleteSecurityCheque,
  depositCheque,
  replaceCheque,
  returnCheque,
  saveSecurityCheque,
} from './cheques';
import {
  ApprovalError,
  applyApproval,
  cancelApproval,
  carryOutDecided,
  decideApproval,
  pendingRequests,
} from './approvals';
import {
  ChequeConfirmationRequiredError,
  chequeWaits,
  waitingCheques,
  type ChequeAsk,
} from './cheque-rules';
import {
  applyChequeRequest,
  madeBy,
  mergePaymentEdit,
  paymentParts,
  requestChequeConfirmation,
} from './cheque-approvals';
import { chequePayments } from '@/lib/cheques';
import { CloudPermissionError } from '@/cloud/outbox';
import type { MemberRole } from '@/cloud/roles';
import type { ApprovalRules, Client, Company, ID, InvoiceDocument, Payment } from './types';

/**
 * Cheque confirmation on the device (#9 of docs/requirements-plan.md, D13):
 * under the owner's rules a cheque recorded by anyone but an approver is a
 * request, not a payment, and confirming it records the payment as asked.
 * Made-up data only.
 */

const RULES: ApprovalRules = {
  expireDays: 14,
  cheques: { issued: true, securityOut: true, received: false },
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/** This device's person in the company kept in the cloud. */
async function signedInAs(company: Company, role: MemberRole, approver = false) {
  await db.syncState.put({
    companyId: company.id,
    userId: `user-${role}`,
    role,
    status: 'ready',
    cursor: 0,
    name: company.name,
    linkedAt: '2026-10-01T08:00:00.000Z',
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
    ...(approver ? { approver: true } : {}),
  });
}

/**
 * An approver's decision as it goes in a company kept in the cloud: saved
 * here, taken by the cloud as sent, then carried out by the sync that sent
 * it (see carryOutDecided). `paid`: whether the cloud has the payment a new
 * cheque would become.
 */
async function decided(id: ID, decision: 'approved' | 'rejected', note = '', paid = false) {
  expect(await decideApproval(id, decision, note)).toBe(false);
  await db.outbox.where('[table+id]').equals(['approvals', id]).delete();
  const request = (await db.approvals.get(id))!;
  await carryOutDecided(request.companyId, [id], async () => paid);
}

async function setup(rules: ApprovalRules | null = RULES) {
  const created = await setupCompany({ name: 'Gulf Pearl Trading', currency: 'KWD' });
  const company = rules ? await saveCompany({ ...created, approvalRules: rules }) : created;
  // The post-dated cheques accounts, as the owner's first cheques make them.
  await db.transaction('rw', [db.accounts, db.activities], async () => {
    await ensurePaymentAccount(company, 'chequesIssued');
    await ensurePaymentAccount(company, 'chequesReceived');
  });
  const vendor = await saveClient(
    createClient(company.id, { name: 'Made-up Supplies', isVendor: true }),
  );
  const customer = await saveClient(createClient(company.id, { name: 'Made-up Customer' }));
  const bill = await issue(company, vendor, 'bill', 250);
  const invoice = await issue(company, customer, 'invoice', 400);
  return { company: (await db.companies.get(company.id))!, vendor, customer, bill, invoice };
}

async function issue(company: Company, client: Client, type: 'invoice' | 'bill', price: number) {
  const draft = await draftDocument(company, type, client);
  draft.issueDate = '2026-10-01';
  draft.items[0] = {
    ...draft.items[0],
    name: 'Supplies',
    quantity: 1,
    unitPrice: price,
    taxes: [],
  };
  return saveDocument({ ...draft, status: 'sent' });
}

function chequeFor(company: Company, doc: InvoiceDocument, overrides: Partial<Payment> = {}) {
  return createPayment(company.id, {
    direction: doc.type === 'bill' ? 'out' : 'in',
    clientId: doc.clientId,
    date: '2026-10-05',
    amount: doc.totals.balance,
    currency: 'KWD',
    method: 'cheque',
    reference: '000101',
    allocations: [{ documentId: doc.id, amount: doc.totals.balance }],
    cheque: newCheque({
      number: '000101',
      bank: 'BRGN',
      date: '2026-10-20',
      drawer: 'Made-up Supplies',
    }),
    ...overrides,
  });
}

async function refusal(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('It went through');
}

/** Asks as the form does: the save is refused with what to ask for, which is then sent. */
async function ask(work: Promise<unknown>, reason = '') {
  const error = await refusal(work);
  expect(error).toBeInstanceOf(ChequeConfirmationRequiredError);
  return requestChequeConfirmation((error as ChequeConfirmationRequiredError).ask, {
    reason,
    byName: 'Made-up Staff',
  });
}

async function codes(company: Company) {
  const { accounts, lines } = await loadLedger(company);
  const byCode: Record<string, number> = {};
  for (const l of lines) {
    const code = accounts.find((a) => a.id === l.accountId)!.code;
    byCode[code] = (byCode[code] ?? 0) + l.amount;
  }
  for (const code of Object.keys(byCode)) if (byCode[code] === 0) delete byCode[code];
  return byCode;
}

const balance = async (id: ID) => (await db.documents.get(id))!.totals.balance;

describe('without cheque rules', () => {
  it('records staff’s cheques at once, as before', async () => {
    const { company, bill } = await setup(null);
    await signedInAs(company, 'staff');
    const payment = await savePayment(chequeFor(company, bill));
    expect(payment.number).not.toBe('');
    expect(await balance(bill.id)).toBe(0);
    expect(await pendingRequests(company.id)).toEqual([]);
  });

  it('records them at once in a company kept on this device only', async () => {
    const { company, bill } = await setup();
    const payment = await savePayment(chequeFor(company, bill));
    expect(await db.payments.get(payment.id)).toBeDefined();
  });

  it('leaves cheques received to everyone while the owner keeps them out', async () => {
    const { company, invoice } = await setup();
    await signedInAs(company, 'staff');
    await savePayment(chequeFor(company, invoice, { reference: '000900' }));
    expect(await balance(invoice.id)).toBe(0);
  });
});

describe('a cheque issued by staff', () => {
  it('waits as a request: nothing reaches the books, the bill or the register', async () => {
    const { company, bill } = await setup();
    const before = await codes(company);
    await signedInAs(company, 'staff');
    const link = await db.syncState.get(company.id);
    const proposal = chequeFor(company, bill);
    expect(chequeWaits(company, link, 'payments', undefined, proposal)).toBe(true);
    const request = await ask(savePayment(proposal), 'For the October supplies');
    expect(request).toMatchObject({
      kind: 'cheque_create',
      subjectTbl: 'payments',
      subjectId: proposal.id,
      subjectNumber: '000101',
      status: 'pending',
      reason: 'For the October supplies',
      requestedBy: 'user-staff',
      requestedByName: 'Made-up Staff',
    });
    expect(request.after).toMatchObject({ number: '', amount: 250, method: 'cheque' });
    expect(await db.payments.count()).toBe(0);
    expect(chequePayments(await db.payments.toArray(), 'out')).toEqual([]);
    expect(await balance(bill.id)).toBe(250);
    expect(await codes(company)).toEqual(before);
    // Written straight to the table, it is refused as the cloud would.
    await expect(db.payments.put(proposal)).rejects.toThrow(CloudPermissionError);
  });

  it('is refused as a duplicate while it waits, for everyone', async () => {
    const { company, bill } = await setup();
    await signedInAs(company, 'staff');
    await ask(savePayment(chequeFor(company, bill)));
    const again = await refusal(
      requestChequeConfirmation({
        action: 'save',
        table: 'payments',
        record: chequeFor(company, bill),
      }),
    );
    expect(again).toBeInstanceOf(PaymentError);
    expect((again as Error).message).toMatch(/already waiting for confirmation/);
    await signedInAs(company, 'owner');
    await expect(savePayment(chequeFor(company, bill))).rejects.toThrow(
      /already waiting for confirmation/,
    );
    // Another number is fine.
    const other = chequeFor(company, bill, {
      amount: 10,
      allocations: [],
      cheque: newCheque({ number: '000102', bank: 'BRGN', date: '2026-10-20', drawer: 'X' }),
    });
    await savePayment(other);
  });

  it('is checked as a payment before it is sent', async () => {
    const { company, bill } = await setup();
    await signedInAs(company, 'staff');
    const ask: ChequeAsk = {
      action: 'save',
      table: 'payments',
      record: chequeFor(company, bill, { allocations: [{ documentId: bill.id, amount: 999 }] }),
    };
    await expect(requestChequeConfirmation(ask)).rejects.toThrow(/larger than the payment/);
    await signedInAs(company, 'owner');
    const locked = await saveLockDate(company, '2026-10-31');
    await signedInAs(company, 'staff');
    await expect(
      requestChequeConfirmation({ ...ask, record: chequeFor(locked, bill) }),
    ).rejects.toThrow(LockedPeriodError);
  });

  it('is recorded when the owner confirms it: numbered, dated as asked, posted and paying the bill', async () => {
    const { company, bill } = await setup();
    await signedInAs(company, 'staff');
    const request = await ask(savePayment(chequeFor(company, bill)));
    await signedInAs(company, 'owner');
    await decided(request.id, 'approved', 'Fine');
    const payment = await db.payments.get(request.subjectId);
    expect(payment).toMatchObject({
      date: '2026-10-05',
      amount: 250,
      approvalId: request.id,
      cheque: { number: '000101', status: 'held' },
    });
    expect(payment!.number).toMatch(/\d/);
    expect(await balance(bill.id)).toBe(0);
    expect(await db.approvals.get(request.id)).toMatchObject({
      status: 'applied',
      resultId: payment!.id,
      decisionNote: 'Fine',
    });
    // Post-dated cheques issued (2150) holds it until it clears.
    const books = await codes(company);
    expect(Object.values(books).some((fils) => fils === -250000)).toBe(true);
    // Staff then deposit and clear it as usual.
    await signedInAs(company, 'staff');
    await clearCheque(payment!.id, { date: '2026-10-21' });
    expect((await db.payments.get(payment!.id))!.cheque?.status).toBe('cleared');
  });

  it('is gone when the owner rejects it, with the note kept and its scans removed', async () => {
    const { company, bill } = await setup();
    await signedInAs(company, 'staff');
    const proposal = chequeFor(company, bill);
    const request = await ask(savePayment(proposal));
    await db.attachments.add({
      id: 'scan-1',
      companyId: company.id,
      ownerId: proposal.id,
      name: 'cheque.jpg',
      type: 'image/jpeg',
      size: 3,
      data: new Blob(['abc']),
      createdAt: '2026-10-05T08:00:00.000Z',
    } as never);
    await signedInAs(company, 'owner');
    // Not while the cloud may still have a payment for it (confirmed on another device).
    await decided(request.id, 'rejected', 'Pay by transfer', true);
    expect(await db.attachments.get('scan-1')).toBeDefined();
    await carryOutDecided(company.id, [request.id], async () => false);
    expect(await db.payments.count()).toBe(0);
    expect(await db.attachments.get('scan-1')).toBeUndefined();
    expect(await db.approvals.get(request.id)).toMatchObject({
      status: 'rejected',
      decisionNote: 'Pay by transfer',
    });
    expect(await balance(bill.id)).toBe(250);
  });

  it('can be taken back by whoever asked', async () => {
    const { company, bill } = await setup();
    await signedInAs(company, 'staff');
    const request = await ask(savePayment(chequeFor(company, bill)));
    await cancelApproval(request.id);
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'cancelled' });
    expect(await waitingCheques(company.id)).toEqual([]);
  });

  it('fails clearly when the bill was paid meanwhile, and stays approved', async () => {
    const { company, bill } = await setup();
    await signedInAs(company, 'staff');
    const request = await ask(savePayment(chequeFor(company, bill)));
    await signedInAs(company, 'owner');
    await savePayment(
      createPayment(company.id, {
        direction: 'out',
        clientId: bill.clientId,
        date: '2026-10-06',
        amount: 200,
        currency: 'KWD',
        method: 'bank_transfer',
        allocations: [{ documentId: bill.id, amount: 200 }],
      }),
    );
    // Carried out by the sync, it stays approved; carrying it out again says why.
    await decided(request.id, 'approved');
    const error = await refusal(applyApproval(request.id));
    expect(error).toBeInstanceOf(ApprovalError);
    expect((error as Error).message).toMatch(/paid meanwhile: only .*50.* is left/);
    expect(await db.payments.get(request.subjectId)).toBeUndefined();
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'approved' });
    // Rejected then, as the message says; it can't be approved twice.
    await expect(decideApproval(request.id, 'approved')).rejects.toThrow(/already been decided/);
    await decideApproval(request.id, 'rejected', 'Paid by transfer meanwhile');
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'rejected' });
  });

  it('can’t be recorded in a period locked meanwhile, and says why', async () => {
    const { company, bill } = await setup();
    await signedInAs(company, 'staff');
    const request = await ask(savePayment(chequeFor(company, bill)));
    await signedInAs(company, 'owner');
    await saveLockDate(company, '2026-10-31');
    await decided(request.id, 'approved');
    await expect(applyApproval(request.id)).rejects.toThrow(LockedPeriodError);
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'approved' });
    expect(await db.payments.count()).toBe(0);
  });

  it('is recorded at once by an approver the owner chose', async () => {
    const { company, bill } = await setup();
    await signedInAs(company, 'accountant', true);
    await savePayment(chequeFor(company, bill));
    expect(await balance(bill.id)).toBe(0);
  });
});

describe('a confirmed cheque', () => {
  async function confirmed() {
    const ctx = await setup();
    await signedInAs(ctx.company, 'owner');
    const payment = await savePayment(chequeFor(ctx.company, ctx.bill));
    await signedInAs(ctx.company, 'staff');
    return { ...ctx, payment };
  }

  it('changes its amount, payee, number, bank or dates only through confirmation', async () => {
    const { company, payment } = await confirmed();
    const changes: Partial<Payment>[] = [
      { amount: 100, allocations: [] },
      { date: '2026-10-07' },
      { cheque: { ...payment.cheque!, number: '000999' } },
      { cheque: { ...payment.cheque!, bank: 'NBOK' } },
      { cheque: { ...payment.cheque!, drawer: 'Someone Else' } },
      { cheque: { ...payment.cheque!, date: '2026-12-01' } },
    ];
    for (const change of changes) {
      const error = await refusal(savePayment({ ...payment, ...change }));
      expect(error).toBeInstanceOf(ChequeConfirmationRequiredError);
    }
    // Notes, deposit-free changes and its life go on.
    await savePayment({ ...payment, notes: 'With the courier' });
    expect((await db.payments.get(payment.id))!.notes).toBe('With the courier');
    expect(company.id).toBe(payment.companyId);
  });

  it('carries out a change as asked onto the cheque as it is now', async () => {
    const { company, payment } = await confirmed();
    const request = await ask(
      savePayment({
        ...payment,
        amount: 200,
        allocations: [{ documentId: payment.documentIds[0], amount: 200 }],
      }),
      'Part payment',
    );
    expect(request.kind).toBe('cheque_edit');
    expect(request.before).toEqual(paymentParts(payment));
    // Meanwhile a note is added.
    await savePayment({ ...(await db.payments.get(payment.id))!, notes: 'Called the vendor' });
    await signedInAs(company, 'owner');
    await decided(request.id, 'approved');
    expect(await db.payments.get(payment.id)).toMatchObject({
      amount: 200,
      notes: 'Called the vendor',
      approvalId: request.id,
    });
    expect(await balance(payment.documentIds[0])).toBe(50);
  });

  it('is deleted only when an approver confirms it', async () => {
    const { company, payment } = await confirmed();
    const request = await ask(deletePayment(payment.id));
    expect(request.kind).toBe('cheque_delete');
    expect(await db.payments.get(payment.id)).toBeDefined();
    await signedInAs(company, 'owner');
    await decided(request.id, 'approved');
    expect(await db.payments.get(payment.id)).toBeUndefined();
  });

  it('is deposited, cleared, returned and its replacement asked for', async () => {
    const { company, invoice } = await setup({ cheques: { issued: true, received: true } });
    await signedInAs(company, 'owner');
    const received = await savePayment(
      chequeFor(company, invoice, {
        reference: '000700',
        cheque: newCheque({ number: '000700', bank: 'NBOK', date: '2026-10-20', drawer: 'C' }),
      }),
    );
    await signedInAs(company, 'staff');
    await depositCheque(received.id, { date: '2026-10-21' });
    await returnCheque(received.id, { date: '2026-10-22', reason: 'Insufficient funds' });
    const request = await ask(
      replaceCheque(received.id, {
        date: '2026-10-25',
        amount: 400,
        cheque: { number: '000701', bank: 'NBOK', date: '2026-10-30', drawer: 'C' },
      }),
    );
    expect(request).toMatchObject({ kind: 'cheque_replace', subjectId: received.id });
    expect(await waitingCheques(company.id)).toMatchObject([{ number: '000701' }]);
    await signedInAs(company, 'owner');
    await decided(request.id, 'approved');
    const done = await db.approvals.get(request.id);
    const replacement = await db.payments.get(done!.resultId!);
    expect(replacement).toMatchObject({ date: '2026-10-25', cheque: { number: '000701' } });
    expect((await db.payments.get(received.id))!.cheque?.replacedById).toBe(replacement!.id);
    expect(await balance(invoice.id)).toBe(0);
    // The same payment whichever approver's device carries it out, and only once.
    expect(replacement).toMatchObject({ id: madeBy(request), approvalId: request.id });
    const count = await db.payments.count();
    expect(await applyChequeRequest({ ...done!, status: 'approved' })).toBe(replacement!.id);
    expect(await db.payments.count()).toBe(count);
  });

  it('merges only what the request changed', () => {
    const base = {
      id: 'p',
      amount: 1,
      notes: 'a',
      allocations: [],
      cheque: { number: '1', bank: 'NBOK', status: 'deposited' },
    } as unknown as Payment;
    const before = paymentParts(base);
    const merged = mergePaymentEdit({ ...base, notes: 'b' }, before, {
      ...base,
      amount: 2,
      cheque: { ...base.cheque!, number: '2', status: 'held' },
    });
    expect(merged).toMatchObject({
      amount: 2,
      notes: 'b',
      cheque: { number: '2', status: 'deposited' },
    });
  });
});

describe('security cheques', () => {
  it('waits for confirmation when given to someone, and not when received', async () => {
    const { company, vendor } = await setup();
    await signedInAs(company, 'staff');
    const given = createSecurityCheque(company.id, {
      direction: 'out',
      clientId: vendor.id,
      number: '000555',
      bank: 'KFHO',
      amount: 1000,
      currency: 'KWD',
      drawer: 'Made-up Landlord',
      purpose: 'Rent deposit',
    });
    const request = await ask(saveSecurityCheque(given));
    expect(request).toMatchObject({ kind: 'cheque_create', subjectTbl: 'securityCheques' });
    expect(await db.securityCheques.count()).toBe(0);
    await saveSecurityCheque({ ...given, id: 'in-1', direction: 'in' });
    await signedInAs(company, 'owner');
    await decided(request.id, 'approved');
    expect(await db.securityCheques.get(given.id)).toMatchObject({ number: '000555' });
    // Deleting it waits too.
    await signedInAs(company, 'staff');
    const deletion = await ask(deleteSecurityCheque(given.id));
    expect(deletion.kind).toBe('cheque_delete');
  });

  it('cashing one given out becomes a cheque issued: asked for, then recorded', async () => {
    const { company, vendor, bill } = await setup();
    await signedInAs(company, 'owner');
    const given = await saveSecurityCheque(
      createSecurityCheque(company.id, {
        direction: 'out',
        clientId: vendor.id,
        number: '000556',
        bank: 'KFHO',
        amount: 250,
        currency: 'KWD',
        drawer: 'Made-up Supplies',
        purpose: 'Guarantee',
      }),
    );
    await signedInAs(company, 'staff');
    const request = await ask(
      cashSecurityCheque(given.id, { date: '2026-10-10', applyToOpen: true }),
    );
    expect(request).toMatchObject({ kind: 'security_cheque_cash', subjectId: given.id });
    expect((await db.securityCheques.get(given.id))!.status).toBe('held');
    await signedInAs(company, 'owner');
    await decided(request.id, 'approved');
    expect((await db.securityCheques.get(given.id))!.status).toBe('cashed');
    expect(await balance(bill.id)).toBe(0);
    expect((await db.securityCheques.get(given.id))!.paymentId).toBe(madeBy(request));
    const count = await db.payments.count();
    await applyChequeRequest({ ...(await db.approvals.get(request.id))!, status: 'approved' });
    expect(await db.payments.count()).toBe(count);
  });
});

async function saveLockDate(company: Company, lockDate: string): Promise<Company> {
  const current = (await db.companies.get(company.id))!;
  await db.companies.update(company.id, {
    accounting: { ...current.accounting!, lockDate },
  });
  return (await db.companies.get(company.id))!;
}
