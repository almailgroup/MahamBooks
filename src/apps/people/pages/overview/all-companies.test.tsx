/**
 * People → All companies: the employees of the companies switched on,
 * each company judged by its own role, never a company where the person is
 * staff or a viewer; opening one switches to their company first. Made-up
 * data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router';
import { db } from '@/db/db';
import { setCurrentCompanyId, setupCompany } from '@/db/records';
import { createEmployee, saveEmployee, setGroupSearch } from '@/db/people';
import type { CloudLink } from '@/cloud/types';
import type { MemberRole } from '@/cloud/roles';
import { CompanyProvider, useCompany } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import { AnyCompanyPeopleGate } from '@/features/cloud/role-gates';
import { useEmployees } from '@/features/people/hooks';
import AllCompaniesPage from './all-companies';

const ME = 'user-test-owner';
const cloud = vi.hoisted(() => ({ user: null as null | { id: string } }));

vi.mock('@/cloud/store', async (original) => ({
  ...(await original<typeof import('@/cloud/store')>()),
  useCloud: () => ({
    user: cloud.user,
    api: null,
    manager: null,
    configured: true,
    ready: true,
    redirectError: null,
  }),
}));

beforeEach(async () => {
  await db.delete();
  await db.open();
  cloud.user = { id: ME };
  localStorage.clear();
});
afterEach(cleanup);

const link = (companyId: string, role: MemberRole): CloudLink => ({
  companyId,
  userId: ME,
  role,
  status: 'ready',
  cursor: 0,
  name: companyId,
  linkedAt: '2026-10-01T09:00:00Z',
  lastSyncAt: null,
  lastError: null,
  lastErrorAt: null,
});

/** A company with one employee, switched on; linked with `role` afterwards (null: on this device only). */
async function companyWith(name: string, person: string, role: MemberRole | null, type?: string) {
  const company = await setupCompany({
    name,
    ...(type ? { companyType: { id: type, name: type } } : {}),
  });
  await saveEmployee(
    createEmployee(company.id, {
      name: person,
      civilId: '299010100005',
      iban: 'KW00TEST0000000000000000000005',
      basicSalary: 765.432,
    }),
  );
  await setGroupSearch(company.id, true);
  if (role) await db.syncState.put(link(company.id, role));
  return company;
}

function Employee() {
  const company = useCompany();
  const { id } = useParams();
  const employee = useEmployees()?.find((e) => e.id === id);
  return <h1>{employee ? `${employee.name} at ${company.name}` : 'Could not be found'}</h1>;
}

function show() {
  const router = createMemoryRouter(
    [
      {
        path: '/people/all',
        element: (
          <AnyCompanyPeopleGate>
            <AllCompaniesPage />
          </AnyCompanyPeopleGate>
        ),
      },
      { path: '/employees/:id', element: <Employee /> },
      { path: '/', element: <p>Home</p> },
    ],
    { initialEntries: ['/people/all'] },
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

describe('the employees of all companies', () => {
  it('come from the companies switched on whose role sees people, never staff ones', async () => {
    const device = await companyWith('Made-up Device Co', 'Test Person Device', null, 'security');
    await companyWith('Made-up Owned Co', 'Test Person Owned', 'owner');
    const staffed = await companyWith('Made-up Staffed Co', 'Test Person Staffed', 'staff');
    // Open in the staff company: its role doesn't decide for the others.
    await setCurrentCompanyId(staffed.id);
    show();

    const table = await screen.findByRole('table', { name: 'Employees' });
    expect(within(table).getByText('Test Person Device')).toBeInTheDocument();
    expect(within(table).getByText('Test Person Owned')).toBeInTheDocument();
    expect(screen.queryByText('Test Person Staffed')).toBeNull();
    // Nothing of pay, bank or papers.
    for (const secret of ['765.432', '765,432', 'KW00TEST', '299010100005']) {
      expect(document.body.textContent).not.toContain(secret);
    }
    // A switch for each company they see, none for the staff company.
    const switches = screen.getByRole('list', { name: 'Companies searched' });
    expect(within(switches).getAllByRole('switch')).toHaveLength(2);
    expect(within(switches).getByRole('switch', { name: /Made-up Device Co/ })).toBeChecked();
    expect(within(switches).getByRole('switch', { name: /Made-up Owned Co/ })).toBeChecked();
    expect(within(switches).queryByRole('switch', { name: /Made-up Staffed Co/ })).toBeNull();

    // Filtered by company type.
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Company type' }),
      'security',
    );
    expect(within(table).queryByText('Test Person Owned')).toBeNull();
    expect(within(table).getByText('Test Person Device')).toBeInTheDocument();
    expect(device.companyType?.id).toBe('security');
  });

  it('open an employee in their own company', async () => {
    await companyWith('Made-up First Co', 'Test Person First', null);
    const second = await companyWith('Made-up Second Co', 'Test Person Second', 'admin');
    const first = (await db.companies.toArray()).find((c) => c.id !== second.id)!;
    await setCurrentCompanyId(first.id);
    const router = show();
    await userEvent.click(await screen.findByRole('button', { name: 'Test Person Second' }));
    expect(
      await screen.findByRole('heading', { name: 'Test Person Second at Made-up Second Co' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toMatch(/^\/employees\//);
  });

  it('leave a company out once it is switched off, and linked ones when signed out', async () => {
    const device = await companyWith('Made-up Device Co', 'Test Person Device', null);
    await companyWith('Made-up Owned Co', 'Test Person Owned', 'owner');
    await setCurrentCompanyId(device.id);
    show();
    await screen.findByText('Test Person Owned');
    await userEvent.click(screen.getByRole('switch', { name: /Made-up Owned Co/ }));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Made-up Owned Co/ })).not.toBeChecked(),
    );
    expect(screen.queryByText('Test Person Owned')).toBeNull();
    cleanup();

    await setGroupSearch((await db.syncState.toArray())[0].companyId, true);
    cloud.user = null;
    show();
    await screen.findByText('Test Person Device');
    expect(screen.queryByText('Test Person Owned')).toBeNull();
    expect(screen.queryByRole('switch', { name: /Made-up Owned Co/ })).toBeNull();
  });

  it('are private to someone who sees people in no company here', async () => {
    const staffed = await companyWith('Made-up Staffed Co', 'Test Person Staffed', 'staff');
    await companyWith('Made-up Viewed Co', 'Test Person Viewed', 'viewer');
    await setCurrentCompanyId(staffed.id);
    show();
    expect(
      await screen.findByRole('heading', { name: 'Payroll and people are private' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Test Person/)).toBeNull();
  });
});
