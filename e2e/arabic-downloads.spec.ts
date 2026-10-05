import { downloadFrom, expect, test } from './fixtures';

/** The month before the current one, as yyyy-MM. */
function lastMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
}

// Browsers save a file whose name has Arabic letters (or an en dash) as
// "download": every file keeps an English, ASCII name in Arabic too.
test('files downloaded in Arabic keep meaningful names', async ({ page }) => {
  test.setTimeout(120_000);
  const DATE = String.raw`\d{4}-\d{2}-\d{2}`;

  // A company and a client named in Arabic letters only, set up in English.
  await page.goto('./');
  await page.getByLabel('Company name').fill('شركة الميل للتجارة');
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.goto('#/employees/new');
  await page.getByLabel('Name (English)').fill('Fatima Al-Sabah');
  await page.getByLabel('Name (Arabic)').fill('فاطمة الصباح');
  await page.getByLabel('Hire date').fill('2024-01-01');
  await page.getByLabel('Basic salary').fill('900');
  await page.getByLabel('IBAN').fill('KW81CBKU0000000000001234560101');
  await page.getByRole('button', { name: 'Save employee' }).first().click();
  await expect(page).toHaveURL(/#\/employees\/[0-9a-f-]{36}$/);

  await page.goto('#/payroll');
  await page.getByRole('button', { name: 'New pay run' }).first().click();
  const create = page.getByRole('dialog', { name: 'New pay run' });
  await create.getByLabel('Month').selectOption(lastMonth());
  await create.getByRole('button', { name: 'Prepare pay run' }).click();
  await expect(page).toHaveURL(/#\/payroll\/runs\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  const payRun = new URL(page.url()).hash;

  await page.goto('#/invoices/new');
  await page.getByLabel('Bill to').click();
  await page.getByPlaceholder('Search clients…').fill('مؤسسة النور');
  await page.getByRole('button', { name: 'New client “مؤسسة النور”' }).click();
  const clientDialog = page.getByRole('dialog', { name: 'New client' });
  await clientDialog.getByRole('button', { name: 'Save client' }).click();
  await expect(clientDialog).toBeHidden();
  await page.getByLabel('Item 1 name').fill('صيانة');
  await page.getByLabel('Item 1 unit price').fill('150.250');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/invoices\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark as sent' }).click();
  await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible();
  const client = await page.getByRole('link', { name: 'مؤسسة النور' }).first().getAttribute('href');

  // The rest happens in Arabic.
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  // Invoice PDF: the type in English and the number; the Arabic client name is left out.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  const invoice = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'تنزيل PDF' }).click(),
  );
  expect(invoice.file.suggestedFilename()).toMatch(/^Invoice INV-\d{4}-0001\.pdf$/);

  // Statement of account PDF and CSV.
  await page.goto(client!);
  await page.getByRole('tab', { name: 'كشف الحساب' }).click();
  const statement = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'تنزيل PDF' }).click(),
  );
  expect(statement.file.suggestedFilename()).toMatch(
    new RegExp(String.raw`^Statement \S+ ${DATE} to ${DATE}\.pdf$`),
  );

  // CSV exports.
  await page.goto('#/invoices');
  const invoices = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'تصدير CSV' }).click(),
  );
  expect(invoices.file.suggestedFilename()).toMatch(new RegExp(`^invoices-${DATE}\\.csv$`));
  await page.goto('#/employees');
  const employees = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'تصدير CSV' }).click(),
  );
  expect(employees.file.suggestedFilename()).toMatch(new RegExp(`^employees-${DATE}\\.csv$`));

  // The salary file for the bank.
  await page.goto(payRun);
  await page.getByRole('button', { name: 'ملف الرواتب' }).click();
  const salaries = await downloadFrom(page, () =>
    page
      .getByRole('dialog', { name: 'ملف تحويل الرواتب' })
      .getByRole('button', { name: 'تنزيل الملف' })
      .click(),
  );
  expect(salaries.file.suggestedFilename()).toBe(`salaries-${lastMonth()}.csv`);

  // The auditor pack: the company's name has no English letters to use.
  await page.goto('#/reports/auditor-pack');
  const pack = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'تنزيل ملف المدقق' }).click(),
  );
  expect(pack.file.suggestedFilename()).toMatch(/^auditor-pack-company-\d{4}\.zip$/);

  // The backup.
  await page.goto('#/settings/data');
  const backup = await downloadFrom(page, () =>
    page.getByRole('button', { name: /^نسخ احتياطي لـ/ }).click(),
  );
  expect(backup.file.suggestedFilename()).toMatch(new RegExp(`^MahamBooks-backup-${DATE}\\.json$`));
});
