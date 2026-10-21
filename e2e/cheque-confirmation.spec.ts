import type { Page } from '@playwright/test';
import { chooseOption, createCompany, expect, test } from './fixtures';
import { FakeSupabase } from './cloud-fake';

/**
 * Cheque confirmation (#9, Settings → Approvals → Cheques): a cheque a staff
 * member writes is a request, not a payment, until the owner (the Super
 * Admin) confirms it on their own device; then it is recorded, posted and
 * pays the bill. A rejected one is gone, with the owner's note kept. The
 * cloud is a stand-in that answers as the server does. Made-up people and
 * companies.
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

/** An open bill from the vendor, for 250; returns its address. */
async function openBill(page: Page): Promise<string> {
  await page.goto('#/bills/new');
  await chooseOption(page, page.getByLabel('Vendor', { exact: true }), {
    placeholder: 'Search vendors…',
    query: 'Made-up Supplies',
  });
  await page.getByLabel('Line 1 description').fill('Office chairs');
  await page.getByLabel('Line 1 rate').fill('250');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page).toHaveURL(/#\/bills\/[0-9a-f-]{36}$/);
  await expect(page.locator('h1').locator('..').getByText('Open', { exact: true })).toBeVisible();
  return page.url();
}

test('a staff member’s cheque waits for the owner’s confirmation, then pays the bill', async ({
  page,
  pageErrors,
}) => {
  test.slow();
  cloud.addUser(OWNER.email, OWNER.password, OWNER.name);
  await createCompany(page, 'Desert Rose Trading');
  await page.goto('#/vendors/new');
  await page.getByLabel('Vendor name').fill('Made-up Supplies');
  await page.getByRole('button', { name: 'Save vendor' }).first().click();
  await expect(page).toHaveURL(/#\/vendors\/[0-9a-f-]{36}$/);
  const billUrl = await openBill(page);

  // Into the cloud; the owner turns cheque confirmation on (the recommended kinds).
  let account = await signIn(page, OWNER);
  await page.getByRole('button', { name: 'Keep in the cloud' }).click();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  const companyId = [...cloud.companies.keys()][0];
  await page.goto('#/settings/approvals');
  await page.getByRole('switch', { name: /Cheques need confirmation/ }).click();
  await expect(page.getByRole('switch', { name: /^Cheques issued/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('switch', { name: /^Security cheques given/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('switch', { name: /^Cheques received/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  expect(cloud.rows(companyId, 'companies')[0].data?.approvalRules).toMatchObject({
    cheques: { issued: true, securityOut: true, received: false },
  });

  const staff = cloud.addUser(STAFF.email, STAFF.password, STAFF.name);
  cloud.companies.get(companyId)!.members.set(staff.id, 'staff');
  await signOut(page, account);

  // The staff member pays the bill by cheque: it is sent for confirmation.
  account = await signIn(page, STAFF);
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await page.goto(billUrl);
  await page.getByRole('button', { name: 'Record payment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record payment' });
  await dialog.getByLabel('Method').selectOption('cheque');
  await dialog.getByLabel('Cheque number').fill('000101');
  await dialog.getByLabel('Bank', { exact: true }).selectOption('BRGN');
  await expect(dialog.getByText(/waits for an approver’s confirmation/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Send for confirmation' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/^Sent for confirmation/)).toBeVisible();
  // Not a payment: the bill is still open, and says the cheque waits.
  const title = page.locator('h1').locator('..');
  await expect(title.getByText('Open', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Cheque 000101 of KD.250\.000 for this document is waiting for confirmation/),
  ).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  expect(cloud.rows(companyId, 'payments')).toHaveLength(0);
  expect(cloud.rows(companyId, 'approvals')[0].data).toMatchObject({
    kind: 'cheque_create',
    status: 'pending',
    requestedBy: staff.id,
  });
  // In the register: not among the open cheques, under Waiting for confirmation.
  await page.goto('#/cheques?tab=issued');
  await expect(page.getByRole('heading', { name: 'No cheques issued yet' })).toBeVisible();
  await page.getByRole('button', { name: /Waiting for confirmation/ }).click();
  await expect(page.getByText('Cheque issued 000101')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take back' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  await signOut(page, account);

  // The owner confirms it on their own device.
  account = await signIn(page, OWNER);
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await page.goto('#/approvals');
  await expect(page.getByText('Cheque issued 000101')).toBeVisible();
  await expect(page.getByText(`Asked by ${STAFF.name}`, { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Cheque confirmed and recorded')).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  const payments = cloud.rows(companyId, 'payments');
  expect(payments).toHaveLength(1);
  expect(payments[0].data).toMatchObject({
    method: 'cheque',
    amount: 250,
    cheque: { number: '000101', status: 'held' },
  });
  expect(cloud.rows(companyId, 'approvals')[0].data).toMatchObject({ status: 'applied' });
  await page.goto(billUrl);
  await expect(page.locator('h1').locator('..').getByText('Paid', { exact: true })).toBeVisible();
  await page.goto('#/cheques?tab=issued');
  await expect(page.getByRole('row', { name: /000101/ })).toContainText(/KD.250\.000/);

  // A second cheque, from the staff member, that the owner turns down.
  await signOut(page, account);
  account = await signIn(page, STAFF);
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await page.goto('#/payments-made/new?method=cheque');
  await chooseOption(page, page.getByLabel('Vendor', { exact: true }), {
    placeholder: 'Search vendors…',
    query: 'Made-up Supplies',
  });
  await page.getByLabel('Amount paid').fill('75');
  await page.getByLabel('Cheque number').fill('000102');
  await page.getByRole('button', { name: 'Send for confirmation' }).click();
  await expect(page.getByText(/^Sent for confirmation/)).toBeVisible();
  await expect(page).toHaveURL(/#\/cheques\?tab=issued&filter=pending/);
  await expect(page.getByText('Cheque issued 000102')).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await signOut(page, account);

  account = await signIn(page, OWNER);
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await page.goto('#/cheques?tab=issued&filter=pending');
  await expect(page.getByText('Cheque issued 000102')).toBeVisible();
  await page.getByRole('button', { name: 'Reject' }).click();
  const reject = page.getByRole('dialog', { name: 'Reject this cheque?' });
  await reject.getByLabel('Note for whoever asked').fill('Pay this one by transfer.');
  await reject.getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByText('Nothing is waiting for confirmation.')).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  expect(cloud.rows(companyId, 'payments')).toHaveLength(1);
  const rejected = cloud
    .rows(companyId, 'approvals')
    .find((r) => (r.data as { subjectNumber?: string }).subjectNumber === '000102');
  expect(rejected?.data).toMatchObject({
    status: 'rejected',
    decisionNote: 'Pay this one by transfer.',
  });
  await page.goto('#/approvals');
  await page.getByRole('tab', { name: 'Decided' }).click();
  await expect(page.getByText(/Not confirmed by .* Pay this one by transfer\./)).toBeVisible();
  expect(pageErrors).toEqual([]);
});
