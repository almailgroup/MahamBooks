import { createCompany, expect, test } from './fixtures';
import { buildWorkbook } from '../src/test/workbook';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('a stock item is bought on a bill, sold on an invoice and costed', async ({ page }) => {
  await createCompany(page, 'Gulf Paper Trading');

  // A stock item, sold by the box.
  await page.goto('#/products');
  await page.getByRole('button', { name: 'New item' }).first().click();
  const item = page.getByRole('dialog', { name: 'New item' });
  await item.getByRole('radio', { name: /^Stock item/ }).click();
  await item.getByLabel('Name', { exact: true }).fill('Printer paper A4');
  await item.getByLabel('Selling price').fill('2.500');
  await item.getByLabel('Cost price').fill('1.250');
  await item.getByLabel(/^Unit/).fill('box');
  await item.getByLabel(/^Reorder level/).fill('8');
  await item.getByRole('button', { name: 'Save' }).click();
  await expect(item).toBeHidden();
  await expect(page.getByRole('row', { name: /Printer paper A4/ })).toContainText('Stock item');

  // A bill for 10 boxes at KD 1.250.
  await page.goto('#/bills/new');
  await page.getByLabel('Vendor', { exact: true }).click();
  await page.getByPlaceholder('Search vendors…').fill('Shuwaikh Paper Co');
  await page.getByRole('button', { name: 'New vendor “Shuwaikh Paper Co”' }).click();
  const vendor = page.getByRole('dialog', { name: 'New vendor' });
  await vendor.getByRole('button', { name: 'Save vendor' }).click();
  await expect(vendor).toBeHidden();
  await page.getByLabel('Line 1 description').fill('Printer');
  await page.getByRole('button', { name: /Printer paper A4/ }).click();
  await expect(page.getByLabel('Line 1 rate')).toHaveValue('1.25');
  await page.getByLabel('Line 1 quantity').fill('10');
  await expect(page.getByLabel('Line 1 amount')).toHaveText('KD 12.500');
  await expect(page.getByRole('button', { name: 'Line 1 category' })).toContainText('Inventory');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page).toHaveURL(/#\/bills\/[0-9a-f-]{36}$/);

  // An invoice for 3 boxes; the line shows what is in stock.
  await page.goto('#/invoices/new');
  await page.getByLabel('Bill to').click();
  await page.getByPlaceholder('Search clients…').fill('Al Noor Stationery');
  await page.getByRole('button', { name: 'New client “Al Noor Stationery”' }).click();
  const client = page.getByRole('dialog', { name: 'New client' });
  await client.getByRole('button', { name: 'Save client' }).click();
  await expect(client).toBeHidden();
  await page.getByLabel('Item 1 name').fill('Printer');
  await page.getByRole('button', { name: /Printer paper A4/ }).click();
  await expect(page.getByText('10 box in stock')).toBeVisible();
  await page.getByLabel('Item 1 quantity').fill('12');
  await expect(page.getByText('Only 10 box in stock')).toBeVisible();
  await page.getByLabel('Item 1 quantity').fill('3');
  await expect(page.getByLabel('Item 1 amount')).toHaveText('KD 7.500');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/invoices\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark as sent' }).click();
  await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible();

  // 7 boxes are left, worth 7 × 1.250; that is below the reorder level of 8.
  await page.goto('#/inventory');
  const row = page.getByRole('row', { name: /Printer paper A4/ });
  await expect(row).toContainText('7 box');
  await expect(row).toContainText('KD 8.750');
  await expect(row).toContainText('Low stock');

  // The general ledger has the cost of sales of the invoice: 3 × 1.250.
  await page.goto('#/reports/general-ledger');
  await expect(
    page.getByRole('row', { name: /Cost of sales INV-\d{4}-0001 3\.750/ }).first(),
  ).toBeVisible();
  await page.goto('#/reports/stock-valuation');
  await expect(page.getByText('Agrees with the books')).toBeVisible();
  await page.goto('#/reports/balance-sheet');
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();

  // One damaged box is written off.
  await page.goto('#/inventory/adjustments/new');
  await page.getByRole('button', { name: 'Item 1', exact: true }).click();
  await page.getByPlaceholder('Search items…').fill('Printer');
  await page.getByRole('option', { name: /Printer paper A4/ }).click();
  await page.getByLabel('Item 1 quantity').fill('-1');
  await expect(page.getByLabel('Item 1 new quantity')).toHaveValue('6');
  await page.getByRole('button', { name: 'Post adjustment' }).click();
  await expect(page).toHaveURL(/#\/inventory\/entries\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Inventory adjustments against inventory: KD 1.250')).toBeVisible();
  await page.goto('#/inventory');
  await expect(page.getByRole('row', { name: /Printer paper A4/ })).toContainText('6 box');
});

test('stock items come in from an Excel file with their opening stock', async ({ page }) => {
  await createCompany(page, 'Shuwaikh Stationers');

  // Products links to the import, which opens on products.
  await page.goto('#/products');
  await page.getByRole('link', { name: 'Import from a spreadsheet' }).click();
  await expect(page.getByRole('radio', { name: /Products and services/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // A made-up stock list: two stock items in the main store and a service.
  await page.locator('input[type=file]').setInputFiles({
    name: 'stock.xlsx',
    mimeType: XLSX,
    buffer: Buffer.from(
      buildWorkbook([
        ['Item name', 'SKU', 'Item type', 'Unit', 'Selling price', 'Cost price', 'Quantity'],
        ['Printer paper A4', 'PAP-A4', 'Stock item', 'box', 2.5, 1.25, 40],
        ['Blue pens', 'PEN-B', 'مخزون', 'pcs', 0.25, 0.1, 200],
        ['Delivery', 'DLV', 'Service', 'trip', 3, null, null],
      ]),
    ),
  });
  await expect(page.getByText('3 items ready')).toBeVisible();
  await expect(page.getByLabel('Stock as at')).toBeVisible();
  await expect(page.getByLabel('Warehouse', { exact: true })).toHaveValue(/main-store/);
  await expect(page.getByText('2 items · 1 warehouse')).toBeVisible();
  await expect(page.getByText('40 in Main store')).toBeVisible();

  // Nothing posts until the person confirms.
  await page.getByRole('button', { name: 'Import 3 items' }).click();
  const confirm = page.getByRole('dialog', { name: 'Post the stock in this file?' });
  await expect(confirm).toContainText(
    'Opening stock worth KD 70.000 goes to opening balance equity, dated',
  );
  await confirm.getByRole('button', { name: 'Import and post stock' }).click();
  await expect(page.getByText('3 items imported').first()).toBeVisible();
  await expect(page.getByText('Stock entries OPN-0001')).toBeVisible();

  // The opening stock entry, booked against opening balance equity.
  await page.getByRole('link', { name: 'View the stock entries' }).click();
  await page.getByRole('link', { name: 'OPN-0001' }).click();
  await expect(page.getByText('Inventory against opening balance equity: KD 70.000')).toBeVisible();
  await page.goto('#/inventory');
  const paper = page.getByRole('row', { name: /Printer paper A4/ });
  await expect(paper).toContainText('40 box');
  await expect(paper).toContainText('KD 50.000');
  await page.goto('#/reports/stock-valuation');
  await expect(page.getByText('Agrees with the books')).toBeVisible();

  // A count sheet filled in on Excel.
  await page.goto('#/inventory/count');
  await page.getByLabel('Import counts').setInputFiles({
    name: 'count.xlsx',
    mimeType: XLSX,
    buffer: Buffer.from(
      buildWorkbook([
        ['SKU', 'Item', 'Unit', 'On record', 'Counted'],
        ['PAP-A4', 'Printer paper A4', 'box', 40, 38],
      ]),
    ),
  });
  await expect(page.getByText('1 count read from the file')).toBeVisible();
  await expect(page.getByLabel('Counted quantity of Printer paper A4')).toHaveValue('38');
});
