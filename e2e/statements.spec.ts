import { downloadFrom, expect, test } from './fixtures';

test('a 5% retention is held, a partial payment shows on the statement, then the retention is released', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByLabel('Company name').fill('Al Mail Contracting');
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // A ministry that keeps the 5% tax retention until the clearance certificate.
  await page.goto('#/clients/new');
  await page.getByLabel('Client name').fill('Ministry of Public Works');
  await page.getByRole('switch', { name: 'This client holds back a retention' }).click();
  await expect(page.getByLabel('Retention (%)')).toHaveValue('5');
  await expect(page.getByLabel('Held until', { exact: true })).toHaveValue('tax');
  await page.getByRole('switch', { name: 'Set a credit limit' }).click();
  await page.getByLabel('Credit limit', { exact: true }).fill('5000');
  await page.getByRole('button', { name: 'Save client' }).first().click();
  await expect(page).toHaveURL(/#\/clients\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ministry of Public Works');
  await expect(page.getByText('5% retention')).toBeVisible();

  // The invoice holds back 5% of 1,234.567: 61.728, so 1,172.839 is due.
  await page.getByRole('link', { name: 'New invoice' }).first().click();
  await expect(page.getByRole('heading', { name: 'New invoice' })).toBeVisible();
  await page.getByLabel('Item 1 name').fill('Maintenance works – phase 1');
  await page.getByLabel('Item 1 quantity').fill('1');
  await page.getByLabel('Item 1 unit price').fill('1234.567');
  await expect(page.getByLabel('Retention (%)')).toHaveValue('5');
  await expect(page.getByText('Retention held', { exact: true })).toBeVisible();
  await expect(page.getByText('-KD 61.728').first()).toBeVisible();
  await expect(page.getByText('KD 1,172.839').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/invoices\/[0-9a-f-]{36}$/);
  const heading = page.getByRole('heading', { level: 1 });
  // The editor's heading stays until the saved invoice's page renders.
  await expect(heading).toHaveText(/^Invoice INV-/);
  const number = (await heading.textContent())!.replace(/^Invoice /, '').trim();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark as sent' }).click();
  await expect(heading.locator('..').getByText('Sent', { exact: true })).toBeVisible();

  // The customer pays 500.000 of the 1,172.839 due.
  await page.getByRole('button', { name: 'Record payment' }).click();
  const payment = page.getByRole('dialog', { name: 'Record payment' });
  const amount = payment.getByLabel('Amount (KWD)');
  await expect(amount).toHaveValue('1172.839');
  await amount.fill('500');
  await payment.getByRole('button', { name: 'Record payment' }).click();
  await expect(payment).toBeHidden();
  await expect(heading.locator('..').getByText('Partially paid', { exact: true })).toBeVisible();

  // The statement runs the balance: invoice, retention held, payment.
  await page.goto('#/clients');
  await page.getByRole('link', { name: 'Ministry of Public Works' }).click();
  await expect(page.getByTestId('contact-balance')).toHaveText('KD 672.839');
  await page.getByRole('tab', { name: 'Statement' }).click();
  const table = page.getByRole('table', { name: 'Statement of account' });
  const rows = table.locator('tbody tr');
  await expect(rows.nth(0)).toContainText('Balance brought forward');
  await expect(rows.nth(1)).toContainText(`Invoice ${number}`);
  await expect(rows.nth(1)).toContainText('KD 1,234.567');
  await expect(rows.nth(2)).toContainText(`Retention held (5%) ${number}`);
  await expect(rows.nth(2)).toContainText('KD 61.728');
  await expect(rows.nth(2)).toContainText('KD 1,172.839');
  await expect(rows.nth(3)).toContainText('Payment received');
  await expect(rows.nth(3)).toContainText('KD 500.000');
  await expect(rows.nth(3)).toContainText('KD 672.839');
  await expect(page.getByTestId('statement-balance')).toHaveText('KD 672.839');
  await expect(page.getByText('Retention held, not yet due')).toBeVisible();

  // The bilingual PDF downloads.
  const { file, content } = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  expect(file.suggestedFilename()).toMatch(/^Statement .*\.pdf$/);
  expect(content.subarray(0, 5).toString('latin1')).toBe('%PDF-');

  // The clearance certificate arrives: the retention is released and due again.
  await page.getByRole('tab', { name: 'Retentions' }).click();
  await page.getByRole('button', { name: 'Release', exact: true }).click();
  const release = page.getByRole('dialog', { name: `Release retention on ${number}` });
  await expect(release.getByLabel('Amount')).toHaveValue('61.728');
  await release.getByLabel('Certificate number').fill('TC-2026-0042');
  await release.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(release).toBeHidden();
  await expect(page.getByText('Nothing is held back')).toBeVisible();
  await expect(page.getByText('Certificate TC-2026-0042')).toBeVisible();

  await page.getByRole('tab', { name: 'Statement' }).click();
  await expect(rows.nth(4)).toContainText(`Retention released ${number}`);
  await expect(rows.nth(4)).toContainText('KD 61.728');
  await expect(page.getByTestId('statement-balance')).toHaveText('KD 734.567');
  await expect(page.getByTestId('contact-balance')).toHaveText('KD 734.567');

  // The invoice asks for the rest, retention included.
  await page.getByRole('link', { name: `Invoice ${number}` }).click();
  await expect(page.getByText('KD 734.567').first()).toBeVisible();
});
