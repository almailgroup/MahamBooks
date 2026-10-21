import { createCompany, downloadFrom, expect, test } from './fixtures';

// A picture of one pixel, sent twice as two files.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const picture = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });

/** Pictures drawn in a PDF. */
const imagesIn = (pdf: Buffer) => pdf.toString('latin1').split('/Subtype /Image').length - 1;

test('items get pictures, shown in lists and printed on quotes that show them', async ({
  page,
}) => {
  test.slow();
  await createCompany(page, 'Sample Lighting');

  // Off until the owner turns item pictures on.
  await page.goto('#/products');
  await page.getByRole('button', { name: 'New item' }).first().click();
  let item = page.getByRole('dialog', { name: 'New item' });
  await expect(item.getByRole('button', { name: 'Add picture' })).toHaveCount(0);
  await item.getByRole('button', { name: 'Cancel' }).click();
  await page.goto('#/settings/items');
  await page.getByRole('switch', { name: /Give items pictures/ }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // A new item with two pictures, picked before it is saved.
  await page.goto('#/products');
  await page.getByRole('button', { name: 'New item' }).first().click();
  item = page.getByRole('dialog', { name: 'New item' });
  await item.getByLabel('Name', { exact: true }).fill('Desk lamp');
  await item.getByLabel('Selling price').fill('12.500');
  await item
    .getByLabel('Choose pictures')
    .setInputFiles([picture('front.png'), picture('side.png')]);
  await expect(item.getByRole('button', { name: 'Main picture' })).toBeVisible();
  await expect(item.getByRole('button', { name: 'Picture 2' })).toBeVisible();
  await item.getByRole('button', { name: 'Save' }).click();
  await expect(item).toBeHidden();

  // Its picture in the list, still there after a reload.
  const row = page.getByRole('row', { name: /Desk lamp/ });
  await expect(row.locator('img')).toBeVisible();
  await page.reload();
  await expect(row.locator('img')).toBeVisible();

  // The second picture becomes the main one, the other is removed, and
  // saving the form afterwards keeps the picture.
  await row.getByRole('button', { name: /^Desk lamp/ }).click();
  item = page.getByRole('dialog', { name: 'Edit Desk lamp' });
  await item.getByRole('button', { name: 'Picture 2' }).click();
  await page.getByRole('menuitem', { name: 'Make main picture' }).click();
  await expect(page.getByText('Main picture changed')).toBeVisible();
  await item.getByRole('button', { name: 'Picture 2' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await page
    .getByRole('dialog', { name: 'Remove this picture?' })
    .getByRole('button', {
      name: 'Remove',
    })
    .click();
  await expect(page.getByText('Picture removed')).toBeVisible();
  await expect(item.getByRole('button', { name: 'Picture 2' })).toHaveCount(0);
  await item.getByRole('button', { name: 'Main picture' }).click();
  await page.getByRole('menuitem', { name: 'Rotate' }).click();
  await item.getByLabel('Selling price').fill('13.000');
  await item.getByRole('button', { name: 'Save' }).click();
  await expect(item).toBeHidden();
  await expect(row.locator('img')).toBeVisible();

  // Picked on a quote, where the suggestion shows it.
  await page.goto('#/quotes/new');
  await page.getByLabel('Prepared for').click();
  await page.getByPlaceholder('Search clients…').fill('Sample Hotel');
  await page.getByRole('button', { name: 'New client “Sample Hotel”' }).click();
  const client = page.getByRole('dialog', { name: 'New client' });
  await client.getByRole('button', { name: 'Save client' }).click();
  await expect(client).toBeHidden();
  await page.getByLabel('Item 1 name').fill('Desk');
  const suggestion = page.getByRole('button', { name: /Desk lamp/ });
  await expect(suggestion.locator('img')).toBeVisible();
  await suggestion.click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/quotes\/[0-9a-f-]{36}$/);
  const quote = page.url();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  const before = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );

  // Printed once the design shows item pictures.
  await page.goto('#/templates');
  const printed = page.getByRole('switch', { name: /Item pictures/ });
  await expect(printed).toBeEnabled();
  await printed.click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await page.goto(quote);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  const after = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  expect(imagesIn(after.content)).toBe(imagesIn(before.content) + 1);
});
