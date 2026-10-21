import type { Page } from '@playwright/test';
import { createCompany, downloadFrom, expect, pdfText, test } from './fixtures';
import { FakeSupabase } from './cloud-fake';

/** The company's branding as saved on this device. */
async function savedBranding(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AlmailBooks');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<{ branding: Record<string, unknown> }[]>((resolve, reject) => {
      const request = database.transaction('companies').objectStore('companies').getAll();
      request.onsuccess = () => resolve(request.result as { branding: Record<string, unknown> }[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return rows[0].branding;
  });
}

/** Fills in a new document for a new client with one line, saves it and returns its PDF text. */
async function savedPdf(page: Page, clientField: string, client: string): Promise<string> {
  await page.getByLabel(clientField).click();
  await page.getByPlaceholder('Search clients…').fill(client);
  const existing = page.getByRole('option', { name: client });
  if (await existing.count()) await existing.first().click();
  else {
    await page.getByRole('button', { name: `New client “${client}”` }).click();
    const dialog = page.getByRole('dialog', { name: 'New client' });
    await dialog.getByRole('button', { name: 'Save client' }).click();
    await expect(dialog).toBeHidden();
  }
  await page.getByLabel('Item 1 name').fill('Printing');
  await page.getByLabel('Item 1 unit price').fill('120');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/(quotes|invoices)\/[0-9a-f-]{36}$/);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  const { content } = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  return (await pdfText(content)).toLowerCase();
}

const INTRO = 'Further to your request, we are pleased to quote.';

test('quotes get Classic and a colour of their own, and invoices keep theirs', async ({ page }) => {
  await createCompany(page, 'Sample Print Co.');
  const before = await savedBranding(page);

  // Settings > Invoice defaults: the introduction new quotes start with.
  await page.goto('#/settings/documents');
  await page.getByLabel('Quote introduction').fill(INTRO);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // From the quotes to their design, which follows the invoices' until changed.
  await page.goto('#/quotes');
  await page.getByRole('link', { name: 'Quote design' }).click();
  await expect(page).toHaveURL(/#\/templates\?type=quote$/);
  await expect(page.getByRole('heading', { name: 'Quote design' })).toBeVisible();
  const same = page.getByRole('switch', { name: /Same as invoices/ });
  await expect(same).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Brand colour')).toBeDisabled();
  await same.click();
  await page.getByLabel('Brand colour').fill('#0f766e');
  await page.getByRole('switch', { name: /Customer acceptance box/ }).click();
  await page.getByRole('button', { name: 'Use Classic as the default template' }).click();
  await expect(page.getByText('Quotes now print with Classic')).toBeVisible();

  const branding = await savedBranding(page);
  expect(branding.templateId).toBe(before.templateId);
  expect(branding.accentColor).toBe(before.accentColor);
  expect(branding.byType).toEqual({
    quote: { templateId: 'classic', accentColor: '#0f766e', layout: { showAcceptance: true } },
  });

  // The invoices' design is as it was.
  await page.getByRole('tab', { name: 'Invoices' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice design' })).toBeVisible();
  await expect(page.getByLabel('Brand colour')).toHaveValue(String(before.accentColor));
  await expect(page.getByRole('switch', { name: /Customer acceptance box/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  // A new quote: Classic, the quotes' colour, the introduction and the acceptance box.
  await page.goto('#/quotes/new');
  await expect(page.getByLabel('Introduction')).toHaveValue(INTRO);
  await expect(page.getByLabel('Template').locator('option').first()).toHaveText(
    'Default (Classic)',
  );
  await expect(page.getByLabel('Colour of this document')).toHaveValue('#0f766e');
  const quote = await savedPdf(page, 'Prepared for', 'Sample Client Co.');
  expect(quote).toContain('furthertoyourrequest,wearepleasedtoquote.');
  expect(quote).toContain('customeracceptance');

  // A new invoice: none of it.
  await page.goto('#/invoices/new');
  await expect(page.getByLabel('Introduction')).toHaveCount(0);
  await expect(page.getByLabel('Template').locator('option').first()).not.toHaveText(
    'Default (Classic)',
  );
  await expect(page.getByLabel('Colour of this document')).toHaveValue(String(before.accentColor));
  const invoice = await savedPdf(page, 'Bill to', 'Sample Client Co.');
  expect(invoice).not.toContain('furthertoyourrequest');
  expect(invoice).not.toContain('customeracceptance');
});

test('a document can have a colour of its own, and go back to its type’s', async ({ page }) => {
  await createCompany(page, 'Sample Print Co.');
  const before = await savedBranding(page);
  await page.goto('#/invoices/new');
  const colour = page.getByLabel('Colour of this document');
  await colour.fill('#be123c');
  await expect(colour).toHaveValue('#be123c');
  await page.getByRole('button', { name: 'Use the default colour' }).click();
  await expect(colour).toHaveValue(String(before.accentColor));
  await expect(page.getByRole('button', { name: 'Use the default colour' })).toHaveCount(0);
});

const OWNER = { email: 'fatima@example.com', password: 'safe-password-1', name: 'Fatima Test' };
const STAFF = { email: 'noor@example.com', password: 'safe-password-3', name: 'Noor Test' };

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('staff look at the quote design but don’t change it', async ({ page }) => {
  test.slow();
  const cloud = new FakeSupabase();
  await cloud.install(page);
  cloud.addUser(OWNER.email, OWNER.password, OWNER.name);
  cloud.addUser(STAFF.email, STAFF.password, STAFF.name);

  // The owner keeps the company in the cloud and invites someone as staff.
  await createCompany(page, 'Sea Breeze Trading');
  await page.goto('#/signin');
  await signIn(page, OWNER.email, OWNER.password);
  await page.getByRole('button', { name: 'Keep in the cloud' }).click();
  const account = page.getByRole('button', { name: `Account: ${OWNER.name}` });
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await page.goto('#/settings/team');
  const invite = page
    .getByRole('region')
    .or(page.locator('form'))
    .filter({ has: page.getByRole('button', { name: 'Create invitation link' }) });
  await invite.getByLabel('Email', { exact: true }).fill(STAFF.email);
  await invite.getByLabel('Role').selectOption('staff');
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  const link = await page.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  await account.click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const signOut = page.getByRole('dialog', { name: 'Sign out?' });
  await signOut.getByText('Remove them from this device').click();
  await signOut.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Maham One' })).toBeVisible();

  // Staff join, and find the design to look at only.
  await page.goto(link);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Password', { exact: true }).fill(STAFF.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Accept and download' }).click();
  await expect(page.getByRole('button', { name: 'Switch company' })).toContainText(
    'Sea Breeze Trading',
    { timeout: 30_000 },
  );
  await page.goto('#/quotes');
  await page.getByRole('link', { name: 'Quote design' }).click();
  await expect(page.getByRole('heading', { name: 'Quote design' })).toBeVisible();
  await expect(
    page.getByText('Owners, admins and accountants choose the design of documents.'),
  ).toBeVisible();
  await expect(page.getByRole('switch', { name: /Same as invoices/ })).toBeDisabled();
  await expect(page.getByLabel('Brand colour')).toBeDisabled();
  await expect(page.getByLabel('Font')).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Use .* as the default template$/ })).toHaveCount(
    0,
  );
  // The designs can still be previewed.
  await page.getByRole('button', { name: 'Preview the Classic template' }).click();
  const preview = page.getByRole('dialog', { name: 'Classic template' });
  await expect(preview.getByRole('button', { name: 'Close' }).first()).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Use as default' })).toHaveCount(0);
});
