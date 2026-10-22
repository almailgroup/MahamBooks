import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import { CompanyProvider } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import { AppLayoutSection, withAppLayout } from './app-layout';

/** Settings → Team → App layout: off until the owner or an admin turns it on. Made-up data only. */

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(cleanup);

function show(canChange: boolean) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
            <AppLayoutSection canChange={canChange} />
          </CompanyProvider>
        ),
      },
    ],
    { initialEntries: ['/settings/team'] },
  );
  render(
    <ConfirmProvider>
      <RouterProvider router={router} />
    </ConfirmProvider>,
  );
}

describe('the app layout', () => {
  it('is written only when split, and left out to go back to the four apps', async () => {
    const company = await setupCompany({ name: 'Made-up Trading', currency: 'KWD' });
    expect(company).not.toHaveProperty('appLayout');
    const split = withAppLayout(company, true);
    expect(split.appLayout).toBe('split');
    expect(withAppLayout(split, false)).not.toHaveProperty('appLayout');
    expect(withAppLayout(split, false)).toEqual(company);
  });

  it('is off at first, and splits Books for the company once confirmed', async () => {
    const company = await setupCompany({ name: 'Made-up Trading', currency: 'KWD' });
    show(true);
    const toggle = await screen.findByRole('switch', {
      name: /Maham Sales and Maham Inventory as their own apps/,
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    const dialog = await screen.findByRole('dialog', {
      name: 'Give Sales and Inventory their own apps?',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch on' }));
    await waitFor(async () =>
      expect((await db.companies.get(company.id))?.appLayout).toBe('split'),
    );
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    // Back to the four apps, without asking.
    fireEvent.click(toggle);
    await waitFor(async () =>
      expect(await db.companies.get(company.id)).not.toHaveProperty('appLayout'),
    );
  });

  it('is changed only by the owner or an admin', async () => {
    await setupCompany({ name: 'Made-up Trading', currency: 'KWD' });
    show(false);
    const toggle = await screen.findByRole('switch', {
      name: /Maham Sales and Maham Inventory as their own apps/,
    });
    expect(toggle).toBeDisabled();
    expect(
      screen.getByText('Only the owner or an admin changes the app layout.'),
    ).toBeInTheDocument();
  });
});
