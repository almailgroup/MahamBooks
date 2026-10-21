import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { toast, Toaster } from 'sonner';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import { CompanyProvider } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import type { CloudLink } from '@/cloud/types';
import type { MemberRole } from '@/cloud/roles';
import TemplatesPage from './templates';

/** The Templates page: a design per type of document. Made-up data only. */

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(() => {
  cleanup();
  toast.dismiss();
});

async function companyAs(role: MemberRole | null) {
  const company = await setupCompany({
    name: 'Al Waha Trading',
    branding: { templateId: 'modern', accentColor: '#4f46e5' },
  });
  if (role) {
    const link: CloudLink = {
      companyId: company.id,
      userId: 'user-1',
      role,
      status: 'ready',
      cursor: 0,
      name: company.name,
      linkedAt: new Date().toISOString(),
      lastSyncAt: null,
      lastError: null,
      lastErrorAt: null,
    };
    await db.syncState.put(link);
  }
  return company;
}

function renderPage(path = '/templates') {
  const router = createMemoryRouter(
    [
      {
        path: '/templates',
        element: (
          <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
            <TemplatesPage />
          </CompanyProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <ConfirmProvider>
      <RouterProvider router={router} />
      <Toaster />
    </ConfirmProvider>,
  );
  return router;
}

const sameAsInvoices = () => screen.getByRole('switch', { name: /Same as invoices/ });

describe('the Templates page', () => {
  it('gives quotes a design of their own and keeps the invoices’', async () => {
    const company = await companyAs(null);
    const user = userEvent.setup();
    const router = renderPage();
    await screen.findByRole('heading', { name: 'Invoice design' });
    await user.click(screen.getByRole('tab', { name: 'Quotes' }));
    expect(router.state.location.search).toBe('?type=quote');
    expect(await screen.findByRole('heading', { name: 'Quote design' })).toBeVisible();

    // They follow the invoices until that is turned off.
    expect(sameAsInvoices()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Logo size')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Use Classic as the default template' }),
    ).toBeNull();
    await user.click(sameAsInvoices());
    expect(screen.getByLabelText('Logo size')).toBeEnabled();
    await user.click(screen.getByRole('switch', { name: /Customer acceptance box/ }));
    await user.click(screen.getByRole('button', { name: 'Use Classic as the default template' }));
    await screen.findByText('Quotes now print with Classic');

    const saved = (await db.companies.get(company.id))!;
    expect(saved.branding.templateId).toBe('modern');
    expect(saved.branding.byType?.quote).toEqual({
      templateId: 'classic',
      accentColor: '#4f46e5',
      layout: { showAcceptance: true },
    });
    // The page reads it back: Classic is the quotes' design.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Use Classic as the default template' }),
      ).toBeNull(),
    );
  });

  it('opens on the tab of its address and has no acceptance box for credit notes', async () => {
    await companyAs(null);
    renderPage('/templates?type=credit');
    expect(await screen.findByRole('heading', { name: 'Credit note design' })).toBeVisible();
    expect(screen.queryByRole('switch', { name: /Customer acceptance box/ })).toBeNull();
  });

  it.each(['staff', 'viewer'] as const)('is for looking at only, for %s', async (role) => {
    await companyAs(role);
    renderPage('/templates?type=quote');
    await screen.findByRole('heading', { name: 'Quote design' });
    // Once the role is read from the company's link to the cloud.
    await waitFor(() => expect(sameAsInvoices()).toBeDisabled());
    expect(screen.getByLabelText('Font')).toBeDisabled();
    expect(screen.getByRole('switch', { name: /Paid and void stamp/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Use .* as the default template$/ })).toBeNull();
    if (role === 'staff') {
      expect(screen.getByRole('note')).toHaveTextContent(
        'Owners, admins and accountants choose the design of documents.',
      );
    }
  });
});
