/**
 * Opening a page of another company (People → All companies, search): the
 * company is switched before the page opens, so the page is never drawn
 * with the company that was open before, and unsaved changes are asked
 * about once. Made-up data only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { getCurrentCompanyId, setCurrentCompanyId, setupCompany } from '@/db/records';
import { ConfirmProvider } from '@/components/ui/overlay';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { CompanyProvider, useCompany, useOpenInCompany } from './company';

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(cleanup);

function show(dirty: boolean, targetId: string, seen: string[]) {
  function Start() {
    const company = useCompany();
    const open = useOpenInCompany();
    useUnsavedGuard(dirty);
    return (
      <>
        <h1>Start in {company.name}</h1>
        <button onClick={() => void open(targetId, '/employees/e1')}>Open</button>
      </>
    );
  }
  function Target() {
    const company = useCompany();
    seen.push(company.id);
    return <h1>Employee in {company.name}</h1>;
  }
  const router = createMemoryRouter(
    [
      { path: '/', element: <Start /> },
      { path: '/employees/:id', element: <Target /> },
    ],
    { initialEntries: ['/'] },
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

async function twoCompanies() {
  const first = await setupCompany({ name: 'Made-up First Co' });
  const second = await setupCompany({ name: 'Made-up Second Co' });
  await setCurrentCompanyId(first.id);
  return { first, second };
}

describe('opening a page of another company', () => {
  it('switches the company first, then opens the page', async () => {
    const { second } = await twoCompanies();
    const seen: string[] = [];
    const router = show(false, second.id, seen);
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(
      await screen.findByRole('heading', { name: 'Employee in Made-up Second Co' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/employees/e1');
    expect(await getCurrentCompanyId()).toBe(second.id);
    // Never drawn with the company open before.
    expect(new Set(seen)).toEqual(new Set([second.id]));
  });

  it('asks once before losing unsaved changes, and stays when told to', async () => {
    const { first, second } = await twoCompanies();
    const seen: string[] = [];
    const router = show(true, second.id, seen);
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/');
    expect(await getCurrentCompanyId()).toBe(first.id);

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(
      await screen.findByRole('heading', { name: 'Employee in Made-up Second Co' }),
    ).toBeInTheDocument();
    // The form's own guard doesn't ask a second time.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(seen.every((id) => id === second.id)).toBe(true);
  });
});
