import { expect, startWithDemoData, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await startWithDemoData(page);
});

test('the bank statement is matched until the account reconciles', async ({ page }) => {
  await page.goto('#/banking');
  await page.getByRole('link', { name: /NBK – current account/ }).click();
  await expect(page.getByText('3 statement lines to match')).toBeVisible();

  // A client paid its latest invoice by bank transfer.
  await page
    .getByText(/^TRF FROM SADU INTERIORS CO\. INV-\d{4}-\d{4}$/)
    .first()
    .click();
  await expect(page.getByLabel('Invoice')).toContainText('same amount');
  await page.getByRole('button', { name: 'Record and match' }).click();
  await expect(page.getByText('Payment recorded and matched')).toBeVisible();

  // The bank's own charges are an expense, in bank charges.
  await page.getByText('SWIFT CHARGES', { exact: true }).click();
  await expect(page.getByLabel('Expense category')).toContainText('Bank charges');
  await page.getByRole('button', { name: 'Record and match' }).click();
  await expect(page.getByText('Expense recorded and matched')).toBeVisible();

  // Money moved to the KFH account is a transfer between our own accounts.
  await page.getByText('TRANSFER TO KFH ACCOUNT 0731005248').click();
  await expect(page.getByLabel('Transfer to').locator('option:checked')).toHaveText(
    /KFH – current account/,
  );
  await page.getByRole('button', { name: 'Record and match' }).click();
  await expect(page.getByText('Transfer recorded and matched')).toBeVisible();

  await expect(page.getByText('Everything is matched.')).toBeVisible();
  await expect(page.getByText('Your books agree with the bank.')).toBeVisible();
  await expect(page.getByText('Reconciled', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: /^Matched/ }).click();
  await page.getByRole('button', { name: 'Actions for SWIFT CHARGES' }).click();
  await page.getByRole('menuitem', { name: 'Unmatch' }).click();
  await expect(page.getByText('1 statement line to match')).toBeVisible();
});

test('a CSV statement is read column by column and never imported twice', async ({ page }) => {
  const csv = Buffer.from(
    'Posting Date,Description,Debit,Credit,Balance\n' +
      '01/10/2026,POS PURCHASE ALI ABDULWAHAB AL MUTAWA,45.600,,"1,954.400"\n' +
      '02/10/2026,TRF FROM MARINA BREEZE RESTAURANTS,,"1,200.000","3,154.400"\n',
  );
  const file = { name: 'october.csv', mimeType: 'text/csv', buffer: csv };
  await page.goto('#/banking');
  const dialog = page.getByRole('dialog');

  await page.getByRole('button', { name: 'Import statement' }).click();
  await dialog.getByLabel('Statement file').setInputFiles(file);
  await expect(dialog.getByText('2 lines to import')).toBeVisible();
  await expect(dialog.getByLabel('Money out').locator('option:checked')).toHaveText('Debit');
  await expect(dialog.getByText('-KD 45.600')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 2 lines' }).click();
  await expect(page.getByText('2 lines imported')).toBeVisible();

  await page.getByRole('button', { name: 'Import statement' }).click();
  await dialog.getByLabel('Statement file').setInputFiles(file);
  await dialog.getByRole('button', { name: 'Import 2 lines' }).click();
  await expect(page.getByText('0 lines imported, 2 already there')).toBeVisible();
});

test('money moves between accounts with a transfer', async ({ page }) => {
  await page.goto('#/banking');
  await page.getByRole('button', { name: 'Transfer money' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('To').selectOption({ label: '1010 Petty cash' });
  await dialog.getByLabel(/^Amount/).fill('80');
  await dialog.getByRole('button', { name: 'Record transfer' }).click();
  await expect(page.getByText('Transfer recorded')).toBeVisible();
  await page.goto('#/journals');
  await expect(page.getByText('Transfer from NBK – current account to Petty cash')).toBeVisible();
});
