import { expect, startWithDemoData, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await startWithDemoData(page);
});

test('Ctrl+K finds a customer by name and opens it', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox', { name: 'Search' }).fill('sadu');
  // The customer comes before their documents.
  await expect(palette.getByRole('option').first()).toContainText('Sadu Interiors Co.');
  await expect(palette.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/#\/clients\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sadu Interiors Co.');

  // It is remembered as a recent item, and "/" opens the palette too.
  await page.keyboard.press('/');
  await expect(palette.getByRole('option').first()).toContainText('Sadu Interiors Co.');
  // Arabic names are found too, whichever way hamza and ta marbuta are typed.
  await palette.getByRole('combobox').fill('السدو');
  await expect(palette.getByRole('option').first()).toContainText('Sadu Interiors Co.');
  await palette.getByRole('combobox').fill('لولوه الخليج');
  await expect(palette.getByRole('option').first()).toContainText('Gulf Pearl Hotel');
  await palette.getByRole('combobox').fill('new bill');
  await expect(palette.getByRole('option').first()).toContainText('New bill');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/bills\/new$/);
});

test('the sidebar groups remember being opened and closed', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Main' });
  const accounting = nav.getByRole('button', { name: 'Accounting' });
  await expect(accounting).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByRole('link', { name: 'Chart of accounts' })).toBeHidden();
  await accounting.click();
  await expect(accounting).toHaveAttribute('aria-expanded', 'true');
  await nav.getByRole('link', { name: 'Chart of accounts' }).click();
  await expect(page).toHaveURL(/#\/accounts$/);
  await expect(nav.getByRole('link', { name: 'Chart of accounts' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.reload();
  await expect(nav.getByRole('button', { name: 'Accounting' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  // Settings stays in view at the bottom of the sidebar.
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeInViewport();
});

test('phones get a tab bar, a New sheet and a menu drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bar = page.getByRole('navigation', { name: 'Shortcuts' });
  await expect(bar).toBeVisible();
  await bar.getByRole('link', { name: 'Invoices' }).click();
  await expect(page).toHaveURL(/#\/invoices$/);
  await expect(bar.getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page');

  // More opens the full menu; its close button is inside the drawer.
  await bar.getByRole('button', { name: 'More' }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Purchases' }).click();
  await drawer.getByRole('link', { name: 'Expenses' }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/#\/expenses$/);

  // The + button lists everything that can be created.
  await bar.getByRole('button', { name: 'Create new' }).click();
  const sheet = page.getByRole('dialog', { name: 'Create new' });
  await sheet.getByRole('button', { name: 'Invoice', exact: true }).click();
  await expect(page).toHaveURL(/#\/invoices\/new$/);

  // Editors keep Save in reach at the bottom; the tab bar makes way.
  await expect(bar).toBeHidden();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeInViewport();
});

test('the Arabic interface puts the navigation on the right', async ({ page }) => {
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const nav = page.getByRole('navigation', { name: 'الرئيسية' });
  await expect(nav.getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('aria-current', 'page');
  const box = await nav.boundingBox();
  const width = page.viewportSize()!.width;
  expect(box!.x).toBeGreaterThan(width / 2);

  const sales = nav.getByRole('button', { name: 'المبيعات' });
  await expect(sales).toHaveAttribute('aria-expanded', 'true');
  await nav.getByRole('link', { name: 'الفواتير', exact: true }).click();
  await expect(page).toHaveURL(/#\/invoices$/);

  // Search works in Arabic too.
  await page.getByRole('button', { name: 'بحث' }).first().click();
  const palette = page.getByRole('dialog', { name: 'بحث' });
  await palette.getByRole('combobox').fill('الفواتير');
  await expect(palette.getByRole('option').first()).toContainText('الفواتير');
});

const PHONE_ROUTES = [
  '#/',
  '#/books',
  '#/people',
  '#/people/directory',
  '#/crm',
  '#/crm/prospects',
  '#/invoices',
  '#/invoices/new',
  '#/quotes',
  '#/proformas',
  '#/sales-orders',
  '#/delivery-notes',
  '#/credits',
  '#/recurring',
  '#/payments',
  '#/payments/new',
  '#/cheques',
  '#/clients',
  '#/vendors',
  '#/purchase-orders',
  '#/bills',
  '#/bills/new',
  '#/expenses',
  '#/payments-made',
  '#/vendor-credits',
  '#/products',
  '#/inventory',
  '#/employees',
  '#/payroll',
  '#/banking',
  '#/accounts',
  '#/journals',
  '#/assets',
  '#/year-end',
  '#/reports',
  '#/compliance',
  '#/templates',
  '#/settings/company',
];

test('no page is wider than a phone', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const wide: string[] = [];
  for (const route of PHONE_ROUTES) {
    await page.goto(route);
    await expect(page.locator('main h1').first(), route).toBeVisible();
    await page.waitForTimeout(250);
    const { scroll, inner } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    if (scroll > inner + 1) wide.push(`${route}: ${scroll}px`);
  }
  expect(wide).toEqual([]);
});
