import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { createClient } from '@/db/defaults';
import { draftDocument, saveDocument } from '@/db/documents';
import { saveClient, setupCompany } from '@/db/records';
import type { Client, Company, InvoiceDocument } from '@/db/types';
import { CompanyProvider } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import { ReadOnlyContext } from '@/components/ui/read-only';
import { SendDialog, WhatsAppDialog } from './send-dialog';

/** Sending a draft with "Mark as sent". Made-up data only. */

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

const share = vi.fn(async () => undefined);

beforeEach(async () => {
  await db.delete();
  await db.open();
  vi.mocked(toast.error).mockClear();
  share.mockClear();
  Object.assign(navigator, { canShare: () => true, share });
});
afterEach(cleanup);

async function draftInvoice(): Promise<{
  company: Company;
  client: Client;
  invoice: InvoiceDocument;
}> {
  const company = await setupCompany({ name: 'Sample Trading' });
  const client = await saveClient(
    createClient(company.id, { name: 'Sample Customer', email: 'customer@example.com' }),
  );
  const draft = await draftDocument(company, 'invoice', client);
  draft.items[0] = { ...draft.items[0], name: 'Service', quantity: 1, unitPrice: 25 };
  const invoice = await saveDocument(draft);
  return { company, client, invoice };
}

function renderDialog(
  which: 'email' | 'whatsapp',
  props: { company: Company; client: Client; invoice: InvoiceDocument },
  getPdf: (issued?: boolean) => Promise<Blob>,
  readOnly = false,
) {
  const Dialog = which === 'email' ? SendDialog : WhatsAppDialog;
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
            <ReadOnlyContext.Provider value={{ readOnly, reason: 'View only' }}>
              <Dialog
                open
                onOpenChange={() => undefined}
                doc={props.invoice}
                company={props.company}
                client={props.client}
                getPdf={getPdf}
                fileName="invoice.pdf"
              />
            </ReadOnlyContext.Provider>
          </CompanyProvider>
        ),
      },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <ConfirmProvider>
      <RouterProvider router={router} />
    </ConfirmProvider>,
  );
}

const pdf = () => vi.fn(async () => new Blob(['%PDF-'], { type: 'application/pdf' }));

describe('sending a draft marked as sent', () => {
  for (const which of ['email', 'whatsapp'] as const) {
    it(`never hands out the signed copy when it can’t be marked as sent (${which})`, async () => {
      const setup = await draftInvoice();
      // Issuing it would post it into a locked period.
      await db.companies.update(setup.company.id, {
        accounting: { ...setup.company.accounting!, lockDate: setup.invoice.issueDate },
      });
      const getPdf = pdf();
      renderDialog(which, setup, getPdf);
      const user = userEvent.setup();
      expect(await screen.findByRole('checkbox', { name: /Mark as sent/ })).toBeChecked();
      await user.click(screen.getByRole('button', { name: /Share PDF/ }));
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(String(vi.mocked(toast.error).mock.calls[0][0])).toMatch(/locked/i);
      expect(getPdf).not.toHaveBeenCalled();
      expect(share).not.toHaveBeenCalled();
      expect((await db.documents.get(setup.invoice.id))?.status).toBe('draft');
    });
  }

  it('shares the signed copy, then marks it as sent', async () => {
    const setup = await draftInvoice();
    const getPdf = pdf();
    renderDialog('email', setup, getPdf);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Share PDF/ }));
    await waitFor(async () =>
      expect((await db.documents.get(setup.invoice.id))?.status).toBe('sent'),
    );
    expect(getPdf).toHaveBeenCalledWith(true);
    expect(share).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('for a viewer, offers no Mark as sent and shares the draft as a draft', async () => {
    const setup = await draftInvoice();
    const getPdf = pdf();
    renderDialog('whatsapp', setup, getPdf, true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Share PDF/ }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('checkbox', { name: /Mark as sent/ })).toBeNull();
    expect(getPdf).toHaveBeenCalledWith(false);
    expect(toast.error).not.toHaveBeenCalled();
    expect((await db.documents.get(setup.invoice.id))?.status).toBe('draft');
  });
});
