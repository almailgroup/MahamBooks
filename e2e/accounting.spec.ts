import type { Page } from '@playwright/test';
import { chooseOption, expect, startWithDemoData, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await startWithDemoData(page);
});

/** The balance the chart of accounts shows for an account, in dinars. */
async function balance(page: Page, account: string): Promise<number> {
  await page.goto('#/accounts');
  const row = page.getByRole('row').filter({ hasText: account }).first();
  const text = await row.getByRole('cell').nth(3).innerText();
  return Number(text.replace(/[^\d.-]/g, ''));
}

test('the books balance', async ({ page }) => {
  await page.goto('#/reports/balance-sheet');
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();

  await page.goto('#/reports/trial-balance');
  const totals = page.locator('tfoot td');
  await expect(totals.nth(1)).not.toHaveText('');
  expect(await totals.nth(1).textContent()).toBe(await totals.nth(2).textContent());
});

test('a manual journal reaches the accounts and reports', async ({ page }) => {
  const before = await balance(page, 'Office equipment and computers');

  await page.goto('#/journals/new');
  await page.getByLabel('Reference').fill('Office chairs');
  const accounts = page.getByRole('button', { name: 'Choose an account…' });
  await chooseOption(page, accounts.first(), {
    placeholder: 'Search accounts…',
    query: 'Office equipment',
    option: '1520 Office equipment and computers',
  });
  await page.getByLabel('Line 1 debit').fill('600');
  await chooseOption(page, accounts.first(), {
    placeholder: 'Search accounts…',
    query: 'NBK',
    option: '1000 NBK – current account',
  });
  await page.getByLabel('Line 2 credit').fill('600');
  await page.getByRole('button', { name: 'Save and post' }).click();
  await expect(page).toHaveURL(/#\/journals$/);
  await expect(page.getByText('Office chairs')).toBeVisible();

  expect(await balance(page, 'Office equipment and computers')).toBeCloseTo(before + 600, 3);

  await page.goto('#/reports/general-ledger');
  await expect(page.getByRole('row', { name: /Office chairs.*600\.000/ }).first()).toBeVisible();
  await page.goto('#/reports/balance-sheet');
  await expect(page.getByText('Property and equipment', { exact: true })).toBeVisible();
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
});

test('an unbalanced journal is refused', async ({ page }) => {
  await page.goto('#/journals/new');
  await chooseOption(page, page.getByRole('button', { name: 'Choose an account…' }).first(), {
    placeholder: 'Search accounts…',
    query: 'Rent',
    option: '6060 Rent',
  });
  await page.getByLabel('Line 1 debit').fill('100');
  await expect(page.getByText('more debit')).toBeVisible();
  await page.getByRole('button', { name: 'Save and post' }).click();
  await expect(page.getByText('A journal needs at least two lines with amounts.')).toBeVisible();
});
