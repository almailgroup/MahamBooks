import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { db } from '@/db/db';
import { createClient } from '@/db/defaults';
import { saveClient, saveCompany, setupCompany } from '@/db/records';
import { deleteDocument, draftDocument, saveDocument } from '@/db/documents';
import { createPayment, ensurePaymentAccount, newCheque, savePayment } from '@/db/payments';
import {
  ApprovalRequiredError,
  applyApproval,
  cancelApproval,
  decideApproval,
  expirePending,
} from '@/db/approvals';
import { ChequeConfirmationRequiredError } from '@/db/cheque-rules';
import { madeBy, requestChequeConfirmation } from '@/db/cheque-approvals';
import { replaceCheque } from '@/db/cheques';
import { addAttachment } from '@/db/purchases';
import { canSendForApproval, sendParkedForApproval } from '@/features/approvals/parked';
import type { ApprovalRules, InvoiceDocument, Payment } from '@/db/types';
import type { MemberRole } from './roles';
import { FakeCloud } from './testing/fake-cloud';
import { parkedEntries, startDownload, startUpload, syncCompany, type SyncContext } from './sync';

/**
 * Decisions on approval requests made on several devices at once, through
 * the cloud (here its stand-in, which answers as the server does): the
 * cloud's decision is the one carried out, scans of a confirmed cheque are
 * never lost, nothing is recorded twice, and a refused change never leaves
 * half of itself in the cloud. One database per device. Made-up data only.
 */

const OWNER = 'user-owner';
const STAFF = 'user-staff';
const CHEQUES: ApprovalRules = { cheques: { issued: true, securityOut: true }, expireDays: 14 };

let server: FakeCloud;
const ctx = (user: string): SyncContext => ({ api: server.client(user), userId: user });

// One IndexedDB per device, so each keeps its own copy while another works.
const devices = new Map<string, IDBFactory>();
async function on(device: string) {
  db.close();
  let factory = devices.get(device);
  if (!factory) devices.set(device, (factory = new IDBFactory()));
  (db as unknown as { _deps: { indexedDB: IDBFactory } })._deps.indexedDB = factory;
  await db.open();
}

beforeEach(async () => {
  devices.clear();
  await on('setup');
  server = new FakeCloud();
  server.features = ['tables_v16', 'super_admin', 'approvals', 'cheque_approvals'];
});

/** The owner's company in the cloud, with an open bill of 250. */
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

/** A new device of `user`, with the company downloaded. */
async function device(
  name: string,
  company: { companyId: string; name: string },
  user: string,
  role: MemberRole,
) {
  await on(name);
  await startDownload({ id: company.companyId, name: company.name, role }, ctx(user));
  await syncCompany(company.companyId, ctx(user));
}

function cheque(companyId: string, bill: InvoiceDocument, number = '000101'): Payment {
  return createPayment(companyId, {
    direction: 'out',
    clientId: bill.clientId,
    date: '2026-10-05',
    amount: 250,
    currency: 'KWD',
    method: 'cheque',
    reference: number,
    allocations: [{ documentId: bill.id, amount: 250 }],
    cheque: newCheque({ number, bank: 'BRGN', date: '2026-10-20', drawer: 'Supplies' }),
  });
}

