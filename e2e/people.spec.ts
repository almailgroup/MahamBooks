import type { Page } from '@playwright/test';
import { chooseOption, createCompany, downloadFrom, expect, pdfText, test } from './fixtures';
import { FakeSupabase } from './cloud-fake';

/** yyyy-MM-dd `days` from today (the browser runs in UTC, see playwright.config.ts). */
const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test('a residency expiring in 20 days is renewed from Compliance with its fee', async ({
  page,
}) => {
  await createCompany(page, 'Almail Trading');

  // An expatriate employee whose residency expires in 20 days.
  await page.goto('#/employees');
  await expect(page.getByText('No employees yet')).toBeVisible();
  await page.getByRole('link', { name: 'New employee' }).first().click();
  await page.getByLabel('Name (English)').fill('Ravi Kumar');
  await page.getByLabel('Name (Arabic)').fill('رافي كومار');
  await chooseOption(page, page.getByLabel('Nationality'), {
    placeholder: 'Search countries…',
    query: 'India',
  });
  await expect(page.getByLabel('Category')).toHaveValue('expat');
  await page.getByLabel('Residency number').fill('18/2024/55');
  await page.getByLabel('Residency expiry').fill(inDays(20));
  await page.getByLabel('Basic salary').fill('450');
  await page.getByRole('button', { name: 'Save employee' }).first().click();

  await expect(page).toHaveURL(/#\/employees\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ravi Kumar');
  await expect(page.getByText('Expires in 20 days')).toBeVisible();
  await expect(page.getByText('End-of-service estimate today')).toBeVisible();

  // It shows as due soon in the compliance calendar.
  await page.goto('#/compliance');
  await expect(page.getByRole('heading', { name: 'Compliance' })).toBeVisible();
  const item = page.getByRole('listitem').filter({ hasText: 'Residency' });
  await expect(item).toContainText('Ravi Kumar');
  await expect(item).toContainText('Due soon');
  await expect(item).toContainText('In 20 days');

  // Renewed for a year, with a KD 10 fee paid from the bank.
  await item.getByRole('button', { name: 'Renew' }).click();
  const dialog = page.getByRole('dialog', { name: 'Renew Residency' });
  // Date fields show the company's format (dd/MM/yyyy in Kuwait).
  await expect(dialog.getByLabel('New expiry date')).toHaveValue(
    (() => {
      const d = new Date(`${inDays(20)}T00:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      const [year, month, day] = d.toISOString().slice(0, 10).split('-');
      return `${day}/${month}/${year}`;
    })(),
  );
  await dialog.getByLabel('Fee paid').fill('10');
  await expect(dialog.getByLabel('Category')).toContainText(
    '6090 Government fees, visas and residency',
  );
  await dialog.getByRole('button', { name: 'Renew' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Residency renewed until/)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Residency' })).toHaveCount(0);

  // The register shows it valid again.
  await page.goto('#/compliance/documents');
  const row = page.getByRole('row').filter({ hasText: 'Residency' });
  await expect(row).toContainText('Ravi Kumar');
  await expect(row).toContainText('Valid');

  // The fee is an expense in government fees, without the employee's name
  // (staff see expenses), and the books balance.
  await page.goto('#/expenses');
  await expect(page.getByRole('row', { name: /Document renewal fee.*KD 10\.000/ })).toBeVisible();
  await expect(page.getByText('Ravi Kumar')).toHaveCount(0);
  await page.goto('#/reports/balance-sheet');
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
});

test('the employee and compliance pages read right to left in Arabic', async ({ page }) => {
  await createCompany(page, 'Almail Trading');
  await page.goto('#/employees');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'الموظفون' })).toBeVisible();
  await expect(page.getByText('لا يوجد موظفون بعد')).toBeVisible();
  await page.goto('#/compliance');
  await expect(page.getByRole('heading', { name: 'الامتثال' })).toBeVisible();
  await page.goto('#/compliance/documents');
  await expect(page.getByText('لا توجد وثائق بعد')).toBeVisible();
});

/** An employee of the open company, from the form. */
async function addEmployee(
  page: Page,
  name: string,
  nameAr: string,
  extra: { phone?: string; department?: string } = {},
) {
  await page.goto('#/employees/new');
  await page.getByLabel('Name (English)').fill(name);
  await page.getByLabel('Name (Arabic)').fill(nameAr);
  if (extra.phone) await page.getByLabel('Mobile').fill(extra.phone);
  if (extra.department) await page.getByLabel('Department').fill(extra.department);
  await page.getByLabel('Basic salary').fill('500');
  await page.getByRole('button', { name: 'Save employee' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

/** Another company, set up from Add company; it becomes the open one. */
async function addCompany(page: Page, name: string, type?: string) {
  await page.goto('#/setup');
  await page.getByLabel('Company name').fill(name);
  if (type) await page.getByLabel('Company type').selectOption({ label: type });
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByText(`${name} is ready.`)).toBeVisible();
}

test('an employee of another company is found from one page and from search', async ({ page }) => {
  await createCompany(page, 'Made-up Trading');
  await addEmployee(page, 'Faisal Testing', 'فيصل التجريبي', { phone: '+965 5555 0101' });
  await addCompany(page, 'Made-up Guarding', 'Security services');
  await addEmployee(page, 'Maryam Sample', 'مريم سامبل');

  // Off until switched on: no link, and search finds only this company's staff.
  await page.goto('#/employees');
  await expect(page.getByRole('heading', { name: 'Employees', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Search all companies' })).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox', { name: 'Search' }).fill('faisal');
  await expect(palette.getByText('Nothing found for “faisal”')).toBeVisible();
  await page.keyboard.press('Escape');

  // The owner switches both companies on in Settings → Companies.
  await page.goto('#/settings/companies');
  const section = page.getByRole('list', { name: 'Companies searched' });
  await section.getByRole('switch', { name: /Made-up Trading/ }).click();
  await section.getByRole('switch', { name: /Made-up Guarding/ }).click();
  await expect(section.getByRole('switch', { name: /Made-up Trading/ })).toBeChecked();
  await expect(section.getByRole('switch', { name: /Made-up Guarding/ })).toBeChecked();

  // From the open company (Guarding), every company's employees.
  await page.goto('#/employees');
  await page.getByRole('link', { name: 'Search all companies' }).click();
  await expect(page).toHaveURL(/#\/people\/all$/);
  await expect(page.getByRole('heading', { name: 'All companies', level: 1 })).toBeVisible();
  const table = page.getByRole('table', { name: 'Employees' });
  await expect(table.getByRole('row', { name: /Faisal Testing.*Made-up Trading/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /Maryam Sample.*Made-up Guarding/ })).toBeVisible();
  await expect(table).not.toContainText('500');
  // By company type, and by phone digits typed in Arabic.
  await page.getByLabel('Company type').selectOption({ label: 'Security services' });
  await expect(table.getByRole('row', { name: /Faisal Testing/ })).toHaveCount(0);
  await page.getByLabel('Company type').selectOption({ label: 'All types' });
  await page.getByRole('searchbox', { name: 'Search employees' }).fill('٥٥٥٥٠١٠١');
  await expect(table.getByRole('row', { name: /Maryam Sample/ })).toHaveCount(0);
  await expect(table.getByRole('row', { name: /Faisal Testing/ })).toBeVisible();

  // Opened in its own company.
  await table.getByRole('button', { name: 'Faisal Testing' }).click();
  await expect(page.getByText('Made-up Trading is open now.')).toBeVisible();
  await expect(page).toHaveURL(/#\/employees\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Faisal Testing');
  const switcher = page.getByRole('button', { name: 'Switch company' });
  await expect(switcher).toContainText('Made-up Trading');

  // Search: the other company's employee, under its own section, in Arabic too.
  await page.keyboard.press('Control+k');
  await palette.getByRole('combobox', { name: 'Search' }).fill('مريم');
  await expect(palette.getByRole('group', { name: 'Employees in other companies' })).toBeVisible();
  const option = palette.getByRole('option', { name: /Maryam Sample/ });
  await expect(option).toContainText('Made-up Guarding');
  await option.click();
  await expect(page.getByText('Made-up Guarding is open now.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Maryam Sample');
  await expect(switcher).toContainText('Made-up Guarding');
  // Remembered among the recent items of the company it belongs to.
  await page.keyboard.press('Control+k');
  await expect(palette.getByRole('option').first()).toContainText('Maryam Sample');
  await page.keyboard.press('Escape');

  // In Arabic.
  await page.goto('#/people/all');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.getByRole('heading', { name: 'كل الشركات', level: 1 })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('فيصل التجريبي');
});

test('a company where the person is staff adds nobody to the search across companies', async ({
  page,
}) => {
  test.slow();
  const cloud = new FakeSupabase();
  await cloud.install(page);
  const owner = { email: 'owner@example.com', password: 'safe-password-1', name: 'Test Owner' };
  cloud.addUser(owner.email, owner.password, owner.name);
  cloud.addUser('staff@example.com', 'safe-password-3', 'Test Staff');

  // The owner keeps a company with an employee in the cloud and invites staff.
  await createCompany(page, 'Made-up Sea Co');
  await addEmployee(page, 'Hidden Person', 'شخص مخفي');
  await page.goto('#/signin');
  await page.getByLabel('Email', { exact: true }).fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(owner.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Keep in the cloud' }).click();
  const account = page.getByRole('button', { name: `Account: ${owner.name}` });
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await page.goto('#/settings/team');
  const invite = page
    .getByRole('region')
    .or(page.locator('form'))
    .filter({ has: page.getByRole('button', { name: 'Create invitation link' }) });
  await invite.getByLabel('Email', { exact: true }).fill('staff@example.com');
  await invite.getByLabel('Role').selectOption('staff');
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  const link = await page.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  await account.click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const signOut = page.getByRole('dialog', { name: 'Sign out?' });
  await signOut.getByText('Remove them from this device').click();
  await signOut.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Maham One' })).toBeVisible();
  // Signed out too, not only the companies removed: the app has then gone home
  // (a toast from an earlier sign-out may still be showing, so not by that).
  await expect(
    page.getByRole('heading', { name: 'Work from any device, with your team' }),
  ).toBeVisible();

  // On this device the staff member also keeps two companies of their own.
  await createCompany(page, 'Made-up Own One');
  await addEmployee(page, 'Own Person One', 'شخص أول');
  await addCompany(page, 'Made-up Own Two');
  await addEmployee(page, 'Own Person Two', 'شخص ثان');
  await page.goto(link);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Password', { exact: true }).fill('safe-password-3');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Accept and download' }).click();
  // With companies of their own here, the list of companies comes first.
  const downloaded = page
    .getByRole('region', { name: 'On this device' })
    .getByRole('listitem')
    .filter({ hasText: 'Made-up Sea Co' });
  await expect(downloaded).toContainText('Synced', { timeout: 30_000 });
  await downloaded.getByRole('button', { name: 'Made-up Sea Co' }).click();
  await expect(page.getByRole('button', { name: 'Switch company' })).toContainText(
    'Made-up Sea Co',
  );

  // Only their own companies can be switched on.
  await page.goto('#/settings/companies');
  const section = page.getByRole('list', { name: 'Companies searched' });
  await expect(section.getByRole('switch')).toHaveCount(2);
  await expect(section.getByRole('switch', { name: /Made-up Sea Co/ })).toHaveCount(0);
  await section.getByRole('switch', { name: /Made-up Own One/ }).click();
  await section.getByRole('switch', { name: /Made-up Own Two/ }).click();
  await expect(section.getByRole('switch', { name: /Made-up Own Two/ })).toBeChecked();

  // The page and search: their own companies' employees, nothing of the staff company.
  await page.goto('#/people/all');
  const table = page.getByRole('table', { name: 'Employees' });
  await expect(table.getByRole('row', { name: /Own Person One/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /Own Person Two/ })).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(page.getByText('Hidden Person')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox', { name: 'Search' }).fill('person');
  await expect(palette.getByRole('option', { name: /Own Person One/ })).toBeVisible();
  await expect(palette.getByRole('option', { name: /Hidden Person/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The staff company's own People pages stay private.
  await page.goto('#/employees');
  await expect(page.getByRole('heading', { name: 'Payroll and people are private' })).toBeVisible();
});

test('a stateless employee holds a review card instead of a residency, in both languages', async ({
  page,
}) => {
  await createCompany(page, 'Made-up Guarding');
  await page.goto('#/employees/new');
  await page.getByLabel('Name (English)').fill('Saad Testing');
  await page.getByLabel('Name (Arabic)').fill('سعد التجريبي');
  await page.getByLabel('Category').selectOption({ label: 'Stateless (Bedoon)' });
  await expect(page.getByText(/^Not insured with PIFSS\. No residency needed/)).toBeVisible();
  // No residency is asked for; the work permit is optional.
  await expect(page.getByLabel('Residency expiry')).toHaveCount(0);
  await expect(page.getByLabel('PIFSS number')).toHaveCount(0);
  await expect(page.getByLabel('Work permit number')).toBeVisible();
  await page.getByLabel('Review card number').fill('RC-2041');
  await page.getByLabel('Review card expiry').fill(inDays(20));
  await page.getByLabel('Basic salary').fill('300');
  await page.getByRole('button', { name: 'Save employee' }).first().click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saad Testing');
  await expect(page.getByText('Stateless (Bedoon)', { exact: true })).toBeVisible();
  const card = page.getByRole('listitem').filter({ hasText: 'Central Agency review card' });
  await expect(card).toContainText('Expires in 20 days');
  // Reminded in Compliance like any other paper.
  await page.goto('#/compliance');
  const item = page.getByRole('listitem').filter({ hasText: 'Central Agency review card' });
  await expect(item).toContainText('Saad Testing');
  await expect(item).toContainText('Due soon');

  // On the list, counted and filtered on their own.
  await page.goto('#/employees');
  await expect(page.getByText('Stateless (Bedoon): 1')).toBeVisible();
  await page.getByLabel('Category').selectOption({ label: 'Expatriate' });
  await expect(page.getByText('No employees match.')).toBeVisible();
  await page.getByLabel('Category').selectOption({ label: 'Stateless (Bedoon)' });
  await expect(page.getByRole('row', { name: /Saad Testing/ })).toBeVisible();

  // In Arabic.
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.getByRole('row', { name: /سعد التجريبي/ })).toContainText(
    'غير محدد الجنسية (بدون)',
  );
  await page
    .getByRole('row', { name: /سعد التجريبي/ })
    .getByRole('link')
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('سعد التجريبي');
  await expect(page.getByText('بطاقة المراجعة (الجهاز المركزي)')).toBeVisible();
  await page.getByRole('link', { name: 'تعديل', exact: true }).click();
  await expect(page.getByLabel('الفئة')).toHaveValue('stateless');
  await expect(page.getByLabel('رقم بطاقة المراجعة')).toHaveValue('RC-2041');
});

test('departments are a list with Arabic names, renamed with their employees and given to several at once', async ({
  page,
}) => {
  await createCompany(page, 'Made-up Trading');
  await addEmployee(page, 'Huda Testing', 'هدى التجريبية', { department: 'Securty' });
  await addEmployee(page, 'Fahad Testing', 'فهد التجريبي');
  await addEmployee(page, 'Noura Testing', 'نورة التجريبية');

  // The list starts from the departments in use.
  await page.goto('#/employees');
  await page.getByRole('button', { name: 'Departments', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Departments', exact: true });
  await dialog.getByRole('button', { name: 'Add the departments in use' }).click();
  const list = dialog.getByRole('list', { name: 'Departments' });
  await expect(list.getByRole('listitem', { name: 'Securty' })).toContainText('1 employee');

  // A rename moves its employees, after a warning; the Arabic name comes with it.
  await list.getByRole('button', { name: 'Actions for Securty' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await list.getByLabel('Name (English)').fill('Security');
  await list.getByLabel('Name (Arabic)').fill('الأمن');
  await list.getByRole('button', { name: 'Save' }).click();
  await page
    .getByRole('dialog', { name: 'Rename Securty to Security?' })
    .getByRole('button', { name: 'Rename' })
    .click();
  await expect(list.getByRole('listitem', { name: 'Security' })).toContainText('الأمن');

  // Another one, added by hand.
  const add = dialog.locator('form');
  await add.getByLabel('Name (English)').fill('Head Office');
  await add.getByLabel('Name (Arabic)').fill('الإدارة');
  await add.getByRole('button', { name: 'Add department' }).click();
  await expect(list.getByRole('listitem', { name: 'Head Office' })).toContainText('0 employees');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('row', { name: /Huda Testing/ })).toContainText('Security');

  // Two employees chosen on the list go to Head Office together.
  await page.getByRole('checkbox', { name: 'Select Fahad Testing' }).check();
  await page.getByRole('checkbox', { name: 'Select Noura Testing' }).check();
  const selection = page.getByRole('region', { name: 'Selected employees' });
  await expect(selection).toContainText('2 selected');
  await selection.getByRole('button', { name: 'Department' }).click();
  const assign = page.getByRole('dialog', { name: 'Department', exact: true });
  await assign.getByLabel('Department', { exact: true }).selectOption({ label: 'Head Office' });
  await assign.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('2 employees moved')).toBeVisible();
  await expect(selection).toBeHidden();
  await expect(page.getByRole('row', { name: /Fahad Testing/ })).toContainText('Head Office');
  await expect(page.getByRole('row', { name: /Noura Testing/ })).toContainText('Head Office');
  // And one taken out of it again, chosen on its own.
  await page.getByRole('checkbox', { name: 'Select Fahad Testing' }).check();
  await selection.getByRole('button', { name: 'Department' }).click();
  await assign.getByLabel('Take them out of their department').check();
  await assign.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('1 employee moved')).toBeVisible();
  await expect(page.getByRole('row', { name: /Fahad Testing/ })).not.toContainText('Head Office');

  // The form chooses from the list, or "Other…" to type one.
  await page.goto('#/employees/new');
  const department = page.getByLabel(/^Department/);
  await expect(department.locator('option')).toHaveText([
    'No department',
    'Head Office',
    'Security',
    'Other…',
  ]);

  // In Arabic the departments show their Arabic names; links keep the English one.
  await page.goto('#/employees');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.getByRole('row', { name: /هدى التجريبية/ })).toContainText('الأمن');
  await page.goto('#/people');
  await page.getByRole('link', { name: /الإدارة/ }).click();
  await expect(page).toHaveURL(/department=Head%20Office/);
  await expect(page.getByText('نورة التجريبية')).toBeVisible();
  await expect(page.getByText('هدى التجريبية')).toHaveCount(0);
});

test('drivers without a valid driving licence are flagged once the company checks them', async ({
  page,
}) => {
  await createCompany(page, 'Made-up Transport');
  const newEmployee = async (name: string, number: string, jobTitle: string) => {
    await page.goto('#/employees/new');
    await page.getByLabel('Name (English)').fill(name);
    await page.getByLabel('Employee number').fill(number);
    await page.getByLabel('Job title (English)').fill(jobTitle);
    await page.getByLabel('Basic salary').fill('300');
  };
  const save = async (name: string) => {
    await page.getByRole('button', { name: 'Save employee' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  };

  // A driver by the job title: nothing is asked or flagged while licences aren't checked.
  await newEmployee('Driver Testing', '501', 'Heavy Driver');
  await expect(page.getByLabel('Drives for work')).toHaveCount(0);
  await save('Driver Testing');
  await expect(page.getByText('Driving licence missing')).toHaveCount(0);

  // The owner switches the check on in the compliance settings.
  await page.goto('#/compliance');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Compliance settings' });
  await settings.getByRole('switch', { name: 'Check drivers’ licences' }).click();
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toBeHidden();

  // The warning shows on their page, and the licence is added from it with its class.
  await page.goto('#/employees');
  await page.getByRole('link', { name: 'Driver Testing' }).click();
  const missing = page.getByRole('listitem').filter({ hasText: 'Driving licence missing' });
  await expect(missing).toContainText('Missing');
  await missing.getByRole('button', { name: 'Add licence' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add document' });
  await expect(dialog.getByLabel('Document type')).toHaveValue('driving_licence');
  await dialog.getByLabel('Licence class').fill('Heavy');
  await dialog.getByLabel('Expiry date').fill(inDays(20));
  await dialog.getByRole('button', { name: 'Add document' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Driving licence missing')).toHaveCount(0);
  const licence = page.getByRole('listitem').filter({ hasText: /^Driving licenceClass Heavy/ });
  await expect(licence).toContainText('Expires in 20 days');

  // A licence expiring in 20 days is Expiring in the register.
  await page.goto('#/compliance/documents');
  await page.getByRole('tab', { name: /^Expiring/ }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Driving licence' })).toContainText(
    'Driver Testing',
  );

  // A guard who drives for work, as set on their page.
  await newEmployee('Guard Testing', '502', 'Security Guard');
  const drives = page.getByLabel('Drives for work');
  await expect(drives).toHaveValue('auto');
  await expect(page.getByText('Not a driver by the job title.')).toBeVisible();
  await drives.selectOption({ label: 'Yes' });
  await expect(page.getByText('A valid driving licence is needed.')).toBeVisible();
  await save('Guard Testing');
  await expect(page.getByText('Driving licence missing')).toBeVisible();

  // Both lists filter the drivers without a valid licence.
  await page.goto('#/compliance/documents');
  await page.getByRole('tab', { name: /^Drivers without a valid licence/ }).click();
  await expect(page.getByRole('link', { name: 'Guard Testing' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Driver Testing' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Add a driving licence for Guard Testing' }),
  ).toBeVisible();
  await page.goto('#/employees');
  await page.getByRole('button', { name: 'Drivers without a valid licence' }).click();
  await expect(page.getByRole('row', { name: /Guard Testing/ })).toContainText('Missing');
  await expect(page.getByRole('row', { name: /Driver Testing/ })).toHaveCount(0);

  // A scan added from the list is filed as their driving licence.
  await page.getByRole('button', { name: 'Add documents' }).click();
  const bulk = page.getByRole('dialog', { name: 'Add documents' });
  await bulk.getByLabel('File as driving licence').check();
  await bulk.locator('input[type=file]').setInputFiles([
    {
      name: 'Licence 502.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n'),
    },
  ]);
  await expect(bulk.getByText('1 file matched')).toBeVisible();
  await bulk.getByRole('button', { name: 'Add 1 file' }).click();
  await expect(bulk).toBeHidden();
  await expect(page.getByText('1 scan filed as a driving licence')).toBeVisible();
  // The licence filed has no expiry date yet: the driver stays flagged until it's entered.
  await expect(page.getByRole('row', { name: /Guard Testing/ })).toContainText('No expiry date');
  await page.getByRole('button', { name: 'Drivers without a valid licence' }).click();
  await page.getByRole('link', { name: 'Guard Testing' }).click();
  await expect(page.getByText('Licence 502.pdf')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit Driving licence' }).click();
  const filed = page.getByRole('dialog', { name: 'Edit document' });
  await expect(filed).toContainText('Licence 502.pdf');
  await filed.getByLabel('Expiry date').fill(inDays(400));
  await filed.getByRole('button', { name: 'Save' }).click();
  await expect(filed).toBeHidden();
  await page.goto('#/employees');
  await page.getByRole('button', { name: 'Drivers without a valid licence' }).click();
  await expect(page.getByText('No employees match.')).toBeVisible();

  // In Arabic.
  await page.goto('#/compliance/documents');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.getByRole('tab', { name: /^السائقون بدون رخصة سارية/ })).toBeVisible();
});

test('an Iqama lead time of 90 days marks an Iqama expiring in 80 days, and a renewal asks for its new copy', async ({
  page,
}) => {
  await createCompany(page, 'Made-up Services');
  await page.goto('#/employees/new');
  await page.getByLabel('Name (English)').fill('Made-up Worker');
  await chooseOption(page, page.getByLabel('Nationality'), {
    placeholder: 'Search countries…',
    query: 'India',
  });
  await page.getByLabel('Residency number').fill('18/2025/77');
  await page.getByLabel('Residency expiry').fill(inDays(80));
  await page.getByLabel('Basic salary').fill('300');
  await page.getByRole('button', { name: 'Save employee' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Made-up Worker');

  // 80 days before its expiry, with the company's 60/30/7, the residency is valid.
  await page.goto('#/compliance/documents');
  const residency = page.getByRole('row').filter({ hasText: 'Residency' });
  await expect(residency).toContainText('Valid');

  // Reminders by document type: the owner's lead times are offered, a residency 90 days before.
  await page.goto('#/compliance');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Compliance settings' });
  await expect(
    settings.getByRole('switch', { name: 'Reminders by document type' }),
  ).toHaveAttribute('aria-checked', 'false');
  await settings.getByRole('switch', { name: 'Reminders by document type' }).click();
  await expect(settings.getByLabel('Days before expiry for Residency')).toHaveValue(
    '90, 60, 30, 7',
  );
  await expect(settings.getByLabel('Days before expiry for Passport')).toHaveValue('180, 90, 30');
  await expect(settings.getByLabel('Days before expiry for Vehicle registration')).toHaveValue(
    '30, 14, 7',
  );
  // And the new copy, asked for a day after a renewal.
  await settings.getByRole('switch', { name: 'Ask for the new copy after a renewal' }).click();
  await settings.getByLabel('Ask for the new copy within (days)').fill('1');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toBeHidden();
  await page.goto('#/compliance/documents');
  await expect(residency).toContainText('Expires in 80 days');
  await expect(residency).not.toContainText('Valid');

  // Renewed ten days ago, without its new copy: the register asks for it.
  await residency.getByRole('button', { name: 'Renew Residency' }).click();
  const renew = page.getByRole('dialog', { name: 'Renew Residency' });
  await renew.getByLabel('Renewed on').fill(inDays(-10));
  await renew.getByRole('switch', { name: 'Record the fee as an expense' }).click();
  await renew.getByRole('button', { name: 'Renew' }).click();
  await expect(renew).toBeHidden();
  await expect(residency).toContainText('Valid');
  await expect(residency).toContainText('New copy missing');
  await page.getByRole('tab', { name: /^New copy missing/ }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Made-up Worker' })).toHaveCount(1);

  // The scan in the personnel file, marked as the new residency: no longer missing.
  await page.goto('#/employees');
  await page.getByRole('link', { name: 'Made-up Worker' }).click();
  await page.getByLabel('Attach a file').setInputFiles({
    name: 'residency-2027.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n'),
  });
  await expect(page.getByText('File added')).toBeVisible();
  await page.getByRole('button', { name: 'This file is the… (residency-2027.pdf)' }).click();
  const tag = page.getByRole('dialog', { name: 'This file is the…' });
  // Its only paper with dates: the residency, valid until its new expiry.
  await tag.getByLabel('Copy of').selectOption({ index: 1 });
  await tag.getByRole('button', { name: 'Save' }).click();
  await expect(tag).toBeHidden();
  await expect(page.getByText(/^Residency, valid until/)).toBeVisible();
  await page.goto('#/compliance/documents');
  await expect(page.getByRole('row').filter({ hasText: 'Residency' })).not.toContainText(
    'New copy missing',
  );

  // In Arabic.
  await page.goto('#/compliance');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: 'الإعدادات', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'التذكير حسب نوع المستند' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

/** Rows of a table of this device's database, read in the page. */
async function storedRows(page: Page, table: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AlmailBooks');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = database.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return rows;
  }, table);
}

/**
 * A guard on the payroll at an invented salary, a customer, and the
 * manpower costing (#3) switched on, with the rate card saved from the
 * salaries and a costing of six guards on 12-hour shifts.
 */
async function guardsCosting(page: Page) {
  await page.goto('#/employees/new');
  await page.getByLabel('Name (English)').fill('Made-up Guard');
  await page.getByLabel('Name (Arabic)').fill('حارس تجريبي');
  await chooseOption(page, page.getByLabel('Nationality'), {
    placeholder: 'Search countries…',
    query: 'India',
  });
  await page.getByLabel('Job title (English)').fill('Security Guard');
  await page.getByLabel('Basic salary').fill('137.25');
  await page.getByRole('button', { name: 'Save employee' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Made-up Guard');
  await page.goto('#/clients/new');
  await page.getByLabel('Client name').fill('Made-up Towers Co.');
  await page.getByRole('button', { name: 'Save client' }).first().click();
  await expect(page).toHaveURL(/#\/clients\/[0-9a-f-]{36}$/);

  // Off until switched on.
  await page.goto('#/people/costing');
  const toggle = page.getByRole('switch', { name: 'Use manpower costing' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(page.getByText('Manpower costing turned on')).toBeVisible();

  // The rate card starts from the current salaries, worked out here.
  await expect(page.getByRole('textbox', { name: 'Job title' }).first()).toHaveValue(
    'Security Guard',
  );
  await expect(page.getByRole('textbox', { name: 'Basic salary' }).first()).toHaveValue('137.25');
  await page.getByRole('button', { name: 'Save rate card' }).click();
  await expect(page.getByText('Rate card saved')).toBeVisible();

  await page.getByRole('link', { name: 'New costing' }).first().click();
  await expect(page).toHaveURL(/#\/people\/costing\/new$/);
  await page.getByLabel('Name', { exact: true }).fill('Tower A, night shift');
  await chooseOption(page, page.getByLabel('Customer'), {
    placeholder: 'Search…',
    query: 'Made-up Towers',
    option: 'Made-up Towers Co.',
  });
  await page
    .getByRole('combobox', { name: 'Add from the rate card' })
    .selectOption({ label: 'Security Guard · Expatriate' });
  const post = page.getByTestId('costing-post');
  await post.getByLabel('Headcount').fill('6');
  await post.getByLabel('Hours a day').fill('12');
  // 4 hours of overtime a day: priced, and flagged (art. 66).
  await expect(post.getByText(/Article 66 of Labour Law 6\/2010/)).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Costing saved')).toBeVisible();
  await expect(page).toHaveURL(/#\/people\/costing\/[0-9a-f-]{36}$/);
}

test('a manpower costing prices guards from salaries and makes a quote with sell prices only', async ({
  page,
}) => {
  test.slow();
  await createCompany(page, 'Made-up Guarding');
  await guardsCosting(page);

  // The internal cost sheet has the salaries and the margin.
  const { content } = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'Cost sheet' }).click(),
  );
  const sheet = await pdfText(content);
  expect(sheet).toContain('Costsheet');
  expect(sheet).toContain('Internal');
  expect(sheet).toContain('137.250');

  // The quote: the post at its sell price, and nothing of what it costs.
  const sell = await page.getByTestId('costing-post').getByText(/^KD/).nth(6).innerText();
  await page.getByRole('button', { name: 'Make quote' }).click();
  await expect(page).toHaveURL(/#\/quotes\/[0-9a-f-]{36}$/);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText(/^Quote QUO-/);
  await expect(
    main.getByText(
      `KD ${(6 * Number(sell.replace(/[^\d.]/g, ''))).toLocaleString('en', { minimumFractionDigits: 3 })}`,
    ),
  ).toBeVisible();
  await expect(main.getByRole('link', { name: 'Tower A, night shift' })).toBeVisible();
  const shown = await main.innerText();
  for (const secret of ['137.250', 'PIFSS', 'Overhead', 'Margin', 'Indemnity', 'salary']) {
    expect(shown, secret).not.toContain(secret);
  }
  const quote = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).first().click(),
  );
  const printed = await pdfText(quote.content);
  expect(printed).toContain('SecurityGuard');
  expect(printed).toContain(sell.replace(/\s/g, '').replace('KD', ''));
  for (const secret of ['137.250', 'PIFSS', 'Overhead', 'Margin', 'Indemnity', 'Costsheet']) {
    expect(printed, secret).not.toContain(secret);
  }
  // Stored with the costing's id only, and the costing with the quote's.
  const [stored] = (await storedRows(page, 'documents')).filter((d) => d.type === 'quote');
  const [costing] = await storedRows(page, 'staffingCostings');
  expect(stored.costingId).toBe(costing.id);
  expect(costing.quoteId).toBe(stored.id);
  expect(costing.status).toBe('quoted');
  const { costingId: _, ...rest } = stored;
  expect(JSON.stringify(rest)).not.toMatch(/137\.25|salar|pifss|margin|overhead/i);
});

test('staff never see manpower costings, only the quote made from one', async ({ page }) => {
  test.slow();
  const cloud = new FakeSupabase();
  await cloud.install(page);
  const owner = { email: 'owner@example.com', password: 'safe-password-1', name: 'Test Owner' };
  cloud.addUser(owner.email, owner.password, owner.name);
  cloud.addUser('staff@example.com', 'safe-password-3', 'Test Staff');

  // The owner prices a costing and makes its quote, then keeps the company in the cloud.
  await createCompany(page, 'Made-up Guarding');
  await guardsCosting(page);
  await page.getByRole('button', { name: 'Make quote' }).click();
  await expect(page).toHaveURL(/#\/quotes\/[0-9a-f-]{36}$/);
  const quoteId = page.url().split('/').pop()!;
  await page.goto('#/signin');
  await page.getByLabel('Email', { exact: true }).fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(owner.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Keep in the cloud' }).click();
  const account = page.getByRole('button', { name: `Account: ${owner.name}` });
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  const [company] = [...cloud.companies.keys()];
  expect(cloud.rows(company, 'staffingCostings')).toHaveLength(1);

  await page.goto('#/settings/team');
  const invite = page
    .getByRole('region')
    .or(page.locator('form'))
    .filter({ has: page.getByRole('button', { name: 'Create invitation link' }) });
  await invite.getByLabel('Email', { exact: true }).fill('staff@example.com');
  await invite.getByLabel('Role').selectOption('staff');
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  const link = await page.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  await account.click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const signOut = page.getByRole('dialog', { name: 'Sign out?' });
  await signOut.getByText('Remove them from this device').click();
  await signOut.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page.getByRole('heading', { name: 'Work from any device, with your team' }),
  ).toBeVisible();

  // Staff join and download the company.
  await page.goto(link);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Password', { exact: true }).fill('safe-password-3');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Accept and download' }).click();
  await expect(page.getByRole('button', { name: 'Account: Test Staff' })).toContainText('Synced', {
    timeout: 30_000,
  });

  // Nothing of the costing reaches their device, and its page is locked.
  expect(await storedRows(page, 'staffingCostings')).toEqual([]);
  const activity = await storedRows(page, 'activities');
  expect(activity.filter((a) => a.entity === 'costing')).toEqual([]);
  expect(JSON.stringify(activity)).not.toContain('Tower A');
  await page.goto('#/people/costing');
  await expect(page.getByRole('heading', { name: 'Payroll and people are private' })).toBeVisible();
  await expect(page.getByText('Tower A, night shift')).toHaveCount(0);

  // The quote is theirs to see, at sell prices only, with no way to the costing.
  await page.goto(`#/quotes/${quoteId}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText(/^Quote QUO-/);
  await expect(main.getByText('Total')).toBeVisible();
  await expect(main.getByText('Manpower costing')).toHaveCount(0);
  await expect(main.getByText('Tower A, night shift')).toHaveCount(0);
  expect(await main.innerText()).not.toContain('137.250');
});
