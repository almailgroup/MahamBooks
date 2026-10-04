import { expect, startWithDemoData, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await startWithDemoData(page);
});

test('every page renders without errors', async ({ page }) => {
  test.slow();
  const pages: [path: string, text: string][] = [
    ['#/invoices', 'INV-'],
    ['#/quotes', 'QUO-'],
    ['#/proformas', 'PF-'],
    ['#/sales-orders', 'SO-'],
    ['#/delivery-notes', 'DN-'],
    ['#/credits', 'CN-'],
    ['#/recurring', 'Gulf Pearl Hotel monthly maintenance'],
    ['#/payments', 'Record payment'],
    ['#/payments/new', 'Apply to invoices'],
    ['#/cheques', '004418'],
    ['#/clients', 'Al Bawaba Construction Co. W.L.L.'],
    ['#/vendors', 'Shenzhen Brightway Lighting Co., Ltd.'],
    ['#/purchase-orders', 'PO-'],
    ['#/bills', 'BILL-'],
    ['#/bills/new', "Vendor's invoice number"],
    ['#/vendor-credits', 'VC-'],
    ['#/payments-made', 'PM-'],
    ['#/payments-made/new', 'Apply to bills'],
    ['#/expenses', 'Shuwaikh office and store rent'],
    ['#/products', 'Installation labour'],
    ['#/inventory', 'IP dome camera 4 MP'],
    ['#/inventory/count', 'Electrical cable 2.5 mm², 100 m roll'],
    ['#/employees', 'Rajesh Kumar Nair'],
    ['#/payroll', 'PIFSS'],
    ['#/payroll/leave', 'Abdulaziz Saleh Al-Mutairi'],
    ['#/payroll/loans', 'Mohammed Abdelrahman Hassan'],
    ['#/payroll/settings', 'Pay day'],
    ['#/compliance', 'Vehicle insurance'],
    ['#/compliance/documents', 'Toyota Hilux double cab, plate 18/62417'],
    ['#/reports', 'Profit and loss'],
    ['#/reports/balance-sheet', 'Total equity and liabilities'],
    ['#/reports/trial-balance', 'Trial balance'],
    ['#/reports/general-ledger', 'Closing balance'],
    ['#/reports/changes-in-equity', 'Statement of changes in equity'],
    ['#/reports/cash-flow', 'Statement of cash flows'],
    ['#/reports/asset-schedule', 'Fixed asset schedule'],
    ['#/reports/auditor-pack', 'Download auditor pack'],
    ['#/reports/aging', 'Unpaid invoices'],
    ['#/reports/statements', 'Gulf Pearl Hotel – Salmiya'],
    ['#/reports/retentions', 'Al Bawaba Construction Co. W.L.L.'],
    ['#/reports/payables', 'Unpaid bills'],
    ['#/reports/purchases', 'Bills received'],
    ['#/reports/payments-made', 'Payments made'],
    ['#/reports/low-stock', 'IP dome camera 4 MP'],
    ['#/reports/stock-valuation', 'Agrees with the books'],
    ['#/assets', 'Toyota Hilux double cab'],
    ['#/assets/new', 'Depreciation preview'],
    ['#/year-end', 'Closed'],
    ['#/accounts', 'Post-dated cheques received'],
    ['#/journals', 'Opening balances'],
    ['#/vat', 'VAT returns are off'],
    ['#/banking', 'NBK – current account'],
    ['#/settings/accounting', 'Financial year'],
    ['#/templates', 'Brand colour'],
    ['#/settings/company', 'Company profile'],
    ['#/settings/documents', 'Currency and paper'],
    ['#/settings/numbering', 'Number formats'],
    ['#/settings/taxes', 'Kuwait has no VAT'],
    ['#/settings/payments', 'Bank account'],
    ['#/settings/emails', 'Email templates'],
    ['#/settings/labels', 'Custom wording'],
    ['#/settings/data', 'Back up'],
    ['#/settings/companies', 'Add company'],
    ['#/no-such-page', 'Page not found'],
  ];
  for (const [path, text] of pages) {
    await page.goto(path);
    // Lists show cards at phone width and a table on wider screens.
    await expect(page.getByText(text).filter({ visible: true }).first(), path).toBeVisible();
  }
});

test('an accepted quote becomes an invoice', async ({ page }) => {
  await page.goto('#/quotes');
  await page.getByLabel('Search quotes').fill('Khalid');
  await page.getByRole('link', { name: /^QUO-/ }).first().click();
  await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Convert to invoice' }).click();
  await expect(page).toHaveURL(/#\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Invoice INV-/);
  await expect(page.getByRole('link', { name: /^Created from quote QUO-/ })).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
});