/** Staff on their device ask for a cheque to be confirmed, with a scan, and sync. */
async function askWithScan(companyId: string, bill: InvoiceDocument) {
  const proposal = cheque(companyId, bill);
  const error = await savePayment(proposal).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ChequeConfirmationRequiredError);
  const request = await requestChequeConfirmation((error as ChequeConfirmationRequiredError).ask);
  const scan = await addAttachment(companyId, proposal.id, {
    name: 'cheque.png',
    type: 'image/png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  });
  await syncCompany(companyId, ctx(STAFF));
  expect(server.record(companyId, 'attachments', scan.id)).toBeTruthy();
  return { proposal, request, scan };
}

describe('scans of a cheque asked for', () => {
  it('stay when a device that is behind expires a request confirmed on another device', async () => {
    const c = await company(CHEQUES);
    await device('staff', c, STAFF, 'staff');
    const { proposal, request, scan } = await askWithScan(c.companyId, c.bill);
    // The owner's laptop has it waiting, and is then put away.
    await device('laptop', c, OWNER, 'owner');
    // The owner confirms it on the phone.
    await device('phone', c, OWNER, 'owner');
    await decideApproval(request.id, 'approved');
    await syncCompany(c.companyId, ctx(OWNER));
    expect(server.record(c.companyId, 'approvals', request.id)).toMatchObject({
      status: 'applied',
    });
    // Weeks later the laptop expires it before it syncs.
    await on('laptop');
    expect(await expirePending(c.companyId, '2026-12-31')).toBe(1);
    await syncCompany(c.companyId, ctx(OWNER));
    expect(server.record(c.companyId, 'approvals', request.id)).toMatchObject({
      status: 'applied',
    });
    expect(server.record(c.companyId, 'payments', proposal.id)).toBeTruthy();
    expect(server.record(c.companyId, 'attachments', scan.id)).toBeTruthy();
    expect(server.files.size).toBe(1);
    // The laptop comes round to the cloud's decision.
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'applied' });
    expect(await db.attachments.get(scan.id)).toBeDefined();
  });

  it('stay when whoever asked takes back, offline, a request confirmed meanwhile', async () => {
    const c = await company(CHEQUES);
    await device('staff', c, STAFF, 'staff');
    const { request, scan } = await askWithScan(c.companyId, c.bill);
    await device('owner', c, OWNER, 'owner');
    await decideApproval(request.id, 'approved');
    await syncCompany(c.companyId, ctx(OWNER));
    await on('staff');
    await cancelApproval(request.id);
    await syncCompany(c.companyId, ctx(STAFF));
    expect(server.record(c.companyId, 'approvals', request.id)).toMatchObject({
      status: 'applied',
    });
    expect(server.record(c.companyId, 'attachments', scan.id)).toBeTruthy();
    expect(server.files.size).toBe(1);
  });

  it('go once the cloud has the request turned down, and no payment for it', async () => {
    const c = await company(CHEQUES);
    await device('staff', c, STAFF, 'staff');
    const { proposal, request, scan } = await askWithScan(c.companyId, c.bill);
    await device('owner', c, OWNER, 'owner');
    await decideApproval(request.id, 'rejected', 'Pay by transfer');
    // Not before the cloud has the decision.
    expect(await db.attachments.get(scan.id)).toBeDefined();
    await syncCompany(c.companyId, ctx(OWNER));
    expect(server.record(c.companyId, 'approvals', request.id)).toMatchObject({
      status: 'rejected',
    });
    expect(server.record(c.companyId, 'payments', proposal.id)).toBeUndefined();
    expect(server.record(c.companyId, 'attachments', scan.id)).toBeUndefined();
    expect(server.files.size).toBe(0);
  });
});

