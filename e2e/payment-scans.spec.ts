import type { Page } from '@playwright/test';
import { chooseOption, expect, startWithDemoData, test } from './fixtures';

// A 1×1 PNG, enough to stand in for a photo of a cheque or a transfer receipt.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

test.beforeEach(async ({ page }) => {
  await startWithDemoData(page);
});

/** Names of the files stored on this device. */
async function storedFiles(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AlmailBooks');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<{ name: string }[]>((resolve, reject) => {
      const request = database.transaction('attachments').objectStore('attachments').getAll();
      request.onsuccess = () => resolve(request.result as { name: string }[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return rows.map((r) => r.name);
  });
}

test('a payment keeps a scan of the transfer, which goes when the payment is deleted', async ({
  page,
}) => {
  await page.goto('#/payments/new');
  await chooseOption(page, page.getByLabel('Client', { exact: true }), {
    placeholder: 'Search clients…',
    query: 'Sadu',
    option: 'Sadu Interiors Co.',
  });
  await page.getByLabel('Amount received').fill('45');
  await page.getByLabel('Reference').fill('TRX-55120');
  await expect(page.getByText('A scan of the cheque or the transfer receipt.')).toBeVisible();
  await page
    .getByLabel('Attach a file')
    .setInputFiles({ name: 'transfer-receipt.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(page.getByText('transfer-receipt.png')).toBeVisible();
  await page.getByRole('button', { name: 'Save payment' }).first().click();
  await expect(page).toHaveURL(/#\/payments\/[0-9a-f-]{36}$/);
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText(/^Payment /);
  const number = (await heading.textContent())!.replace(/^Payment /, '').trim();

  // Stored with the payment.
  await page.reload();
  await expect(page.getByText('transfer-receipt.png')).toBeVisible();
  expect(await storedFiles(page)).toContain('transfer-receipt.png');

  await page.goto('#/payments');
  const row = page.getByRole('row', { name: new RegExp(number) });
  await expect(row.getByLabel('Files attached')).toBeVisible();
  await row.getByRole('link', { name: number }).click();

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: `Delete payment ${number}?` });
  await expect(confirm.getByText('Its attached files are deleted with it.')).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Payment deleted')).toBeVisible();
  await expect(page).toHaveURL(/#\/payments$/);
  await expect(page.getByRole('row', { name: new RegExp(number) })).toHaveCount(0);
  expect(await storedFiles(page)).not.toContain('transfer-receipt.png');
});

test('a cheque recorded on an invoice keeps its scan, and the payment page adds more', async ({
  page,
}) => {
  await page.goto('#/invoices/new');
  await chooseOption(page, page.getByLabel('Bill to'), {
    placeholder: 'Search clients…',
    query: 'Sadu',
    option: 'Sadu Interiors Co.',
  });
  await page.getByLabel('Item 1 name').fill('Reception desk lighting');
  await page.getByLabel('Item 1 quantity').fill('1');
  await page.getByLabel('Item 1 unit price').fill('180');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/invoices\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark as sent' }).click();
  const title = page.getByRole('heading', { level: 1 }).locator('..');
  await expect(title.getByText('Sent', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Record payment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record payment' });
  await dialog.getByLabel('Method').selectOption('cheque');
  await dialog.getByLabel('Cheque number').fill('000871');
  await dialog.getByLabel('Bank', { exact: true }).selectOption('NBOK');
  await expect(dialog.getByText('A scan of the cheque or the transfer receipt.')).toBeVisible();
  await dialog
    .getByLabel('Attach a file')
    .setInputFiles({ name: 'cheque-000871.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(dialog.getByText('cheque-000871.png')).toBeVisible();
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  await expect(dialog).toBeHidden();
  await expect(title.getByText('Paid', { exact: true })).toBeVisible();

  await page.goto('#/payments');
  const row = page.getByRole('row', { name: /Cheque 000871/ });
  await expect(row.getByLabel('Files attached')).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/#\/payments\/[0-9a-f-]{36}$/);
  await expect(page.getByText('cheque-000871.png')).toBeVisible();

  // On the payment page, a file is saved as soon as it is attached.
  await page
    .getByLabel('Attach a file')
    .setInputFiles({ name: 'deposit-slip.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByText('deposit-slip.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Remove cheque-000871.png' }).click();
  await expect(page.getByText('cheque-000871.png')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('deposit-slip.pdf')).toBeVisible();
  await expect(page.getByText('cheque-000871.png')).toHaveCount(0);
  const files = await storedFiles(page);
  expect(files).toContain('deposit-slip.pdf');
  expect(files).not.toContain('cheque-000871.png');
});
