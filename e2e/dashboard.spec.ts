import { expect, startWithDemoData, test, chooseOption } from './fixtures';

test.beforeEach(async ({ page }) => {
  await startWithDemoData(page);
});

const OVERVIEW = [
  'Receivables',
  'Payables',
  'Cash flow',
  'Income and expense',
  'Top expenses',
  'Bank and card accounts',
  'Watchlist',
];

test('the overview lays the Books dashboard out like Zoho, with today’s cards underneath', async ({
  page,
}) => {
  await page.goto('#/books');
  const main = page.getByRole('main');
  // Until the owner switches it on, the dashboard is as before.
  await expect(main.getByRole('heading', { name: 'Who owes you' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Cash flow' })).toHaveCount(0);

  const layout = main.getByRole('group', { name: 'Dashboard layout' });
  await layout.getByRole('tab', { name: 'Overview' }).click();
  for (const name of OVERVIEW) {
    await expect(main.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  for (const name of ['Needs attention', 'Cheques due', 'Deadlines and renewals']) {
    await expect(main.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(main.getByRole('heading', { name: 'Who owes you' })).toHaveCount(0);
  await expect(main.getByRole('region', { name: 'Key figures' })).toBeVisible();

  // The demo has unpaid invoices and bills, money in the bank and expenses.
  const card = (name: string) =>
    main
      .locator('div.rounded-xl')
      .filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(card('Receivables')).toContainText('Overdue');
  await expect(card('Bank and card accounts')).toContainText(/KD\s?[\d,]+\.\d{3}/);
  await expect(card('Top expenses').getByRole('link').first()).toHaveAttribute(
    'href',
    /#\/reports\/general-ledger\?account=/,
  );

  // The period: the last 12 months, until another is chosen.
  const period = main.getByLabel('Period');
  await expect(period).toHaveValue('last-12-months');
  await expect(card('Cash flow')).toContainText('Last 12 months · KWD');
  await period.selectOption('last-year');
  await expect(card('Cash flow')).toContainText('Last financial year · KWD');
  await expect(card('Income and expense')).toContainText('accrual basis');

  // Hidden cards come back.
  await card('Top expenses').getByRole('button', { name: 'Hide Top expenses' }).click();
  await expect(main.getByRole('heading', { name: 'Top expenses' })).toHaveCount(0);
  await main.getByRole('button', { name: 'Show 1 hidden card' }).click();
  await expect(main.getByRole('heading', { name: 'Top expenses' })).toBeVisible();

  // The owner's choice is on Settings → Accounting too.
  await page.goto('#/settings/accounting');
  const overview = page.getByRole('switch', { name: 'Overview layout' });
  await expect(overview).toHaveAttribute('aria-checked', 'true');
  await overview.click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await page.goto('#/books');
  await expect(main.getByRole('heading', { name: 'Who owes you' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Watchlist' })).toHaveCount(0);
});

test('the watchlist and the period stay after a reload', async ({ page }) => {
  await page.goto('#/books');
  const main = page.getByRole('main');
  await main
    .getByRole('group', { name: 'Dashboard layout' })
    .getByRole('tab', { name: 'Overview' })
    .click();
  const watchlist = main
    .locator('div.rounded-xl')
    .filter({ has: page.getByRole('heading', { name: 'Watchlist', exact: true }) });
  await expect(watchlist).toContainText('Pick up to 8 accounts');

  const add = watchlist.getByRole('button', { name: 'Add an account to the watchlist' });
  await chooseOption(page, add, {
    placeholder: 'Search accounts…',
    query: 'Petty',
    option: '1010 Petty cash',
  });
  await chooseOption(page, add, {
    placeholder: 'Search accounts…',
    query: '6060',
    option: '6060 Rent',
  });
  const rows = watchlist.getByRole('list', { name: 'Watchlist' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Petty cash');
  await expect(rows.first()).toContainText(/Balance on/);
  await expect(rows.nth(1)).toContainText('In the period');
  await main.getByLabel('Period').selectOption('this-year');

  await page.reload();
  await expect(rows).toHaveCount(2);
  await expect(main.getByLabel('Period')).toHaveValue('this-year');

  await watchlist
    .getByRole('button', { name: /^Remove .*Petty cash.* from the watchlist$/ })
    .click();
  await expect(rows).toHaveCount(1);
  await page.reload();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Rent');
});

test('the overview reads right to left in Arabic', async ({ page }) => {
  await page.goto('#/books');
  const main = page.getByRole('main');
  await main
    .getByRole('group', { name: 'Dashboard layout' })
    .getByRole('tab', { name: 'Overview' })
    .click();
  await expect(main.getByRole('heading', { name: 'Watchlist' })).toBeVisible();

  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  for (const name of [
    'الذمم المدينة',
    'الذمم الدائنة',
    'التدفقات النقدية',
    'الإيرادات والمصروفات',
    'أعلى المصروفات',
    'الحسابات البنكية والبطاقات',
    'قائمة المتابعة',
  ]) {
    const heading = main.getByRole('heading', { name, exact: true });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS('direction', 'rtl');
  }
  await expect(main.getByLabel('الفترة')).toHaveValue('last-12-months');
  await main.getByLabel('الفترة').selectOption('last-6-months');
  await expect(main).toContainText('آخر 6 أشهر · KWD');
  await expect(main).toContainText(/د\.ك/);
  // The charts keep the months in order; the table lists them in Arabic.
  const cashFlow = main
    .locator('div.rounded-xl')
    .filter({ has: page.getByRole('heading', { name: 'التدفقات النقدية', exact: true }) });
  await cashFlow.getByRole('button', { name: 'عرض الجدول' }).click();
  await expect(cashFlow.getByRole('columnheader', { name: 'الشهر', exact: true })).toBeVisible();
  await expect(cashFlow.getByRole('row')).toHaveCount(7);

  // On a phone nothing is wider than the screen.
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(main.getByRole('heading', { name: 'قائمة المتابعة' })).toBeVisible();
  await page.waitForTimeout(250);
  const { scroll, inner } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
});
