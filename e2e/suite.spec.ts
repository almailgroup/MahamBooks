import { expect, startWithDemoData, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await startWithDemoData(page);
});

test('the home shows the apps and what needs attention in them', async ({ page }) => {
  await page.goto('#/');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText(
    /^Good (morning|afternoon|evening)$/,
  );
  const apps = main.getByRole('region', { name: 'Your apps' });
  for (const name of ['Maham Books', 'Maham People', 'Maham CRM', 'Maham Compliance']) {
    await expect(apps.getByRole('link', { name, exact: true })).toBeVisible();
  }
  // The demo has overdue invoices and cheques coming due.
  await expect(main.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  const topics = main.getByRole('list', { name: 'By topic' });
  await expect(topics.getByRole('link', { name: /^Overdue invoices/ })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'At a glance' })).toBeVisible();
  await expect(main).toContainText(/KD\s?[\d,]+\.\d{3}/);

  await apps.getByRole('link', { name: 'Maham People', exact: true }).click();
  await expect(page).toHaveURL(/#\/people$/);
  await expect(main.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
});

test('every tool is a round tile on the home, found by typing its name', async ({ page }) => {
  await page.goto('#/');
  const main = page.getByRole('main');
  // Each app's tools, and the things most often created.
  const tools = main.getByRole('region', { name: 'Tools' });
  for (const name of ['Invoices', 'Cheques', 'Directory', 'Payroll', 'Pipeline', 'Calendar']) {
    await expect(tools.getByRole('link', { name, exact: true }).first()).toBeVisible();
  }
  const create = main.getByRole('region', { name: 'Create' });
  // One for each app the owner works in, People included.
  await expect(create.getByRole('link', { name: 'New employee' })).toBeVisible();
  await create.getByRole('link', { name: 'Record expense' }).click();
  await expect(page).toHaveURL(/#\/expenses/);

  await page.goto('#/');
  await tools.getByRole('link', { name: 'Cheques', exact: true }).click();
  await expect(page).toHaveURL(/#\/cheques$/);

  // Typing narrows the tiles down; Enter opens the first one.
  await page.goto('#/');
  const find = main.getByRole('searchbox', { name: 'Find an app or tool' });
  await find.fill('salaries');
  const results = main.getByRole('region', { name: 'Search results' });
  await expect(results.getByRole('link')).toHaveCount(1);
  // Screen readers hear how many tiles are left.
  await expect(main.getByRole('status').filter({ hasText: /^1 result$/ })).toHaveCount(1);
  await expect(results.getByRole('link', { name: 'Payroll' })).toBeVisible();
  await expect(main.getByRole('region', { name: 'Your apps' })).toHaveCount(0);
  await find.press('Enter');
  await expect(page).toHaveURL(/#\/payroll$/);

  await page.goto('#/');
  await find.fill('zzzz');
  await expect(main.getByText('No app or tool matches your search.')).toBeVisible();
  await find.press('Escape');
  await expect(main.getByRole('region', { name: 'Your apps' })).toBeVisible();
});

test('the app switcher moves between apps, each with its own sidebar', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('button', { name: 'Sales' })).toBeVisible();

  await page.getByRole('button', { name: 'Switch app' }).click();
  await page.getByRole('menuitem', { name: /Maham CRM/ }).click();
  await expect(page).toHaveURL(/#\/crm$/);
  await expect(page.getByRole('heading', { name: 'Pipeline', level: 1 })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Prospects' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Sales' })).toHaveCount(0);

  // Customers are Books' page, opened from CRM with CRM's sidebar.
  await nav.getByRole('link', { name: 'Customers' }).click();
  await expect(page).toHaveURL(/#\/clients$/);
  await expect(nav.getByRole('link', { name: 'Customers' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.getByRole('button', { name: 'Switch app' }).click();
  await page.getByRole('menuitem', { name: /Maham People/ }).click();
  await expect(page).toHaveURL(/#\/people$/);
  await nav.getByRole('link', { name: 'Directory' }).click();
  await expect(page.getByRole('heading', { name: 'Directory', level: 1 })).toBeVisible();
  // Contact cards only: nothing of pay or papers.
  await expect(page.getByRole('main')).not.toContainText(/KD\s?[\d,]+\.\d{3}/);

  // Settings keeps the sidebar of the last app.
  await page.goto('#/settings/company');
  await expect(nav.getByRole('link', { name: 'Directory' })).toBeVisible();

  // Old addresses still open their page, in the app they belong to.
  await page.goto('#/payroll/leave');
  await expect(nav.getByRole('link', { name: 'Leave', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.goto('#/invoices');
  await expect(nav.getByRole('button', { name: 'Sales' })).toBeVisible();
  await page.goto('#/books');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();

  // The Maham One logo at the top of the sidebar leads home.
  await page.getByRole('link', { name: 'Maham One', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('region', { name: 'Your apps' })).toBeVisible();
});

test('the pipeline follows the quotes and finds prospects', async ({ page }) => {
  await page.goto('#/crm');
  const main = page.getByRole('main');
  for (const stage of ['Draft', 'Waiting for an answer', 'Won', 'Lost']) {
    await expect(main.getByRole('region', { name: stage })).toBeVisible();
  }
  await expect(main.getByRole('link', { name: /QUO-\d{4}-\d+/ }).first()).toBeVisible();
  await page.goto('#/crm/prospects');
  await expect(page.getByRole('heading', { name: 'Prospects', level: 1 })).toBeVisible();
});

test('search finds the apps and their pages', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox', { name: 'Search' }).fill('directory');
  await expect(palette.getByRole('option').first()).toContainText('Directory');
  await palette.getByRole('combobox').fill('maham crm');
  await expect(palette.getByRole('option').first()).toContainText('Maham CRM');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/crm$/);
});

test('Settings → Team splits Maham Books into Sales, Books and Inventory, at the same addresses', async ({
  page,
}) => {
  const nav = page.getByRole('navigation', { name: 'Main' });
  await page.goto('#/settings/team');
  const layout = page.getByRole('region', { name: 'App layout' });
  const toggle = layout.getByRole('switch', {
    name: /Maham Sales and Maham Inventory as their own apps/,
  });
  // Off until someone turns it on.
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  const confirm = page.getByRole('dialog', { name: 'Give Sales and Inventory their own apps?' });
  await confirm.getByRole('button', { name: 'Switch on' }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  // The grid shows the six apps.
  const grid = page.getByRole('table', { name: 'What each role can open' });
  for (const name of ['Maham Sales', 'Maham Books', 'Maham Inventory']) {
    await expect(grid.getByRole('columnheader', { name, exact: true })).toBeVisible();
  }

  // The switcher has the six apps.
  await page.getByRole('button', { name: 'Switch app' }).click();
  for (const name of ['Maham Sales', 'Maham Books', 'Maham Inventory', 'Maham People']) {
    await expect(page.getByRole('menuitem', { name: new RegExp(name) })).toBeVisible();
  }
  await page.getByRole('menuitem', { name: /Maham Sales/ }).click();
  // Sales opens at the invoices, as they always were.
  await expect(page).toHaveURL(/#\/invoices$/);
  await expect(nav.getByRole('link', { name: 'Invoices', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('link', { name: 'Quotes', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Purchases' })).toHaveCount(0);

  // Items and stock in Inventory; purchases, cheques and Receivables in Books.
  await page.goto('#/inventory');
  await expect(page.getByRole('heading', { name: 'Inventory', level: 1 })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Stock count' })).toBeVisible();
  await page.goto('#/books');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Purchases' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Receivables' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Sales' })).toHaveCount(0);
  // An invoice opened from Books keeps Books' sidebar.
  await nav.getByRole('button', { name: 'Receivables' }).click();
  await nav.getByRole('link', { name: 'Invoices', exact: true }).click();
  await expect(page).toHaveURL(/#\/invoices$/);
  await expect(nav.getByRole('button', { name: 'Receivables' })).toBeVisible();

  // The home has the six apps, with what needs attention in each.
  await page.goto('#/');
  const apps = page.getByRole('main').getByRole('region', { name: 'Your apps' });
  for (const name of ['Maham Sales', 'Maham Books', 'Maham Inventory', 'Maham CRM']) {
    await expect(apps.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(
    apps.getByRole('link', { name: 'Maham Sales', exact: true }),
  ).toHaveAccessibleDescription(/overdue invoice|Nothing overdue/);

  // Search finds the new apps.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox', { name: 'Search' }).fill('maham inventory');
  await expect(palette.getByRole('option').first()).toContainText('Maham Inventory');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/inventory$/);

  // Back to the four apps: the last app was Inventory, so Books.
  await page.goto('#/settings/team');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(nav.getByRole('button', { name: 'Sales' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch app' }).click();
  await expect(page.getByRole('menuitem', { name: /Maham Sales/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Maham Books/ })).toBeVisible();
});
