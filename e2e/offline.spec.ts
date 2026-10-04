import { expect, test } from './fixtures';

test.use({ serviceWorkers: 'allow' });

test('keeps working without a connection once loaded', async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  await expect(page.getByText('AlmailBooks now works offline')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  // The demo, with its logo and stamp, comes from the cache too.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome to AlmailBooks' })).toBeVisible();
  await page.getByRole('button', { name: 'Explore with demo data' }).click();
  await expect(
    page.getByText('Demo company created. You can delete it later in Settings.'),
  ).toBeVisible({ timeout: 60_000 });

  // Lazily loaded pages, the PDF engine and its fonts all come from the cache.
  await page.goto('#/invoices');
  await page.getByRole('link', { name: /^INV-/ }).first().click();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await context.setOffline(false);
});
