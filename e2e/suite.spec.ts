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
  await expect(nav.getByRole('link', { name: 'Leave' })).toHaveAttribute('aria-current', 'page');
  await page.goto('#/invoices');
  await expect(nav.getByRole('button', { name: 'Sales' })).toBeVisible();
  await page.goto('#/books');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
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
