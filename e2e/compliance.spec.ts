import type { Page } from '@playwright/test';
import { chooseOption, createCompany, expect, test } from './fixtures';

/** yyyy-MM-dd `days` from today (the browser runs in UTC, see playwright.config.ts). */
const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const PDF = {
  name: 'Guarding contract.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n'),
};

/** Compliance → Settings: contracts, customers and vehicles on. */
async function switchExtrasOn(page: Page) {
  const settings = page.getByRole('dialog', { name: 'Compliance settings' });
  await settings.getByRole('switch', { name: 'Contracts, customers and vehicles' }).click();
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toBeHidden();
}

test('a customer’s contract with its purpose, expiry and PDF, in the register and on the customer’s page', async ({
  page,
}) => {
  await createCompany(page, 'Made-up Guarding');

  // Until the owner switches them on, the register is as it was.
  await page.goto('#/compliance/documents');
  await page.getByRole('button', { name: 'Add document' }).first().click();
  let dialog = page.getByRole('dialog', { name: 'Add document' });
  await expect(dialog.getByLabel('Purpose')).toHaveCount(0);
  await expect(dialog.locator('option', { hasText: 'Company contract' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('link', { name: 'Vehicles' })).toHaveCount(0);

  await page.goto('#/clients/new');
  await page.getByLabel('Client name').fill('Made-up Towers Co.');
  await page.getByRole('button', { name: 'Save client' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Made-up Towers Co.');
  await expect(page.getByText('Contracts and papers')).toHaveCount(0);

  await page.goto('#/compliance');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await switchExtrasOn(page);

  // The customer's contract, for a purpose added on the way, with its PDF.
  await page.goto('#/compliance/documents');
  await page.getByRole('button', { name: 'Add document' }).first().click();
  dialog = page.getByRole('dialog', { name: 'Add document' });
  await dialog
    .getByRole('group', { name: 'Belongs to' })
    .getByRole('tab', { name: 'Other' })
    .click();
  await chooseOption(page, dialog.getByLabel('Customer'), {
    placeholder: 'Search customers…',
    query: 'Made-up Towers',
    option: 'Made-up Towers Co.',
  });
  await dialog.getByLabel('Document type').selectOption({ label: 'Customer contract' });
  await dialog.getByRole('button', { name: 'Add document' }).click();
  await expect(page.getByText('Enter the document’s title.')).toBeVisible();
  await dialog.getByLabel('Title', { exact: true }).fill('Guarding contract, Tower A');
  await dialog.getByLabel('Purpose').click();
  await page.getByPlaceholder('Search purposes…').fill('Site guarding');
  await page.getByRole('button', { name: 'Add purpose “Site guarding”' }).click();
  const purpose = page.getByRole('dialog', { name: 'Add purpose' });
  await expect(purpose.getByLabel('Name (English)')).toHaveValue('Site guarding');
  await purpose.getByLabel('Name (Arabic)').fill('حراسة المواقع');
  await purpose.getByRole('button', { name: 'Add purpose' }).click();
  await expect(purpose).toBeHidden();
  await expect(dialog.getByLabel('Purpose')).toContainText('Site guarding');
  await dialog.getByLabel('Expiry date').fill(inDays(45));
  await dialog.locator('input[type=file]').setInputFiles(PDF);
  await expect(dialog.getByText('Guarding contract.pdf')).toBeVisible();
  // Not a cost sheet: it isn't confidential unless ticked.
  await expect(dialog.getByLabel('Confidential')).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Add document' }).click();
  await expect(dialog).toBeHidden();

  const row = page.getByRole('row').filter({ hasText: 'Guarding contract, Tower A' });
  await expect(row).toContainText('Customer contract');
  await expect(row).toContainText('Made-up Towers Co.');
  await expect(row).toContainText('Site guarding');
  await expect(row).toContainText('1 file');
  await expect(row).toContainText('Expires in 45 days');
  await page.getByRole('tab', { name: /^No file/ }).click();
  await expect(page.getByText('No documents match.')).toBeVisible();
  await page.getByRole('tab', { name: /^All/ }).click();

  // A cost sheet for the same customer starts confidential.
  await page.getByRole('button', { name: 'Add document' }).first().click();
  dialog = page.getByRole('dialog', { name: 'Add document' });
  await dialog
    .getByRole('group', { name: 'Belongs to' })
    .getByRole('tab', { name: 'Other' })
    .click();
  await chooseOption(page, dialog.getByLabel('Customer'), {
    placeholder: 'Search customers…',
    query: 'Made-up Towers',
    option: 'Made-up Towers Co.',
  });
  await dialog.getByLabel('Document type').selectOption({ label: 'Customer cost sheet' });
  await expect(dialog.getByLabel('Confidential')).toBeChecked();
  await dialog.getByLabel('Title', { exact: true }).fill('Guards cost sheet, Tower A');
  await dialog.getByRole('button', { name: 'Add document' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('row').filter({ hasText: 'Guards cost sheet, Tower A' }),
  ).toContainText('Confidential');

  // The customer's page lists both, and adds a contract for them.
  await page.goto('#/clients');
  await page.getByRole('link', { name: 'Made-up Towers Co.' }).first().click();
  const card = page.getByRole('region', { name: 'Contracts and papers' });
  await expect(card).toContainText('Guarding contract, Tower A');
  await expect(card).toContainText('Guards cost sheet, Tower A');
  await card.getByRole('button', { name: 'Add document' }).click();
  dialog = page.getByRole('dialog', { name: 'Add document' });
  await expect(dialog.getByLabel('Customer')).toContainText('Made-up Towers Co.');
  await expect(dialog.getByLabel('Document type')).toHaveValue('client_contract');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // In Arabic.
  await page.goto('#/compliance/documents');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(
    page.getByRole('row').filter({ hasText: 'Guarding contract, Tower A' }),
  ).toContainText('عقد العميل');
  await expect(
    page.getByRole('row').filter({ hasText: 'Guarding contract, Tower A' }),
  ).toContainText('حراسة المواقع');
  await expect(page.getByRole('tab', { name: /^بلا ملف/ })).toBeVisible();
});

test('vehicles keep their papers, and papers typed with a plate are linked to theirs', async ({
  page,
}) => {
  await createCompany(page, 'Made-up Transport');
  await page.goto('#/compliance/vehicles');
  await expect(page.getByText('Vehicles are switched off')).toBeVisible();
  await page.getByRole('button', { name: 'Compliance settings' }).click();
  await switchExtrasOn(page);
  await expect(page.getByText('No vehicles yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Vehicles' }).first()).toBeVisible();

  // A paper with the plate typed, as before vehicles were kept.
  await page.goto('#/compliance/documents');
  await page.getByRole('button', { name: 'Add document' }).first().click();
  let dialog = page.getByRole('dialog', { name: 'Add document' });
  await dialog
    .getByRole('group', { name: 'Belongs to' })
    .getByRole('tab', { name: 'Vehicle' })
    .click();
  await expect(dialog.getByLabel('Vehicle', { exact: true })).toContainText('Not in the list');
  await dialog.getByLabel('Plate number or model').fill('55/12345');
  await dialog.getByLabel('Expiry date').fill(inDays(20));
  await dialog.getByRole('button', { name: 'Add document' }).click();
  await expect(dialog).toBeHidden();

  // Linked to a vehicle of that plate, added on the way.
  await page.goto('#/compliance/vehicles');
  await page.getByRole('button', { name: 'Link vehicles' }).click();
  const confirm = page.getByRole('dialog', { name: 'Link the papers of 1 vehicle?' });
  await expect(confirm).toContainText('55/12345');
  await expect(confirm).toContainText('1 paper');
  await confirm.getByRole('button', { name: 'Link vehicles' }).click();
  await expect(page.getByText('1 paper linked')).toBeVisible();
  const linked = page.getByRole('listitem').filter({ hasText: '55/12345' }).first();
  await expect(linked).toContainText('Vehicle registration');
  await expect(linked).toContainText('Expires in 20 days');
  await expect(page.getByRole('button', { name: 'Link vehicles' })).toHaveCount(0);

  // What it is.
  await page.getByRole('button', { name: 'Edit 55/12345' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit vehicle' });
  await edit.getByLabel('Make').fill('Toyota');
  await edit.getByLabel('Model').fill('Hiace');
  await edit.getByLabel('Year made').fill('2021');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await expect(linked).toContainText('Toyota Hiace 2021');

  // A second vehicle, with its insurance added from its row.
  await page.getByRole('button', { name: 'Add vehicle' }).first().click();
  const add = page.getByRole('dialog', { name: 'Add vehicle' });
  await add.getByLabel('Plate number').fill('TEST 1');
  await add.getByRole('button', { name: 'Add vehicle' }).click();
  await expect(add).toBeHidden();
  await page.getByRole('button', { name: 'Add a paper for TEST 1' }).click();
  dialog = page.getByRole('dialog', { name: 'Add document' });
  await expect(dialog.getByLabel('Vehicle', { exact: true })).toContainText('TEST 1');
  await dialog.getByLabel('Document type').selectOption({ label: 'Vehicle insurance' });
  await dialog.getByLabel('Expiry date').fill(inDays(200));
  await dialog.getByRole('button', { name: 'Add document' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: 'TEST 1' }).first()).toContainText(
    'Vehicle insurance',
  );
  // The register names each paper's vehicle.
  await page.goto('#/compliance/documents');
  await expect(page.getByRole('row').filter({ hasText: 'Vehicle insurance' })).toContainText(
    'TEST 1',
  );

  // In Arabic, right to left.
  await page.goto('#/compliance/vehicles');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('link', { name: 'المركبات' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'إضافة مركبة' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'TEST 1' }).first()).toContainText(
    'تأمين المركبة',
  );
});
