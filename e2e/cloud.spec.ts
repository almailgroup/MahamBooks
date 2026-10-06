import type { Page } from '@playwright/test';
import { createCompany, expect, test } from './fixtures';
import { FakeSupabase, PUBLISHABLE_KEY } from './cloud-fake';

// The real service can't be reached from here: a stand-in answers instead.
let cloud: FakeSupabase;

test.beforeEach(async ({ page }) => {
  cloud = new FakeSupabase();
  await cloud.install(page);
});

const OWNER = { email: 'fatima@example.com', password: 'safe-password-1', name: 'Fatima Al-Sabah' };

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** A company set up on this device, then kept in the cloud by its owner. */
async function companyInTheCloud(page: Page, name: string) {
  cloud.addUser(OWNER.email, OWNER.password, OWNER.name);
  await createCompany(page, name);
  await page.goto('#/signin');
  await signIn(page, OWNER.email, OWNER.password);
  await expect(page.getByRole('heading', { name: 'Your companies' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep in the cloud' }).click();
  // Once it is in the cloud, the app opens on it by itself.
  const account = page.getByRole('button', { name: `Account: ${OWNER.name}` });
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Switch company' })).toContainText(name);
  return { account, companyId: [...cloud.companies.keys()][0] };
}

async function signOutRemovingCompanies(page: Page, account: ReturnType<Page['getByRole']>) {
  await account.click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out?' });
  await dialog.getByText('Remove them from this device').click();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Maham Books' })).toBeVisible();
}

test('creating an account asks to confirm the email address', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await page.getByLabel('Full name').fill('Yousef Al-Kandari');
  await page.getByLabel('Email', { exact: true }).fill('yousef@example.com');
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page.getByRole('alert')).toHaveText('Choose a password of at least 8 characters.');
  await page.getByLabel('Password', { exact: true }).fill('safe-password-2');
  await page.getByRole('button', { name: 'Create an account' }).click();

  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByText('yousef@example.com')).toBeVisible();
  const signup = cloud.requests.find((r) => r.path === '/auth/v1/signup')!;
  // The confirmation link comes back to the app (PKCE: a code, never tokens).
  expect(signup.body).toMatchObject({
    email: 'yousef@example.com',
    data: { full_name: 'Yousef Al-Kandari', language: 'en' },
    code_challenge_method: 's256',
  });
  expect(signup.apikey).toBe(PUBLISHABLE_KEY);
});

