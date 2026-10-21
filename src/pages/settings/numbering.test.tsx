import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { saveCompany, setupCompany } from '@/db/records';
import { CompanyProvider } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import type { Company } from '@/db/types';
import type { MemberRole } from '@/cloud/roles';
import NumberingSettings from './numbering';

/**
 * Settings → Numbering → Number invoices and credit notes when they are
 * issued. In a company kept in the cloud it waits for the server's approvals
 * script (server_features answers 'approvals'): until then nothing on the
 * server refuses an invoice an older version issues without its number.
 * Made-up data only.
 */

const NOTE =
  'The cloud needs the latest database script first. Ask the owner of the company to run it.';
const LABEL = /^Number invoices and credit notes when they are issued/;

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(() => cleanup());

function renderPage() {
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
          <NumberingSettings />
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

async function inTheCloud(company: Company, role: MemberRole, features?: string[]) {
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
    ...(features ? { features, featuresAt: new Date().toISOString() } : {}),
  });
}

/** The page once the company and its link to the cloud are read. */
async function opened() {
  renderPage();
  expect(await screen.findByText('Number formats')).toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.queryByRole('switch', { name: LABEL }) ?? screen.queryByText(NOTE, { exact: false }),
    ).not.toBeNull(),
  );
  // Nothing changes once the link has been read.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('numbering invoices when they are issued', () => {
  it('is switched on and off as before in a company kept on this device only', async () => {
    const company = await setupCompany({ name: 'Made-up Trading' });
    await opened();
    expect(screen.queryByText(NOTE, { exact: false })).toBeNull();
    const toggle = screen.getByRole('switch', { name: LABEL });
    expect(toggle).toBeEnabled();
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(async () =>
      expect((await db.companies.get(company.id))?.defaults.numberOnIssue).toBe(true),
    );
  });

  it('waits for the server’s script in a company kept in the cloud', async () => {
    for (const role of ['owner', 'admin'] as const) {
      for (const features of [undefined, ['tables_v16'], ['tables_v16', 'super_admin']]) {
        await db.delete();
        await db.open();
        const company = await setupCompany({ name: 'Made-up Trading' });
        await inTheCloud(company, role, features);
        await opened();
        expect(screen.getByText(NOTE, { exact: false })).toBeInTheDocument();
        expect(screen.queryByRole('switch', { name: LABEL })).toBeNull();
        expect(screen.queryByText(/Until it has run, turn this off/)).toBeNull();
        // The number formats are changed as before.
        expect(screen.getAllByLabelText('Pattern')[0]).toBeEnabled();
        cleanup();
      }
    }
  });

  it('is offered once the server has the script', async () => {
    const company = await setupCompany({ name: 'Made-up Trading' });
    await inTheCloud(company, 'owner', ['tables_v16', 'super_admin', 'approvals']);
    await opened();
    expect(screen.queryByText(NOTE, { exact: false })).toBeNull();
    const toggle = screen.getByRole('switch', { name: LABEL });
    expect(toggle).toBeEnabled();
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(async () =>
      expect((await db.companies.get(company.id))?.defaults.numberOnIssue).toBe(true),
    );
  });

  it('can still be turned off when it was on before the company moved to the cloud', async () => {
    const company = await setupCompany({ name: 'Made-up Trading' });
    await saveCompany({ ...company, defaults: { ...company.defaults, numberOnIssue: true } });
    await inTheCloud(company, 'owner', ['tables_v16']);
    await opened();
    expect(screen.getByText(NOTE, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Until it has run, turn this off/)).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: LABEL });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(async () =>
      expect((await db.companies.get(company.id))?.defaults.numberOnIssue).toBe(false),
    );
    // Off, it waits for the script like any other company in the cloud.
    await waitFor(() => expect(screen.queryByRole('switch', { name: LABEL })).toBeNull());
    expect(screen.getByText(NOTE, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/Until it has run, turn this off/)).toBeNull();
  });
});
