import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import {
  convertDocument,
  deleteDocument,
  duplicateDocument,
  recalculateDocuments,
  DocumentChangeError,
  DuplicateNumberError,
  draftDocument,
  markSent,
  reissueDocument,
  saveDocument,
  setDocumentStatus,
} from './documents';
import { saveClient, saveCompany, setupCompany } from './records';
import { createPayment, savePayment, setPaymentLink } from './payments';
import { releaseRetention } from './retention';
import {
  ApprovalError,
  ApprovalRequiredError,
  applyApproval,
  cancelApproval,
  changedSinceAsked,
  decideApproval,
  expirePending,
  mergeProposal,
  pendingRequestFor,
  pendingRequests,
  requestApproval,
  waitsForApproval,
} from './approvals';
import { CloudPermissionError } from '@/cloud/outbox';
import type { MemberRole } from '@/cloud/roles';
import type { ApprovalRules, Client, Company, InvoiceDocument } from './types';

/**
 * The approvals service on the device (D6), with invoices and credit notes
 * kept for approvers (#8), and invoice numbers that are never reused (D12).
 * Made-up data only.
 */

const RULES: ApprovalRules = {
  documentTypes: ['invoice', 'credit'],
  voidInsteadOfDelete: true,
  expireDays: 14,
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

async function setup(rules: ApprovalRules | null = RULES) {
  const created = await setupCompany({ name: 'Gulf Pearl Trading', currency: 'KWD' });
  const company = rules ? await saveCompany({ ...created, approvalRules: rules }) : created;
  const client = await saveClient(createClient(company.id, { name: 'Made-up Customer' }));
  return { company, client };
}

async function issue(company: Company, client: Client, unitPrice = 150) {
  const draft = await draftDocument(company, 'invoice', client);
  draft.items[0] = { ...draft.items[0], name: 'Guarding', quantity: 2, unitPrice, taxes: [] };
  return saveDocument({ ...draft, status: 'sent' });
}

async function pay(company: Company, doc: InvoiceDocument, amount: number) {
  return savePayment(
    createPayment(company.id, {
      direction: 'in',
      clientId: doc.clientId,
      date: doc.issueDate,
      amount,
      currency: doc.currency,
      method: 'bank_transfer',
      allocations: [{ documentId: doc.id, amount }],
    }),
  );
}

async function catchError(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('It went through');
}

const edited = (doc: InvoiceDocument): InvoiceDocument => ({
  ...doc,
  terms: 'Cash on delivery.',
  items: [{ ...doc.items[0], unitPrice: 120 }],
});

describe('without the rules', () => {
  it('leaves issued invoices to everyone who writes documents, as before', async () => {
    const { company, client } = await setup(null);
    const invoice = await issue(company, client);
    await signedInAs(company, 'staff');
    expect(waitsForApproval(company, await db.syncState.get(company.id), invoice)).toBe(false);
    const saved = await saveDocument(edited(invoice));
    expect(saved.totals.total).toBe(240);
    await setDocumentStatus(invoice.id, 'void');
    await setDocumentStatus(invoice.id, 'sent');
    await deleteDocument(invoice.id);
    expect(await db.documents.get(invoice.id)).toBeUndefined();
  });

  it('never applies to a company kept on this device only', async () => {
    const { company, client } = await setup();
    const invoice = await issue(company, client);
    expect(waitsForApproval(company, null, invoice)).toBe(false);
    await saveDocument(edited(invoice));
    await setDocumentStatus(invoice.id, 'void');
    // Void instead of delete is a cloud rule too.
    await deleteDocument(invoice.id);
    expect(await db.documents.count()).toBe(0);
  });
});

describe('with the rules on, for someone who is not an approver', () => {
  it('turns an edit of an issued invoice into a request, and saves nothing', async () => {
    const { company, client } = await setup();
    const invoice = await issue(company, client);
    for (const role of ['staff', 'accountant', 'admin'] as const) {
      await signedInAs(company, role);
      expect(waitsForApproval(company, await db.syncState.get(company.id), invoice)).toBe(true);
      const error = await catchError(saveDocument(edited(invoice)));
      expect(error).toBeInstanceOf(ApprovalRequiredError);
      expect((error as ApprovalRequiredError).kind).toBe('invoice_edit');
      expect((error as ApprovalRequiredError).proposal.totals.total).toBe(240);
      expect((await db.documents.get(invoice.id))?.totals.total).toBe(300);
      expect(await db.outbox.count()).toBe(0);
    }
  });

  it('turns a void or un-void into a request, and keeps drafts and new invoices free', async () => {
    const { company, client } = await setup();
    const invoice = await issue(company, client);
    await signedInAs(company, 'staff');
    const voiding = await catchError(setDocumentStatus(invoice.id, 'void'));
    expect(voiding).toMatchObject({ kind: 'invoice_void' });
    // Back to draft can't be asked for.
    expect(await catchError(setDocumentStatus(invoice.id, 'draft'))).toMatchObject({ kind: null });
    // New documents, drafts and their issuing are anyone's.
    const draft = await saveDocument(await draftDocument(company, 'invoice', client));
    await saveDocument({ ...draft, terms: 'Changed' });
    await markSent(draft.id);
    expect((await db.documents.get(draft.id))?.status).toBe('sent');
    // Quotes are not covered.
    const quote = await saveDocument({
      ...(await draftDocument(company, 'quote', client)),
      status: 'sent',
    });
    await saveDocument({ ...quote, terms: 'Changed' });
  });

  it('voids issued invoices instead of deleting them, for everyone; drafts are still deleted', async () => {
    const { company, client } = await setup();
    const invoice = await issue(company, client);
    for (const role of ['owner', 'staff'] as const) {
      await signedInAs(company, role);
      expect(await catchError(deleteDocument(invoice.id))).toBeInstanceOf(DocumentChangeError);
    }
    const draft = await saveDocument(await draftDocument(company, 'invoice', client));
    await deleteDocument(draft.id);
    expect(await db.documents.get(draft.id)).toBeUndefined();
  });

  it('lets payments, payment links and conversions change invoices as before', async () => {
    const { company, client } = await setup();
    const invoice = await issue(company, client);
    await signedInAs(company, 'staff');
    await pay(company, invoice, 100);
    expect(await db.documents.get(invoice.id)).toMatchObject({ status: 'partial' });
    await pay(company, invoice, 200);
    expect(await db.documents.get(invoice.id)).toMatchObject({ status: 'paid' });
    await setPaymentLink(invoice.id, {
      provider: 'other',
      url: 'https://pay.example.com/x',
      expiresAt: null,
    });
    const quote = await saveDocument({
      ...(await draftDocument(company, 'quote', client)),
      status: 'sent',
    });
    const converted = await convertDocument(quote.id, 'invoice');
    expect(converted.type).toBe('invoice');
    await db.documents.update(converted.id, { archived: true });
  });

  it('lets retention releases and recalculations change invoices as before', async () => {
    const { company, client } = await setup();
    const draft = await draftDocument(company, 'invoice', client);
    draft.items[0] = { ...draft.items[0], name: 'Works', quantity: 1, unitPrice: 1000, taxes: [] };
    const invoice = await saveDocument({
      ...draft,
      status: 'sent',
      retentionPercent: 5,
      retentionKind: 'tax',
    });
    await signedInAs(company, 'accountant');
    await releaseRetention(invoice.id, {
      date: invoice.issueDate,
      amount: 50,
      basis: 'handover',
      reference: 'Handed over',
    });
    expect((await db.documents.get(invoice.id))?.retentionReleases).toHaveLength(1);
    await recalculateDocuments([invoice.id]);
    // A credit note applied to it: the credit and the invoice move on as payments do.
    const credit = await duplicateDocument(invoice.id, 'credit', { sourceId: invoice.id });
    const issuedCredit = await saveDocument({ ...credit, status: 'sent' });
    await savePayment(
      createPayment(company.id, {
        direction: 'in',
        clientId: invoice.clientId,
        date: invoice.issueDate,
        amount: 100,
        currency: invoice.currency,
        method: 'credit_note',
        creditId: issuedCredit.id,
        reference: issuedCredit.number,
        allocations: [{ documentId: invoice.id, amount: 100 }],
      }),
    );
    expect((await db.documents.get(invoice.id))?.totals.paid).toBe(100);
  });

  it('is refused by the change capture too, where the save can’t ask (inside a transaction)', async () => {
    const { company, client } = await setup();
    const invoice = await issue(company, client);
    await signedInAs(company, 'staff');
    await expect(
      db.transaction('rw', [db.documents], () =>
        db.documents.put({ ...invoice, terms: 'Changed offline' }),
      ),
    ).rejects.toBeInstanceOf(CloudPermissionError);
  });

  it('keeps the approval rules to the owner', async () => {
    const { company } = await setup();
    await signedInAs(company, 'admin', true);
    await expect(saveCompany({ ...company, approvalRules: { documentTypes: [] } })).rejects.toThrow(
      /Only the owner changes the approval rules/,
    );
    await saveCompany({ ...company, phone: '+965 0000 0000' });
    await signedInAs(company, 'owner');
    await saveCompany({ ...company, approvalRules: { documentTypes: [] } });
  });
});

describe('requests', () => {
  async function asked() {
    const { company, client } = await setup();
    const invoice = await issue(company, client);
    await signedInAs(company, 'staff');
    const error = (await catchError(saveDocument(edited(invoice)))) as ApprovalRequiredError;
    const request = await requestApproval({
      kind: 'invoice_edit',
      subject: error.subject,
      proposal: error.proposal,
      reason: 'The customer asked for the new price.',
      byName: 'Made-up Staff',
    });
    return { company, client, invoice, request };
  }

  it('waits with what was asked, one at a time, and needs a reason', async () => {
    const { company, invoice, request } = await asked();
    expect(request).toMatchObject({
      kind: 'invoice_edit',
      status: 'pending',
      subjectTbl: 'documents',
      subjectId: invoice.id,
      subjectNumber: invoice.number,
      requestedBy: 'user-staff',
      requestedByName: 'Made-up Staff',
    });
    expect(request.before).toMatchObject({ terms: invoice.terms });
    expect(request.after).toMatchObject({ terms: 'Cash on delivery.' });
    expect((await pendingRequestFor(invoice.id))?.id).toBe(request.id);
    expect(await pendingRequests(company.id)).toHaveLength(1);
    await expect(
      requestApproval({ kind: 'invoice_void', subject: invoice, reason: 'Wrong customer' }),
    ).rejects.toBeInstanceOf(ApprovalError);
    await cancelApproval(request.id);
    await expect(
      requestApproval({ kind: 'invoice_void', subject: invoice, reason: '  ' }),
    ).rejects.toThrow(/Say why/);
  });

  it('is decided by an approver only, and carried out on the approver’s device', async () => {
    const { company, invoice, request } = await asked();
    await expect(decideApproval(request.id, 'approved')).rejects.toBeInstanceOf(ApprovalError);
    await signedInAs(company, 'accountant', true);
    await decideApproval(request.id, 'approved', 'Fine.');
    expect(await db.approvals.get(request.id)).toMatchObject({
      status: 'applied',
      decidedBy: 'user-accountant',
      decisionNote: 'Fine.',
    });
    expect(await db.documents.get(invoice.id)).toMatchObject({
      terms: 'Cash on delivery.',
      totals: expect.objectContaining({ total: 240 }),
    });
  });

  it('carries an edit onto the invoice as it is now: payments made since stay', async () => {
    const { company, invoice, request } = await asked();
    await pay(company, invoice, 100);
    const current = (await db.documents.get(invoice.id))!;
    expect(changedSinceAsked(request, current)).toBe(false);
    await signedInAs(company, 'owner');
    await decideApproval(request.id, 'approved');
    expect(await db.documents.get(invoice.id)).toMatchObject({
      status: 'partial',
      totals: expect.objectContaining({ total: 240, paid: 100, balance: 140 }),
    });
  });

  it('carries only what the request changed', () => {
    const current = {
      id: 'inv-1',
      terms: 'Changed by the owner meanwhile',
      notes: 'Old notes',
      intro: 'An introduction',
    } as unknown as InvoiceDocument;
    const merged = mergeProposal(
      current,
      { notes: 'Old notes', intro: 'An introduction', terms: 'Before' },
      { notes: 'New notes', terms: 'Before' },
    );
    expect(merged).toMatchObject({ notes: 'New notes', terms: 'Changed by the owner meanwhile' });
    expect('intro' in merged).toBe(false);
  });

  it('leaves the invoice as it was when rejected, and lets whoever asked take it back', async () => {
    const { company, invoice, request } = await asked();
    await signedInAs(company, 'owner');
    await decideApproval(request.id, 'rejected', 'Keep the old price.');
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'rejected' });
    expect((await db.documents.get(invoice.id))?.totals.total).toBe(300);
    await expect(decideApproval(request.id, 'approved')).rejects.toThrow(/already been decided/);

    await signedInAs(company, 'staff');
    const again = await requestApproval({
      kind: 'invoice_void',
      subject: invoice,
      reason: 'Issued twice',
    });
    await cancelApproval(again.id);
    expect(await db.approvals.get(again.id)).toMatchObject({ status: 'cancelled' });
  });

  it('voids with the reason, who and when, and frees the money paid as the customer’s credit', async () => {
    const { company, client } = await setup();
    const invoice = await issue(company, client);
    const payment = await pay(company, invoice, 300);
    await signedInAs(company, 'staff');
    const request = await requestApproval({
      kind: 'invoice_void',
      subject: (await db.documents.get(invoice.id))!,
      reason: 'Issued to the wrong customer',
    });
    await signedInAs(company, 'owner');
    await decideApproval(request.id, 'approved');
    const voided = await db.documents.get(invoice.id);
    expect(voided).toMatchObject({
      status: 'void',
      number: invoice.number,
      voidReason: 'Issued to the wrong customer',
      voidedBy: 'user-owner',
    });
    expect(voided?.voidedAt).toBeTruthy();
    expect((await db.payments.get(payment.id))?.allocations).toEqual([]);
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'applied' });

    // Back from void, asked for and approved.
    await signedInAs(company, 'staff');
    const back = await requestApproval({
      kind: 'invoice_unvoid',
      subject: voided!,
      reason: 'Voided by mistake',
    });
    await signedInAs(company, 'owner');
    await decideApproval(back.id, 'approved');
    expect(await db.documents.get(invoice.id)).toMatchObject({ status: 'sent', voidedAt: null });
  });

  it('stays approved when it can’t be carried out, to be tried again', async () => {
    const { company, invoice, request } = await asked();
    // Gone meanwhile (taken off this device by hand: the rules keep it in the cloud).
    await db.syncState.clear();
    await db.documents.delete(invoice.id);
    await signedInAs(company, 'owner');
    await expect(decideApproval(request.id, 'approved')).rejects.toThrow(/no longer exists/);
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'approved' });
    await expect(applyApproval(request.id)).rejects.toThrow(/no longer exists/);
  });

  it('are cancelled after the days the rules allow, on an approver’s device', async () => {
    const { company, request } = await asked();
    await db.approvals.update(request.id, { requestedAt: '2026-09-01T08:00:00.000Z' });
    expect(await expirePending(company.id, '2026-09-10')).toBe(0);
    // Only approvers cancel them.
    expect(await expirePending(company.id, '2026-10-01')).toBe(0);
    await signedInAs(company, 'owner');
    expect(await expirePending(company.id, '2026-09-15')).toBe(0);
    expect(await expirePending(company.id, '2026-09-16')).toBe(1);
    expect(await db.approvals.get(request.id)).toMatchObject({
      status: 'cancelled',
      expired: true,
    });
  });
});

