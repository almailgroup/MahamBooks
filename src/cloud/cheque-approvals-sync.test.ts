import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createClient } from '@/db/defaults';
import { saveClient, saveCompany, setupCompany } from '@/db/records';
import { draftDocument, saveDocument } from '@/db/documents';
import { createPayment, ensurePaymentAccount, newCheque, savePayment } from '@/db/payments';
import { decideApproval } from '@/db/approvals';
import { ChequeConfirmationRequiredError } from '@/db/cheque-rules';
import { requestChequeConfirmation } from '@/db/cheque-approvals';
import { sendParkedForConfirmation } from '@/features/approvals/parked';
import type { ApprovalRules, InvoiceDocument, Payment } from '@/db/types';
import type { MemberRole } from './roles';
import { FakeCloud } from './testing/fake-cloud';
import { startDownload, startUpload, syncCompany, type SyncContext } from './sync';

/**
 * Cheques an approver confirms (#9), between devices through the cloud (here
 * its stand-in, which answers as the server does). Made-up data only.
 */

const OWNER = 'user-owner';
const STAFF = 'user-staff';
const RULES: ApprovalRules = { cheques: { issued: true, securityOut: true } };

let server: FakeCloud;
const ctx = (user: string): SyncContext => ({ api: server.client(user), userId: user });

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = new FakeCloud();
  server.features = ['tables_v16', 'super_admin', 'approvals', 'cheque_approvals'];
});

/** The owner's company in the cloud with an open bill; then this device is `user`'s. */
async function company(rules: ApprovalRules | null) {
  const created = await setupCompany({ name: 'Gulf Pearl Trading', currency: 'KWD' });
  const owned = rules ? await saveCompany({ ...created, approvalRules: rules }) : created;
  await db.transaction('rw', [db.accounts, db.activities], () =>
    ensurePaymentAccount(owned, 'chequesIssued'),
  );
  const vendor = await saveClient(
    createClient(owned.id, { name: 'Made-up Supplies', isVendor: true }),
  );
  const draft = await draftDocument(owned, 'bill', vendor);
  draft.items[0] = { ...draft.items[0], name: 'Supplies', quantity: 1, unitPrice: 250, taxes: [] };
  const bill = await saveDocument({ ...draft, status: 'sent' });
  await startUpload(owned.id, ctx(OWNER));
  await syncCompany(owned.id, ctx(OWNER));
  server.addMember(owned.id, STAFF, 'staff');
  return { companyId: owned.id, name: owned.name, bill };
}

async function deviceOf(companyId: string, name: string, user: string, role: MemberRole) {
  await db.delete();
  await db.open();
  await startDownload({ id: companyId, name, role }, ctx(user));
  await syncCompany(companyId, ctx(user));
}

function cheque(companyId: string, bill: InvoiceDocument): Payment {
  return createPayment(companyId, {
    direction: 'out',
    clientId: bill.clientId,
    date: '2026-10-05',
    amount: 250,
    currency: 'KWD',
    method: 'cheque',
    reference: '000101',
    allocations: [{ documentId: bill.id, amount: 250 }],
    cheque: newCheque({ number: '000101', bank: 'BRGN', date: '2026-10-20', drawer: 'Supplies' }),
  });
}

describe('cheque confirmation through the cloud', () => {
  it('staff ask, the owner confirms on their device, and both end up with the payment', async () => {
    const { companyId, name, bill } = await company(RULES);
    await deviceOf(companyId, name, STAFF, 'staff');
    const proposal = cheque(companyId, bill);
    let error: unknown;
    await savePayment(proposal).catch((e: unknown) => (error = e));
    expect(error).toBeInstanceOf(ChequeConfirmationRequiredError);
    const request = await requestChequeConfirmation((error as ChequeConfirmationRequiredError).ask);
    expect((await syncCompany(companyId, ctx(STAFF))).parked).toBe(0);
    expect(server.record(companyId, 'approvals', request.id)).toMatchObject({
      status: 'pending',
      requestedBy: STAFF,
      kind: 'cheque_create',
    });
    expect(server.record(companyId, 'payments', proposal.id)).toBeUndefined();

    await deviceOf(companyId, name, OWNER, 'owner');
    await decideApproval(request.id, 'approved');
    expect((await syncCompany(companyId, ctx(OWNER))).parked).toBe(0);
    expect(server.record(companyId, 'approvals', request.id)).toMatchObject({
      status: 'applied',
      decidedBy: OWNER,
      resultId: proposal.id,
    });
    expect(server.record(companyId, 'payments', proposal.id)).toMatchObject({
      amount: 250,
      date: '2026-10-05',
      approvalId: request.id,
    });

    await deviceOf(companyId, name, STAFF, 'staff');
    expect((await db.payments.get(proposal.id))?.number).not.toBe('');
    expect((await db.documents.get(bill.id))?.totals.balance).toBe(0);
  });

  it('parks a cheque recorded before this device knew the rules, which can then be sent for confirmation', async () => {
    const { companyId, name, bill } = await company(null);
    await deviceOf(companyId, name, STAFF, 'staff');
    // The owner turns cheque confirmation on meanwhile.
    const record = server.record(companyId, 'companies', companyId)!;
    await server
      .client(OWNER)
      .pushRecords(companyId, [
        { tbl: 'companies', id: companyId, data: { ...record, approvalRules: RULES } },
      ]);
    // This device doesn't know yet: it records the cheque.
    const payment = await savePayment(cheque(companyId, bill));
    expect((await db.documents.get(bill.id))?.totals.balance).toBe(0);
    const result = await syncCompany(companyId, ctx(STAFF));
    expect(result.parked).toBeGreaterThan(0);
    const parked = (await db.outbox.toArray()).filter(
      (e) => e.parked === 1 && e.table === 'payments',
    );
    expect(parked.map((e) => `${e.table} ${e.error}`)).toEqual(['payments approval_required']);
    expect(server.record(companyId, 'payments', payment.id)).toBeUndefined();

    const request = await sendParkedForConfirmation(
      companyId,
      parked[0],
      ctx(STAFF),
      'Recorded before the rules',
    );
    expect(request).toMatchObject({ kind: 'cheque_create', status: 'pending' });
    expect(request.after).toMatchObject({ number: '', amount: 250 });
    // Gone from this device, and the bill is open again until it is confirmed.
    expect(await db.payments.get(payment.id)).toBeUndefined();
    expect((await db.documents.get(bill.id))?.totals.balance).toBe(250);
    await syncCompany(companyId, ctx(STAFF));
    expect(server.record(companyId, 'approvals', request.id)).toMatchObject({
      status: 'pending',
    });
    expect(server.record(companyId, 'documents', bill.id)).toMatchObject({
      totals: expect.objectContaining({ balance: 250 }),
    });
  });

  it('changes nothing for a server without cheque confirmation', async () => {
    server.features = ['tables_v16', 'super_admin', 'approvals'];
    const { companyId, name, bill } = await company(null);
    await deviceOf(companyId, name, STAFF, 'staff');
    const payment = await savePayment(cheque(companyId, bill));
    expect((await syncCompany(companyId, ctx(STAFF))).parked).toBe(0);
    expect(server.record(companyId, 'payments', payment.id)).toMatchObject({ amount: 250 });
  });
});
