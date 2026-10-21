import type { Page } from '@playwright/test';
import { createCompany, expect, test } from './fixtures';
import { FakeSupabase } from './cloud-fake';

/** yyyy-MM-dd `days` from today (the browser runs in UTC, see playwright.config.ts). */
const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

// A 1×1 PNG, enough to stand in for a photo of a receipt.
const RECEIPT = {
  name: 'Fuel receipt.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
};
const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n'),
});

async function addExpenseWithReceipt(page: Page) {
  await page.goto('#/expenses');
  await page.getByRole('button', { name: 'Record expense' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount paid').fill('12.500');
  await dialog.getByLabel('Description').fill('Fuel for the pickup');
  await dialog.getByLabel('Attach a file').setInputFiles(RECEIPT);
  await expect(dialog.getByText(RECEIPT.name)).toBeVisible();
  await dialog.getByRole('button', { name: 'Record expense' }).click();
  await expect(dialog).toBeHidden();
}

async function addLicence(page: Page) {
  await page.goto('#/compliance/documents');
  await page.getByRole('button', { name: 'Add document' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add document' });
  await dialog.getByLabel('Document number').fill('CL-2026-77');
  await dialog.getByLabel('Expiry date').fill(inDays(200));
  await dialog.locator('input[type=file]').setInputFiles(pdf('Commercial licence.pdf'));
  await expect(dialog.getByText('Commercial licence.pdf')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add document' }).click();
  await expect(dialog).toBeHidden();
}

async function addEmployeeWithContract(page: Page) {
  await page.goto('#/employees/new');
  await page.getByLabel('Name (English)').fill('Ahmad Testing');
  await page.getByLabel('Name (Arabic)').fill('أحمد التجريبي');
  await page.getByLabel('Basic salary').fill('400');
  await page.getByRole('button', { name: 'Save employee' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ahmad Testing');
  await page.getByLabel('Attach a file').setInputFiles(pdf('Employment contract.pdf'));
  await expect(page.getByText('Employment contract.pdf')).toBeVisible();
}

/** Runs `open` and waits for the tab it opens to show the file. */
async function opensFile(page: Page, open: () => Promise<void>) {
  const popup = page.waitForEvent('popup');
  await open();
  const tab = await popup;
  await expect.poll(() => tab.url()).toMatch(/^blob:/);
  await tab.close();
}

test('the Files page and search find every file of the company, in English and Arabic', async ({
  page,
}) => {
  await createCompany(page, 'Made-up Guarding');
  await addExpenseWithReceipt(page);
  await addLicence(page);
  await addEmployeeWithContract(page);

  // Off until switched on: no Files in the sidebar, nor files in search.
  await page.goto('#/compliance');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Calendar' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Files' })).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  const search = palette.getByRole('combobox', { name: 'Search' });
  await search.fill('fuel receipt');
  await expect(palette.getByRole('group', { name: 'Files' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.goto('#/files');
  await expect(
    page.getByRole('heading', { name: 'Finding files and papers is off' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Switch on' }).click();

  const list = page.getByRole('list', { name: 'Files' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByRole('listitem').filter({ hasText: 'Fuel receipt.png' })).toContainText(
    /Expense EXP-.* · Fuel for the pickup/,
  );
  await expect(
    list.getByRole('listitem').filter({ hasText: 'Commercial licence.pdf' }),
  ).toContainText('Commercial licence · Made-up Guarding');
  await expect(
    list.getByRole('listitem').filter({ hasText: 'Employment contract.pdf' }),
  ).toContainText('Ahmad Testing · Personnel file');

  // Arabic in any spelling, and numbers without their dashes.
  const find = page.getByRole('textbox', { name: 'Search files' });
  await find.fill('احمد');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Employment contract.pdf');
  await find.fill('cl202677');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Commercial licence.pdf');
  await find.fill('');
  await page.getByLabel('Kept with').selectOption({ label: 'Expenses' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Fuel receipt.png');

  // A file opens in a new tab; what it is kept with opens its page.
  await opensFile(page, () => list.getByRole('button', { name: 'Open Fuel receipt.png' }).click());
  await page.getByLabel('Kept with').selectOption({ label: 'Every file' });
  await list.getByRole('link', { name: 'Commercial licence' }).click();
  await expect(page).toHaveURL(/#\/compliance\/documents\?doc=[0-9a-f-]{36}$/);
  await expect(page.getByRole('dialog', { name: 'Edit document' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Files is in Compliance's sidebar now.
  await nav.getByRole('link', { name: 'Files' }).click();
  await expect(page).toHaveURL(/#\/files$/);
  await expect(nav.getByRole('link', { name: 'Files' })).toHaveAttribute('aria-current', 'page');

  // Search finds files, the register's papers and the papers on employees' records.
  await page.keyboard.press('Control+k');
  await search.fill('commercial licence');
  await expect(
    palette
      .getByRole('group', { name: 'Files' })
      .getByRole('option', { name: /Commercial licence\.pdf/ }),
  ).toBeVisible();
  await expect(
    palette
      .getByRole('group', { name: 'Papers' })
      .getByRole('option', { name: /Commercial licence/ }),
  ).toBeVisible();
  await search.fill('fuel');
  await expect(
    palette.getByRole('group', { name: 'Documents' }).getByRole('option', { name: /Expense EXP-/ }),
  ).toBeVisible();
  await search.fill('fuel receipt');
  await expect(palette.getByRole('option').first()).toContainText('Fuel receipt.png');
  await opensFile(page, () => page.keyboard.press('Enter'));

  // The page fits a phone, in Arabic too.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const language of ['English', 'العربية']) {
    if (language === 'العربية') {
      await page.getByRole('button', { name: 'العربية' }).first().click();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { name: 'الملفات', level: 1 })).toBeVisible();
    }
    await page.goto('#/files');
    const files = page.getByRole('list', { name: language === 'English' ? 'Files' : 'الملفات' });
    await expect(files.getByRole('listitem')).toHaveCount(3);
    const { scroll, inner } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(scroll, language).toBeLessThanOrEqual(inner + 1);
  }
  await expect(
    page
      .getByRole('list', { name: 'الملفات' })
      .getByRole('listitem')
      .filter({ hasText: 'Fuel receipt.png' }),
  ).toContainText('مصروف');
  await page.getByRole('textbox', { name: 'البحث في الملفات' }).fill('أحمد');
  await expect(page.getByRole('list', { name: 'الملفات' })).toContainText('ملف الموظف');
});

test.describe('without a connection', () => {
  test.use({ serviceWorkers: 'allow' });

  test('the Files page works offline', async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.goto('./');
    await expect(page.getByText('Maham One now works offline')).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await createCompany(page, 'Made-up Guarding');
    await addExpenseWithReceipt(page);
    // Switched on in Compliance → Settings.
    await page.goto('#/compliance');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Compliance settings' });
    await settings.getByRole('switch', { name: 'Find files and papers' }).click();
    await settings.getByRole('button', { name: 'Save' }).click();
    await expect(settings).toBeHidden();

    await context.setOffline(true);
    await page.reload();
    await page.goto('#/files');
    const list = page.getByRole('list', { name: 'Files' });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await page.getByRole('textbox', { name: 'Search files' }).fill('fuel');
    await expect(list).toContainText('Fuel receipt.png');
    await opensFile(page, () =>
      list.getByRole('button', { name: 'Open Fuel receipt.png' }).click(),
    );
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Search' });
    await palette.getByRole('combobox', { name: 'Search' }).fill('fuel receipt');
    await expect(palette.getByRole('option').first()).toContainText('Fuel receipt.png');
    await page.keyboard.press('Escape');
    await context.setOffline(false);
  });
});

test('staff see the company’s files but no employee’s', async ({ page }) => {
  test.slow();
  const cloud = new FakeSupabase();
  await cloud.install(page);
  const owner = { email: 'owner@example.com', password: 'safe-password-1', name: 'Test Owner' };
  cloud.addUser(owner.email, owner.password, owner.name);
  cloud.addUser('staff@example.com', 'safe-password-3', 'Test Staff');

  // The owner keeps the company in the cloud, with the finder on, and invites staff.
  await createCompany(page, 'Made-up Sea Co');
  await addExpenseWithReceipt(page);
  await addEmployeeWithContract(page);
  await page.goto('#/files');
  await page.getByRole('button', { name: 'Switch on' }).click();
  await expect(page.getByRole('list', { name: 'Files' }).getByRole('listitem')).toHaveCount(2);
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

  await page.goto(link);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Password', { exact: true }).fill('safe-password-3');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Accept and download' }).click();
  await expect(page.getByRole('button', { name: 'Switch company' })).toContainText(
    'Made-up Sea Co',
    { timeout: 30_000 },
  );

  // The receipt; nothing of the employee's.
  await page.goto('#/files');
  const list = page.getByRole('list', { name: 'Files' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByRole('listitem')).toContainText('Fuel receipt.png');
  await expect(
    page.getByText('Employees’ files and confidential papers aren’t included in what you see.'),
  ).toBeVisible();
  await expect(page.getByText('Employment contract.pdf')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox', { name: 'Search' }).fill('contract');
  await expect(palette.getByText('Employment contract.pdf')).toHaveCount(0);
  await palette.getByRole('combobox', { name: 'Search' }).fill('fuel receipt');
  await expect(palette.getByRole('option').first()).toContainText('Fuel receipt.png');
});
