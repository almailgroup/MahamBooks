import { chooseOption, expect, test } from './fixtures';
import type { Page } from '@playwright/test';

/** yyyy-MM-dd `days` from today (the browser runs in UTC, see playwright.config.ts). */
const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function createKuwaitCompany(page: Page) {
  await page.goto('./');
  await page.getByLabel('Company name').fill('Almail Trading');
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test('a residency expiring in 20 days is renewed from Compliance with its fee', async ({
  page,
}) => {
  await createKuwaitCompany(page);

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
  await page.getByRole('link', { name: 'Compliance' }).click();
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
  await page.getByRole('link', { name: 'Documents' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Residency' });
  await expect(row).toContainText('Ravi Kumar');
  await expect(row).toContainText('Valid');

  // The fee is an expense in government fees, and the books balance.
  await page.goto('#/expenses');
  await expect(
    page.getByRole('row', { name: /Residency renewal – Ravi Kumar.*KD 10\.000/ }),
  ).toBeVisible();
  await page.goto('#/reports/balance-sheet');
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
});

test('the employee and compliance pages read right to left in Arabic', async ({ page }) => {
  await createKuwaitCompany(page);
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
