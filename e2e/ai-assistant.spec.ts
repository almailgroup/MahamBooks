import type { Page, Route } from '@playwright/test';
import { createCompany, expect, test } from './fixtures';
import { FakeSupabase } from './cloud-fake';

/**
 * The AI assistant (first version): the owner turns it on in Settings → AI
 * assistant, then anyone signed in asks on any page and the answer streams
 * in. The AI service is a stand-in for the Worker (the sandbox can't reach
 * it): it answers with Gemini's Server-Sent Events and keeps what it was
 * sent, so the test can check no record went with the question. Made-up
 * company, person and numbers only.
 */

const AI_URL = 'https://maham-ai-proxy.steep-band-c624.workers.dev';

/** As the Worker answers a preflight (workers/ai-proxy, ALLOWED_REQUEST_HEADERS). */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'Authorization, Content-Type, X-Maham-Company, X-Maham-Feature, X-Maham-Shares',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-expose-headers': 'Retry-After',
};

const OWNER = { email: 'owner@example.com', password: 'safe-password-1', name: 'Mariam Test' };

/** An invented employee, shown on the page the question is asked from. */
const EMPLOYEE = {
  name: 'Imaginary Guard Person',
  nameAr: 'حارس تجريبي',
  civilId: '290010112345',
  iban: 'KW81CBKU0000000000001234560101',
  salary: '1234.567',
};

interface AiCall {
  body: string;
  authorization: string | undefined;
}

/** The stand-in AI service: /health, and /v1/stream answering in pieces. */
async function fakeAiService(
  page: Page,
  /** With `hold` set, an answer is still being written: nothing is sent back. */
  service: { hold: boolean } = { hold: false },
): Promise<AiCall[]> {
  const calls: AiCall[] = [];
  await page.route(`${AI_URL}/**`, async (route: Route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    if (pathname === '/health') {
      await route.fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true, model: 'gemini-e2e' }),
      });
      return;
    }
    if (pathname === '/v1/stream') {
      const body = request.postData() ?? '';
      calls.push({ body, authorization: request.headers().authorization });
      if (service.hold) return;
      const question = (
        JSON.parse(body) as { contents: { parts: { text: string }[] }[] }
      ).contents.at(-1)!.parts[0].text;
      const pieces = /[؀-ۿ]/.test(question)
        ? ['افتح ', '**الرواتب**', ' ثم الإجازات.']
        : ['To record ', '**sick leave**, open ', 'Maham People → Leave.'];
      const events = pieces.map(
        (text) =>
          `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] })}\r\n\r\n`,
      );
      events.push(
        `data: ${JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 20, totalTokenCount: 720 },
        })}\r\n\r\n`,
      );
      await route.fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'text/event-stream; charset=utf-8' },
        body: events.join(''),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ error: { code: 'not_found', message: 'Not found.', status: 404 } }),
    });
  });
  return calls;
}

async function signIn(page: Page, who: typeof OWNER) {
  await page.goto('#/signin');
  await page.getByLabel('Email', { exact: true }).fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  return page.getByRole('button', { name: `Account: ${who.name}` });
}

