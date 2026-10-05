import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * What the company typed (names of people, companies, things, and the
 * descriptions of its own entries): it may be in English, it is not the
 * interface's wording.
 */
async function typedText(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AlmailBooks');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = (store: string) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = database.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
        request.onerror = () => reject(request.error);
      });
    const fields: Record<string, string[]> = {
      companies: ['name', 'legalName'],
      clients: ['name'],
      employees: ['name'],
      products: ['name'],
      assets: ['name', 'description', 'location'],
      warehouses: ['name', 'address'],
      recurring: ['name'],
      expenses: ['description'],
      journals: ['reference'],
      complianceDocuments: ['title', 'issuer', 'ownerName'],
    };
    const typed: string[] = [];
    for (const [store, keys] of Object.entries(fields)) {
      for (const row of await read(store)) {
        for (const key of keys) if (typeof row[key] === 'string') typed.push(row[key]);
        for (const person of (row.contacts as { name?: string }[] | undefined) ?? []) {
          if (person.name) typed.push(person.name);
        }
      }
    }
    database.close();
    // Longest first, so a name is removed before a shorter one inside it.
    return [...new Set(typed.filter((t) => t.trim()))].sort((a, b) => b.length - a.length);
  });
}

/**
 * Headings, buttons, labels and navigation links that still have English
 * words in them. Codes and abbreviations (INV-2026-0001, KWD, PDF, KNET),
 * numbers, what the company typed, brand names, keyboard shortcuts ("Ctrl
 * K") and the name of the other language ("English") are fine. Charts and
 * notifications are left out.
 */
async function englishInInterface(page: Page, typed: string[]): Promise<string[]> {
  return page.evaluate((typed) => {
    const areas = 'main, header, nav, aside, [role="navigation"]';
    const selector =
      'h1, h2, h3, h4, [role="heading"], button, [role="button"], [role="tab"], label, nav a';
    const skipped = 'svg, kbd, [lang^="en"], [data-sonner-toaster], [role="img"]';
    const allowed = ['English', 'Ctrl', 'WhatsApp', 'MyFatoorah', 'Tabby', 'Taly', 'Deema'];
    const found: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (!element.closest(areas) || element.closest(skipped)) continue;
      if (!element.checkVisibility()) continue;
      const copy = element.cloneNode(true) as HTMLElement;
      for (const inner of copy.querySelectorAll(skipped)) inner.remove();
      const text = `${copy.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`
        .replace(/\s+/g, ' ')
        .trim();
      let words = text;
      for (const value of [...typed, ...allowed]) words = words.split(value).join(' ');
      // Codes and abbreviations: INV-2026-0001, PAY-0060, KWD, PIFSS, 18/62417…
      words = words.replace(/\b[A-Z][A-Z0-9]*(?:[-/.][A-Z0-9]+)*\b/g, ' ');
      if (/[A-Za-z]{2,}/.test(words)) found.push(text);
    }
    return found;
  }, typed);
}

/** The page reads right to left, with nothing left in English. */
async function expectArabic(page: Page, heading: string | RegExp, typed: string[]) {
  const title = page.getByRole('main').getByRole('heading', { level: 1, name: heading });
  await expect(title).toBeVisible();
  await expect(title).toHaveCSS('direction', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(await englishInInterface(page, typed), `English on ${page.url()}`).toEqual([]);
}

test('the demo reads right to left in Arabic', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', /^ar/);
  await expect(
    page.getByText('شركة تجارية كويتية مع سنة كاملة من الفواتير والشيكات والرواتب.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'التجربة ببيانات تجريبية' }).click();
  await expect(
    page.getByText('تم إنشاء الشركة التجريبية. يمكنك حذفها لاحقاً من الإعدادات.'),
  ).toBeVisible({ timeout: 60_000 });
  const typed = await typedText(page);
  expect(typed).toContain('Rawdat Al Khaleej General Trading & Contracting');

  // The dashboard: right to left, with amounts in dinars. Until its title is
  // in Arabic (it is rebuilt and translated separately), what it still has
  // in English is only noted.
  await page.goto('#/');
  const dashboard = page.getByRole('main').getByRole('heading', { level: 1 });
  await expect(dashboard).toBeVisible();
  await expect(dashboard).toHaveCSS('direction', 'rtl');
  await expect(page.getByRole('main')).toContainText(/د\.ك/);
  const english = await englishInInterface(page, typed);
  if (/[؀-ۿ]/.test(await dashboard.innerText())) {
    expect(english, 'English on the dashboard').toEqual([]);
  } else {
    test.info().annotations.push({
      type: 'fixme',
      description: `The dashboard is not translated yet: ${english.join(' | ')}`,
    });
  }

  // Invoices: Arabic names of the clients, balances in dinars.
  await page.goto('#/invoices');
  await expect(page.getByRole('link', { name: /^INV-/ }).first()).toBeVisible();
  await expect(page.getByRole('main')).toContainText('فندق لؤلؤة الخليج – السالمية');
  await expect(page.getByRole('main')).toContainText(/\d{1,3}(,\d{3})*\.\d{3}.{0,3}د\.ك/);
  await expectArabic(page, 'الفواتير', typed);

  // An invoice and its PDF preview.
  await page.getByLabel('البحث في الفواتير').fill('وزارة التربية');
  await page.getByRole('link', { name: /^INV-/ }).first().click();
  await expect(page).toHaveURL(/#\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await expectArabic(page, /^فاتورة INV-\d{4}-\d{4}$/, typed);

  // Cheques: the post-dated cheques in hand.
  await page.goto('#/cheques');
  await expect(page.getByRole('row', { name: /004418/ })).toBeVisible();
  await expectArabic(page, 'الشيكات', typed);

  // Payroll: a year of pay runs.
  await page.goto('#/payroll');
  await expect(page.getByRole('row').filter({ hasText: 'د.ك' }).first()).toBeVisible();
  await expectArabic(page, 'الرواتب', typed);
});
