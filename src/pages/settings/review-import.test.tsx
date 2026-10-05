import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import { CompanyProvider } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import ImportSettings from './import';

/** The import preview shows dates as they were read. Made-up data only. */

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(cleanup);

function renderImport() {
  const router = createMemoryRouter(
    [
      {
        path: '/settings/import',
        element: (
          <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
            <ImportSettings />
          </CompanyProvider>
        ),
      },
    ],
    { initialEntries: ['/settings/import?kind=documents'] },
  );
  render(
    <ConfirmProvider>
      <RouterProvider router={router} />
    </ConfirmProvider>,
  );
}

describe('importing open invoices', () => {
  it('shows each date as it was read, with the month in words', async () => {
    await setupCompany({ name: 'Review Trading' });
    const user = userEvent.setup();
    renderImport();
    const csv = [
      'Invoice number,Customer,Date,Due date,Amount due',
      'INV-7001,Made-up Customer,03/09/2026,02/10/2026,15.000',
      'INV-7002,Made-up Customer,2026-08-15,,20.000',
    ].join('\n');
    const input = await screen.findByLabelText('Choose a CSV or Excel file', {
      selector: 'input',
    });
    await user.upload(input, new File([csv], 'open-invoices.csv', { type: 'text/csv' }));
    // 03/09/2026 is read day first: 3 September, due 2 October. The ISO date
    // of the second row is read as it is, whatever the format for text dates.
    expect(await screen.findByText('Made-up Customer · 3 Sep 2026 · → 2 Oct 2026')).toBeVisible();
    expect(screen.getByText('Made-up Customer · 15 Aug 2026 · → 14 Sep 2026')).toBeVisible();
  });
});
