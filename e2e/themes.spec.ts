import type { Page } from '@playwright/test';
import { createCompany, expect, test } from './fixtures';

/** How light an element's background looks: WCAG relative luminance, 0 (black) to 1 (white). */
async function lightness(page: Page, selector = 'body'): Promise<number> {
  return page.evaluate((selector) => {
    const color = getComputedStyle(document.querySelector(selector)!).backgroundColor;
    // The canvas turns any CSS colour (oklch too) into sRGB.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data].map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }, selector);
}

test('a dark theme chosen in Settings applies at once, stays after a reload and never prints', async ({
  page,
}) => {
  await createCompany(page, 'Gulf Lights Trading Co.');
  expect(await lightness(page)).toBeGreaterThan(0.85);

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('link', { name: 'Appearance' })
    .click();
  await expect(page).toHaveURL(/#\/settings\/appearance$/);
  const dark = page.getByRole('radiogroup', { name: 'Dark themes' });
  await expect(page.getByRole('radio', { name: 'Classic' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await dark.getByRole('radio', { name: 'Midnight' }).click();
  await expect(dark.getByRole('radio', { name: 'Midnight' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('radio', { name: 'Classic' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
  expect(await lightness(page)).toBeLessThan(0.03);
  // Cards and the text on them turn dark and light too.
  const card = page.getByRole('main').locator('.bg-surface').first();
  await expect(card).toBeVisible();
  expect(await lightness(page, 'main .bg-surface')).toBeLessThan(0.05);
  await expect(page.getByRole('heading', { name: 'Appearance' })).toHaveCSS(
    'color',
    /oklch\(0\.9|rgb\(2[45]\d/,
  );

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
  await expect(page.getByRole('radio', { name: 'Midnight' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(await lightness(page)).toBeLessThan(0.03);

  // Printing always uses the light look.
  await page.emulateMedia({ media: 'print' });
  expect(await lightness(page)).toBeGreaterThan(0.85);
  await page.emulateMedia({ media: 'screen' });
  expect(await lightness(page)).toBeLessThan(0.03);
});

test('the header switch and the command palette change the theme', async ({ page }) => {
  await createCompany(page, 'Sand Dunes Contracting Co.');
  await page.getByRole('banner').getByRole('button', { name: 'Theme' }).click();
  const menu = page.getByRole('dialog', { name: 'Theme' });
  await expect(menu.getByRole('radio')).toHaveCount(20);
  await expect(menu.getByRole('radio', { name: 'Classic' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await menu.getByRole('radio', { name: 'Desert sand' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sand');
  await expect(menu.getByRole('radio', { name: 'Desert sand' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // Arrow keys move along the row and choose as they go.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sunset');
  await expect(menu.getByRole('radio', { name: 'Sunset' })).toBeFocused();
  await menu.getByRole('radio', { name: 'Black (high contrast)' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'black');
  expect(await lightness(page)).toBeLessThan(0.01);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // The command palette goes back to the light theme chosen before, and to dark again.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await palette.getByRole('combobox', { name: 'Search' }).fill('light theme');
  await expect(palette.getByRole('option').first()).toContainText('Switch to light theme');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sunset');
  await page.keyboard.press('Control+k');
  await palette.getByRole('combobox', { name: 'Search' }).fill('dark theme');
  await expect(palette.getByRole('option').first()).toContainText('Switch to dark theme');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'black');
  // "Change theme" opens Settings → Appearance.
  await page.keyboard.press('Control+k');
  await palette.getByRole('combobox', { name: 'Search' }).fill('change theme');
  await expect(palette.getByRole('option').first()).toContainText('Change theme');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/settings\/appearance$/);
});

test('Match my device follows the device between light and dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await createCompany(page, 'Lagoon View Real Estate Co.');
  await page.goto('#/settings/appearance');
  await page.getByRole('switch', { name: 'Match my device' }).click();
  await expect(page.getByRole('switch', { name: 'Match my device' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // One choice per group: Classic for light, Midnight for dark.
  await expect(page.getByRole('radio', { name: 'Classic' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('radio', { name: 'Midnight' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // Choosing a dark theme keeps following the device, which is light.
  await page.getByRole('radio', { name: 'Lagoon' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'lagoon');
  expect(await lightness(page)).toBeLessThan(0.03);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'lagoon');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
});

test('themes work in Arabic, right to left', async ({ page }) => {
  await createCompany(page, 'Desert Rose Trading Co.');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto('#/settings/appearance');
  await expect(page.getByRole('heading', { name: 'المظهر' })).toBeVisible();
  const dark = page.getByRole('radiogroup', { name: 'السمات الداكنة' });
  await dark.getByRole('radio', { name: 'ليل الصحراء' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'desert-night');
  // Left is forward when reading right to left.
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ember');
  await expect(dark.getByRole('radio', { name: 'الجمر' })).toHaveAttribute('aria-checked', 'true');
  expect(await lightness(page)).toBeLessThan(0.03);
  await page.getByRole('banner').getByRole('button', { name: 'السمة' }).click();
  const menu = page.getByRole('dialog', { name: 'السمة' });
  await menu.getByRole('radio', { name: 'وردي', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'rose');
  expect(await lightness(page)).toBeGreaterThan(0.85);
});

test('the saved theme is painted before the app loads', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('almailbooks.theme', 'black'));
  // Hold the app back: what shows is index.html on its own.
  await page.route(/\/assets\/index-[\w-]+\.js$/, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'black');
  expect(await lightness(page, 'html')).toBeLessThan(0.01);
  expect(await lightness(page)).toBeLessThan(0.01);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#000000');
  await page.unroute(/\/assets\/index-[\w-]+\.js$/);

  // A bad value shows Classic.
  await page.evaluate(() => localStorage.setItem('almailbooks.theme', '{"mode":"dark"'));
  await page.reload();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'black');
  expect(await lightness(page)).toBeGreaterThan(0.85);
});
