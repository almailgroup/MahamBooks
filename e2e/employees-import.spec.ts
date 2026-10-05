import { createCompany, expect, test } from './fixtures';
import { fakeCardNumber, zohoWorkbook } from '../src/test/workbook';

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
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
