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
  extra: { phone?: string } = {},
) {
  await page.goto('#/employees/new');
  await page.getByLabel('Name (English)').fill(name);
  await page.getByLabel('Name (Arabic)').fill(nameAr);
  if (extra.phone) await page.getByLabel('Mobile').fill(extra.phone);
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
