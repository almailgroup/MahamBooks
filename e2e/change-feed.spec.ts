import type { Page } from '@playwright/test';
import { createCompany, expect, test } from './fixtures';
import { FakeSupabase } from './cloud-fake';

/**
 * Changes by the team (#7): the owner (the Super Admin) turns them on in
 * Settings → Email alerts; a staff member edits an issued invoice on their
 * own device; the owner's bell shows it with their name, Updates lists it,
 * and the invoice's activity says who did it. The cloud is a stand-in that
 * answers as the server does. Made-up people and companies.
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
  return page.getByRole('button', { name: `Account: ${who.name}` });
}

async function signOut(page: Page, account: ReturnType<Page['getByRole']>) {
  await account.click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out?' });
  await dialog.getByText('Remove them from this device').click();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Maham One' })).toBeVisible();
}

test('a staff member’s edit reaches the owner’s bell with their name', async ({ page }) => {
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

  // Into the cloud. Nothing about it shows until the owner turns it on.
  let account = await signIn(page, OWNER);
  await page.getByRole('button', { name: 'Keep in the cloud' }).click();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  const companyId = [...cloud.companies.keys()][0];
  await expect(page.getByRole('button', { name: /^Updates/ })).toHaveCount(0);

  await page.goto('#/settings/alerts');
  await expect(page.getByRole('heading', { name: 'Changes by your team' })).toBeVisible();
  await page
    .getByRole('switch', { name: 'Tell me about changes by my team in Desert Rose Trading' })
    .click();
  await page.getByRole('checkbox', { name: /Company settings/ }).uncheck();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Changes by your team are on')).toBeVisible();
  const [saved] = cloud.calls('set_change_notifications');
  expect(saved.body).toMatchObject({
    p_company: companyId,
    p_enabled: true,
    p_immediate_kinds: ['document', 'cheque', 'approval', 'member', 'people'],
    p_digest: 'daily',
  });
  const bell = page.getByRole('button', { name: /^Updates/ });
  await expect(bell).toBeVisible();

  const staff = cloud.addUser(STAFF.email, STAFF.password, STAFF.name);
  cloud.companies.get(companyId)!.members.set(staff.id, 'staff');
  await signOut(page, account);

  // The staff member changes the issued invoice on their device. No bell for them.
  account = await signIn(page, STAFF);
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Updates/ })).toHaveCount(0);
  await page.goto(invoiceUrl);
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Item 1 unit price').fill('120');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('KD 240.000').first()).toBeVisible();
  await expect
    .poll(() => cloud.changes.filter((c) => c.tbl === 'documents').length, { timeout: 30_000 })
    .toBe(1);
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  expect(cloud.changes.find((c) => c.tbl === 'documents')).toMatchObject({
    actor: staff.id,
    kind: 'document',
    important: true,
    summary: { what: 'edited', number },
  });
  await signOut(page, account);

  // The owner's bell counts it and names who did it.
  account = await signIn(page, OWNER);
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await expect(bell).toHaveAccessibleName(/^Updates: \d+ unread$/);
  await bell.click();
  const panel = page.getByRole('dialog', { name: 'Updates' });
  const row = panel.getByRole('link', { name: new RegExp(`Edited invoice ${number}`) });
  await expect(row).toContainText(STAFF.name);
  await expect(row).toContainText('Important');
  await expect(row).toContainText('Made-up Customer · KD 240.000');

  // Updates has everything, by day; marking all read empties the count.
  await panel.getByRole('link', { name: 'See all updates' }).click();
  await expect(page.getByRole('heading', { name: 'Updates', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Today' })).toContainText(
    `${STAFF.name} Edited invoice ${number} after it was issued`,
  );
  await page.getByRole('tab', { name: 'Important' }).click();
  await expect(page.getByText(`Edited invoice ${number} after it was issued`)).toBeVisible();
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(bell).toHaveAccessibleName('Updates');
  expect(cloud.calls('mark_notifications_read')).toHaveLength(1);

  // It opens the invoice, whose activity says who changed it.
  await page.getByRole('link', { name: new RegExp(`Edited invoice ${number}`) }).click();
  await expect(page).toHaveURL(invoiceUrl);
  await expect(page.getByText(`by ${STAFF.name}`).first()).toBeVisible();
});
