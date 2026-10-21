import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import type { Account } from '@/db/types';
import { CompanyProvider } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import { rememberedFormat, guessLayout } from '@/lib/banking/layout';
import { parseCsvRows } from '@/lib/banking/statement';
import { ImportStatementDialog } from './import-dialog';

/** The statement import dialog. Made-up data only. */

const reading = vi.hoisted(() => ({ gate: null as Promise<void> | null }));

vi.mock('./read-statement', async (original) => {
  const actual = await original<typeof import('./read-statement')>();
  return {
    ...actual,
    readStatementFile: async (data: ArrayBuffer | Uint8Array) => {
      // A large Excel file takes a moment to read.
      if (reading.gate) await reading.gate;
      return actual.readStatementFile(data);
    },
  };
});

beforeEach(async () => {
  await db.delete();
  await db.open();
  reading.gate = null;
});
afterEach(cleanup);

async function moneyAccounts(): Promise<Account[]> {
  const company = await setupCompany({ name: 'Sample Trading' });
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  return ['bank', 'cash'].map((role) => accounts.find((a) => a.role === role)!);
}

function renderDialog(accounts: Account[]) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
            <ImportStatementDialog
              accounts={accounts}
              initialAccountId={accounts[0].id}
              onClose={() => undefined}
            />
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

async function upload(csv: string) {
  const input = await screen.findByLabelText('Statement file', { selector: 'input' });
  await userEvent.upload(input, new File([csv], 'statement.csv', { type: 'text/csv' }));
}

describe('importing a statement', () => {
  it('reads the file with the layout of the account chosen while it was read', async () => {
    const [bank, cash] = await moneyAccounts();
    const csv = 'Statement\n2026-10-01,Coffee,-3.200\n2026-10-02,Lunch,-6.500\n';
    const rows = parseCsvRows(csv);
    const format = rememberedFormat('csv', rows, 1, guessLayout(rows, 1).mapping);
    await db.accounts.update(cash.id, { statementFormat: format });
    const remembering = { ...cash, statementFormat: format };
    let open!: () => void;
    reading.gate = new Promise((resolve) => (open = resolve));
    renderDialog([bank, remembering]);
    const user = userEvent.setup();
    await upload(csv);
    await user.selectOptions(screen.getByLabelText('Account'), cash.id);
    open();
    expect(
      await screen.findByText('Read with the layout remembered for this account.'),
    ).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: /Remember this layout for this account/ }),
    ).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Import 2 lines' }));
    await waitFor(async () =>
      expect(await db.bankTransactions.where('accountId').equals(cash.id).count()).toBe(2),
    );
    expect((await db.accounts.get(cash.id))?.statementFormat).toEqual(format);
  });

  it('keeps One column and a debit or credit column while its column is still to be chosen', async () => {
    renderDialog(await moneyAccounts());
    const user = userEvent.setup();
    await upload(
      'Date,Details,Amount,Side,Balance\n01/10/2026,Fee,1.250,O,98.750\n02/10/2026,Deposit,50.000,I,148.750\n',
    );
    const amounts = await screen.findByLabelText('Amounts');
    await user.selectOptions(amounts, 'amount-type');
    expect(screen.getByLabelText('Amounts')).toHaveValue('amount-type');
    const side = screen.getByLabelText(/Debit or credit/);
    expect(side).toHaveValue('');
  });

  it('offers to swap money in and money out when the balances go the other way', async () => {
    renderDialog(await moneyAccounts());
    const user = userEvent.setup();
    // The bank's Credit column is money out here, and its Debit column money in.
    await upload(
      'Date,Description,Credit,Debit,Balance\n01/10/2026,Fee,1.250,,98.750\n' +
        '02/10/2026,Transfer in,,50.000,148.750\n03/10/2026,Card,10.000,,138.750\n',
    );
    await screen.findByText(/money in and money out look swapped/);
    expect(screen.queryByText(/flip the signs/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Swap money in and money out' }));
    expect(await screen.findByText('The amounts add up to the balances in the file.')).toBeTruthy();
  });
});
