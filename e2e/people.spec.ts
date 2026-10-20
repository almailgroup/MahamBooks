import type { Page } from '@playwright/test';
import { chooseOption, createCompany, expect, test } from './fixtures';
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
  await assign.getByLabel('Department').selectOption({ label: 'Head Office' });
  await assign.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('2 employees moved')).toBeVisible();
  await expect(selection).toBeHidden();
  await expect(page.getByRole('row', { name: /Fahad Testing/ })).toContainText('Head Office');
  await expect(page.getByRole('row', { name: /Noura Testing/ })).toContainText('Head Office');

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
