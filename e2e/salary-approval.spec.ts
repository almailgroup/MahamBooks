import type { Page } from '@playwright/test';
import { createCompany, expect, test } from './fixtures';
import { FakeSupabase } from './cloud-fake';

/**
 * Salary approval by the Super Admin (#10): with the owner's switch on, the
 * accountant sends the month's pay run for approval, the owner (the Super
 * Admin) gives approval (موافقة) on their own device, and only then is the
 * pay run approved (posted, اعتماد). A change after sending asks for a new
 * approval. The cloud is a stand-in that answers as the server does.
 * Made-up people and companies.
 */

let cloud: FakeSupabase;

test.beforeEach(async ({ page }) => {
  cloud = new FakeSupabase();
  await cloud.install(page);
});

const OWNER = { email: 'owner@example.com', password: 'safe-password-1', name: 'Made-up Owner' };
const ACCOUNTANT = {
  email: 'accountant@example.com',
  password: 'safe-password-3',
  name: 'Made-up Accountant',
};

/** The month before the current one, as yyyy-MM and as the app writes it ("September 2026"). */
function lastMonth() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return {
    period: date.toISOString().slice(0, 7),
    label: date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

async function signIn(page: Page, who: typeof OWNER) {
  await page.goto('#/signin');
  await page.getByLabel('Email', { exact: true }).fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  return page.getByRole('button', { name: `Account: ${who.name}` });
}

async function signOut(page: Page, account: ReturnType<Page['getByRole']>) {
  await account.click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out?' });
  await dialog.getByText('Remove them from this device').click();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page.getByRole('heading', { name: 'Work from any device, with your team' }),
  ).toBeVisible();
}

