import type { Page } from '@playwright/test';
import { createCompany, downloadFrom, drawSignature, expect, pdfText, test } from './fixtures';

/** Records an expense paid to someone who isn't a vendor, and opens it again. */
async function recordExpense(page: Page, description: string, payee: string) {
  await page.goto('#/expenses');
  await page.getByRole('button', { name: 'Record expense' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Record expense' });
  await dialog.getByLabel('Amount paid').fill('36');
  await dialog.getByLabel('Description').fill(description);
  await dialog.getByLabel('Paid to').fill(payee);
  await dialog.getByRole('button', { name: 'Record expense' }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole('row', { name: new RegExp(description) });
  await expect(row).toContainText(payee);
  await row.getByRole('button', { name: description }).click();
}

test('an expense has a payment voucher, printed or saved as a PDF', async ({ page }) => {
  await createCompany(page, 'Sample Print Co.');
  await recordExpense(page, 'Courier envelopes', 'Corner stationery shop');

  // The voucher prints what is saved: unsaved changes come first.
  const dialog = page.getByRole('dialog', { name: /^Expense EXP-/ });
  const print = dialog.getByRole('button', { name: 'Print voucher' });
  await dialog.getByLabel('Description').fill('Courier envelopes and tape');
  await expect(print).toBeDisabled();
  await dialog.getByLabel('Description').fill('Courier envelopes');
  await print.click();

  await expect(page).toHaveURL(/#\/expenses\/[0-9a-f-]{36}\/voucher$/);
  await expect(page.getByText('Payment voucher', { exact: true })).toBeVisible();
  await expect(page.getByText('سند صرف')).toBeVisible();
  await expect(page.getByText('Paid to', { exact: true })).toBeVisible();
  await expect(page.getByText('Corner stationery shop')).toBeVisible();
  await expect(page.getByText('Thirty-Six Kuwaiti Dinars Only')).toBeVisible();
  await expect(page.getByText(/^EXP-\d{4}-0001$/)).toBeVisible();
  // Off until the owner turns it on: no stamp or signature.
  await expect(page.getByRole('img', { name: 'Authorised signature' })).toHaveCount(0);

  const pdf = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  expect(pdf.file.suggestedFilename()).toMatch(
    /^Payment voucher EXP-\d{4}-0001 - Corner stationery shop\.pdf$/,
  );
  const text = await pdfText(pdf.content);
  expect(text).toMatch(/Paymentvoucher/i);
  expect(text).toContain('Cornerstationeryshop');
  expect(text).toMatch(/EXP-\d{4}-0001/);

  await page.getByRole('link', { name: 'Back to the expense' }).click();
  await expect(page.getByRole('dialog', { name: /^Expense EXP-/ })).toBeVisible();
});

test('the owner adds the stamp and blue signature, and words the signature lines', async ({
  page,
}) => {
  await createCompany(page, 'Sample Print Co.');
  await page.goto('#/settings/company?section=branding');
  await drawSignature(page);
  await page.getByRole('tab', { name: 'Blue ink' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved').last()).toBeVisible();

  await page.goto('#/settings/documents');
  const section = page.locator('#vouchers');
  await expect(section.getByText('Receipt and payment vouchers')).toBeVisible();
  const images = section.getByRole('switch', { name: 'Print the stamp, signature and address' });
  await expect(images).toHaveAttribute('aria-checked', 'false');
  await images.click();
  const paid = section.getByRole('group', { name: 'Signature lines on payment vouchers' });
  await expect(paid.getByLabel('Signature line 2 in English')).toHaveValue('Approved by');
  await paid.getByLabel('Signature line 2 in English').fill('Finance manager');
  await paid.getByLabel('Signature line 2 in Arabic').fill('المدير المالي');
  await paid.getByLabel('Signature line 3 in English').fill('Cashier');
  await paid.getByLabel('Signature line 3 in Arabic').fill('أمين الصندوق');
  await paid.getByRole('button', { name: 'Add a line' }).click();
  await paid.getByLabel('Signature line 4 in English').fill('Received by');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved').last()).toBeVisible();

  await recordExpense(page, 'Office water', 'Water delivery');
  await page
    .getByRole('dialog', { name: /^Expense EXP-/ })
    .getByRole('button', { name: 'Print voucher' })
    .click();
  await expect(page.getByText('Payment voucher', { exact: true })).toBeVisible();
  await expect(page.getByText('Finance manager')).toBeVisible();
  await expect(page.getByText('المدير المالي')).toBeVisible();
  await expect(page.getByText('Received by')).toBeVisible();
  // Over the last line but one, the company's: the last is the other party's.
  const signature = page.getByRole('img', { name: 'Authorised signature' });
  await expect(signature).toHaveCount(1);
  await expect(signature.locator('xpath=../..')).toContainText('Cashier');
  await expect(page.getByRole('img', { name: 'Stamp' })).toHaveCount(0);
  const pdf = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  expect(await pdfText(pdf.content)).toContain('Financemanager');

  // Back to the standard lines, and no pictures.
  await page.goto('#/settings/documents');
  await section.getByRole('button', { name: 'Use the standard lines' }).click();
  await images.click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved').last()).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Approved by')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Authorised signature' })).toHaveCount(0);
});
