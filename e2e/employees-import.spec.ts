import { createCompany, expect, test } from './fixtures';
import { fakeCardNumber, zohoEmployees, zohoWorkbook } from '../src/test/workbook';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// A tiny PDF: the app keeps PDF files as they are.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n');

test('employees come over from a Zoho People spreadsheet with their Arabic names', async ({
  page,
}) => {
  await createCompany(page, 'Gulf Shield Security');

  // The empty employees page points to the import.
  await page.goto('#/employees');
  await page.getByRole('link', { name: 'Import from a spreadsheet' }).click();
  await expect(page.getByRole('radio', { name: /Employees/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // A made-up Zoho export (.xlsx): the check is one line and one button.
  await page.locator('input[type=file]').setInputFiles({
    name: 'Employee_View.xlsx',
    mimeType: XLSX,
    buffer: Buffer.from(zohoWorkbook()),
  });
  await expect(
    page.getByText(
      /^7 employees will be added · 1 row without a name or number, skipped · \d+ notes$/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText('Salaries are not in the file: add them before running payroll.'),
  ).toBeVisible();
  const details = page.getByRole('button', { name: /^Details/ });
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await details.click();
  await expect(
    page.getByText('Arabic names taken from the document file names for 3 employees.'),
  ).toBeVisible();
  await expect(page.getByText(/Nationality “.?ATLANTIS.?” not recognised\./)).toBeVisible();
  await expect(page.getByRole('cell', { name: /TEST GUARD ONE.*موظف تجريبي واحد/ })).toBeVisible();

  await page.getByRole('button', { name: 'Import 7 employees' }).click();
  await expect(page.getByText('7 employees imported').first()).toBeVisible();
  await page.getByRole('link', { name: 'View them' }).click();

  // The list shows them, with their Arabic names in Arabic.
  await expect(page).toHaveURL(/#\/employees$/);
  await expect(page.getByRole('link', { name: 'TEST GUARD ONE' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sample Cleaner Two' })).toBeVisible();
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.getByRole('link', { name: 'موظف تجريبي واحد' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'موظفة تجريبية اثنان' })).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();

  // The employee page: gender, date of birth and the salary card, masked until shown.
  await page.getByRole('link', { name: 'TEST GUARD ONE' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('TEST GUARD ONE');
  const card = fakeCardNumber('5407', 101);
  await expect(page.getByText(`•••• ${card.slice(-4)}`)).toBeVisible();
  await expect(page.getByText(card)).toHaveCount(0);
  await page.getByRole('button', { name: 'Show the whole number' }).click();
  await expect(page.getByText(card)).toBeVisible();
  await expect(page.getByText('Male', { exact: true })).toBeVisible();
  await expect(page.getByText('01/05/1990')).toBeVisible();
  await expect(page.getByText('Driving licence', { exact: true }).first()).toBeVisible();
});

test('scans go to the personnel files of the employees whose numbers end their names', async ({
  page,
}) => {
  await createCompany(page, 'Gulf Shield Security');
  await page.goto('#/settings/import?kind=employees');
  await page.locator('input[type=file]').setInputFiles({
    name: 'staff.xlsx',
    mimeType: XLSX,
    buffer: Buffer.from(zohoWorkbook(zohoEmployees().slice(0, 2))),
  });
  await page.getByRole('button', { name: 'Import 2 employees' }).click();
  await expect(page.getByText('2 employees imported').first()).toBeVisible();

  await page.goto('#/employees');
  await page.getByRole('button', { name: 'Add documents' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add documents' });
  await dialog.locator('input[type=file]').setInputFiles([
    { name: 'موظف تجريبي واحد 101.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'Sample Cleaner Two 0102.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'Somebody 999.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') },
  ]);
  await expect(dialog.getByText('2 files matched · 1 not matched · 1 refused')).toBeVisible();
  const file = (name: string) => dialog.getByRole('listitem').filter({ hasText: name });
  await expect(file('موظف تجريبي واحد 101.pdf')).toContainText('000101 · TEST GUARD ONE');
  await expect(file('Sample Cleaner Two 0102.pdf')).toContainText('000102 · Sample Cleaner Two');
  await expect(dialog.getByText('No employee has the number 999.')).toBeVisible();
  await expect(dialog.getByText('Only photos and PDF files can be added.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add 2 files' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('2 files added to the personnel files')).toBeVisible();

  // Each is in the right personnel file.
  await page.getByRole('link', { name: 'TEST GUARD ONE' }).click();
  await expect(page.getByText('موظف تجريبي واحد 101.pdf')).toBeVisible();
  await expect(page.getByText('Sample Cleaner Two 0102.pdf')).toHaveCount(0);
  await page.goto('#/employees');
  await page.getByRole('link', { name: 'Sample Cleaner Two' }).click();
  await expect(page.getByText('Sample Cleaner Two 0102.pdf')).toBeVisible();

  // Adding the same files again finds them already there.
  await page.goto('#/employees');
  await page.getByRole('button', { name: 'Add documents' }).click();
  await dialog
    .locator('input[type=file]')
    .setInputFiles([
      { name: 'موظف تجريبي واحد 101.pdf', mimeType: 'application/pdf', buffer: PDF },
    ]);
  await expect(dialog.getByText(/Already in their personnel file/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add 0 files' })).toBeDisabled();
});
