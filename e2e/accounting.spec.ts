import { chooseOption, expect, startWithDemoData, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await startWithDemoData(page);
});

test('the books balance', async ({ page }) => {
  await page.goto('#/reports/balance-sheet');
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();

  await page.goto('#/reports/trial-balance');
  const totals = page.locator('tfoot td');
  await expect(totals.nth(1)).not.toHaveText('');
  expect(await totals.nth(1).textContent()).toBe(await totals.nth(2).textContent());
});

test('a manual journal reaches the accounts and reports', async ({ page }) => {
  await page.goto('#/journals/new');
  await page.getByLabel('Reference').fill('Office chairs');
  const accounts = page.getByRole('button', { name: 'Choose an account…' });
  await chooseOption(page, accounts.first(), {
    placeholder: 'Search accounts…',
    query: 'Office equipment',
    option: '0030 Office equipment',
  });
  await page.getByLabel('Line 1 debit').fill('600');
  await chooseOption(page, accounts.first(), {
    placeholder: 'Search accounts…',
    query: 'Bank current',
    option: '1200 Bank current account',
  });
  await page.getByLabel('Line 2 credit').fill('600');
  await page.getByRole('button', { name: 'Save and post' }).click();
  await expect(page).toHaveURL(/#\/journals$/);
  await expect(page.getByText('Office chairs')).toBeVisible();

  await page.goto('#/accounts');
  await expect(
    page.getByRole('row', { name: /Office equipment\b.*£600\.00/ }).first(),
  ).toBeVisible();

  await page.goto('#/reports/balance-sheet');
  await expect(page.getByText('Property and equipment', { exact: true })).toBeVisible();
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
});

test('an unbalanced journal is refused', async ({ page }) => {
  await page.goto('#/journals/new');
  await chooseOption(page, page.getByRole('button', { name: 'Choose an account…' }).first(), {
    placeholder: 'Search accounts…',
    query: 'Rent',
    option: '7000 Rent and rates',
  });
  await page.getByLabel('Line 1 debit').fill('100');
  await expect(page.getByText('more debit')).toBeVisible();
  await page.getByRole('button', { name: 'Save and post' }).click();
  await expect(page.getByText('A journal needs at least two lines with amounts.')).toBeVisible();
});
