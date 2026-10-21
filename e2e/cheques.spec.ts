import type { Page } from '@playwright/test';
import { chooseOption, expect, startWithDemoData, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await startWithDemoData(page);
});

/** Creates and sends a fresh invoice to Sadu Interiors; returns its number. */
async function sentInvoice(page: Page, item: string, price: string): Promise<string> {
  await page.goto('#/invoices/new');
  await chooseOption(page, page.getByLabel('Bill to'), {
    placeholder: 'Search clients…',
    query: 'Sadu',
    option: 'Sadu Interiors Co.',
  });
  await page.getByLabel('Item 1 name').fill(item);
  await page.getByLabel('Item 1 quantity').fill('1');
  await page.getByLabel('Item 1 unit price').fill(price);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/invoices\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark as sent' }).click();
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading.locator('..').getByText('Sent', { exact: true })).toBeVisible();
  return (await heading.textContent())!.replace(/^Invoice /, '').trim();
}

/** Records a cheque for the invoice on screen. */
async function payByCheque(page: Page, number: string) {
  await page.getByRole('button', { name: 'Record payment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record payment' });
  await dialog.getByLabel('Method').selectOption('cheque');
  await dialog.getByLabel('Cheque number').fill(number);
  await dialog.getByLabel('Bank', { exact: true }).selectOption('NBOK');
  await expect(dialog.getByLabel('Drawer', { exact: true })).toHaveValue('Sadu Interiors Co.');
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  await expect(dialog).toBeHidden();
}

