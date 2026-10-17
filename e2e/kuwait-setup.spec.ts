import { expect, test } from './fixtures';

// A 1×1 transparent PNG, as a company stamp.
const STAMP = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('a Kuwaiti business sets up in Arabic and brings in its open invoices', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Welcome to Maham One' })).toBeVisible();

  // The welcome page switches to Arabic, right to left.
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'أهلاً بك في مهام ون' })).toBeVisible();
  await expect(page.getByText('الدينار الكويتي بالفلس')).toBeVisible();
  await expect(page.getByText('بدون ضريبة قيمة مضافة', { exact: true })).toBeVisible();

  await page.getByLabel('اسم الشركة').fill('Al Mail Trading');
  await page.getByLabel('الاسم بالعربية').fill('شركة الميل للتجارة');
  await page.getByRole('button', { name: /تفاصيل إضافية/ }).click();
  const phone = page.getByLabel('الهاتف');
  await phone.fill('22223333');
  await phone.blur();
  await expect(phone).toHaveValue('+965 2222 3333');
  await page.getByRole('button', { name: 'إنشاء الشركة' }).click();

  // Ready under its Arabic name, with the Kuwaiti chart of accounts and no VAT returns.
  await expect(page.getByText('شركة الميل للتجارة جاهزة.')).toBeVisible();
  const menu = page.getByRole('navigation', { name: 'الرئيسية' });
  // Accounting is a group in the menu; it opens to show its pages.
  await menu.getByRole('button', { name: 'المحاسبة' }).click();
  await expect(menu.getByRole('link', { name: 'دليل الحسابات' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'إقرارات ضريبة القيمة المضافة' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'تبديل الشركة' })).toContainText(
    'شركة الميل للتجارة',
  );
  await expect(page.getByRole('main')).toContainText(/0\.000.{0,3}د\.ك/);
  await page.goto('./#/accounts');
  await expect(page.getByRole('heading', { name: 'دليل الحسابات', level: 1 })).toBeVisible();
  await expect(page.getByText('حصة صاحب العمل في التأمينات الاجتماعية').first()).toBeVisible();
  await page.goto('./#/vat');
  await expect(page.getByText('إقرارات ضريبة القيمة المضافة متوقفة')).toBeVisible();

  // Open invoices from the old system, with Arabic column names.
  await page.goto('./#/settings/import');
  await page.getByRole('radio', { name: /الفواتير المفتوحة/ }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'open-invoices.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      '﻿رقم الفاتورة,العميل,التاريخ,تاريخ الاستحقاق,المبلغ المستحق\n' +
        'INV-1001,شركة النور للتجارة,15/08/2026,14/09/2026,"1,250.750"\n' +
        'INV-1002,شركة النور للتجارة,02/09/2026,,480\n',
    ),
  });
  await expect(page.getByText('فاتورتان جاهزتان')).toBeVisible();
  await expect(page.getByText('ستتم إضافة العميل الجديد شركة النور للتجارة.')).toBeVisible();
  await page.getByRole('button', { name: 'استيراد فاتورتين' }).click();
  await expect(page.getByText('تم استيراد فاتورتين').first()).toBeVisible();

  // The invoices list shows the balances in dinars.
  await page.goto('./#/invoices');
  await expect(page.getByText('INV-1001').first()).toBeVisible();
  await expect(page.getByRole('main')).toContainText(/1,250\.750.{0,3}د\.ك/);
  await expect(page.getByRole('main')).toContainText(/1,730\.750.{0,3}د\.ك/);

  // Company settings: IBAN checked as typed, stamp saved, everything kept after a reload.
  await page.goto('./#/settings/company');
  await expect(page.getByLabel('الاسم بالعربية')).toHaveValue('شركة الميل للتجارة');
  const iban = page.getByLabel('رقم الآيبان (IBAN)');
  await iban.fill('KW82 CBKU 0000 0000 0000 1234 5601 01');
  await expect(page.getByText('رقم الآيبان غير صحيح. تحقق من وجود خطأ في الكتابة.')).toBeVisible();
  await iban.fill('KW81CBKU0000000000001234560101');
  await expect(page.getByText('رقم آيبان صحيح')).toBeVisible();
  await page.getByLabel('رقم الرخصة التجارية').fill('2026/12345');
  await page.locator('#branding input[type=file]').nth(1).setInputFiles({
    name: 'stamp.png',
    mimeType: 'image/png',
    buffer: STAMP,
  });
  await expect(page.locator('#branding img[alt="ختم الشركة"]')).toBeVisible();
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
  await expect(page.getByText('تم حفظ الإعدادات')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('رقم الآيبان (IBAN)')).toHaveValue(
    'KW81 CBKU 0000 0000 0000 1234 5601 01',
  );
  await expect(page.getByLabel('رقم الرخصة التجارية')).toHaveValue('2026/12345');
  await expect(page.locator('#branding img[alt="ختم الشركة"]')).toBeVisible();
  await expect(page.locator('#payment')).toContainText(
    'IBAN: KW81 CBKU 0000 0000 0000 1234 5601 01',
  );
});

test.describe('at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the welcome page and company settings fit without sideways scrolling', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'العربية' }).click();
    await page.getByRole('button', { name: /تفاصيل إضافية/ }).click();
    const fits = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);
    await page.getByLabel('اسم الشركة').fill('Al Mail Trading');
    await page.getByRole('button', { name: 'إنشاء الشركة' }).click();
    await expect(page.getByText('Al Mail Trading جاهزة.')).toBeVisible();
    for (const section of ['company', 'taxes', 'payments', 'import', 'numbering']) {
      await page.goto(`./#/settings/${section}`);
      await expect(page.getByRole('heading', { name: 'الإعدادات', level: 1 })).toBeVisible();
      expect(await fits(), section).toBe(true);
    }
  });
});