describe('a decision reaching the cloud', () => {
  it('is carried out only as the cloud keeps it: not on a request taken back meanwhile', async () => {
    const c = await company(CHEQUES);
    await device('staff', c, STAFF, 'staff');
    const { proposal, request } = await askWithScan(c.companyId, c.bill);
    await device('owner', c, OWNER, 'owner');
    // Staff take it back while the owner's device is offline.
    await on('staff');
    await cancelApproval(request.id);
    await syncCompany(c.companyId, ctx(STAFF));
    // The owner, offline, still has it waiting, and confirms it.
    await on('owner');
    expect(await decideApproval(request.id, 'approved')).toBe(false);
    expect(await db.payments.get(proposal.id)).toBeUndefined();
    await syncCompany(c.companyId, ctx(OWNER));
    expect(server.record(c.companyId, 'approvals', request.id)).toMatchObject({
      status: 'cancelled',
    });
    expect(server.record(c.companyId, 'payments', proposal.id)).toBeUndefined();
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'cancelled' });
    expect(await db.payments.get(proposal.id)).toBeUndefined();
    expect((await db.documents.get(c.bill.id))?.totals.balance).toBe(250);
    // And Carry it out again has nothing to carry out.
    await applyApproval(request.id);
    expect(await db.payments.get(proposal.id)).toBeUndefined();
  });

  it('is carried out by the sync that sends it, on the approver’s device', async () => {
    const c = await company(CHEQUES);
    await device('staff', c, STAFF, 'staff');
    const { proposal, request } = await askWithScan(c.companyId, c.bill);
    await device('owner', c, OWNER, 'owner');
    await decideApproval(request.id, 'approved');
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'approved' });
    await syncCompany(c.companyId, ctx(OWNER));
    expect(await db.approvals.get(request.id)).toMatchObject({
      status: 'applied',
      resultId: proposal.id,
    });
    expect(server.record(c.companyId, 'approvals', request.id)).toMatchObject({
      status: 'applied',
    });
    expect(server.record(c.companyId, 'payments', proposal.id)).toMatchObject({
      approvalId: request.id,
    });
  });

  it('records a replacement once when two of the owner’s devices confirm it', async () => {
    const c = await company(CHEQUES);
    // The owner writes a cheque (an approver's is recorded at once).
    const first = await savePayment(cheque(c.companyId, c.bill));
    await syncCompany(c.companyId, ctx(OWNER));
    await device('staff', c, STAFF, 'staff');
    const error = await replaceCheque(first.id, {
      amount: 250,
      cheque: { number: '000102', bank: 'BRGN', date: '2026-10-21', drawer: 'Supplies' },
      date: '2026-10-21',
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ChequeConfirmationRequiredError);
    const request = await requestChequeConfirmation((error as ChequeConfirmationRequiredError).ask);
    await syncCompany(c.companyId, ctx(STAFF));
    await device('laptop', c, OWNER, 'owner');
    await device('phone', c, OWNER, 'owner');
    await decideApproval(request.id, 'approved');
    await syncCompany(c.companyId, ctx(OWNER));
    // The laptop, offline, still has it waiting: confirmed there too.
    await on('laptop');
    await decideApproval(request.id, 'approved');
    await syncCompany(c.companyId, ctx(OWNER));
    // Carried out again by hand on the laptop: still the one payment.
    await applyApproval(request.id);
    await syncCompany(c.companyId, ctx(OWNER));
    const replacements = server
      .rows(c.companyId, 'payments')
      .filter((p) => (p.data.cheque as { number?: string } | undefined)?.number === '000102');
    expect(replacements).toHaveLength(1);
    expect(replacements[0].data).toMatchObject({ id: madeBy(request) });
    await device('check', c, OWNER, 'owner');
    expect((await db.documents.get(c.bill.id))?.totals.balance).toBe(0);
  });
});