test('post-dated cheques are tracked until they clear or come back', async ({ page }) => {
  // A cheque that clears.
  const first = await sentInvoice(page, 'Showroom lighting – ceiling spots', '250');
  await payByCheque(page, '000123');
  const status = page.getByRole('heading', { level: 1 }).locator('..');
  await expect(status.getByText('Paid', { exact: true })).toBeVisible();

  await page.goto('#/cheques');
  await expect(page.getByRole('heading', { name: 'Cheques' })).toBeVisible();
  const row = page.getByRole('row', { name: /000123/ });
  await expect(row).toContainText('In hand');
  await expect(row).toContainText('National Bank of Kuwait');
  await expect(row).toContainText('Sadu Interiors Co.');
  await expect(row).toContainText('Today');

  await row.getByRole('button', { name: 'Actions for cheque 000123' }).click();
  await page.getByRole('menuitem', { name: 'Mark cleared' }).click();
  const clear = page.getByRole('dialog', { name: 'Mark cheque cleared' });
  await clear.getByRole('button', { name: 'Mark cleared' }).click();
  await expect(clear).toBeHidden();
  // Cleared cheques leave the open list.
  await expect(page.getByRole('row', { name: /000123/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'All' }).click();
  await expect(page.getByRole('row', { name: /000123/ })).toContainText('Cleared');

  // A cheque that comes back unpaid opens the invoice again.
  const second = await sentInvoice(page, 'Extra socket outlets', '80');
  await payByCheque(page, '000124');
  await expect(status.getByText('Paid', { exact: true })).toBeVisible();

  await page.goto('#/cheques');
  const returned = page.getByRole('row', { name: /000124/ });
  await returned.getByRole('button', { name: 'Actions for cheque 000124' }).click();
  await page.getByRole('menuitem', { name: 'Mark returned' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark cheque returned' });
  await expect(dialog.getByLabel('Reason')).toHaveValue('Insufficient funds');
  await dialog.getByRole('button', { name: 'Mark returned' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('tab', { name: 'Returned' }).click();
  await expect(page.getByRole('row', { name: /000124/ })).toContainText('Returned');
  await expect(page.getByRole('row', { name: /000124/ })).toContainText('Insufficient funds');

  await page.goto('#/invoices');
  await page.getByLabel('Search invoices').fill(second);
  await page.getByRole('link', { name: second }).click();
  await expect(status.getByText('Sent', { exact: true })).toBeVisible();
  await expect(page.getByText('Returned', { exact: true })).toBeVisible();

  // The first invoice stays paid, and the books still balance.
  await page.goto('#/invoices');
  await page.getByLabel('Search invoices').fill(first);
  await page.getByRole('link', { name: first }).click();
  await expect(status.getByText('Paid', { exact: true })).toBeVisible();
  await page.goto('#/reports/balance-sheet');
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
});

test('the receipt voucher prints in English and Arabic', async ({ page }) => {
  await sentInvoice(page, 'Site visit and survey', '40');
  await payByCheque(page, '000200');
  await page.goto('#/payments');
  await page.getByLabel('Search payments').fill('000200');
  await page
    .getByRole('row', { name: /000200/ })
    .getByRole('link')
    .first()
    .click();
  await expect(page).toHaveURL(/#\/payments\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Print voucher' }).click();
  await expect(page.getByText('Receipt voucher', { exact: true })).toBeVisible();
  await expect(page.getByText('سند قبض')).toBeVisible();
  await expect(page.getByText('000200')).toBeVisible();
  await expect(page.getByText(/dinars/i).first()).toBeVisible();
});

test('a returned cheque is replaced by a new post-dated one', async ({ page }) => {
  await page.goto('#/cheques');
  await expect(page.getByRole('row', { name: /004425/ })).toContainText('In hand');
  await page.getByRole('tab', { name: 'Returned' }).click();
  const returned = page.getByRole('row', { name: /004417/ });
  await expect(returned).toContainText('Returned');
  await expect(returned).toContainText('Al Naseem Real Estate Co. K.S.C.C.');
});

test('a cheque issued prints onto its Burgan Bank leaf, once', async ({ page }) => {
  // Printing a page opens the browser's print dialog: here it only says it printed.
  await page.evaluate(() => {
    window.print = () => void window.dispatchEvent(new Event('afterprint'));
  });

  // Off until the owner turns it on.
  await page.goto('#/settings/payments');
  await page.getByRole('switch', { name: 'Print cheques issued' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  await page.goto('#/payments-made/new?method=cheque');
  await chooseOption(page, page.getByLabel('Vendor', { exact: true }), {
    placeholder: 'Search vendors…',
    query: 'Sharq',
    option: 'Sharq Computer Systems Co.',
  });
  await page.getByLabel('Amount paid').fill('1250.75');
  await page.getByLabel('Cheque number').fill('100045');
  await page.getByLabel('Bank', { exact: true }).selectOption('BRGN');
  await expect(page.getByLabel('Pay to')).toHaveValue('Sharq Computer Systems Co.');
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page).toHaveURL(/#\/payments-made\/[0-9a-f-]{36}$/);

  await page.getByRole('link', { name: 'Print cheque' }).click();
  await expect(page.getByRole('heading', { name: 'Print cheque 100045' })).toBeVisible();
  await expect(page.getByText(/not been checked against a real leaf/)).toBeVisible();
  const leaf = page.getByRole('region', { name: 'Cheque 100045' });
  await expect(leaf.locator('[data-field="payee"]')).toHaveText('Sharq Computer Systems Co.');
  await expect(leaf.locator('[data-field="figures"]')).toHaveText('**1,250.750**');
  const words = await leaf.locator('[data-field^="words"]').allTextContents();
  expect(words.filter(Boolean).join(' ')).toBe(
    'فقط ألف ومائتان وخمسون دينارًا كويتيًا وسبعمائة وخمسون فلسًا لا غير',
  );
  await expect(leaf.locator('[data-field="date"]')).toHaveText(/^\d{8}$/);
  await page.getByLabel('Cross the cheque: A/C payee only').check();
  await expect(leaf.getByText('A/C Payee Only', { exact: true })).toBeVisible();

  // The first leaf jams: it is recorded as spoiled and the cheque moves on.
  await page.getByRole('button', { name: 'Print cheque', exact: true }).click();
  const asked = page.getByRole('dialog', { name: 'Did the cheque print correctly?' });
  await asked.getByRole('button', { name: 'No, the leaf is spoiled' }).click();
  const spoiled = page.getByRole('dialog', { name: 'Spoiled leaf' });
  await expect(spoiled.getByLabel('Number of the next leaf')).toHaveValue('100046');
  await spoiled.getByLabel('Reason').fill('Paper jam');
  await spoiled.getByRole('button', { name: 'Record the spoiled leaf' }).click();
  await expect(spoiled).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Print cheque 100046' })).toBeVisible();

  // Printed with the browser's own Print command: asked about all the same.
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await asked.getByRole('button', { name: 'Yes, record the print' }).click();
  await expect(page).toHaveURL(/#\/payments-made\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Printed on')).toBeVisible();
  await expect(page.getByText(/A\/C payee only/)).toBeVisible();
  await expect(page.getByText('Spoiled leaves')).toBeVisible();
  await expect(page.getByText('100045', { exact: true })).toBeVisible();

  // A second print needs the printed leaf spoiled first.
  await page.getByRole('link', { name: 'Print cheque' }).click();
  await expect(page.getByText(/Printed on .* on leaf 100046\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print cheque', exact: true })).toBeDisabled();
  // Nor does the browser's Print command put it on a leaf.
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('region', { name: 'Cheque 100046' })).toBeHidden();
  await expect(page.getByText('This cheque can’t be printed now.', { exact: false })).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await expect(page.getByRole('region', { name: 'Cheque 100046' })).toBeVisible();

  // The register says so, and has the layouts.
  await page.goto('#/cheques?tab=issued');
  await expect(page.getByRole('row', { name: /100046/ })).toContainText('Printed');
  await page.getByRole('link', { name: 'Cheque layouts' }).click();
  await expect(page.getByRole('heading', { name: 'Cheque layouts' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Preview' })).toBeVisible();
  await page.getByLabel('Amount in figures: from the left (mm)').fill('137');
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByText('Cheque layout saved')).toBeVisible();
  await expect(page.getByText('This company’s layout prints cheques on this bank.')).toBeVisible();
});

test('arrows on the print pages point the way they go in Arabic', async ({ page }) => {
  await page.goto('#/cheques');
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  /** Whether an arrow icon shows mirrored: by the page's RTL rule, by a rotation, or both (which undo each other). */
  const mirrored = (icon: ReturnType<Page['locator']>) =>
    icon.evaluate((svg) => {
      const style = getComputedStyle(svg);
      const flipped = style.transform !== 'none' && new DOMMatrix(style.transform).a < 0;
      const turned = style.rotate === '180deg';
      return flipped !== turned;
    });

  await page.goto('#/cheques/test-print?bank=BRGN');
  // The leaf doesn't turn round in Arabic: the button that moves the print left points left.
  const nudges = page.locator('[dir="ltr"]').filter({ has: page.locator('.lucide-arrow-up') });
  await expect(nudges.locator('.lucide-arrow-left')).toBeVisible();
  expect(await mirrored(nudges.locator('.lucide-arrow-left'))).toBe(false);
  expect(await mirrored(nudges.locator('.lucide-arrow-right'))).toBe(false);
  // Back links point back, to the right, like every other one in Arabic.
  const back = page.getByRole('link', { name: 'نماذج الشيكات' }).locator('.lucide-arrow-left');
  expect(await mirrored(back)).toBe(true);

  await page.goto('#/products/labels');
  const labelsBack = page
    .getByRole('link', { name: 'المنتجات والخدمات' })
    .locator('.lucide-arrow-left');
  await expect(labelsBack).toBeVisible();
  expect(await mirrored(labelsBack)).toBe(true);
});
