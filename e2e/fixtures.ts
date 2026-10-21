import { readFile } from 'node:fs/promises';
import { test as base, expect, type Download, type Locator, type Page } from '@playwright/test';

/** Every test fails if the page throws or logs an error. */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`Uncaught: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`Console: ${message.text()}`);
      });
      await use(errors);
      expect(errors, 'errors reported by the page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Loading the demo writes a year of work, which takes a few seconds (more
 * when several tests load it at once): tests that start with it get this
 * much more time.
 */
const DEMO_LOAD_TIME = 60_000;

/** Opens the app on a fresh browser profile and loads the demo company. */
export async function startWithDemoData(page: Page): Promise<void> {
  test.info().setTimeout(test.info().timeout + DEMO_LOAD_TIME);
  await page.goto('./');
  await page.getByRole('button', { name: 'Explore with demo data' }).click();
  await expect(
    page.getByText('Demo company created. You can delete it later in Settings.'),
  ).toBeVisible({ timeout: DEMO_LOAD_TIME });
}

/** Sets up a company in Kuwait (dinars, no VAT) from the welcome page. */
export async function createCompany(page: Page, name: string): Promise<void> {
  await page.goto('./');
  await page.getByLabel('Company name').fill(name);
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByText(`${name} is ready.`)).toBeVisible();
}

/** Runs `action` and returns the file the app downloads because of it. */
export async function downloadFrom(
  page: Page,
  action: () => Promise<void>,
): Promise<{ file: Download; content: Buffer }> {
  const pending = page.waitForEvent('download');
  await action();
  const file = await pending;
  return { file, content: await readFile(await file.path()) };
}

/** Picks an option in one of the app's searchable selects. */
export async function chooseOption(
  page: Page,
  trigger: Locator,
  search: { placeholder: string; query: string; option?: string },
) {
  await trigger.click();
  await page.getByPlaceholder(search.placeholder).fill(search.query);
  await page
    .getByRole('option', { name: search.option ?? search.query })
    .first()
    .click();
}

/** The words of a PDF, without spaces. */
export async function pdfText(content: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(content), verbosity: 0 });
  const doc = await task.promise;
  const words: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const text = await (await doc.getPage(n)).getTextContent();
    for (const item of text.items) if ('str' in item) words.push(item.str);
  }
  await task.destroy();
  return words.join('').replace(/\s+/g, '');
}

/** Signs on the signature pad with the mouse. */
export async function drawSignature(page: Page) {
  await page.getByRole('button', { name: 'Draw signature' }).click();
  const pad = page.getByRole('dialog', { name: 'Draw your signature' });
  const canvas = pad.getByLabel('Signature pad');
  // Once the dialog has opened: a press outside it would close it.
  await canvas.hover();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height * 0.7);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(box.x + 40 + step * 25, box.y + box.height * (step % 2 ? 0.3 : 0.7));
  }
  await page.mouse.up();
  await pad.getByRole('button', { name: 'Use this signature' }).click();
  await expect(pad).toBeHidden();
}
