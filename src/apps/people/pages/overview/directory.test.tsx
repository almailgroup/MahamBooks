/**
 * The directory and the People overview show how to reach people, never
 * their pay, Civil ID or bank account. Made-up data.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { setCurrentCompanyId, setupCompany } from '@/db/records';
import { createEmployee, saveEmployee } from '@/db/people';
import { CompanyProvider } from '@/app/company';
import DirectoryPage from './directory';
import PeopleOverview from './index';

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(cleanup);

const SECRETS = [
  '290010100001',
  'KW00TEST0000000000000000000001',
  '1,234.500',
  '1234.5',
  'P1234567',
];

async function staff() {
  const c = await setupCompany({ name: 'Test Directory Co' });
  await setCurrentCompanyId(c.id);
  await saveEmployee(
    createEmployee(c.id, {
      name: 'Test Person One',
      jobTitle: 'Storekeeper',
      department: 'Warehouse',
      phone: '+965 5555 0199',
      email: 'one@example.com',
      civilId: '290010100001',
      passportNumber: 'P1234567',
      iban: 'KW00TEST0000000000000000000001',
      basicSalary: 1234.5,
      hireDate: '2024-01-01',
    }),
  );
}

function show(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/people', element: <PeopleOverview /> },
      { path: '/people/directory', element: <DirectoryPage /> },
    ],
    { initialEntries: [path] },
  );
  render(
    <CompanyProvider fallback={null} onboarding={null}>
      <RouterProvider router={router} />
    </CompanyProvider>,
  );
}

describe('the staff directory', () => {
  it('shows the job, department, phone and email only', async () => {
    await staff();
    show('/people/directory');
    expect(await screen.findByRole('link', { name: 'Test Person One' })).toBeInTheDocument();
    expect(screen.getByText('Storekeeper · Warehouse')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+965 5555 0199' })).toHaveAttribute(
      'href',
      'tel:+96555550199',
    );
    expect(screen.getByRole('link', { name: 'one@example.com' })).toHaveAttribute(
      'href',
      'mailto:one@example.com',
    );
    const text = document.body.textContent ?? '';
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  it('and the overview has no pay either', async () => {
    await staff();
    show('/people');
    expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Warehouse')).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });
});