describe('a change the cloud refuses', () => {
  it('leaves the bill a refused cheque pays as the cloud has it, without going back and forth', async () => {
    const c = await company(null);
    await device('staff', c, STAFF, 'staff');
    // The owner turns on cheque confirmation; the staff device doesn't know yet.
    const record = server.record(c.companyId, 'companies', c.companyId)!;
    await server
      .client(OWNER)
      .pushRecords(c.companyId, [
        { tbl: 'companies', id: c.companyId, data: { ...record, approvalRules: CHEQUES } },
      ]);
    await device('owner', c, OWNER, 'owner');
    await on('staff');
    await savePayment(cheque(c.companyId, c.bill));
    const statuses: string[] = [];
    for (let round = 0; round < 4; round++) {
      await on('staff');
      await syncCompany(c.companyId, ctx(STAFF));
      statuses.push(String(server.record(c.companyId, 'documents', c.bill.id)?.status));
      await on('owner');
      await syncCompany(c.companyId, ctx(OWNER));
      statuses.push(String(server.record(c.companyId, 'documents', c.bill.id)?.status));
    }
    // The bill update made with the refused cheque is held back with it.
    expect(statuses).toEqual(Array(8).fill('sent'));
    await on('staff');
    expect((await parkedEntries(c.companyId)).map((e) => `${e.table} ${e.error}`)).toContain(
      'payments approval_required',
    );
  });

  it('stops working out again a bill an older version keeps paying with a refused cheque', async () => {
    const c = await company(null);
    await device('staff', c, STAFF, 'staff');
    const record = server.record(c.companyId, 'companies', c.companyId)!;
    await server
      .client(OWNER)
      .pushRecords(c.companyId, [
        { tbl: 'companies', id: c.companyId, data: { ...record, approvalRules: CHEQUES } },
      ]);
    await device('owner', c, OWNER, 'owner');
    // An older version: the bill paid by a cheque the cloud refuses, sent on its own.
    await on('staff');
    const refused = cheque(c.companyId, c.bill);
    await server
      .client(STAFF)
      .pushRecords(c.companyId, [{ tbl: 'payments', id: refused.id, data: { ...refused } }])
      .then(
        () => expect.unreachable(),
        () => undefined,
      );
    const paid = server.record(c.companyId, 'documents', c.bill.id)!;
    const statuses: string[] = [];
    for (let round = 0; round < 6; round++) {
      // As the older version does after each sync: the bill, worked out with its cheque.
      await server.client(STAFF).pushRecords(c.companyId, [
        {
          tbl: 'documents',
          id: c.bill.id,
          data: {
            ...server.record(c.companyId, 'documents', c.bill.id)!,
            status: 'paid',
            totals: { ...(paid.totals as object), paid: 250, balance: 0 },
          },
        },
      ]);
      await on('owner');
      await syncCompany(c.companyId, ctx(OWNER));
      statuses.push(String(server.record(c.companyId, 'documents', c.bill.id)?.status));
    }
    // The owner's device works it out again a few times, then leaves it to the cloud.
    expect(statuses.slice(0, 3)).toEqual(['sent', 'sent', 'sent']);
    expect(statuses.slice(3)).toEqual(['paid', 'paid', 'paid']);
  });

  it('keeps the payments an issued invoice’s delete freed when the cloud refuses the delete', async () => {
    const owned = await setupCompany({ name: 'Gulf Pearl Trading', currency: 'KWD' });
    const customer = await saveClient(createClient(owned.id, { name: 'Made-up Customer' }));
    const draft = await draftDocument(owned, 'invoice', customer);
    draft.items[0] = { ...draft.items[0], name: 'Work', quantity: 1, unitPrice: 100, taxes: [] };
    const invoice = await saveDocument({ ...draft, status: 'sent' });
    const payment = await savePayment(
      createPayment(owned.id, {
        direction: 'in',
        clientId: customer.id,
        date: invoice.issueDate,
        amount: 100,
        currency: 'KWD',
        method: 'bank_transfer',
        reference: 'TT1',
        allocations: [{ documentId: invoice.id, amount: 100 }],
      }),
    );
    await startUpload(owned.id, ctx(OWNER));
    await syncCompany(owned.id, ctx(OWNER));
    server.addMember(owned.id, STAFF, 'staff');
    const c = { companyId: owned.id, name: owned.name };
    await device('staff', c, STAFF, 'staff');
    // The owner turns the rules on; the staff device doesn't know yet.
    const record = server.record(owned.id, 'companies', owned.id)!;
    const rules: ApprovalRules = {
      documentTypes: ['invoice', 'credit'],
      voidInsteadOfDelete: true,
    };
    await server
      .client(OWNER)
      .pushRecords(owned.id, [
        { tbl: 'companies', id: owned.id, data: { ...record, approvalRules: rules } },
      ]);
    await on('staff');
    await deleteDocument(invoice.id);
    await syncCompany(owned.id, ctx(STAFF));
    // Neither the delete nor the payment it freed reached the cloud.
    expect(server.record(owned.id, 'documents', invoice.id)).toMatchObject({ status: 'paid' });
    expect(server.record(owned.id, 'payments', payment.id)?.allocations).toEqual([
      { documentId: invoice.id, amount: 100 },
    ]);
    const parked = await parkedEntries(owned.id);
    expect(parked.map((e) => `${e.table} ${e.op}`).sort()).toEqual(
      expect.arrayContaining(['documents delete', 'payments put']),
    );
    // Now the rules are known here: deleting it asks for a void instead.
    const entry = parked.find((e) => e.table === 'documents')!;
    expect(canSendForApproval(entry)).toBe(true);
    const request = await sendParkedForApproval(owned.id, entry, ctx(STAFF), 'Issued twice');
    expect(request).toMatchObject({ kind: 'invoice_void', subjectId: invoice.id });
    // Everything is back as the cloud has it.
    expect(await db.documents.get(invoice.id)).toMatchObject({ status: 'paid' });
    expect((await db.payments.get(payment.id))?.allocations).toEqual([
      { documentId: invoice.id, amount: 100 },
    ]);
    expect(await parkedEntries(owned.id)).toEqual([]);
    expect(
      await deleteDocument(invoice.id).then(
        () => null,
        (e: unknown) => e,
      ),
    ).toBeInstanceOf(ApprovalRequiredError);
    await syncCompany(owned.id, ctx(STAFF));
    expect(server.record(owned.id, 'approvals', request.id)).toMatchObject({
      status: 'pending',
      kind: 'invoice_void',
    });
  });
});
