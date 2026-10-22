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
  await expect(page.getByRole('heading', { name: 'Welcome to Maham One' })).toBeVisible();
  // Signed out too, not only the companies removed: the app has then gone home
  // (a toast from an earlier sign-out may still be showing, so not by that).
  await expect(
    page.getByRole('heading', { name: 'Work from any device, with your team' }),
  ).toBeVisible();
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

test('an owner chooses whose papers their email alerts cover', async ({ page }) => {
  const { companyId } = await companyInTheCloud(page, 'Pearl Coast Trading');
  await page.goto('#/settings/alerts');
  await page.getByRole('switch', { name: 'Email me alerts for Pearl Coast Trading' }).click();
  // Every kind of paper at first, under Papers and licences.
  for (const kind of [
    'Company papers and licences',
    'Vehicles’ papers',
    'Employees’ papers',
    'Customers’ papers',
  ]) {
    await expect(page.getByRole('checkbox', { name: kind })).toBeChecked();
  }
  await page.getByRole('checkbox', { name: 'Vehicles’ papers' }).uncheck();
  await page.getByRole('checkbox', { name: 'Customers’ papers' }).uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByText(`Email alerts are on. The first email is on its way to ${OWNER.email}.`),
  ).toBeVisible();
  const [scope] = cloud.calls('set_email_alert_scope');
  expect(scope.body).toMatchObject({ p_company: companyId, p_kinds: ['company', 'staff'] });
  // The topics are saved as before, for older versions too.
  expect(cloud.calls('set_email_alerts')[0].body).toMatchObject({
    p_topics: ['documents', 'deadlines', 'cheques', 'bills', 'invoices'],
  });

  // Kept: the page opens with them.
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Employees’ papers' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Vehicles’ papers' })).not.toBeChecked();
  // Papers and licences off: their kinds can't be chosen.
  await page.getByRole('checkbox', { name: /Papers and licences/ }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Employees’ papers' })).toBeDisabled();
});

