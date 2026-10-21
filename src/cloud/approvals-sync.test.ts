import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createClient } from '@/db/defaults';
import { saveClient, saveCompany, setupCompany } from '@/db/records';
import { draftDocument, saveDocument } from '@/db/documents';
import { ApprovalRequiredError, decideApproval, requestApproval } from '@/db/approvals';
import { sendParkedForApproval } from '@/features/approvals/parked';
import type { ApprovalRules, InvoiceDocument } from '@/db/types';
import type { MemberRole } from './roles';
import { FakeCloud } from './testing/fake-cloud';
import { startDownload, startUpload, syncCompany, type SyncContext } from './sync';

/**
 * Approval requests and issued invoices kept for approvers, between devices
 * through the cloud (here its stand-in, which answers as the server does).
 * Made-up data only.
 */

const OWNER = 'user-owner';
const STAFF = 'user-staff';
const RULES: ApprovalRules = { documentTypes: ['invoice', 'credit'], voidInsteadOfDelete: true };

let server: FakeCloud;
const ctx = (user: string): SyncContext => ({ api: server.client(user), userId: user });

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = new FakeCloud();
  server.features = ['tables_v16', 'super_admin', 'approvals'];
});

/** The owner's company in the cloud with an issued invoice; then this device is `user`'s. */
async function company(rules: ApprovalRules | null) {
  const created = await setupCompany({ name: 'Gulf Pearl Trading', currency: 'KWD' });
  const owned = rules ? await saveCompany({ ...created, approvalRules: rules }) : created;
  const client = await saveClient(createClient(owned.id, { name: 'Made-up Customer' }));
  const draft = await draftDocument(owned, 'invoice', client);
  draft.items[0] = { ...draft.items[0], name: 'Guarding', quantity: 2, unitPrice: 150, taxes: [] };
  const invoice = await saveDocument({ ...draft, status: 'sent' });
  await startUpload(owned.id, ctx(OWNER));
  await syncCompany(owned.id, ctx(OWNER));
  server.addMember(owned.id, STAFF, 'staff');
  return { companyId: owned.id, name: owned.name, invoice };
}

/** This device becomes `user`'s, with the company downloaded. */
async function deviceOf(companyId: string, name: string, user: string, role: MemberRole) {
  await db.delete();
  await db.open();
  await startDownload({ id: companyId, name, role }, ctx(user));
  await syncCompany(companyId, ctx(user));
}

const edited = (doc: InvoiceDocument): InvoiceDocument => ({
  ...doc,
  terms: 'Cash on delivery.',
  items: [{ ...doc.items[0], unitPrice: 120 }],
});

describe('approvals through the cloud', () => {
  it('a staff member asks, the owner approves on their device, and both end up with the change', async () => {
    const { companyId, name, invoice } = await company(RULES);
    await deviceOf(companyId, name, STAFF, 'staff');
    const local = (await db.documents.get(invoice.id))!;
    let error: unknown;
    await saveDocument(edited(local)).catch((e: unknown) => (error = e));
    expect(error).toBeInstanceOf(ApprovalRequiredError);
    const { subject, proposal } = error as ApprovalRequiredError;
    const request = await requestApproval({
      kind: 'invoice_edit',
      subject,
      proposal,
      reason: 'New price agreed.',
    });
    expect((await syncCompany(companyId, ctx(STAFF))).parked).toBe(0);
    // The cloud stamped who asked.
    expect(server.record(companyId, 'approvals', request.id)).toMatchObject({
      status: 'pending',
      requestedBy: STAFF,
    });

    await deviceOf(companyId, name, OWNER, 'owner');
    await decideApproval(request.id, 'approved');
    expect((await syncCompany(companyId, ctx(OWNER))).parked).toBe(0);
    expect(server.record(companyId, 'approvals', request.id)).toMatchObject({
      status: 'applied',
      decidedBy: OWNER,
    });
    expect(server.record(companyId, 'documents', invoice.id)).toMatchObject({
      terms: 'Cash on delivery.',
    });

    await deviceOf(companyId, name, STAFF, 'staff');
    expect(await db.documents.get(invoice.id)).toMatchObject({ terms: 'Cash on delivery.' });
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'applied' });
  });

  it('parks an edit made before this device knew the rules, which can then be sent for approval', async () => {
    const { companyId, name, invoice } = await company(null);
    await deviceOf(companyId, name, STAFF, 'staff');
    // The owner turns the rules on meanwhile.
    const record = server.record(companyId, 'companies', companyId)!;
    await server
      .client(OWNER)
      .pushRecords(companyId, [
        { tbl: 'companies', id: companyId, data: { ...record, approvalRules: RULES } },
      ]);
    // This device doesn't know yet: it saves the edit.
    await saveDocument(edited((await db.documents.get(invoice.id))!));
    const result = await syncCompany(companyId, ctx(STAFF));
    expect(result.parked).toBe(1);
    const parked = (await db.outbox.toArray()).filter((e) => e.parked === 1);
    expect(parked.map((e) => `${e.table} ${e.error}`)).toEqual(['documents approval_required']);
    expect(server.record(companyId, 'documents', invoice.id)).toMatchObject({
      terms: invoice.terms,
    });
    // Known now (the company record came with the same sync).
    expect((await db.companies.get(companyId))?.approvalRules).toEqual(RULES);

    const request = await sendParkedForApproval(
      companyId,
      parked[0],
      ctx(STAFF),
      'Price changed before the rules',
    );
    expect(request).toMatchObject({ kind: 'invoice_edit', status: 'pending' });
    expect(request.after).toMatchObject({ terms: 'Cash on delivery.' });
    // Back to the cloud's copy here, and the request goes up.
    expect(await db.documents.get(invoice.id)).toMatchObject({ terms: invoice.terms });
    expect((await syncCompany(companyId, ctx(STAFF))).parked).toBe(0);
    expect(server.record(companyId, 'approvals', request.id)).toMatchObject({
      status: 'pending',
      requestedBy: STAFF,
    });
  });

  it('changes nothing for a server without approvals', async () => {
    server.features = ['tables_v16', 'super_admin'];
    const { companyId, name, invoice } = await company(null);
    await deviceOf(companyId, name, STAFF, 'staff');
    await saveDocument(edited((await db.documents.get(invoice.id))!));
    expect((await syncCompany(companyId, ctx(STAFF))).parked).toBe(0);
    expect(server.record(companyId, 'documents', invoice.id)).toMatchObject({
      terms: 'Cash on delivery.',
    });
  });
});
