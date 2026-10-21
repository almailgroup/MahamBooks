import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { createClient } from '@/db/defaults';
import { saveClient, saveCompany, setupCompany } from '@/db/records';
import { draftDocument, saveDocument } from '@/db/documents';
import {
  ApprovalError,
  carryOutDecided,
  decideApproval,
  requestApproval,
  type ApprovalRequiredError,
} from '@/db/approvals';
import { markRemote } from '@/cloud/outbox';
import type { SyncManager } from '@/cloud/manager';
import type { MemberRole } from '@/cloud/roles';
import { CompanyProvider } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import type { Company, InvoiceDocument } from '@/db/types';
import { approve, carryOut } from './decide';
import { ApprovalRequestCard } from './request-card';

/**
 * Approving on a device: in a company kept in the cloud the change is
 * carried out once the cloud has the decision, as it keeps it; an approval
 * that can't be carried out may still be rejected. Made-up data only.
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(() => cleanup());

async function signedInAs(company: Company, role: MemberRole) {
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
  });
}

/** A staff member's edit of an issued invoice, waiting; the owner signed in now. */
async function asked() {
  const created = await setupCompany({ name: 'Gulf Pearl Trading', currency: 'KWD' });
  const company = await saveCompany({ ...created, approvalRules: { documentTypes: ['invoice'] } });
  const client = await saveClient(createClient(company.id, { name: 'Made-up Customer' }));
  const draft = await draftDocument(company, 'invoice', client);
  draft.items[0] = { ...draft.items[0], name: 'Guarding', quantity: 2, unitPrice: 150, taxes: [] };
  const invoice = await saveDocument({ ...draft, status: 'sent' });
  await signedInAs(company, 'staff');
  const error = (await saveDocument({ ...invoice, terms: 'Cash on delivery.' }).then(
    () => null,
    (e: unknown) => e,
  )) as ApprovalRequiredError;
  const request = await requestApproval({
    kind: 'invoice_edit',
    subject: error.subject,
    proposal: error.proposal,
    reason: 'The customer asked.',
  });
  await signedInAs(company, 'owner');
  return { company, invoice, request };
}

/** A stand-in for the sync: the cloud takes what is sent, and keeps `kept` when given. */
function syncing(kept?: 'cancelled'): SyncManager {
  return {
    syncNow: async (companyId: string) => {
      const sent = await db.outbox.where('table').equals('approvals').toArray();
      await db.transaction('rw', [db.approvals, db.outbox], async () => {
        markRemote();
        await db.outbox.bulkDelete(sent.map((e) => e.seq!));
        if (kept) {
          for (const e of sent) {
            await db.approvals.update(e.id, { status: kept });
          }
        }
      });
      await carryOutDecided(
        companyId,
        sent.map((e) => e.id),
        async () => false,
      );
    },
  } as unknown as SyncManager;
}

describe('approving in a company kept in the cloud', () => {
  it('carries the change out once the sync has sent the decision', async () => {
    const { invoice, request } = await asked();
    expect(await approve(request.id, syncing())).toBe('done');
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'applied' });
    expect((await db.documents.get(invoice.id))?.terms).toBe('Cash on delivery.');
  });

  it('waits while this device can’t reach the cloud, and carries it out then', async () => {
    const { invoice, request } = await asked();
    expect(await approve(request.id, null)).toBe('waiting');
    expect((await db.documents.get(invoice.id))?.terms).not.toBe('Cash on delivery.');
    expect(await carryOut(request.id, syncing())).toBe('done');
    expect((await db.documents.get(invoice.id))?.terms).toBe('Cash on delivery.');
  });

  it('says so when the cloud kept another decision, and changes nothing', async () => {
    const { invoice, request } = await asked();
    await expect(approve(request.id, syncing('cancelled'))).rejects.toBeInstanceOf(ApprovalError);
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'cancelled' });
    expect((await db.documents.get(invoice.id))?.terms).not.toBe('Cash on delivery.');
  });
});

describe('an approved request that wasn’t carried out', () => {
  function renderCard(request: Parameters<typeof ApprovalRequestCard>[0]['request']) {
    const router = createMemoryRouter([
      {
        path: '/',
        element: (
          <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
            <ApprovalRequestCard
              request={request}
              doc={undefined as InvoiceDocument | undefined}
              clients={new Map()}
              names={new Map()}
              approver
              userId="user-owner"
            />
          </CompanyProvider>
        ),
      },
    ]);
    render(
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>,
    );
  }

  it('can still be rejected by an approver', async () => {
    const { request } = await asked();
    await decideApproval(request.id, 'approved');
    await db.outbox.clear();
    renderCard((await db.approvals.get(request.id))!);
    expect(await screen.findByText(/Approved, but not carried out yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Carry it out again/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Reject/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject this request?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(async () =>
      expect(await db.approvals.get(request.id)).toMatchObject({ status: 'rejected' }),
    );
  });
});