test('staff open only the apps of their role', async ({ page }) => {
  test.slow();
  const { account } = await companyInTheCloud(page, 'Sea Breeze Trading');
  cloud.addUser('noor@example.com', 'safe-password-3', 'Noor Test');
  await page.goto('#/settings/team');
  // The owner sees what each role opens.
  await expect(page.getByRole('table', { name: 'What each role can open' })).toBeVisible();
  const invite = page
    .getByRole('region')
    .or(page.locator('form'))
    .filter({ has: page.getByRole('button', { name: 'Create invitation link' }) });
  await invite.getByLabel('Email', { exact: true }).fill('noor@example.com');
  await invite.getByLabel('Role').selectOption('staff');
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  const link = await page.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  await signOutRemovingCompanies(page, account);

  await page.goto(link);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Password', { exact: true }).fill('safe-password-3');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Accept and download' }).click();
  await expect(page.getByRole('button', { name: 'Switch company' })).toContainText(
    'Sea Breeze Trading',
    { timeout: 30_000 },
  );

  // No Maham People in the switcher, on the home, or in the New menu.
  await page.goto('#/');
  await expect(page.getByRole('region', { name: 'Your apps' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Maham People', exact: true })).toHaveCount(0);
  // No People tools on the home either, and nothing of theirs to create.
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Invoices', exact: true })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Payroll', exact: true })).toHaveCount(0);
  await expect(main.getByRole('link', { name: 'Directory', exact: true })).toHaveCount(0);
  await expect(main.getByRole('link', { name: 'New invoice' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'New employee' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch app' }).click();
  await expect(page.getByRole('menuitem', { name: /Maham Books/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Maham People/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Invoice', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Employee', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Payroll and employees stay private, whatever the address.
  for (const route of ['#/employees', '#/people', '#/people/directory', '#/payroll']) {
    await page.goto(route);
    await expect(
      page.getByRole('heading', { name: 'Payroll and people are private' }),
    ).toBeVisible();
  }
  // Compliance is there to look at.
  await page.goto('#/compliance');
  await expect(
    page.getByRole('status').filter({ hasText: 'You can look at Maham Compliance' }),
  ).toBeVisible();
  // CRM and Books are theirs to work in.
  await page.goto('#/crm');
  await expect(page.getByRole('heading', { name: 'Pipeline', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New quote' })).toBeVisible();
});

test('the owner, as Super Admin, limits a member, and the cloud parks what they still try', async ({
  page,
  pageErrors,
}) => {
  test.slow();
  const { account, companyId } = await companyInTheCloud(page, 'Coral Reef Trading');
  const member = cloud.addUser('salem@example.com', 'safe-password-4', 'Salem Test');
  cloud.companies.get(companyId)!.members.set(member.id, 'accountant');

  // Settings → Team: the owner is the Super Admin and decides who does what.
  await page.goto('#/settings/team');
  await expect(page.getByText('Owner (Super Admin)')).toBeVisible();
  await page.getByRole('switch', { name: /Only the owner makes admins and accountants/ }).click();
  await expect(page.getByText('Team rules saved')).toBeVisible();
  expect(cloud.seniorRolesOwnerOnly.has(companyId)).toBe(true);

  await page.getByRole('button', { name: 'Permissions of Salem Test' }).click();
  const dialog = page.getByRole('dialog', { name: 'What Salem Test can do' });
  await dialog.getByLabel('Access to Maham People').selectOption('none');
  await dialog.getByRole('switch', { name: /Can approve/ }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Permissions saved')).toBeVisible();
  expect(cloud.access.get(`${companyId} ${member.id}`)).toEqual({
    permissions: { apps: { people: 'none' } },
    canApprove: true,
  });
  await expect(page.getByText('Can approve', { exact: true })).toBeVisible();
  await expect(page.getByText('Limited access', { exact: true })).toBeVisible();
  await signOutRemovingCompanies(page, account);

  // The accountant on their own device: People is off for them.
  await page.goto('#/signin');
  await signIn(page, 'salem@example.com', 'safe-password-4');
  const theirs = page.getByRole('button', { name: 'Account: Salem Test' });
  await expect(theirs).toContainText('Synced', { timeout: 30_000 });
  await page.goto('#/employees');
  await expect(
    page.getByRole('heading', { name: 'The owner has turned Maham People off for you' }),
  ).toBeVisible();

  // The owner makes Books view only too. A customer saved before this device
  // knows it is refused by the cloud and waits in Settings → Cloud and sync.
  cloud.access.set(`${companyId} ${member.id}`, {
    permissions: { apps: { people: 'none', books: 'view' } },
    canApprove: true,
  });
  await page.goto('#/clients/new');
  await page.getByLabel('Client name').fill('Made-up Customer');
  await page.getByRole('button', { name: 'Save client' }).first().click();
  await expect(theirs).toContainText('Sync problem', { timeout: 30_000 });
  expect(
    cloud.rows(companyId, 'clients').filter((r) => r.data?.name === 'Made-up Customer'),
  ).toEqual([]);
  // Known on this device now: Books is view only for them.
  await page.goto('#/invoices');
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'The owner has made Maham Books view only for you' }),
  ).toBeVisible();
  // The browser logs the cloud's refusals; nothing else may go wrong.
  const refused = pageErrors.filter((e) => e.includes('status of 403'));
  expect(refused.length).toBeGreaterThan(0);
  for (const error of refused) pageErrors.splice(pageErrors.indexOf(error), 1);
});

test('with the owner’s switch on, an admin cancels only the invitations of staff and viewers', async ({
  page,
}) => {
  const { account, companyId } = await companyInTheCloud(page, 'Pearl Dive Trading');
  const admin = cloud.addUser('noura@example.com', 'safe-password-5', 'Noura Test');
  cloud.companies.get(companyId)!.members.set(admin.id, 'admin');
  cloud.seniorRolesOwnerOnly.add(companyId);
  const owner = cloud.users.get(OWNER.email)!;
  cloud.invite(companyId, 'new-accountant@example.com', 'accountant', owner.id);
  cloud.invite(companyId, 'new-staff@example.com', 'staff', admin.id);
  await signOutRemovingCompanies(page, account);

  await page.goto('#/signin');
  await signIn(page, 'noura@example.com', 'safe-password-5');
  await expect(page.getByRole('button', { name: 'Account: Noura Test' })).toContainText('Synced', {
    timeout: 30_000,
  });
  await page.goto('#/settings/team');
  const accountant = page.getByRole('listitem').filter({ hasText: 'new-accountant@example.com' });
  await expect(accountant.getByText('Only the owner cancels this invitation.')).toBeVisible();
  await expect(accountant.getByRole('button', { name: 'Cancel invitation' })).toHaveCount(0);
  const staff = page.getByRole('listitem').filter({ hasText: 'new-staff@example.com' });
  await staff.getByRole('button', { name: 'Cancel invitation' }).click();
  await expect(page.getByText('Invitation cancelled')).toBeVisible();
  expect(cloud.invites.find((i) => i.email === 'new-staff@example.com')?.revoked).toBe(true);
  expect(cloud.invites.find((i) => i.email === 'new-accountant@example.com')?.revoked).toBeFalsy();
});
