import { chooseOption, expect, startWithDemoData, test } from './fixtures';

// A 1×1 PNG, enough to stand in for a photo of a receipt.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async ({ page }) => {
  await startWithDemoData(page);
});

test('a bill is recorded with its scan, paid, and kept in the books', async ({ page }) => {
  await page.goto('#/bills/new');
  await chooseOption(page, page.getByLabel('Vendor', { exact: true }), {
    placeholder: 'Search vendors…',
    query: 'Sharq',
    option: 'Sharq Computer Systems Co.',
  });
  await page.getByLabel("Vendor's invoice number").fill('SCS-INV-4471');
  await chooseOption(page, page.getByRole('button', { name: 'Line 1 category' }), {
    placeholder: 'Search accounts…',
    query: 'Software',
    option: '6190 Software and subscriptions',
  });
  await page.getByLabel('Line 1 description').fill('Antivirus licences, 12 users – one year');
  await page.getByLabel('Line 1 rate').fill('137.500');
  await expect(page.getByLabel('Line 1 amount')).toHaveText('KD 137.500');
  await page
    .getByLabel('Attach a file')
    .setInputFiles({ name: 'bill-scan.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(page.getByText('bill-scan.png')).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page).toHaveURL(/#\/bills\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Bill BILL-/);
  const title = page.locator('h1').locator('..');
  await expect(title.getByText('Open', { exact: true })).toBeVisible();
  await expect(page.getByText('their ref. SCS-INV-4471')).toBeVisible();
  await expect(page.getByText('6190 Software and subscriptions')).toBeVisible();
  await expect(page.getByText('bill-scan.png')).toBeVisible();

  // No VAT in Kuwait: the bill is paid at its face value.
  await page.getByRole('button', { name: 'Record payment' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(/^Amount/)).toHaveValue(/^137\.5/);
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  await expect(dialog).toBeHidden();
  await expect(title.getByText('Paid', { exact: true })).toBeVisible();
  await expect(page.getByText('Balance due').locator('..')).toContainText('KD 0.000');

  await page.goto('#/payments-made');
  await expect(
    page.getByRole('row', { name: /Sharq Computer Systems Co\..*KD 137\.500/ }),
  ).toBeVisible();
  await page.goto('#/payments');
  await expect(page.getByText('Sharq Computer Systems Co.')).toHaveCount(0);

  await page.goto('#/reports/balance-sheet');
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
});

test('an expense is recorded with a photo of the receipt', async ({ page }) => {
  await page.goto('#/expenses');
  await page.getByRole('button', { name: 'Record expense' }).click();
  const dialog = page.getByRole('dialog');
  await chooseOption(page, dialog.getByLabel('Category'), {
    placeholder: 'Search accounts…',
    query: 'Stationery',
    option: '6140 Stationery and printing',
  });
  await dialog.getByLabel('Amount paid').fill('36');
  await dialog.getByLabel('Description').fill('Courier envelopes');
  await dialog
    .getByLabel('Attach a file')
    .setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(dialog.getByText('receipt.png')).toBeVisible();
  await dialog.getByRole('button', { name: 'Record expense' }).click();
  await expect(dialog).toBeHidden();

  const row = page.getByRole('row', { name: /Courier envelopes/ });
  await expect(row).toContainText('KD 36.000');
  await expect(row.getByLabel('Receipt attached')).toBeVisible();

  await row.getByRole('button', { name: 'Courier envelopes' }).click();
  await expect(dialog.getByText('receipt.png')).toBeVisible();
  await expect(dialog.getByLabel('Amount paid')).toHaveValue(/^36/);
});

test('vendors have their own list, and a contact can be both', async ({ page }) => {
  await page.goto('#/vendors/new');
  await page.getByLabel('Vendor name').fill('Gulf Toner Supplies');
  await page.getByRole('button', { name: 'Save vendor' }).first().click();
  await expect(page).toHaveURL(/#\/vendors\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('link', { name: 'New bill' })).toBeVisible();

  await page.goto('#/vendors');
  await expect(page.getByRole('link', { name: 'Gulf Toner Supplies' })).toBeVisible();
  await page.goto('#/clients');
  await expect(page.getByRole('link', { name: 'Al Bawaba Construction Co. W.L.L.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Gulf Toner Supplies' })).toHaveCount(0);

  // Al Sahel installs for us as a subcontractor, and buys cable from our store.
  await page.getByRole('link', { name: 'Al Sahel Technical Services Co.' }).click();
  await expect(page.getByText(/^INV-/).first()).toBeVisible();
  await page.getByRole('link', { name: 'Also a vendor' }).click();
  await expect(page).toHaveURL(/#\/vendors\//);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Al Sahel Technical Services Co.',
  );
  await expect(page.getByText(/^BILL-/).first()).toBeVisible();

  await page.goto('#/reports/payables');
  await expect(page.getByRole('link', { name: 'Al Sahel Technical Services Co.' })).toBeVisible();
});
