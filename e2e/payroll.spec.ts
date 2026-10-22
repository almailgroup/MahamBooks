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

  // Hired before they were added here: their leave before isn't known. Everyone
  // without a balance starts at 0 days, in one go.
  const noOpening = page.getByText(
    '2 employees have no opening leave balance: their leave is counted from their hire date.',
  );
  await expect(noOpening).toBeVisible();
  await page.getByRole('button', { name: 'Set opening leave balances' }).click();
  const everyone = page.getByRole('dialog', { name: 'Set opening leave balances' });
  await expect(
    everyone.getByRole('radio', { name: /^Everyone without a balance starts at 0 days/ }),
  ).toBeChecked();
  await expect(
    everyone.getByText('This applies to 2 current employees without an opening balance.'),
  ).toBeVisible();
  await everyone.getByRole('button', { name: 'Set for 2 employees' }).click();
  await expect(page.getByText('Opening leave balances set for 2 employees')).toBeVisible();
  await expect(everyone).toBeHidden();
  await expect(noOpening).toBeHidden();

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
    'Employee No,Civil ID,Employee Name,Employee Name (Arabic),IBAN,Account/Card No,Bank Code,Amount,Salary Month,PAM File No',
  );
  const period = month.period.replace('-', '');
  expect(rows.slice(1)).toEqual([
    `EMP-001,,Fatima Al-Sabah,فاطمة الصباح,KW81CBKU0000000000001234560101,,CBKU,2711.250,${period},`,
    `EMP-002,,Ravi Kumar,رافي كومار,KW09NBOK0000000000001234567890,,NBOK,525.000,${period},`,
  ]);

  // Bilingual payslips.
  await page.getByRole('link', { name: 'Payslips' }).click();
  await expect(page.getByText('قسيمة الراتب').first()).toBeVisible();
  await expect(page.getByText('KD 2,711.250').first()).toBeVisible();
  await page.getByRole('link', { name: 'Back to the pay run' }).click();

  // Ravi's own balance from a spreadsheet: it replaces the 0 days.
  await page.goto('#/payroll/leave');
  await page.getByRole('button', { name: 'Set opening leave balances' }).click();
  const sheet = page.getByRole('dialog', { name: 'Set opening leave balances' });
  await sheet.getByRole('radio', { name: /^From a spreadsheet/ }).check();
  await sheet.locator('input[type=file]').setInputFiles({
    name: 'leave-balances.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Employee No,Leave balance\nEMP-002,12.5\nEMP-009,3\nEMP-001,many\n'),
  });
  await expect(sheet.getByText('1 matched · 1 not found · 1 can’t be read')).toBeVisible();
  await expect(
    sheet.getByText('1 of them has an opening balance already: the spreadsheet replaces it.'),
  ).toBeVisible();
  await expect(sheet.getByText('No employee has this number.')).toBeVisible();
  await expect(sheet.getByText(/^“.?many.?” is not a number of days\.$/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Set for 1 employee' }).click();
  await expect(page.getByText('Opening leave balance set for 1 employee')).toBeVisible();
  await page.getByRole('link', { name: 'Ravi Kumar' }).click();
  await expect(page.getByText(/^12\.5 days on .+\. Leave counts from this date\.$/)).toBeVisible();

  // The books balance.
  await page.goto('#/reports/balance-sheet');
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
});

