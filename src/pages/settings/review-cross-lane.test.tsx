import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { saveCompany, setupCompany } from '@/db/records';
import { CompanyProvider } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import type { Company } from '@/db/types';
import type { MemberRole } from '@/cloud/roles';
import DocumentSettings from './documents';
import ComplianceSettingsPage from './compliance';

/**
 * Settings where the Books lane and the People and Compliance lane meet: the
 * vouchers' settings, which only owners, admins and accountants change, and
 * the compliance switches, found from Settings. Made-up data only.
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(() => cleanup());

function renderPage(page: ReactNode) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
          {page}
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

async function inTheCloud(company: Company, role: MemberRole) {
  await db.syncState.put({
    companyId: company.id,
    userId: `user-${role}`,
    role,
    status: 'ready',
    cursor: 1,
    name: company.name,
    linkedAt: new Date().toISOString(),
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
  });
}

describe('the vouchers’ settings', () => {
  const voucherSwitch = () => screen.findByRole('switch', { name: /stamp, signature and address/ });

  it('are changed by owners, admins and accountants', async () => {
    const company = await setupCompany({ name: 'Made-up Trading' });
    await inTheCloud(company, 'accountant');
    renderPage(<DocumentSettings />);
    const toggle = await voucherSwitch();
    // The role is known once the cloud link is read.
    await waitFor(() => expect(toggle).toBeEnabled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(toggle).toBeEnabled();
    expect(screen.queryByText(/set up vouchers/)).toBeNull();
  });

  it('are only looked at by staff and viewers', async () => {
    for (const role of ['staff', 'viewer'] as const) {
      await db.delete();
      await db.open();
      const company = await setupCompany({ name: 'Made-up Trading' });
      await inTheCloud(company, role);
      renderPage(<DocumentSettings />);
      // Once the role is known.
      expect(
        await screen.findByText(
          'Owners, admins and accountants set up vouchers. You can look at them.',
        ),
      ).toBeInTheDocument();
      expect(await voucherSwitch()).toBeDisabled();
      expect(screen.getByLabelText('PDF paper')).toBeDisabled();
      for (const line of screen.getAllByLabelText('Signature line 1 in English')) {
        expect(line).toBeDisabled();
      }
      expect(screen.getAllByRole('button', { name: 'Add a line' })[0]).toBeDisabled();
      cleanup();
    }
  });
});

describe('Settings → Compliance and files', () => {
  it('says which switches are on and opens the compliance settings', async () => {
    const company = await setupCompany({ name: 'Made-up Guarding' });
    await saveCompany({ ...company, fileFinder: true });
    renderPage(<ComplianceSettingsPage />);
    const finder = (await screen.findByText('Find files and papers')).parentElement!;
    expect(within(finder).getByText('Switched on')).toBeInTheDocument();
    const extras = screen.getByText('Contracts, customers and vehicles').parentElement!;
    expect(within(extras).getByText('Switched off')).toBeInTheDocument();

    const open = await screen.findByRole('button', { name: 'Compliance settings' });
    await waitEnabled(open);
    await userEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Compliance settings' });
    expect(within(dialog).getByRole('switch', { name: /^Find files and papers/ })).toBeChecked();
  });

  it('can’t be changed by a viewer', async () => {
    const company = await setupCompany({ name: 'Made-up Guarding' });
    await inTheCloud(company, 'viewer');
    renderPage(<ComplianceSettingsPage />);
    expect(
      await screen.findByText('You can view this company but not change it.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compliance settings' })).toBeNull();
  });
});

async function waitEnabled(element: HTMLElement) {
  for (let i = 0; i < 50 && (element as HTMLButtonElement).disabled; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(element).toBeEnabled();
}
