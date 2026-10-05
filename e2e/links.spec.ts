import { createCompany, expect, test } from './fixtures';

test("a company's other tools are links in the sidebar that open in a new tab", async ({
  page,
}) => {
  await createCompany(page, 'Gulf Shield Security');
  await page.goto('#/settings/links');
  await expect(page.getByText('No links yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add a link' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Tasks');
  await page.getByLabel('Name in Arabic').fill('المهام');

  // Only web pages can be opened from the sidebar.
  await page.getByLabel('Web address').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByText('Enter a web address, like https://tasks.example.com.').first(),
  ).toBeVisible();
  await page.getByLabel('Web address').fill('tasks.example.com/board');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await expect(page.getByLabel('Web address')).toHaveValue('https://tasks.example.com/board');

  const links = page.getByRole('list', { name: 'Links' });
  const tasks = links.getByRole('link', { name: 'Tasks (opens in a new tab)' });
  await expect(tasks).toHaveAttribute('href', 'https://tasks.example.com/board');
  await expect(tasks).toHaveAttribute('target', '_blank');
  await expect(tasks).toHaveAttribute('rel', 'noopener noreferrer');

  // In Arabic, the Arabic name.
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(
    page.getByRole('list', { name: 'الروابط' }).getByRole('link', { name: /المهام/ }),
  ).toHaveAttribute('href', 'https://tasks.example.com/board');
});
