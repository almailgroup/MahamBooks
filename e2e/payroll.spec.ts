import { chooseOption, createCompany, downloadFrom, expect, test } from './fixtures';
import type { Page } from '@playwright/test';

/** The month before the current one, as yyyy-MM and as the app writes it ("September 2026"). */
function lastMonth() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return {
    period: date.toISOString().slice(0, 7),
    label: date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

async function addEmployee(
  page: Page,
  input: { name: string; nameAr: string; country?: string; salary: string; iban: string },
) {
  await page.goto('#/employees/new');
  await page.getByLabel('Name (English)').fill(input.name);
  await page.getByLabel('Name (Arabic)').fill(input.nameAr);
  if (input.country) {
    await chooseOption(page, page.getByLabel('Nationality'), {
      placeholder: 'Search countries…',
      query: input.country,
    });
  }
  await page.getByLabel('Hire date').fill('2024-01-01');
  await page.getByLabel('Basic salary').fill(input.salary);
  await page.getByLabel('IBAN').fill(input.iban);
  await page.getByRole('button', { name: 'Save employee' }).first().click();
  await expect(page).toHaveURL(/#\/employees\/[0-9a-f-]{36}$/);
}

test('a month’s payroll is prepared, approved, paid and sent to the bank as a salary file', async ({
  page,
}) => {
  const month = lastMonth();
  await createCompany(page, 'Almail Trading');

  // One Kuwaiti insured with PIFSS above the KD 2,750 cap, one expatriate.
  await addEmployee(page, {
    name: 'Fatima Al-Sabah',
    nameAr: 'فاطمة الصباح',
    salary: '3000',
    iban: 'KW81CBKU0000000000001234560101',
  });
  await expect(page.getByText('Kuwaiti', { exact: true })).toBeVisible();
  await addEmployee(page, {
    name: 'Ravi Kumar',
    nameAr: 'رافي كومار',
    country: 'India',
    salary: '500',
    iban: 'KW09NBOK0000000000001234567890',
  });

  // Prepare the pay run.
  await page.goto('#/payroll');
  await expect(page.getByText('No pay runs yet')).toBeVisible();
  await page.getByRole('button', { name: 'New pay run' }).first().click();
  const create = page.getByRole('dialog', { name: 'New pay run' });
  await create.getByLabel('Month').selectOption(month.period);
  await create.getByRole('button', { name: 'Prepare pay run' }).click();
  await expect(page).toHaveURL(/#\/payroll\/runs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Payroll for ${month.label}`);

  // PIFSS is 10.5% of the insured KD 2,750: KD 288.750 off Fatima's pay.
  const fatima = page.getByRole('row').filter({ hasText: 'Fatima Al-Sabah' });
  await expect(fatima).toContainText('KD 2,711.250');

  // A KD 25 bonus for Ravi.
  await page.getByRole('row').filter({ hasText: 'Ravi Kumar' }).click();
  const line = page.getByRole('dialog', { name: 'Ravi Kumar' });
  await line.getByRole('button', { name: 'Add an addition or deduction' }).click();
  await line.getByLabel('Amount').fill('25');
  await line.getByLabel('Note').fill('Bonus');
  await expect(line.getByText('KD 525.000').last()).toBeVisible();
  await line.getByRole('button', { name: 'Save' }).click();
  await expect(line).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: 'Total' })).toContainText('KD 3,236.250');

  // Approve: one entry in the books.
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(`Payroll for ${month.label} approved`)).toBeVisible();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();

  // Pay from the bank.
  await page.getByRole('button', { name: 'Record payment' }).click();
  const pay = page.getByRole('dialog', { name: `Pay the salaries for ${month.label}` });
  await expect(pay).toContainText('KD 3,236.250');
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText(`Salaries for ${month.label} paid`)).toBeVisible();
  await expect(page.getByText('Paid', { exact: true })).toBeVisible();

  // The salary file pays each IBAN its net pay and adds up to the books.
  await page.getByRole('button', { name: 'Salary file' }).click();
  const fileDialog = page.getByRole('dialog', { name: 'Salary transfer file' });
  await expect(fileDialog.getByText('Matches the salaries payable in the books.')).toBeVisible();
  const { file, content } = await downloadFrom(page, () =>
    fileDialog.getByRole('button', { name: 'Download file' }).click(),
  );
  expect(file.suggestedFilename()).toBe(`salaries-${month.period}.csv`);
  const rows = content
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .split('\r\n');
  expect(rows[0]).toBe(
    'Employee No,Civil ID,Employee Name,Employee Name (Arabic),IBAN,Bank Code,Amount,Salary Month,PAM File No',
  );
  const period = month.period.replace('-', '');
  expect(rows.slice(1)).toEqual([
    `EMP-001,,Fatima Al-Sabah,فاطمة الصباح,KW81CBKU0000000000001234560101,CBKU,2711.250,${period},`,
    `EMP-002,,Ravi Kumar,رافي كومار,KW09NBOK0000000000001234567890,NBOK,525.000,${period},`,
  ]);

  // Bilingual payslips.
  await page.getByRole('link', { name: 'Payslips' }).click();
  await expect(page.getByText('قسيمة الراتب').first()).toBeVisible();
  await expect(page.getByText('KD 2,711.250').first()).toBeVisible();
  await page.getByRole('link', { name: 'Back to the pay run' }).click();

  // The books balance.
  await page.goto('#/reports/balance-sheet');
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
});
