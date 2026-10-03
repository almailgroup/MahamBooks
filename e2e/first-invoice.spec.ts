import { downloadFrom, expect, test } from './fixtures';

test('set up a company, invoice a new client and get paid', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Welcome to AlmailBooks' })).toBeVisible();

  // Company setup: Kuwait, dinars and no VAT out of the box.
  await expect(page.getByText('Kuwaiti dinar with fils')).toBeVisible();
  await page.getByLabel('Company name').fill('AL Mail Group');
  await page.getByRole('button', { name: 'Create company' }).click();

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.getByRole('link', { name: /Create your first invoice/ }).click();
  await expect(page.getByRole('heading', { name: 'New invoice' })).toBeVisible();

  // A new client, created from the client picker.
  await page.getByLabel('Bill to').click();
  await page.getByPlaceholder('Search clients…').fill('Acme Trading Ltd');
  await page.getByRole('button', { name: 'New client “Acme Trading Ltd”' }).click();
  const clientDialog = page.getByRole('dialog', { name: 'New client' });
  await expect(clientDialog.getByLabel('Client name')).toHaveValue('Acme Trading Ltd');
  await clientDialog.getByLabel('Email').first().fill('accounts@acme.example');
  await clientDialog.getByRole('button', { name: 'Save client' }).click();
  await expect(clientDialog).toBeHidden();
  await expect(page.getByLabel('Bill to')).toContainText('Acme Trading Ltd');

  // 3 × KD 150.250, no tax: three decimals (fils) throughout.
  await page.getByLabel('Item 1 name').fill('Bulk mail sorting');
  await page.getByLabel('Item 1 quantity').fill('3');
  await page.getByLabel('Item 1 unit price').fill('150.250');
  await expect(page.getByLabel('Item 1 amount')).toHaveText('KD 450.750');
  await expect(page.getByText('KD 450.750').first()).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Invoice INV-\d{4}-0001$/);
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();

  // The PDF renders in the preview and downloads as a real PDF file.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  const { file, content } = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  expect(file.suggestedFilename()).toMatch(/INV-\d{4}-0001.*\.pdf$/);
  expect(content.subarray(0, 5).toString('latin1')).toBe('%PDF-');

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark as sent' }).click();
  await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible();

  // The payment dialog suggests the full balance.
  await page.getByRole('button', { name: 'Record payment' }).click();
  const paymentDialog = page.getByRole('dialog', { name: 'Record payment' });
  await paymentDialog.getByRole('button', { name: 'Record payment' }).click();
  await expect(paymentDialog).toBeHidden();
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Bank transfer')).toBeVisible();
});