test('the Leave page and employees’ balances follow the company’s leave policy', async ({
  page,
}) => {
  await createCompany(page, 'Made-up Guarding');
  await addEmployee(page, {
    name: 'Made-up Guard',
    nameAr: 'حارس افتراضي',
    country: 'India',
    salary: '300',
    iban: 'KW81CBKU0000000000001234560101',
  });
  const employeePage = page.url();

  // The law's 30 days a year until a policy is set.
  await page.goto('#/payroll/leave');
  await expect(page.getByText(/: 2\.5 days a month, less leave taken\.$/)).toBeVisible();

  await page.goto('#/payroll/settings');
  const card = page
    .locator('div.rounded-xl')
    .filter({ has: page.getByRole('heading', { name: 'Annual leave', exact: true }) });
  await expect(card.getByText(/^The law’s leave applies: 30 working days a year/)).toBeVisible();
  await card.getByRole('button', { name: 'Set the company’s leave policy' }).click();
  // Fewer than 30 days breaches art. 70.
  await card.getByLabel('Days a year').fill('25');
  await expect(card.getByText('At least 30 days a year (art. 70).')).toBeVisible();
  await card.getByLabel('Days a year').fill('45');
  // From a date that has passed: the balances from it change.
  await card.getByLabel('From').fill('2024-01-01');
  await expect(card.getByText(/^This date has passed: balances from it change/)).toBeVisible();
  await expect(card.getByLabel('Months before the first leave')).toHaveValue('9');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Payroll settings saved')).toBeVisible();

  await page.goto('#/payroll/leave');
  await expect(page.getByText(/: 3\.75 days a month, less leave taken\.$/)).toBeVisible();
  await page.goto(`${employeePage}?tab=leave`);
  await expect(
    page.getByText('45 days a year, 3.75 days for each month of service (art. 70).'),
  ).toBeVisible();

  // Their contract gives them 60 days a year; never fewer than 30.
  await page.goto(`${employeePage}/edit`);
  const own = page.getByLabel(/^Annual leave days(?! from)/);
  await expect(own).toHaveAttribute('placeholder', '45');
  await own.fill('20');
  await page.getByRole('button', { name: 'Save employee' }).first().click();
  await expect(page.getByText('At least 30 days a year (art. 70).')).toBeVisible();
  await own.fill('60');
  // From the hire date, as no date is given: their balance changes, which the form says.
  await expect(page.getByLabel('Annual leave days from')).toHaveValue('');
  await expect(page.getByText(/^This date has passed: balances from it change/)).toBeVisible();
  await page.getByRole('button', { name: 'Save employee' }).first().click();
  await expect(page).toHaveURL(/#\/employees\/[0-9a-f-]{36}$/);
  await page.goto(`${employeePage}?tab=leave`);
  await expect(
    page.getByText('60 days a year in their contract, 5 days for each month of service.'),
  ).toBeVisible();

  // Once annual leave is recorded, the counting stays as it is.
  await page.goto('#/payroll/leave');
  await expect(
    page.getByText(/: 3\.75 days a month, or each employee’s own entitlement, less leave taken\.$/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Record leave' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record leave' });
  await dialog.getByLabel('First day').fill('2026-03-02');
  await dialog.getByLabel('Last day').fill('2026-03-03');
  await expect(dialog.getByText('2 working days', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Leave recorded for Made-up Guard')).toBeVisible();
  await page.goto('#/payroll/settings');
  await expect(card.getByLabel('Leave is counted in')).toBeDisabled();
  await expect(
    card.getByText('Annual leave has been recorded, so the way it is counted stays as it is.'),
  ).toBeVisible();
});

test('the company’s leave reasons: emergency leave from annual leave and leave on half pay', async ({
  page,
}) => {
  const month = lastMonth();
  await createCompany(page, 'Made-up Facilities');
  await addEmployee(page, {
    name: 'Made-up Cleaner',
    nameAr: 'عامل نظافة افتراضي',
    country: 'India',
    salary: '300',
    iban: 'KW81CBKU0000000000001234560101',
  });
  const employeePage = page.url();

  // Off until switched on: leave is recorded with the six types only.
  await page.goto('#/payroll/leave');
  await page.getByRole('button', { name: 'Record leave' }).click();
  let dialog = page.getByRole('dialog', { name: 'Record leave' });
  await expect(dialog.getByRole('option', { name: 'Emergency leave' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('link', { name: 'Leave reasons' }).first().click();
  await expect(page).toHaveURL(/#\/payroll\/leave-reasons$/);
  await expect(page.getByText('No leave reasons yet')).toBeVisible();
  await page.getByRole('button', { name: 'Add the recommended reasons' }).click();
  await expect(page.getByText('Recommended leave reasons added')).toBeVisible();
  await expect(page.getByText('Emergency leave', { exact: true })).toBeVisible();
  await expect(page.getByText('Compensatory days', { exact: true })).toBeVisible();
  await expect(page.getByText('Older versions show it as annual leave.')).toBeVisible();

  // A reason on half pay, with a note.
  await page.getByRole('button', { name: 'Add a reason' }).click();
  const reason = page.getByRole('dialog', { name: 'Add a leave reason' });
  await reason.getByLabel('Name (English)').fill('Study leave');
  await reason.getByLabel('Name (Arabic)').fill('إجازة دراسية');
  await reason.getByLabel('How it is paid').selectOption({ label: 'Half pay' });
  await expect(
    reason.getByText(/^Each calendar day of it costs half a day’s pay\. Older versions show it/),
  ).toBeVisible();
  await reason.getByLabel('Most days a year').fill('10');
  await reason.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Leave reason saved')).toBeVisible();
  await expect(page.getByText('Half pay · At most 10 days a year')).toBeVisible();

  // The pause of long unpaid leave is off, and asks for the auditor first.
  await expect(
    page.getByText(/^Ask your auditor to confirm that a month of service with more than 15 days/),
  ).toBeVisible();
  await expect(
    page.getByRole('switch', {
      name: /^A month of service with more than 15 days of unpaid leave/,
    }),
  ).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('switch', { name: /^Offer these reasons when leave is recorded/ }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Leave reasons saved')).toBeVisible();

  // Emergency leave, then ten days of study leave, last month.
  await page.goto('#/payroll/leave');
  await page.getByRole('button', { name: 'Record leave' }).click();
  dialog = page.getByRole('dialog', { name: 'Record leave' });
  await dialog.getByLabel('Type of leave').selectOption({ label: 'Emergency leave' });
  // A working day (Sunday to Thursday).
  const day = [20, 21, 22, 23, 24]
    .map((d) => `${month.period}-${d}`)
    .find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() < 5)!;
  await dialog.getByLabel('First day').fill(day);
  await dialog.getByLabel('Last day').fill(day);
  await expect(dialog.getByText(/· Taken from annual leave$/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Leave recorded for Made-up Cleaner')).toBeVisible();

  await page.getByRole('button', { name: 'Record leave' }).click();
  dialog = page.getByRole('dialog', { name: 'Record leave' });
  await dialog.getByLabel('Type of leave').selectOption({ label: 'Study leave' });
  await dialog.getByLabel('First day').fill(`${month.period}-01`);
  await dialog.getByLabel('Last day').fill(`${month.period}-10`);
  await expect(dialog.getByText('10 calendar days', { exact: false })).toBeVisible();
  await expect(dialog.getByText(/Half pay · 0 of 10 days a year taken$/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  // The first leave's toast may still be showing.
  await expect(page.getByText('Leave recorded for Made-up Cleaner').last()).toBeVisible();

  await page.goto(`${employeePage}?tab=leave`);
  const reasons = page
    .locator('div.rounded-xl')
    .filter({ has: page.getByRole('heading', { name: /^The company’s leave reasons in/ }) });
  await expect(reasons).toContainText('Study leave');
  await expect(reasons).toContainText('10 of 10 days');

  // The pay line shows each reason, and pays the study leave at half.
  await page.goto('#/payroll');
  await page.getByRole('button', { name: 'New pay run' }).first().click();
  const create = page.getByRole('dialog', { name: 'New pay run' });
  await create.getByLabel('Month').selectOption(month.period);
  await create.getByRole('button', { name: 'Prepare pay run' }).click();
  await expect(page).toHaveURL(/#\/payroll\/runs\/[0-9a-f-]{36}$/);
  await page.getByRole('row').filter({ hasText: 'Made-up Cleaner' }).click();
  const line = page.getByRole('dialog', { name: 'Made-up Cleaner' });
  await expect(line.getByText('Study leave: 10 days at 50% pay.')).toBeVisible();
  await expect(line.getByText('Emergency leave: 1 day, taken from annual leave.')).toBeVisible();
  await expect(line.getByText('From leave records: 10 calendar days at 50% pay.')).toBeVisible();
  await line.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(`Payroll for ${month.label} approved`)).toBeVisible();
  await page.getByRole('link', { name: 'Payslips' }).click();
  await expect(page.getByText('Leave this month').first()).toBeVisible();
  await expect(page.getByText('الإجازات هذا الشهر').first()).toBeVisible();
  await expect(page.getByText('إجازة دراسية').first()).toBeVisible();
  await expect(page.getByText('بنصف أجر').first()).toBeVisible();
  await page.getByRole('link', { name: 'Back to the pay run' }).click();

  // In Arabic.
  await page.goto('#/payroll/leave-reasons');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'أسباب الإجازة' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'إجازة طارئة' })).toContainText(
    'تُخصم من الإجازة السنوية',
  );
  await expect(page.getByText('بنصف أجر · 10 يوم في السنة كحد أقصى')).toBeVisible();
  await page.goto(`${employeePage}?tab=leave`);
  await expect(page.getByText('إجازة دراسية').first()).toBeVisible();
});
