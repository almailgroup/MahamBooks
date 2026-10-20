import { expect, startWithDemoData, test } from './fixtures';
import { statementHtml, statementWorkbook } from '../src/test/bank-statements';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

test('an Excel statement with account details above it is remembered and never imported twice', async ({
  page,
}) => {
  // A made-up export: five rows about the account, then the table, then totals.
  const file = { name: 'statement.xlsx', mimeType: XLSX, buffer: Buffer.from(statementWorkbook()) };
  await page.goto('#/banking');
  await page.getByRole('link', { name: /KFH – current account/ }).click();
  const dialog = page.getByRole('dialog');
  // The account has no statement yet: its empty page has a second button.
  const importButton = page.getByRole('button', { name: 'Import statement' }).first();

  await importButton.click();
  await dialog.getByLabel('Statement file').setInputFiles(file);
  await expect(dialog.getByLabel('The table starts at row').locator('option:checked')).toHaveText(
    /^Row 6: Posting Date · Value Date/,
  );
  await expect(
    dialog.getByText('3 lines to import · 3 rows of totals or notes after the lines left out'),
  ).toBeVisible();
  await expect(dialog.getByLabel('Money out').locator('option:checked')).toHaveText('Debit');
  await expect(dialog.getByLabel(/^Value date/).locator('option:checked')).toHaveText('Value Date');
  await expect(dialog.getByText('The amounts add up to the balances in the file.')).toBeVisible();
  const remember = dialog.getByRole('switch', { name: 'Remember this layout for this account' });
  await expect(remember).toHaveAttribute('aria-checked', 'false');
  await remember.click();
  await dialog.getByRole('button', { name: 'Import 3 lines' }).click();
  await expect(page.getByText('3 lines imported')).toBeVisible();
  await expect(page.getByText('TRF FROM TEST CUSTOMER ONE')).toBeVisible();

  // The next import reads the file with the remembered layout and adds nothing twice.
  await importButton.click();
  await dialog.getByLabel('Statement file').setInputFiles(file);
  await expect(dialog.getByText('Read with the layout remembered for this account.')).toBeVisible();
  await expect(remember).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: 'Import 3 lines' }).click();
  await expect(page.getByText('0 lines imported, 3 already there')).toBeVisible();

  // The same statement saved by the bank as an HTML ".xls" is the same lines.
  await importButton.click();
  await dialog.getByLabel('Statement file').setInputFiles({
    name: 'statement.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer: Buffer.from(statementHtml()),
  });
  await dialog.getByRole('button', { name: 'Import 3 lines' }).click();
  await expect(page.getByText('0 lines imported, 3 already there')).toBeVisible();

  // An old binary Excel file gets a way out.
  await importButton.click();
  await dialog.getByLabel('Statement file').setInputFiles({
    name: 'old.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]),
  });
  await expect(
    page.getByText(
      'Older Excel files (.xls) can’t be read. In Excel, save the file as .xlsx or CSV.',
    ),
  ).toBeVisible();
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
