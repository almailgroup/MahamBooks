import { expect, startWithDemoData, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await startWithDemoData(page);
});

test('every page renders without errors', async ({ page }) => {
  const pages: [path: string, text: string][] = [
    ['#/invoices', 'INV-'],
    ['#/quotes', 'QUO-'],
    ['#/credits', 'CN-'],
    ['#/recurring', 'Monthly patient mailing'],
    ['#/payments', 'Record payment'],
    ['#/payments/new', 'Apply to invoices'],
    ['#/clients', 'Brightside Retail Group'],
    ['#/vendors', 'PaperMill Supplies Ltd'],
    ['#/bills', 'BILL-'],
    ['#/bills/new', "Vendor's invoice number"],
    ['#/vendor-credits', 'VC-'],
    ['#/payments-made', 'PM-'],
    ['#/payments-made/new', 'Apply to bills'],
    ['#/expenses', 'Printer toner'],
    ['#/products', 'Courier — next-day delivery'],
    ['#/reports', 'Profit and loss'],
    ['#/reports/balance-sheet', 'Total equity and liabilities'],
    ['#/reports/trial-balance', 'Trial balance'],
    ['#/reports/general-ledger', 'Closing balance'],
    ['#/reports/changes-in-equity', 'Statement of changes in equity'],
    ['#/reports/cash-flow', 'Statement of cash flows'],
    ['#/reports/asset-schedule', 'Fixed asset schedule'],
    ['#/reports/auditor-pack', 'Download auditor pack'],
    ['#/assets', 'No fixed assets yet'],
    ['#/assets/new', 'Depreciation preview'],
    ['#/year-end', 'Profit for'],
    ['#/reports/aging', 'Unpaid invoices'],
    ['#/reports/payables', 'Unpaid bills'],
    ['#/reports/purchases', 'Bills received'],
    ['#/reports/payments-made', 'Payments made'],
    ['#/accounts', 'Trade debtors'],
    ['#/journals', 'Share capital introduced'],
    ['#/vat', 'Next return to file'],
    ['#/banking', 'Bank current account'],
    ['#/settings/accounting', 'Financial year'],
    ['#/templates', 'Brand colour'],
    ['#/settings/company', 'Company profile'],
    ['#/settings/documents', 'Currency and paper'],
    ['#/settings/numbering', 'Number formats'],
    ['#/settings/taxes', 'Tax rates'],
    ['#/settings/payments', 'Online payment link'],
    ['#/settings/emails', 'Email templates'],
    ['#/settings/labels', 'Custom wording'],
    ['#/settings/data', 'Back up'],
    ['#/settings/companies', 'Add company'],
    ['#/no-such-page', 'Page not found'],
  ];
  for (const [path, text] of pages) {
    await page.goto(path);
    await expect(page.getByText(text).first(), path).toBeVisible();
  }
});

test('an accepted quote becomes an invoice', async ({ page }) => {
  await page.goto('#/quotes');
  await page.getByLabel('Search quotes').fill('Orbit');
  await page.getByRole('link', { name: /^QUO-/ }).first().click();
  await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Convert to invoice' }).click();
  await expect(page).toHaveURL(/#\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Invoice INV-/);
  await expect(page.getByRole('link', { name: /^Created from quote QUO-/ })).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
});