test('signing in keeps a company of this device in the cloud and syncs changes', async ({
  page,
}) => {
  const { account, companyId } = await companyInTheCloud(page, 'Gulf Lights Trading');
  expect(cloud.companies.get(companyId)?.name).toBe('Gulf Lights Trading');
  expect(cloud.rows(companyId, 'companies')).toHaveLength(1);
  expect(cloud.rows(companyId, 'accounts').length).toBeGreaterThan(50);

  // A new client goes to the cloud on its own.
  await page.goto('#/clients/new');
  await page.getByLabel('Client name').fill('Sadu Interiors Co.');
  await page.getByRole('button', { name: 'Save client' }).first().click();
  await expect
    .poll(() => cloud.rows(companyId, 'clients').map((r) => r.data?.name), { timeout: 15_000 })
    .toContain('Sadu Interiors Co.');
  await expect(account).toContainText('Synced');

  // The status is in the account menu and in the command palette.
  await account.click();
  await expect(page.getByRole('menuitem', { name: 'Sync now' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox', { name: 'Search' }).fill('sync');
  await expect(palette.getByRole('option', { name: /Sync status/ })).toContainText('Synced');

  // Only the publishable key was ever used.
  expect(new Set(cloud.requests.map((r) => r.apikey))).toEqual(new Set([PUBLISHABLE_KEY]));
});

test('signing out can remove the cloud companies from a shared computer', async ({ page }) => {
  const { account, companyId } = await companyInTheCloud(page, 'Desert Rose Trading');
  await signOutRemovingCompanies(page, account);
  // The sign-out request may still be on its way when the welcome page shows.
  await expect.poll(() => cloud.requests.some((r) => r.path === '/auth/v1/logout')).toBe(true);
  // Removed here, still in the cloud.
  expect(cloud.rows(companyId, 'companies')).toHaveLength(1);
});

test('signing in on another device brings the companies and opens the app by itself', async ({
  page,
}) => {
  const { account } = await companyInTheCloud(page, 'Desert Rose Trading');
  // A device that has nothing yet.
  await signOutRemovingCompanies(page, account);

  await page.goto('#/signin');
  await signIn(page, OWNER.email, OWNER.password);
  await expect(page.getByRole('button', { name: 'Switch company' })).toContainText(
    'Desert Rose Trading',
    { timeout: 30_000 },
  );
  await expect(page.getByRole('button', { name: `Account: ${OWNER.name}` })).toContainText(
    'Synced',
    { timeout: 30_000 },
  );
});

test('an invitation link says who invites whom, then joins and downloads the company', async ({
  page,
}) => {
  test.slow();
  const { account } = await companyInTheCloud(page, 'Al Mail Trading');
  cloud.addUser('yousef@example.com', 'safe-password-2', 'Yousef Al-Kandari');

  // The owner makes an invitation link in Settings → Team.
  await page.goto('#/settings/team');
  await expect(page.getByText(OWNER.email).first()).toBeVisible();
  const invite = page
    .getByRole('region')
    .or(page.locator('form'))
    .filter({
      has: page.getByRole('button', { name: 'Create invitation link' }),
    });
  await invite.getByLabel('Email', { exact: true }).fill('Yousef@Example.com');
  await invite.getByLabel('Role').selectOption('accountant');
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  const link = await page.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  expect(link).toMatch(/#\/invite\/[0-9a-f]{64}\?i=/);
  await expect(page.getByRole('link', { name: 'Send by WhatsApp' })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\/\?text=/,
  );

  // On a shared computer: sign out and leave nothing behind.
  await signOutRemovingCompanies(page, account);

  // The invitee opens the link.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'You are invited' })).toBeVisible();
  await expect(
    page.getByText('Fatima Al-Sabah invited you to join Al Mail Trading as Accountant.'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('yousef@example.com');
  await page.getByLabel('Password', { exact: true }).fill('safe-password-2');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Join Al Mail Trading' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept and download' }).click();
  // The company arrives and the app opens on it.
  await expect(page.getByRole('button', { name: 'Switch company' })).toContainText(
    'Al Mail Trading',
    { timeout: 30_000 },
  );
  await expect(page.getByRole('button', { name: 'Account: Yousef Al-Kandari' })).toContainText(
    'Synced',
  );
});

test('an owner turns on email alerts and gets the first email at once', async ({ page }) => {
  const { companyId } = await companyInTheCloud(page, 'Pearl Coast Trading');
  await page.goto('#/settings/alerts');
  await expect(page.getByRole('heading', { name: 'Email alerts' })).toBeVisible();
  const toggle = page.getByRole('switch', { name: 'Email me alerts for Pearl Coast Trading' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(
    page.getByText(`Sent to ${OWNER.email}, the address of your account.`),
  ).toBeVisible();

  await toggle.click();
  await page.getByRole('checkbox', { name: /Bills to pay/ }).uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByText(`Email alerts are on. The first email is on its way to ${OWNER.email}.`),
  ).toBeVisible();

  const [saved] = cloud.calls('set_email_alerts');
  expect(saved.body).toMatchObject({
    p_company: companyId,
    p_enabled: true,
    p_topics: ['documents', 'deadlines', 'cheques', 'invoices'],
  });
  // The address the app is open at, for the button in the email.
  expect((saved.body as { p_app_url: string }).p_app_url).toBe(new URL('./', page.url()).href);
  expect(cloud.alertEmails).toEqual([{ company: companyId, to: OWNER.email }]);

  // Later, the same email on demand.
  await page.getByRole('button', { name: 'Send me the email now' }).click();
  await expect(page.getByText(`Email sent to ${OWNER.email}.`)).toBeVisible();
  expect(cloud.alertEmails).toHaveLength(2);
});
