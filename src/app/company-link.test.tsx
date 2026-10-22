/**
 * A link into a company (…?company=<id>, the pay run approval emails, #10):
 * the company of the link is opened before the app's gate looks, so a
 * person who can't open People in the company open on the device still
 * reaches the pay run of the company that asked them. Made-up data only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { getCurrentCompanyId, setCurrentCompanyId, setupCompany } from '@/db/records';
import { ConfirmProvider } from '@/components/ui/overlay';
import type { MemberRole } from '@/cloud/roles';
import { AppGate } from '@/suite/app-gate';
import { CompanyProvider, useCompany } from './company';
import { CompanyOfLink } from './company-link';

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(cleanup);

async function companyAs(name: string, role: MemberRole) {
  const made = await setupCompany({ name, currency: 'KWD' });
  await db.syncState.put({
    companyId: made.id,
    userId: 'user-1',
    role,
    status: 'ready',
    cursor: 0,
    name: made.name,
    linkedAt: '2026-10-01T08:00:00.000Z',
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
  });
  return made;
}

function open(path: string, seen: string[]) {
  function PayRun() {
    const company = useCompany();
    seen.push(company.id);
    return <h1>Pay run in {company.name}</h1>;
  }
  const router = createMemoryRouter(
    [
      {
        path: '/payroll/runs/:id',
        element: (
          <CompanyOfLink>
            <AppGate app="people">
              <PayRun />
            </AppGate>
          </CompanyOfLink>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <ConfirmProvider>
      <CompanyProvider fallback={null} onboarding={null}>
        <RouterProvider router={router} />
      </CompanyProvider>
    </ConfirmProvider>,
  );
  return router;
}

describe('a link into a company', () => {
  it('opens the company of the link before People’s gate looks', async () => {
    const staffHere = await companyAs('Made-up Staff Co', 'staff');
    const asked = await companyAs('Made-up Asking Co', 'accountant');
    await setCurrentCompanyId(staffHere.id);
    const seen: string[] = [];
    const router = open(`/payroll/runs/run-1?company=${asked.id}`, seen);
    expect(
      await screen.findByRole('heading', { name: 'Pay run in Made-up Asking Co' }),
    ).toBeInTheDocument();
    expect(await getCurrentCompanyId()).toBe(asked.id);
    expect(router.state.location.pathname).toBe('/payroll/runs/run-1');
    expect(router.state.location.search).toBe('');
    // Never drawn, nor locked, in the company open before.
    expect(new Set(seen)).toEqual(new Set([asked.id]));
    expect(screen.queryByText(/not part of your role/)).toBeNull();
  });

  it('stays in the company open when this device doesn’t have the one of the link', async () => {
    const here = await companyAs('Made-up Here Co', 'accountant');
    await setCurrentCompanyId(here.id);
    const seen: string[] = [];
    const router = open('/payroll/runs/run-1?company=not-here', seen);
    expect(
      await screen.findByRole('heading', { name: 'Pay run in Made-up Here Co' }),
    ).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
  });
});
