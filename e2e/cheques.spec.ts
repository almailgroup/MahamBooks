import type { Page } from '@playwright/test';
import { chooseOption, expect, startWithDemoData, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await startWithDemoData(page);
});

/** Creates and sends a fresh invoice; returns its number. */
async function sentInvoice(page: Page, item: string, price: string): Promise<string> {
  await page.goto('#/invoices/new');
  await chooseOption(page, page.getByLabel('Bill to'), {
    placeholder: 'Search clients…',
    query: 'Brightside',
    option: 'Brightside Retail Group',
  });
  await page.getByLabel('Item 1 name').fill(item);
  await page.getByLabel('Item 1 quantity').fill('1');
  await page.getByLabel('Item 1 unit price').fill(price);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/invoices\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark as sent' }).click();
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading.locator('..').getByText('Sent', { exact: true })).toBeVisible();
  return (await heading.textContent())!.replace(/^Invoice /, '').trim();
}

/** Records a cheque for the invoice on screen. */
async function payByCheque(page: Page, number: string) {
  await page.getByRole('button', { name: 'Record payment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record payment' });
  await dialog.getByLabel('Method').selectOption('cheque');
  await dialog.getByLabel('Cheque number').fill(number);
  await dialog.getByLabel('Bank', { exact: true }).selectOption('NBOK');
  await expect(dialog.getByLabel('Drawer', { exact: true })).toHaveValue('Brightside Retail Group');
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  await expect(dialog).toBeHidden();
}

test('post-dated cheques are tracked until they clear or come back', async ({ page }) => {
  // A cheque that clears.
  const first = await sentInvoice(page, 'Bulk mailing – October', '250');
  await payByCheque(page, '000123');
  const status = page.getByRole('heading', { level: 1 }).locator('..');
  await expect(status.getByText('Paid', { exact: true })).toBeVisible();

  await page.goto('#/cheques');
  await expect(page.getByRole('heading', { name: 'Cheques' })).toBeVisible();
  const row = page.getByRole('row', { name: /000123/ });
  await expect(row).toContainText('In hand');
  await expect(row).toContainText('National Bank of Kuwait');
  await expect(row).toContainText('Brightside Retail Group');
  await expect(row).toContainText('Today');

  await row.getByRole('button', { name: 'Actions for cheque 000123' }).click();
  await page.getByRole('menuitem', { name: 'Mark cleared' }).click();
  const clear = page.getByRole('dialog', { name: 'Mark cheque cleared' });
  await clear.getByRole('button', { name: 'Mark cleared' }).click();
  await expect(clear).toBeHidden();
  // Cleared cheques leave the open list.
  await expect(page.getByRole('row', { name: /000123/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'All' }).click();
  await expect(page.getByRole('row', { name: /000123/ })).toContainText('Cleared');

  // A cheque that comes back unpaid opens the invoice again.
  const second = await sentInvoice(page, 'Leaflet printing', '80');
  await payByCheque(page, '000124');
  await expect(status.getByText('Paid', { exact: true })).toBeVisible();

  await page.goto('#/cheques');
  const returned = page.getByRole('row', { name: /000124/ });
  await returned.getByRole('button', { name: 'Actions for cheque 000124' }).click();
  await page.getByRole('menuitem', { name: 'Mark returned' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark cheque returned' });
  await expect(dialog.getByLabel('Reason')).toHaveValue('Insufficient funds');
  await dialog.getByRole('button', { name: 'Mark returned' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('tab', { name: 'Returned' }).click();
  await expect(page.getByRole('row', { name: /000124/ })).toContainText('Returned');
  await expect(page.getByRole('row', { name: /000124/ })).toContainText('Insufficient funds');

  await page.goto('#/invoices');
  await page.getByLabel('Search invoices').fill(second);
  await page.getByRole('link', { name: second }).click();
  await expect(status.getByText('Sent', { exact: true })).toBeVisible();
  await expect(page.getByText('Returned', { exact: true })).toBeVisible();

  // The first invoice stays paid, and the books still balance.
  await page.goto('#/invoices');
  await page.getByLabel('Search invoices').fill(first);
  await page.getByRole('link', { name: first }).click();
  await expect(status.getByText('Paid', { exact: true })).toBeVisible();
  await page.goto('#/reports/balance-sheet');
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
});

test('the receipt voucher prints in English and Arabic', async ({ page }) => {
  await sentInvoice(page, 'Courier run', '40');
  await payByCheque(page, '000200');
  await page.goto('#/payments');
  await page.getByLabel('Search payments').fill('000200');
  await page
    .getByRole('row', { name: /000200/ })
    .getByRole('link')
    .first()
    .click();
  await expect(page).toHaveURL(/#\/payments\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Print voucher' }).click();
  await expect(page.getByText('Receipt voucher', { exact: true })).toBeVisible();
  await expect(page.getByText('سند قبض')).toBeVisible();
  await expect(page.getByText('000200')).toBeVisible();
  await expect(page.getByText(/pounds/i).first()).toBeVisible();
});
