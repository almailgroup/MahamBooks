import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { createClient } from '@/db/defaults';
import { createExpense, saveExpense } from '@/db/purchases';
import { saveClient, setupCompany } from '@/db/records';
import { CompanyProvider } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import PaymentVoucherPage from './voucher';

/** The expense voucher page. Made-up data only. */

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(cleanup);

describe('an expense voucher', () => {
  it('loads without first saying the expense could not be found', async () => {
    const company = await setupCompany({ name: 'Sample Trading' });
    const category = (await db.accounts
      .where('[companyId+role]')
      .equals([company.id, 'expense'])
      .first())!;
    const vendor = await saveClient(
      createClient(company.id, { name: 'Sample Paper Supplies', isVendor: true }),
    );
    const expense = await saveExpense(
      createExpense(company.id, {
        accountId: category.id,
        amount: 12.5,
        vendorId: vendor.id,
        description: 'Envelopes',
      }),
    );
    // Everything the page shows, as it shows it.
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(document.body.textContent ?? ''));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const router = createMemoryRouter(
      [
        {
          path: '/expenses/:id/voucher',
          element: (
            <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
              <PaymentVoucherPage source="expense" direction="out" />
            </CompanyProvider>
          ),
        },
      ],
      { initialEntries: [`/expenses/${expense.id}/voucher`] },
    );
    render(
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>,
    );
    expect((await screen.findAllByText(/Sample Paper Supplies/)).length).toBeGreaterThan(0);
    observer.disconnect();
    expect(seen.some((text) => text.includes('This expense could not be found.'))).toBe(false);
  });
});
