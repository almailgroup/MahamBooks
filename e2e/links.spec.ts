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

test('Deema, Taly and Tahseel show under Integrations in the apps chosen for them', async ({
  page,
}) => {
  await createCompany(page, 'Coral Bay Trading');
  await page.goto('#/settings/links');
  const card = (number: number) => page.getByRole('listitem', { name: `Link ${number}` });

  // The names are filled in; the owner pastes the address of each portal.
  for (const name of ['Deema', 'Taly', 'Tahseel']) {
    await page.getByRole('button', { name: `Add ${name}` }).click();
    await expect(page.getByRole('button', { name: `Add ${name}` })).toHaveCount(0);
  }
  await expect(card(1).getByLabel('Name', { exact: true })).toHaveValue('Deema');
  await expect(card(1).getByLabel('Name in Arabic')).toHaveValue('ديما');
  await expect(card(1).getByText('Paste the address of your Deema portal.')).toBeVisible();
  await expect(card(1).getByLabel('Show under')).toHaveValue('integrations');
  await expect(card(1).getByLabel('Maham Books')).toBeChecked();
  await expect(card(1).getByLabel('Maham CRM')).toBeChecked();
  await expect(card(1).getByLabel('Maham People')).not.toBeChecked();

  await card(1).getByLabel('Web address').fill('merchant.example.com/deema');
  // Keys don't belong in a link: everyone in the company gets it.
  await card(2).getByLabel('Web address').fill('https://merchant.example.com/taly?token=abc');
  await expect(card(2).getByText(/seems to hold a key or token/)).toBeVisible();
  await card(2).getByLabel('Web address').fill('https://merchant.example.com/taly');
  await expect(card(2).getByText(/seems to hold a key or token/)).toHaveCount(0);
  await card(3).getByLabel('Web address').fill('https://collect.example.com');
  // Tahseel in Books only; a link must show in at least one app.
  await card(3).getByLabel('Maham CRM').uncheck();
  await card(3).getByLabel('Maham Books').uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Choose at least one app for the link.').first()).toBeVisible();
  await card(3).getByLabel('Maham Books').check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Main' });
  const integrations = nav.getByRole('list', { name: 'Integrations' });
  const opens = (name: string) =>
    integrations.getByRole('link', { name: `${name} (opens in a new tab)` });

  await page.goto('#/books');
  await expect(opens('Deema')).toHaveAttribute('href', 'https://merchant.example.com/deema');
  await expect(opens('Deema')).toHaveAttribute('target', '_blank');
  await expect(opens('Deema')).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(opens('Taly')).toBeVisible();
  await expect(opens('Tahseel')).toHaveAttribute('href', 'https://collect.example.com/');
  // Not in the list of other links.
  await expect(nav.getByRole('list', { name: 'Links' })).toHaveCount(0);
  // A collapsible group, open until closed.
  await nav.getByRole('button', { name: 'Integrations' }).click();
  await expect(opens('Deema')).toBeHidden();
  await nav.getByRole('button', { name: 'Integrations' }).click();
  await expect(opens('Deema')).toBeVisible();

  await page.goto('#/crm');
  await expect(opens('Deema')).toBeVisible();
  await expect(opens('Taly')).toBeVisible();
  await expect(opens('Tahseel')).toHaveCount(0);

  await page.goto('#/people');
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Integrations' })).toHaveCount(0);

  // On the home, as round tiles that open in a new tab.
  await page.goto('#/');
  const tiles = page.getByRole('main').getByRole('region', { name: 'Integrations' });
  await expect(tiles.getByRole('link')).toHaveCount(3);
  await expect(tiles.getByRole('link', { name: /Deema/ })).toHaveAttribute('target', '_blank');

  // In Arabic, ديما and تالي; Tahseel keeps its brand name.
  await page.goto('#/settings/links');
  await page.getByRole('button', { name: 'العربية' }).click();
  await page.goto('#/books');
  const arabic = page.getByRole('list', { name: 'التكاملات' });
  await expect(arabic.getByRole('link', { name: /ديما/ })).toBeVisible();
  await expect(arabic.getByRole('link', { name: /تالي/ })).toBeVisible();
  await expect(arabic.getByRole('link', { name: /Tahseel/ })).toBeVisible();
});
