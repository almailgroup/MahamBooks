import { createCompany, expect, startWithDemoData, test } from './fixtures';

/** First day of last month, as the date inputs want it (yyyy-MM-dd). */
function startOfLastMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 10);
}

test('an asset is depreciated for a month and the balance sheet follows', async ({ page }) => {
  await createCompany(page, 'Al Mail Contracting');
  await page.goto('#/assets');
  await expect(page.getByRole('heading', { name: 'Fixed assets', exact: true })).toBeVisible();
  await expect(page.getByText('No fixed assets yet')).toBeVisible();

  await page.getByRole('link', { name: 'New asset' }).first().click();
  await expect(page.getByRole('heading', { name: 'New asset' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Laptops');
  const category = page.getByLabel('Asset account', { exact: true });
  const equipment = await category
    .locator('option', { hasText: /equipment/i })
    .first()
    .getAttribute('value');
  await category.selectOption(equipment!);
  // The matching accumulated depreciation account is picked for us.
  await expect(
    page.getByLabel('Accumulated depreciation account').locator('option:checked'),
  ).toHaveText(/depreciation/i);
  await page.getByLabel('Purchase date', { exact: true }).fill(startOfLastMonth());
  await page.getByLabel('Cost', { exact: true }).fill('1200');
  await page.getByLabel('Useful life (months)').fill('12');
  await expect(page.getByText('1 year')).toBeVisible();
  await page.getByRole('button', { name: 'Save asset' }).click();

  await expect(page.getByRole('heading', { name: /Laptops/ })).toBeVisible();
  await expect(page.getByText('No depreciation posted yet')).toBeVisible();

  // Bought from the bank: property and equipment goes up.
  await page.goto('#/reports/balance-sheet');
  await expect(page.getByRole('row', { name: /Property and equipment/ })).toContainText(
    /1,200\.000/,
  );
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();

  // One month of depreciation: 1,200 over 12 months.
  await page.goto('#/assets');
  await page.getByRole('button', { name: 'Run depreciation' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Laptops')).toBeVisible();
  await dialog.getByRole('button', { name: 'Post depreciation' }).click();
  await expect(page.getByText(/^Depreciation for .+ posted$/)).toBeVisible();

  await page.goto('#/journals');
  const journal = page.getByRole('row', { name: /Depreciation for/ });
  await expect(journal).toContainText('100.000');
  await expect(journal.getByText('Depreciation', { exact: true })).toBeVisible();
  // Made by the register, so it can only be changed there.
  await journal.click();
  await expect(page.getByText(/so it can only be changed there/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save and post' })).toHaveCount(0);

  await page.goto('#/reports/balance-sheet');
  await expect(page.getByRole('row', { name: /Property and equipment/ })).toContainText(
    /1,100\.000/,
  );
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();

  // Running the same month again adds nothing.
  await page.goto('#/assets?tab=runs');
  await expect(page.getByRole('row', { name: /100\.000/ })).toHaveCount(1);
});

test('the demo’s assets are on the schedule, reports switch to Arabic and the auditor pack downloads', async ({
  page,
}) => {
  await startWithDemoData(page);
  await page.goto('#/assets');
  await expect(page.getByRole('link', { name: /Toyota Hilux double cab/ }).first()).toBeVisible();
  await page.goto('#/reports/asset-schedule');
  await expect(page.getByText('Toyota Hilux double cab').first()).toBeVisible();

  await page.goto('#/reports/profit-and-loss');
  await expect(page.getByRole('heading', { name: 'Statement of profit or loss' })).toBeVisible();
  await page.getByRole('tab', { name: 'العربية' }).click();
  await expect(page.getByRole('heading', { name: 'بيان الأرباح أو الخسائر' })).toBeVisible();

  await page.goto('#/reports/auditor-pack');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download auditor pack' }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(/^auditor-pack-.+\.zip$/);
});