describe('numbers are never reused (D12)', () => {
  it('voided documents keep their number, and it is never given again', async () => {
    const { company, client } = await setup(null);
    const invoice = await issue(company, client);
    await setDocumentStatus(invoice.id, 'void');
    expect((await db.documents.get(invoice.id))?.number).toBe(invoice.number);
    const next = await issue(company, client);
    expect(next.number).not.toBe(invoice.number);
    const draft = await draftDocument(company, 'invoice', client);
    await expect(saveDocument({ ...draft, number: invoice.number })).rejects.toBeInstanceOf(
      DuplicateNumberError,
    );
  });

  it('numbers drafts only when they are issued, with numberOnIssue', async () => {
    const created = await setupCompany({ name: 'Gulf Pearl Trading', currency: 'KWD' });
    const company = await saveCompany({
      ...created,
      defaults: { ...created.defaults, numberOnIssue: true },
    });
    const client = await saveClient(createClient(company.id, { name: 'Made-up Customer' }));
    const counter = async () => (await db.companies.get(company.id))!.numbering.invoice.next;
    const start = await counter();
    const draft = await saveDocument(await draftDocument(company, 'invoice', client));
    expect(draft.number).toBe('');
    // Deleting the draft uses up nothing.
    await deleteDocument(draft.id);
    expect(await counter()).toBe(start);
    const kept = await saveDocument(await draftDocument(company, 'invoice', client));
    await saveDocument({ ...kept, terms: 'Changed' });
    expect((await db.documents.get(kept.id))?.number).toBe('');
    await markSent(kept.id);
    const issued = await db.documents.get(kept.id);
    expect(issued?.number).toBeTruthy();
    expect(await counter()).toBe(start + 1);
    // Saved as issued straight from the editor: numbered then.
    const other = await saveDocument(await draftDocument(company, 'invoice', client));
    const sent = await saveDocument({ ...other, status: 'sent' });
    expect(sent.number).toBeTruthy();
    expect(sent.number).not.toBe(issued?.number);
    // Quotes are numbered when first saved, as before.
    const quote = await saveDocument(await draftDocument(company, 'quote', client));
    expect(quote.number).toBeTruthy();
  });

  it('issues a void invoice again with a new number that says which it replaces', async () => {
    const { company, client } = await setup(null);
    const invoice = await issue(company, client);
    await expect(reissueDocument(invoice.id)).rejects.toBeInstanceOf(DocumentChangeError);
    await setDocumentStatus(invoice.id, 'void', undefined, { voidReason: 'Wrong price' });
    const copy = await reissueDocument(invoice.id);
    expect(copy).toMatchObject({
      status: 'draft',
      replacesId: invoice.id,
      replacesNumber: invoice.number,
    });
    expect(copy.number).not.toBe(invoice.number);
    expect((await db.documents.get(invoice.id))?.replacedById).toBe(copy.id);
    await expect(reissueDocument(invoice.id)).rejects.toThrow(/already been issued again/);
    // The new draft deleted: the void one can be issued again.
    await deleteDocument(copy.id);
    expect((await db.documents.get(invoice.id))?.replacedById).toBeNull();
  });
});
