import { createCompany, expect, test } from './fixtures';

test('items get codes, units from a list, a QR code and labels', async ({ page }) => {
  await createCompany(page, 'Sample Stationers');

  // An item saved the way it always was: unit typed, no code.
  await page.goto('#/products');
  await page.getByRole('button', { name: 'New item' }).first().click();
  let item = page.getByRole('dialog', { name: 'New item' });
  await item.getByLabel('Name', { exact: true }).fill('Envelopes C5');
  await item.getByLabel(/^Unit/).fill('Pcs');
  await item.getByRole('button', { name: 'Save' }).click();
  await expect(item).toBeHidden();

  // The owner turns on units from the list and item codes, with a unit of their own.
  await page.goto('#/settings/items');
  await page.getByRole('switch', { name: /Units from a list/ }).click();
  await page.getByRole('button', { name: 'Add unit' }).click();
  await page.getByLabel('Unit 1', { exact: true }).fill('roll');
  await page.getByLabel('Arabic name').fill('لفة');
  await page.getByRole('switch', { name: /Give new items a code/ }).click();
  await expect(page.getByText(/such as SKU-00001/)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // The older item gets a code in one go.
  await expect(page.getByText('1 item has no code yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Give codes to items without one' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Give codes' }).click();
  await expect(page.getByText('1 item has a code now')).toBeVisible();
  await page.goto('#/settings/numbering');
  await expect(page.getByText('Item codes (SKU)')).toBeVisible();

  // A new item: the next code, a unit picked from the list.
  await page.goto('#/products');
  await expect(page.getByRole('row', { name: /Envelopes C5/ })).toContainText('SKU-00001');
  await page.getByRole('button', { name: 'New item' }).first().click();
  item = page.getByRole('dialog', { name: 'New item' });
  await item.getByRole('radio', { name: /^Stock item/ }).click();
  await item.getByLabel('Name', { exact: true }).fill('Printer paper A4');
  await expect(item.getByLabel('SKU / code')).toHaveAttribute('placeholder', 'SKU-00002');
  await item.getByLabel('Selling price').fill('2.500');
  await item.getByLabel(/^Unit/).click();
  await page.getByPlaceholder('Search units…').fill('box');
  await page.getByRole('option', { name: /^box/ }).click();
  await expect(item.getByLabel(/^Unit/)).toHaveText('box');
  await item.getByRole('button', { name: 'Save' }).click();
  await expect(item).toBeHidden();
  const paper = page.getByRole('row', { name: /Printer paper A4/ });
  await expect(paper).toContainText('SKU-00002');
  await expect(paper).toContainText('/ box');

  // The older item's typed unit is the list's.
  await page.getByRole('button', { name: /^Envelopes C5/ }).click();
  item = page.getByRole('dialog', { name: 'Edit Envelopes C5' });
  await expect(item.getByLabel(/^Unit/)).toHaveText('pcs');
  // A code taken by another item is refused.
  await item.getByLabel('SKU / code').fill('sku-00002');
  await expect(item.getByText(/Labels printed with SKU-00001/)).toBeVisible();
  await item.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Another item already has the SKU sku-00002.')).toBeVisible();
  await item.getByRole('button', { name: 'Cancel' }).click();

  // Its QR code, and its label.
  await paper.getByRole('button', { name: /^Printer paper A4/ }).click();
  item = page.getByRole('dialog', { name: 'Edit Printer paper A4' });
  await expect(item.getByRole('img', { name: 'QR code of SKU-00002' })).toBeVisible();
  await item.getByRole('link', { name: 'Print label' }).click();
  await expect(page).toHaveURL(/#\/products\/labels\?ids=[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Print labels' })).toBeVisible();
  const label = page.locator('[data-sku="SKU-00002"]');
  await expect(label).toHaveCount(1);
  await expect(label.getByRole('img', { name: 'QR code of SKU-00002' })).toBeVisible();
  await expect(label).toContainText('/ box');
  await page.getByLabel('Copies of each').fill('3');
  await expect(label).toHaveCount(3);
  await page.getByRole('tab', { name: 'Thermal label, 50 × 25 mm' }).click();
  await expect(page.getByRole('region', { name: /^Sheet / })).toHaveCount(3);
  await page.getByRole('button', { name: 'Test page' }).click();
  await expect(label).toHaveCount(0);

  // Labels for the items picked in the list.
  await page.goto('#/products');
  await page.getByRole('checkbox', { name: 'Select all' }).check();
  await page
    .getByRole('region', { name: 'Selected items' })
    .getByRole('button', { name: 'Print labels' })
    .click();
  await expect(page.locator('[data-sku]')).toHaveCount(2);

  // In Arabic, the unit picked from the list is the Arabic one.
  await page.goto('#/products');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.getByRole('row', { name: /Printer paper A4/ })).toContainText('علبة');
});
