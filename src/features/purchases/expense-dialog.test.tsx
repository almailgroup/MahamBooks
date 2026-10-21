import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { createExpense, saveExpense } from '@/db/purchases';
import { setupCompany } from '@/db/records';
import type { Expense } from '@/db/types';
import { CompanyProvider } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import { ExpenseDialog } from './expense-dialog';

/** The expense dialog. Made-up data only. */

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(cleanup);

async function savedExpense(): Promise<Expense> {
  const company = await setupCompany({ name: 'Sample Trading' });
  const category = (await db.accounts
    .where('[companyId+role]')
    .equals([company.id, 'expense'])
    .first())!;
  return saveExpense(
    createExpense(company.id, { accountId: category.id, amount: 4.5, description: 'Courier' }),
  );
}

function renderDialog(expense: Expense) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
            <ExpenseDialog expense={expense} isNew={false} onClose={() => undefined} />
          </CompanyProvider>
        ),
      },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <ConfirmProvider>
      <RouterProvider router={router} />
    </ConfirmProvider>,
  );
}

describe('an expense', () => {
  it('can’t print its voucher while a receipt added is still to be saved', async () => {
    renderDialog(await savedExpense());
    const print = await screen.findByRole('button', { name: 'Print voucher' });
    expect(print).toBeEnabled();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Attach a file'),
      new File(['%PDF-1.4'], 'receipt.pdf', { type: 'application/pdf' }),
    );
    expect(await screen.findByText('receipt.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Print voucher' })).toBeDisabled();
  });
});
