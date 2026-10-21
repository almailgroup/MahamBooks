import type { Page } from '@playwright/test';
import { createCompany, downloadFrom, expect, pdfText, test } from './fixtures';
import { FakeSupabase } from './cloud-fake';

/**
 * Approvals (Settings → Approvals): a staff member's change to an issued
 * invoice waits for the owner (the Super Admin), who approves it on their own
 * device; voided invoices keep their number under Void invoices. The cloud is
 * a stand-in that answers as the server does. Made-up people and companies.
 */

let cloud: FakeSupabase;

test.beforeEach(async ({ page }) => {
  cloud = new FakeSupabase();
  await cloud.install(page);
});

const OWNER = { email: 'owner@example.com', password: 'safe-password-1', name: 'Mariam Test' };
const STAFF = { email: 'staff@example.com', password: 'safe-password-2', name: 'Hamad Test' };

async function signIn(page: Page, who: typeof OWNER) {
  await page.goto('#/signin');
  await page.getByLabel('Email', { exact: true }).fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const account = page.getByRole('button', { name: `Account: ${who.name}` });
  return account;
}

async function signOut(page: Page, account: ReturnType<Page['getByRole']>) {
  await account.click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out?' });
  await dialog.getByText('Remove them from this device').click();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Maham One' })).toBeVisible();
}

test('a staff member’s change waits for the owner, who approves it; voids keep their number', async ({
  page,
  pageErrors,
}) => {
  test.slow();
  cloud.addUser(OWNER.email, OWNER.password, OWNER.name);
  await createCompany(page, 'Desert Rose Trading');

  // An issued invoice.
  await page.goto('#/invoices/new');
  await page.getByLabel('Bill to').click();
  await page.getByPlaceholder('Search clients…').fill('Made-up Customer');
  await page.getByRole('button', { name: 'New client “Made-up Customer”' }).click();
  await page
    .getByRole('dialog', { name: 'New client' })
    .getByRole('button', { name: 'Save client' })
    .click();
  await page.getByLabel('Item 1 name').fill('Guarding, October');
  await page.getByLabel('Item 1 quantity').fill('2');
  await page.getByLabel('Item 1 unit price').fill('150');
  await page.getByRole('button', { name: 'More save options' }).click();
  await page.getByRole('menuitem', { name: 'Save and mark as sent' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Invoice INV-/);
  const number = (await page.getByRole('heading', { level: 1 }).textContent())!.replace(
    'Invoice ',
    '',
  );
  const invoiceUrl = page.url();

  // Into the cloud, then the owner turns approvals on.
  let account = await signIn(page, OWNER);
  await page.getByRole('button', { name: 'Keep in the cloud' }).click();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  const companyId = [...cloud.companies.keys()][0];
  await page.goto('#/settings/approvals');
  await page.getByRole('switch', { name: /Issued invoices need an approver to change/ }).click();
  await expect(page.getByRole('switch', { name: /Void instead of delete/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  expect(cloud.rows(companyId, 'companies')[0].data?.approvalRules).toEqual({
    voidInsteadOfDelete: true,
    expireDays: 14,
    documentTypes: ['invoice'],
  });
  // Approvals is in the Books sidebar now.
  await expect(page.getByRole('link', { name: 'Approvals', exact: true }).first()).toBeVisible();

  const staff = cloud.addUser(STAFF.email, STAFF.password, STAFF.name);
  cloud.companies.get(companyId)!.members.set(staff.id, 'staff');
  await signOut(page, account);

  // The staff member edits the issued invoice: the change is sent for approval.
  account = await signIn(page, STAFF);
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await page.goto(invoiceUrl);
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Item 1 unit price').fill('120');
  await page.getByRole('button', { name: 'Send for approval' }).click();
  const ask = page.getByRole('dialog', { name: `Send the change of ${number} for approval?` });
  await ask.getByRole('button', { name: 'Send for approval' }).click();
  await expect(ask.getByText('Say why, for the approver.')).toBeVisible();
  await ask.getByLabel('Reason').fill('The customer agreed a lower price.');
  await ask.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText('Sent for approval')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
  // The invoice itself is unchanged until approved.
  await expect(page.getByText('KD 300.000').first()).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  const asked = cloud.rows(companyId, 'approvals');
  expect(asked).toHaveLength(1);
  expect(asked[0].data).toMatchObject({
    kind: 'invoice_edit',
    status: 'pending',
    requestedBy: staff.id,
    reason: 'The customer agreed a lower price.',
  });
  // Staff can't void it themselves either: they ask.
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Request void' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await signOut(page, account);

  // The owner approves on their own device.
  account = await signIn(page, OWNER);
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await page.goto('#/');
  await page.getByRole('link', { name: /Waiting for your approval/ }).click();
  await expect(page.getByRole('heading', { name: 'Approval requests' })).toBeVisible();
  await expect(page.getByText('The customer agreed a lower price.')).toBeVisible();
  await expect(page.getByText(`Asked by ${STAFF.name}`, { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved and done').first()).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  const invoice = cloud.rows(companyId, 'documents')[0].data!;
  expect((invoice.items as { unitPrice: number }[])[0].unitPrice).toBe(120);
  expect(cloud.rows(companyId, 'approvals')[0].data).toMatchObject({ status: 'applied' });

  // The owner voids it, with why: it keeps its number, under Void invoices.
  await page.goto(invoiceUrl);
  await expect(page.getByText('KD 240.000').first()).toBeVisible();
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Void document' }).click();
  const voiding = page.getByRole('dialog', { name: `Void ${number}?` });
  await voiding.getByLabel('Why it is voided').fill('Issued to the wrong branch.');
  await voiding.getByRole('button', { name: 'Void document' }).click();
  await expect(page.getByText('Why it was voided: Issued to the wrong branch.')).toBeVisible();
  const { content } = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  expect(await pdfText(content)).toContain('VOID');
  await page.goto('#/invoices?status=void');
  await expect(page.getByRole('heading', { name: 'Void invoices' })).toBeVisible();
  await expect(page.getByRole('link', { name: number })).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  expect(cloud.rows(companyId, 'documents')[0].data).toMatchObject({
    status: 'void',
    number,
    voidReason: 'Issued to the wrong branch.',
  });
  // The browser logs nothing the cloud refused here.
  expect(pageErrors).toEqual([]);
});
