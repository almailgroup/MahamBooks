import { expect, test } from './fixtures';

test('a sales order is delivered in part and invoiced, a purchase order becomes a bill', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByLabel('Company name').fill('Al Waha Trading');
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const title = page.locator('h1').locator('..');

  // A sales order with two lines, from the New menu.
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sales order' }).click();
  await expect(page.getByRole('heading', { name: 'New sales order' })).toBeVisible();
  await page.getByLabel('Customer').click();
  await page.getByPlaceholder('Search clients…').fill('Al Rawda Trading');
  await page.getByRole('button', { name: 'New client “Al Rawda Trading”' }).click();
  const clientDialog = page.getByRole('dialog', { name: 'New client' });
  await clientDialog.getByRole('button', { name: 'Save client' }).click();
  await expect(clientDialog).toBeHidden();
  await page.getByLabel('PO / reference').fill('LPO-55120');
  await page.getByLabel('Item 1 name').fill('Thermal label printer');
  await page.getByLabel('Item 1 quantity').fill('5');
  await page.getByLabel('Item 1 unit price').fill('125.250');
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByLabel('Item 2 name').fill('Label rolls');
  await page.getByLabel('Item 2 quantity').fill('40');
  await page.getByLabel('Item 2 unit price').fill('3.125');
  await expect(page.getByLabel('Item 1 amount')).toHaveText('KD 626.250');
  await page.getByRole('button', { name: 'More save options' }).click();
  await page.getByRole('menuitem', { name: 'Save and confirm' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Sales order SO-\d{4}-0001$/);
  await expect(title.getByText('Confirmed', { exact: true })).toBeVisible();
  await expect(title.getByText('Not delivered', { exact: true })).toBeVisible();

  // A delivery note for two of the five printers.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Create delivery note' }).click();
  const partDialog = page.getByRole('dialog', { name: 'Create delivery note' });
  await expect(partDialog.getByLabel('Quantity for line 1')).toHaveValue('5');
  await partDialog.getByLabel('Quantity for line 1').fill('2');
  await partDialog.getByLabel('Quantity for line 2').fill('0');
  await partDialog.getByRole('button', { name: 'Create delivery note' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Delivery note DN-\d{4}-0001$/);
  await expect(page.getByRole('link', { name: /^Created from sales order SO-/ })).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Mark as delivered' }).click();
  const deliverDialog = page.getByRole('dialog', { name: 'Mark as delivered' });
  await deliverDialog.getByLabel('Received by').fill('Ahmad Al-Mutairi');
  await deliverDialog.getByLabel(/Civil ID number/).fill('287010112349');
  await deliverDialog.getByRole('button', { name: 'Mark as delivered' }).click();
  await expect(deliverDialog).toBeHidden();
  await expect(title.getByText('Delivered', { exact: true })).toBeVisible();
  await expect(page.getByText(/delivered and received by Ahmad Al-Mutairi/)).toBeVisible();

  // Back on the order: partly delivered, so invoice it.
  await page.getByRole('link', { name: /^Created from sales order SO-/ }).click();
  await expect(title.getByText('Partially delivered', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create invoice' }).click();
  const invoiceDialog = page.getByRole('dialog', { name: 'Create invoice' });
  await invoiceDialog.getByRole('button', { name: 'Create invoice' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Invoice INV-\d{4}-0001$/);
  await expect(page.getByText('KD 751.250').first()).toBeVisible();
  await page.getByRole('link', { name: /^Created from sales order SO-/ }).click();
  await expect(title.getByText('Invoiced', { exact: true })).toBeVisible();
  await expect(title.getByText('Partially delivered', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^INV-\d{4}-0001$/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^DN-\d{4}-0001$/ })).toBeVisible();
  // What is left to deliver is the next step.
  await expect(page.getByRole('button', { name: 'Create delivery note' })).toBeVisible();

  await page.goto('#/sales-orders');
  await expect(
    page.getByRole('row', { name: /SO-\d{4}-0001.*Al Rawda Trading.*KD 751\.250.*Invoiced/ }),
  ).toBeVisible();

  // A purchase order, issued and turned into a bill.
  await page.goto('#/purchase-orders/new');
  await page.getByLabel('Vendor', { exact: true }).click();
  await page.getByPlaceholder('Search vendors…').fill('Gulf Paper');
  await page.getByRole('button', { name: 'New vendor “Gulf Paper”' }).click();
  const vendorDialog = page.getByRole('dialog', { name: 'New vendor' });
  await vendorDialog.getByRole('button', { name: 'Save vendor' }).click();
  await expect(vendorDialog).toBeHidden();
  await page.getByLabel('Line 1 description').fill('A4 paper');
  await page.getByLabel('Line 1 quantity').fill('100');
  await page.getByLabel('Line 1 rate').fill('1.375');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /^Purchase order PO-\d{4}-0001$/,
  );
  await expect(title.getByText('Issued', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Convert to bill' }).click();
  const billDialog = page.getByRole('dialog', { name: 'Convert to bill' });
  await billDialog.getByRole('button', { name: 'Convert to bill' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Bill BILL-\d{4}-0001$/);
  await expect(page.getByText('KD 137.500').first()).toBeVisible();
  await page.getByRole('link', { name: /^Created from purchase order PO-/ }).click();
  await expect(title.getByText('Billed', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^BILL-\d{4}-0001$/ })).toBeVisible();

  // Each type has its own list.
  await page.goto('#/purchase-orders');
  await expect(
    page.getByRole('row', { name: /PO-\d{4}-0001.*Gulf Paper.*KD 137\.500.*Billed/ }),
  ).toBeVisible();
  await page.goto('#/delivery-notes');
  await expect(
    page.getByRole('row', { name: /DN-\d{4}-0001.*Al Rawda Trading.*Delivered/ }),
  ).toBeVisible();
  await page.goto('#/proformas');
  await expect(page.getByText('No proforma invoices yet')).toBeVisible();
});