async function addEmployee(
  page: Page,
  name: string,
  nameAr: string,
  salary: string,
  department: string,
  iban: string,
) {
  await page.goto('#/employees/new');
  await page.getByLabel('Name (English)').fill(name);
  await page.getByLabel('Name (Arabic)').fill(nameAr);
  await page.getByLabel('Department').fill(department);
  await page.getByLabel('Hire date').fill('2024-01-01');
  await page.getByLabel('Basic salary').fill(salary);
  await page.getByLabel('IBAN').fill(iban);
  await page.getByRole('button', { name: 'Save employee' }).first().click();
  await expect(page).toHaveURL(/#\/employees\/[0-9a-f-]{36}$/);
  // The employee's page, before going on: the form is gone.
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

test('a pay run is approved by the Super Admin before it is posted; a change asks again', async ({
  page,
  pageErrors,
}) => {
  test.slow();
  const month = lastMonth();
  const owner = cloud.addUser(OWNER.email, OWNER.password, OWNER.name);
  await createCompany(page, 'Desert Rose Guarding');
  // Made-up IBANs (valid check digits, no real account).
  await addEmployee(
    page,
    'Made-up Guard One',
    'حارس تجريبي أول',
    '320',
    'Operations',
    'KW54CBKU0000000000001234560102',
  );
  await addEmployee(
    page,
    'Made-up Guard Two',
    'حارس تجريبي ثان',
    '340',
    'Operations',
    'KW27CBKU0000000000001234560103',
  );
  await addEmployee(
    page,
    'Made-up Clerk',
    'كاتب تجريبي',
    '700',
    'Head Office',
    'KW97CBKU0000000000001234560104',
  );

  // Into the cloud; the owner turns salary approval on.
  let account = await signIn(page, OWNER);
  await page.getByRole('button', { name: 'Keep in the cloud' }).click();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  const companyId = [...cloud.companies.keys()][0];
  await page.goto('#/settings/approvals');
  await expect(page.getByRole('heading', { name: 'Pay runs' })).toBeVisible();
  await page.getByRole('switch', { name: /Pay runs need the Super Admin’s approval/ }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  // Books stays as it was: only pay runs wait.
  expect(cloud.rows(companyId, 'companies')[0].data?.approvalRules).toEqual({
    expireDays: 14,
    payroll: true,
  });

  const accountant = cloud.addUser(ACCOUNTANT.email, ACCOUNTANT.password, ACCOUNTANT.name);
  cloud.companies.get(companyId)!.members.set(accountant.id, 'accountant');
  await signOut(page, account);

  // The accountant prepares the month: it can't be approved before the Super Admin agrees.
  account = await signIn(page, ACCOUNTANT);
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await page.goto('#/payroll');
  await page.getByRole('button', { name: 'New pay run' }).first().click();
  const create = page.getByRole('dialog', { name: 'New pay run' });
  await create.getByLabel('Month').selectOption(month.period);
  await create.getByRole('button', { name: 'Prepare pay run' }).click();
  await expect(page).toHaveURL(/#\/payroll\/runs\/[0-9a-f-]{36}$/);
  const runUrl = page.url();
  await expect(
    page.getByText('This pay run needs the Super Admin’s approval before it is approved.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Ask for approval' }).click();
  const ask = page.getByRole('dialog', {
    name: `Ask the Super Admin to approve the payroll for ${month.label}?`,
  });
  await ask.getByLabel('Note for the Super Admin').fill('Two new guards this month.');
  await ask.getByRole('button', { name: 'Ask for approval' }).click();
  await expect(page.getByText('Sent for the Super Admin’s approval').first()).toBeVisible();
  await expect(page.getByText('Waiting for the Super Admin', { exact: true })).toBeVisible();

  // A change after sending: sent again for the run as it is now.
  await page.getByRole('row').filter({ hasText: 'Made-up Clerk' }).click();
  const line = page.getByRole('dialog', { name: 'Made-up Clerk' });
  await line.getByRole('button', { name: 'Add an addition or deduction' }).click();
  await line.getByLabel('Amount').fill('25');
  await line.getByLabel('Note').fill('Bonus');
  await line.getByRole('button', { name: 'Save' }).click();
  await expect(line).toBeHidden();
  await expect(
    page.getByText('This pay run changed after it was sent for approval. Send it again.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ask for approval again' }).click();
  await ask.getByRole('button', { name: 'Ask for approval' }).click();
  await expect(page.getByText('Waiting for the Super Admin', { exact: true })).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  const asked = cloud.rows(companyId, 'approvals').map((r) => r.data!);
  expect(asked.map((r) => r.status).sort()).toEqual(['cancelled', 'pending']);
  const waiting = asked.find((r) => r.status === 'pending')!;
  expect(waiting).toMatchObject({
    kind: 'payroll',
    subjectTbl: 'payRuns',
    requestedBy: accountant.id,
  });
  // Totals only: no names in the request.
  expect(JSON.stringify(waiting)).not.toContain('Made-up Guard');
  expect(waiting.after).toMatchObject({ totals: { employees: 3, gross: 1385 } });
  await signOut(page, account);

  // The owner gives approval on their own device, from the Approvals page.
  account = await signIn(page, OWNER);
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await page.goto('#/approvals');
  await expect(page.getByRole('heading', { name: 'Approval requests' })).toBeVisible();
  await expect(page.getByText(`Payroll for ${month.label}`)).toBeVisible();
  await expect(page.getByText(`Asked by ${ACCOUNTANT.name}`, { exact: false })).toBeVisible();
  // Each employee's pay is here, in the app.
  await page.getByRole('button', { name: 'Show each employee’s pay' }).click();
  await expect(page.getByRole('cell', { name: 'Made-up Guard One' })).toBeVisible();
  await page.getByRole('button', { name: 'Give approval' }).click();
  const agree = page.getByRole('dialog', {
    name: `Give approval to the payroll for ${month.label}?`,
  });
  await agree.getByRole('button', { name: 'Give approval' }).click();
  await expect(page.getByText('Approval given').first()).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  expect(cloud.rows(companyId, 'approvals').find((r) => r.id === waiting.id)?.data).toMatchObject({
    status: 'approved',
    decidedBy: owner.id,
  });
  await signOut(page, account);

  // Now the accountant approves (posts) it.
  account = await signIn(page, ACCOUNTANT);
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await page.goto(runUrl);
  await expect(
    page.getByText('The Super Admin approved it. You can approve (post) the pay run now.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(`Payroll for ${month.label} approved`)).toBeVisible();
  await expect(page.getByText('Approved by the Super Admin, and posted.')).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  expect(cloud.rows(companyId, 'approvals').find((r) => r.id === waiting.id)?.data).toMatchObject({
    status: 'applied',
  });
  expect(cloud.rows(companyId, 'payRuns')[0].data).toMatchObject({ status: 'approved' });

  // The register by department and position, ready to print.
  await page.getByRole('link', { name: 'Register by department' }).click();
  await expect(page.getByText('Payroll by department and position').first()).toBeVisible();
  await expect(page.getByText('كشف الرواتب حسب القسم والوظيفة').first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /Operations/ })).toBeVisible();

  // In Arabic: the Super Admin's decision is a موافقة, posting stays اعتماد.
  await page.goto(runUrl);
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('وافق عليه المشرف العام، واعتُمد.')).toBeVisible();
  await expect(page.getByText('تمت الموافقة واعتُمد المسير').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'الاعتمادات' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
