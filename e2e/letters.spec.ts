import type { Page } from '@playwright/test';
import { chooseOption, createCompany, expect, test } from './fixtures';
import { FakeSupabase } from './cloud-fake';

/**
 * Employee letters (#19): off until turned on in People → Letters; the
 * templates' wording edited; a salary certificate drafted (a watermark and
 * no signature when printed), issued with the year's first number, printed
 * right to left in Arabic, and taken off Letters to print. In the cloud an
 * accountant asks for approval and the owner issues it; staff see the
 * lock. Made-up people and companies.
 */

const YEAR = new Date().getUTCFullYear();

async function addEmployee(page: Page, name: string, nameAr: string, salary: string) {
  await page.goto('#/employees/new');
  await page.getByLabel('Name (English)').fill(name);
  await page.getByLabel('Name (Arabic)').fill(nameAr);
  await page.getByLabel('Job title (English)').fill('Storekeeper');
  await page.getByLabel('Hire date').fill('2023-02-01');
  await page.getByLabel('Basic salary').fill(salary);
  await page.getByRole('button', { name: 'Save employee' }).first().click();
  await expect(page).toHaveURL(/#\/employees\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

/** Clicks Print without opening the browser's print dialog. */
async function print(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await page.getByRole('button', { name: 'Print' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed))
    .toBe(1);
}

test('a salary certificate is drafted, issued as the year’s first letter and printed in Arabic', async ({
  page,
}) => {
  await createCompany(page, 'Made-up Pearl Trading');
  await addEmployee(page, 'Made-up Storekeeper', 'أمين مخزن تجريبي', '600');

  // Off until turned on: the page offers the switch, nothing else.
  await page.goto('#/people/letters');
  await expect(page.getByRole('heading', { name: 'Letters', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New letter' })).toHaveCount(0);
  await page.getByRole('switch', { name: /Use employee letters/ }).click();
  await expect(page.getByText('Employee letters turned on')).toBeVisible();

  // The salary certificate's wording, edited and saved.
  await page.getByRole('link', { name: 'Letter templates' }).click();
  await expect(page.getByRole('heading', { name: 'Letter templates' })).toBeVisible();
  await page.getByRole('link', { name: /Salary certificate/ }).click();
  await expect(page.getByLabel('Kind of letter')).toHaveValue('salary_certificate');
  await expect(page.getByLabel('Printed in')).toHaveValue('ar');
  const arabic = page.getByLabel('Text (Arabic)');
  await arabic.fill(`${await arabic.inputValue()}\nمع خالص التحية.`);
  await page.getByLabel('Signed by').fill('Made-up Manager');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Template saved')).toBeVisible();

  // A draft for the employee, previewed with their record.
  await page.goto('#/people/letters');
  await page.getByRole('button', { name: 'New letter' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Salary certificate' });
  await chooseOption(page, dialog.getByLabel('Employee'), {
    placeholder: 'Search employees…',
    query: 'Made-up Storekeeper',
  });
  const preview = dialog.getByRole('region', { name: 'Preview' });
  await expect(preview).toContainText('أمين مخزن تجريبي');
  await expect(preview).toContainText('مع خالص التحية.');
  await expect(preview).toContainText('600.000');
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();

  // Printed as a draft: a watermark, no number and no signature.
  await page.getByRole('tab', { name: /Drafts/ }).click();
  await page.getByRole('button', { name: 'Salary certificate' }).click();
  await page.getByRole('link', { name: 'Print' }).click();
  const sheet = page.locator('article');
  await expect(sheet).toHaveAttribute('dir', 'rtl');
  await expect(sheet.getByText('مسودة · DRAFT')).toBeVisible();
  await expect(sheet.getByText('Made-up Manager')).toBeVisible();
  await expect(sheet.locator('img')).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to letters' }).click();

  // Issued: the year's first number, its text frozen.
  await page.getByRole('tab', { name: /Drafts/ }).click();
  await page.getByRole('button', { name: 'Salary certificate' }).click();
  const draft = page.getByRole('dialog', { name: 'Salary certificate' });
  await draft.getByRole('button', { name: 'Issue letter' }).click();
  await page
    .getByRole('dialog', { name: 'Issue this letter?' })
    .getByRole('button', { name: 'Issue letter' })
    .click();
  await expect(page.getByText(`Letter HR-${YEAR}-0001 issued`)).toBeVisible();
  const issued = page.getByRole('dialog', { name: `Salary certificate HR-${YEAR}-0001` });
  await expect(issued.getByText('Not printed yet')).toBeVisible();
  await expect(issued.getByRole('button', { name: 'Save draft' })).toHaveCount(0);

  // Printed: no watermark, the number and date in Arabic, and off the list to print.
  await issued.getByRole('link', { name: 'Print' }).click();
  await expect(sheet.getByText(`HR-${YEAR}-0001`)).toBeVisible();
  await expect(sheet.getByText('مسودة · DRAFT')).toHaveCount(0);
  await expect(sheet.getByText('الرقم:')).toBeVisible();
  await expect(sheet.getByText(/أمين مخزن تجريبي/).first()).toBeVisible();
  await print(page);
  await page.getByRole('link', { name: 'Back to letters' }).click();
  await page.getByRole('tab', { name: /To print/ }).click();
  await expect(page.getByText('Nothing to print')).toBeVisible();
  await page.getByRole('tab', { name: 'Issued' }).click();
  await expect(page.getByRole('row').filter({ hasText: `HR-${YEAR}-0001` })).toContainText(
    'Made-up Storekeeper',
  );

  // On the employee's page, and in Arabic.
  await page.goto('#/employees');
  await page.getByRole('link', { name: 'Made-up Storekeeper' }).first().click();
  await page.getByRole('tab', { name: 'Letters' }).click();
  await expect(page.getByRole('button', { name: `HR-${YEAR}-0001` })).toBeVisible();
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('tab', { name: 'الخطابات' })).toBeVisible();
  await expect(page.getByText('شهادة راتب').first()).toBeVisible();
  await page.goto('#/people/letters');
  await expect(page.getByRole('heading', { name: 'الخطابات', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'قوالب الخطابات' })).toBeVisible();
});

test.describe('in the cloud', () => {
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
  const STAFF = { email: 'staff@example.com', password: 'safe-password-4', name: 'Made-up Staff' };

  async function signIn(page: Page, who: typeof OWNER) {
    await page.goto('#/signin');
    await page.getByLabel('Email', { exact: true }).fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const account = page.getByRole('button', { name: `Account: ${who.name}` });
    return account;
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

  test('an accountant asks, the owner approves and issues; staff see the lock', async ({
    page,
  }) => {
    test.slow();
    cloud.addUser(OWNER.email, OWNER.password, OWNER.name);
    await createCompany(page, 'Made-up Falcon Services');
    await addEmployee(page, 'Made-up Driver', 'سائق تجريبي', '450');
    let account = await signIn(page, OWNER);
    await page.getByRole('button', { name: 'Keep in the cloud' }).click();
    await expect(account).toContainText('Synced', { timeout: 30_000 });
    const companyId = [...cloud.companies.keys()][0];
    await page.goto('#/people/letters');
    await page.getByRole('switch', { name: /Use employee letters/ }).click();
    await expect(page.getByText('Employee letters turned on')).toBeVisible();
    await expect(account).toContainText('Synced', { timeout: 30_000 });
    expect(cloud.rows(companyId, 'peopleSettings')[0].data).toMatchObject({ letters: true });

    const accountant = cloud.addUser(ACCOUNTANT.email, ACCOUNTANT.password, ACCOUNTANT.name);
    cloud.companies.get(companyId)!.members.set(accountant.id, 'accountant');
    const staff = cloud.addUser(STAFF.email, STAFF.password, STAFF.name);
    cloud.companies.get(companyId)!.members.set(staff.id, 'staff');
    await signOut(page, account);

    // The accountant drafts an employment certificate and asks for approval.
    account = await signIn(page, ACCOUNTANT);
    await expect(account).toContainText('Synced', { timeout: 30_000 });
    await page.goto('#/people/letters');
    await expect(page.getByRole('switch', { name: /Use employee letters/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'New letter' }).first().click();
    let dialog = page.getByRole('dialog', { name: 'Salary certificate' });
    await dialog.getByLabel('Template').selectOption({ label: 'Employment certificate' });
    dialog = page.getByRole('dialog', { name: 'Employment certificate' });
    await chooseOption(page, dialog.getByLabel('Employee'), {
      placeholder: 'Search employees…',
      query: 'Made-up Driver',
    });
    await expect(dialog.getByRole('button', { name: 'Issue letter' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Send for approval' }).click();
    const ask = page.getByRole('dialog', { name: 'Ask for approval to issue this letter?' });
    await ask.getByLabel('Note for the approver').fill('For the embassy.');
    await ask.getByRole('button', { name: 'Send for approval' }).click();
    await expect(page.getByText('Sent for approval')).toBeVisible();
    // The letter waits, and can be taken back while it does.
    await expect(dialog.getByText('Waiting for approval to issue it.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Take back' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(account).toContainText('Synced', { timeout: 30_000 });
    const asked = cloud.rows(companyId, 'approvals').map((r) => r.data!);
    expect(asked).toEqual([
      expect.objectContaining({
        kind: 'letter',
        subjectTbl: 'employeeLetters',
        status: 'pending',
        requestedBy: accountant.id,
      }),
    ]);
    expect(cloud.rows(companyId, 'employeeLetters')[0].data).toMatchObject({
      status: 'draft',
      number: '',
    });
    await signOut(page, account);

    // Staff see the lock: letters are People data.
    account = await signIn(page, STAFF);
    await expect(account).toContainText('Synced', { timeout: 30_000 });
    await page.goto('#/people/letters');
    await expect(
      page.getByRole('heading', { name: 'Payroll and people are private' }),
    ).toBeVisible();
    await expect(page.getByText('Made-up Driver')).toHaveCount(0);
    await signOut(page, account);

    // The owner approves on their device, which issues the letter.
    account = await signIn(page, OWNER);
    await expect(account).toContainText('Synced', { timeout: 30_000 });
    await page.goto('#/people/letters');
    await expect(page.getByText('For the embassy.')).toBeVisible();
    await page.getByRole('button', { name: 'Approve and issue' }).first().click();
    await page
      .getByRole('dialog', { name: 'Approve and issue this letter?' })
      .getByRole('button', { name: 'Approve and issue' })
      .click();
    await expect(page.getByText('Approved, and the letter is issued')).toBeVisible();
    await expect(account).toContainText('Synced', { timeout: 30_000 });
    await expect
      .poll(() => cloud.rows(companyId, 'employeeLetters')[0].data?.number)
      .toBe(`HR-${YEAR}-0001`);
    expect(cloud.rows(companyId, 'employeeLetters')[0].data).toMatchObject({ status: 'issued' });
    expect(cloud.rows(companyId, 'approvals')[0].data).toMatchObject({ status: 'applied' });
    await page.getByRole('tab', { name: /To print/ }).click();
    await expect(page.getByRole('row').filter({ hasText: `HR-${YEAR}-0001` })).toContainText(
      'Made-up Driver',
    );
  });
});