/** Adds the invented employee; returns the address of their page. */
async function addEmployee(page: Page): Promise<string> {
  await page.goto('#/employees/new');
  await page.getByLabel('Name (English)').fill(EMPLOYEE.name);
  await page.getByLabel('Name (Arabic)').fill(EMPLOYEE.nameAr);
  await page.getByLabel('Civil ID number').fill(EMPLOYEE.civilId);
  await page.getByLabel('Basic salary').fill(EMPLOYEE.salary);
  await page.getByLabel('IBAN').fill(EMPLOYEE.iban);
  await page.getByRole('button', { name: 'Save employee' }).first().click();
  await expect(page).toHaveURL(/#\/employees\/[0-9a-f-]{36}$/);
  return `#/${page.url().split('#/')[1]}`;
}

test('the owner turns the assistant on; a question on an employee’s page is answered without the employee', async ({
  page,
}) => {
  test.slow();
  const cloud = new FakeSupabase();
  await cloud.install(page);
  const calls = await fakeAiService(page);
  cloud.addUser(OWNER.email, OWNER.password, OWNER.name);
  await createCompany(page, 'Made-up Guarding Co');
  const employeePage = await addEmployee(page);

  // Kept on this device: no button, and Settings says why.
  await expect(page.getByRole('button', { name: 'Ask AI' })).toHaveCount(0);
  await page.goto('#/settings/ai');
  await expect(page.getByText(/The AI assistant needs a company kept in the cloud/)).toBeVisible();
  await expect(page.getByRole('switch', { name: /Use the AI assistant/ })).toHaveCount(0);

  // Into the cloud: still off until the owner turns it on.
  const account = await signIn(page, OWNER);
  await page.getByRole('button', { name: 'Keep in the cloud' }).click();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  const companyId = [...cloud.companies.keys()][0];
  await page.goto(employeePage);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EMPLOYEE.name);
  await expect(page.getByRole('button', { name: 'Ask AI' })).toHaveCount(0);

  await page.goto('#/settings/ai');
  const toggle = page.getByRole('switch', { name: /Use the AI assistant/ });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText(/Only what you type in the chat/)).toBeVisible();
  await page.getByRole('button', { name: 'Test the connection' }).click();
  await expect(page.getByText('Connected. The AI service answers with gemini-e2e.')).toBeVisible();
  await toggle.click();
  await expect(page.getByText('AI assistant turned on')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  expect(cloud.rows(companyId, 'companies')[0].data?.ai).toEqual({ on: true });

  // On the employee's page, with their Civil ID, IBAN and salary on screen.
  await page.goto(employeePage);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EMPLOYEE.name);
  await page.getByRole('button', { name: 'Ask AI' }).click();
  const panel = page.getByRole('dialog', { name: 'AI assistant' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Employees', { exact: true })).toBeVisible();
  // On a wide screen the page makes room: the top bar's New stays in sight beside the panel.
  const panelBox = (await panel.boundingBox())!;
  const newBox = (await page.getByRole('button', { name: 'New', exact: true }).boundingBox())!;
  expect(newBox.x + newBox.width).toBeLessThanOrEqual(panelBox.x);
  await expect(panel.getByText('AI can make mistakes. Check important answers.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'How do I record annual leave?' })).toBeVisible();
  const question = panel.getByRole('textbox', { name: 'Your question' });
  await question.fill('How do I record sick leave?');
  await question.press('Enter');
  await expect(panel.getByText('How do I record sick leave?')).toBeVisible();
  await expect(panel.locator('strong', { hasText: 'sick leave' })).toBeVisible();
  await expect(panel.getByText(/Maham People → Leave\./)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Copy' })).toBeVisible();

  // What was sent: the question, where the person is, the sign-in; nothing of the employee.
  expect(calls).toHaveLength(1);
  const sent = calls[0];
  expect(sent.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  expect(sent.body).toContain('How do I record sick leave?');
  expect(sent.body).toContain('Page: Employees');
  expect(sent.body).toContain('Path: /employees/:id');
  expect(sent.body).toContain('Role: owner');
  for (const secret of [
    EMPLOYEE.civilId,
    EMPLOYEE.iban,
    EMPLOYEE.salary,
    '1,234.567',
    EMPLOYEE.name,
    EMPLOYEE.nameAr,
    'Made-up Guarding Co',
    companyId,
    employeePage.split('/').at(-1)!,
  ]) {
    expect(sent.body, secret).not.toContain(secret);
  }

  // New chat forgets it; closed, the focus goes back to Ask AI.
  await panel.getByRole('button', { name: 'New chat' }).click();
  await expect(panel.getByText('How do I record sick leave?')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: 'Ask AI' })).toBeFocused();

  // The search never asks the AI by itself: Enter on an IBAN it doesn't find does nothing.
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Search' });
  await search.fill(EMPLOYEE.iban);
  await expect(page.getByText(`Nothing found for “${EMPLOYEE.iban}”`)).toBeVisible();
  await expect(page.getByRole('option', { name: /Ask AI…/ })).toHaveAttribute(
    'aria-selected',
    'false',
  );
  await search.press('Enter');
  await expect(search).toBeVisible();
  await expect(panel).toBeHidden();
  expect(calls).toHaveLength(1);
  // Chosen on purpose, what was typed goes in the box, to be read and sent from there.
  await search.fill('where is sick leave');
  await page.getByRole('option', { name: /Ask AI…/ }).click();
  await expect(question).toHaveValue('where is sick leave');
  await expect(question).toBeFocused();
  expect(calls).toHaveLength(1);
  await question.press('Enter');
  await expect(panel.getByText('where is sick leave')).toBeVisible();
  await expect(panel.locator('strong', { hasText: 'sick leave' })).toBeVisible();
  expect(calls).toHaveLength(2);
  expect(calls.map((call) => call.body).join()).not.toContain(EMPLOYEE.iban);
  expect(calls[1].body).toContain('where is sick leave');
  expect(calls[1].body).toContain('Role: owner');
  // Ctrl J closes it and opens it again.
  await page.keyboard.press('Control+j');
  await expect(panel).toBeHidden();
  await page.keyboard.press('Control+j');
  await expect(panel).toBeVisible();

  // A question typed but not sent stays, and the panel stays open, when the language changes.
  await question.fill('unsent draft text');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const sheet = page.getByRole('dialog', { name: 'المساعد الذكي' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'سؤالك' })).toHaveValue('unsent draft text');
  await sheet.getByRole('button', { name: 'إغلاق' }).click();
  await expect(sheet).toBeHidden();
  expect(calls).toHaveLength(2);

  // In Arabic: right to left, at the end side (the left), and answered in Arabic.
  const askArabic = page.getByRole('button', { name: 'اسأل المساعد' });
  await expect(askArabic).toBeVisible();
  const viewport = page.viewportSize()!;
  const buttonBox = (await askArabic.boundingBox())!;
  expect(buttonBox.x + buttonBox.width).toBeLessThan(viewport.width / 2);
  await askArabic.click();
  await expect(sheet).toBeVisible();
  const sheetBox = (await sheet.boundingBox())!;
  expect(sheetBox.x).toBeLessThan(viewport.width / 2);
  await sheet.getByRole('button', { name: 'محادثة جديدة' }).click();
  const arabicQuestion = sheet.getByRole('textbox', { name: 'سؤالك' });
  await expect(arabicQuestion).toHaveAttribute('dir', 'auto');
  await arabicQuestion.fill('كيف أسجّل إجازة مرضية؟');
  await arabicQuestion.press('Enter');
  await expect(sheet.locator('strong', { hasText: 'الرواتب' })).toBeVisible();
  await expect(sheet.locator('p[dir="auto"]', { hasText: 'كيف أسجّل إجازة مرضية؟' })).toBeVisible();
  expect(calls).toHaveLength(3);
  expect(calls[2].body).toContain('App language: Arabic');
  for (const secret of [EMPLOYEE.civilId, EMPLOYEE.iban, EMPLOYEE.salary, EMPLOYEE.nameAr]) {
    expect(calls[2].body, secret).not.toContain(secret);
  }
  await sheet.getByRole('button', { name: 'إغلاق' }).click();

  // Back in English: a Civil ID and an IBAN typed into a question are hidden before it is sent.
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Ask AI' }).click();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'New chat' }).click();
  const ibanSpaced = EMPLOYEE.iban.replace(/(.{4})(?=.)/g, '$1 ');
  await question.fill(
    `My Civil ID is ${EMPLOYEE.civilId} and my IBAN is ${ibanSpaced}. How do I add them to my profile?`,
  );
  await question.press('Enter');
  await expect(
    panel.getByText(
      'My Civil ID is [ID number hidden] and my IBAN is [IBAN hidden]. How do I add them to my profile?',
    ),
  ).toBeVisible();
  await expect(panel.getByText('1 ID number was hidden before sending')).toBeVisible();
  await expect(panel.getByText('1 IBAN was hidden before sending')).toBeVisible();
  await expect(panel.locator('strong', { hasText: 'sick leave' })).toBeVisible();
  expect(calls).toHaveLength(4);
  const scrubbed = calls[3].body;
  for (const secret of [EMPLOYEE.civilId, EMPLOYEE.iban, ibanSpaced, 'CBKU', '12345601']) {
    expect(scrubbed, secret).not.toContain(secret);
  }
  expect(scrubbed).toContain('[ID number hidden]');
  expect(scrubbed).toContain('[IBAN hidden]');
  // Written with dots, with no-break spaces, or over two lines, they are hidden too.
  await question.fill(
    `Civil ID ${EMPLOYEE.civilId.replace(/(.{4})(?=.)/g, '$1.')}, IBAN ${EMPLOYEE.iban.replace(/(.{4})(?=.)/g, '$1\u00a0')}, and ${EMPLOYEE.civilId.slice(0, 6)}\n${EMPLOYEE.civilId.slice(6)}`,
  );
  await question.press('Enter');
  await expect(panel.getByText('2 ID numbers were hidden before sending')).toBeVisible();
  expect(calls).toHaveLength(5);
  const odd = JSON.parse(calls[4].body) as { contents: { parts: { text: string }[] }[] };
  const oddText = odd.contents.at(-1)!.parts[0].text;
  expect(oddText).toBe('Civil ID [ID number hidden], IBAN [IBAN hidden], and [ID number hidden]');
  expect(oddText.replace(/\D/g, '')).toBe('');
  // A short answer, every time.
  expect(JSON.parse(scrubbed).generationConfig).toEqual({
    maxOutputTokens: 2048,
    thinkingConfig: { thinkingLevel: 'low' },
  });
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();

  // Switched off again: the button goes.
  await page.goto('#/settings/ai');
  await page.getByRole('switch', { name: /Use the AI assistant/ }).click();
  await expect(page.getByText('AI assistant turned off')).toBeVisible();
  await page.goto(employeePage);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EMPLOYEE.name);
  await expect(page.getByRole('button', { name: 'Ask AI' })).toHaveCount(0);
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  expect(cloud.rows(companyId, 'companies')[0].data).not.toHaveProperty('ai');
});

test('signing out and removing the companies from this device stops the answer and forgets the chat', async ({
  page,
}) => {
  test.slow();
  const cloud = new FakeSupabase();
  await cloud.install(page);
  const service = { hold: false };
  const calls = await fakeAiService(page, service);
  cloud.addUser(OWNER.email, OWNER.password, OWNER.name);
  await createCompany(page, 'Made-up Shared Desk Co');
  const account = await signIn(page, OWNER);
  await page.getByRole('button', { name: 'Keep in the cloud' }).click();
  await expect(account).toContainText('Synced', { timeout: 30_000 });
  await page.goto('#/settings/ai');
  await page.getByRole('switch', { name: /Use the AI assistant/ }).click();
  await expect(page.getByText('AI assistant turned on')).toBeVisible();
  await expect(account).toContainText('Synced', { timeout: 30_000 });

  // A question whose answer is still being written on a shared computer.
  service.hold = true;
  const stopped = page.waitForEvent('requestfailed', (r) => r.url().endsWith('/v1/stream'));
  await page.getByRole('button', { name: 'Ask AI' }).click();
  const panel = page.getByRole('dialog', { name: 'AI assistant' });
  const question = panel.getByRole('textbox', { name: 'Your question' });
  await question.fill('A question on a shared computer');
  await question.press('Enter');
  await expect(panel.getByText('Writing the answer…')).toBeVisible();
  await expect.poll(() => calls.length).toBe(1);
  await question.fill('a draft not sent');

  // Signed out, the companies removed from this device: the answer is stopped.
  await account.click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out?' });
  await dialog.getByText('Remove them from this device').click();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page.getByRole('heading', { name: 'Work from any device, with your team' }),
  ).toBeVisible();
  await stopped;

  // The same person signs in again and the company comes back: nothing of before.
  service.hold = false;
  await signIn(page, OWNER);
  await expect(page.getByRole('button', { name: 'Switch company' })).toContainText(
    'Made-up Shared Desk Co',
    { timeout: 30_000 },
  );
  const ask = page.getByRole('button', { name: 'Ask AI' });
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await expect(panel).toBeHidden();
  await ask.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByText('A question on a shared computer')).toHaveCount(0);
  await expect(question).toHaveValue('');
  expect(calls).toHaveLength(1);
});

test('a company kept on this device only never shows the assistant, even with the switch set', async ({
  page,
}) => {
  const calls = await fakeAiService(page);
  await createCompany(page, 'Made-up Local Trading');
  // As if a backup from a cloud company had the switch on.
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AlmailBooks');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const store = database.transaction('companies', 'readwrite').objectStore('companies');
      const all = store.getAll();
      all.onsuccess = () => {
        for (const company of all.result as Record<string, unknown>[]) {
          store.put({ ...company, ai: { on: true } });
        }
      };
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error);
    });
    database.close();
  });
  await page.reload();
  await page.goto('#/people');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask AI' })).toHaveCount(0);
  await page.keyboard.press('Control+j');
  await expect(page.getByRole('dialog', { name: 'AI assistant' })).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search' }).fill('leave');
  await expect(page.getByRole('option', { name: /Ask AI…/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('#/settings/ai');
  await expect(page.getByText(/The AI assistant needs a company kept in the cloud/)).toBeVisible();
  expect(calls).toEqual([]);
});
