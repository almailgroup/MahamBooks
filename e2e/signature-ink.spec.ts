import type { Page } from '@playwright/test';
import { createCompany, downloadFrom, drawSignature, expect, pdfText, test } from './fixtures';

/** The company's branding as saved on this device. */
async function savedBranding(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AlmailBooks');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<{ branding: Record<string, unknown> }[]>((resolve, reject) => {
      const request = database.transaction('companies').objectStore('companies').getAll();
      request.onsuccess = () => resolve(request.result as { branding: Record<string, unknown> }[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return rows[0].branding;
  });
}

/** The average colour [r, g, b] of the visible pixels of an image. */
async function inkColour(page: Page, src: string): Promise<number[]> {
  return page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const sum = [0, 0, 0];
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      for (let k = 0; k < 3; k++) sum[k] += data[i + k];
      count++;
    }
    return sum.map((s) => Math.round(s / Math.max(1, count)));
  }, src);
}

test('a drawn signature prints in blue ink and goes back to its own colours', async ({ page }) => {
  await createCompany(page, 'Sample Print Co.');
  await page.goto('#/settings/company?section=branding');
  await expect(
    page.getByText('Drafts print without the stamp and signature, under a DRAFT watermark'),
  ).toBeVisible();

  await drawSignature(page);
  const preview = page.getByRole('img', { name: 'Authorised signature' });
  await expect(preview).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Original' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Blue ink: made once, here, with the drawing kept beside it.
  await page.getByRole('tab', { name: 'Blue ink' }).click();
  await expect(page.getByRole('tab', { name: 'Blue ink' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  const blue = await savedBranding(page);
  expect(blue.signatureInk).toBe('blue');
  expect(blue.signatureOriginal).toMatch(/^data:image\/png;base64,/);
  const [r, g, b] = await inkColour(page, blue.signature as string);
  expect(b).toBeGreaterThan(140);
  expect(b - r).toBeGreaterThan(100);
  expect(g).toBeLessThan(90);
  const [or, , ob] = await inkColour(page, blue.signatureOriginal as string);
  expect(Math.abs(ob - or)).toBeLessThan(30);

  // Still blue after a reload; back to the drawing's own colours.
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Blue ink' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Original' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  const back = await savedBranding(page);
  expect(back.signatureInk).toBe('original');
  expect(back.signatureOriginal).toBeNull();
  expect(back.signature).toBe(blue.signatureOriginal);
});

test('a draft prints as a draft, and the copy sent is signed', async ({ page }) => {
  // A browser that shares files (as phones do), to see the PDF that is sent.
  await page.addInitScript(() => {
    const w = window as unknown as { sharedPdf?: Promise<string> };
    Object.assign(navigator, {
      canShare: () => true,
      share: async (data: { files?: File[] }) => {
        const file = data.files?.[0];
        if (!file) return;
        w.sharedPdf = file.arrayBuffer().then((buffer) => {
          let text = '';
          for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte);
          return btoa(text);
        });
        await w.sharedPdf;
      },
    });
  });
  await createCompany(page, 'Sample Print Co.');
  await page.goto('#/settings/company?section=branding');
  await drawSignature(page);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  await page.goto('#/invoices/new');
  await page.getByLabel('Bill to').click();
  await page.getByPlaceholder('Search clients…').fill('Sample Client Co.');
  await page.getByRole('button', { name: 'New client “Sample Client Co.”' }).click();
  const clientDialog = page.getByRole('dialog', { name: 'New client' });
  await clientDialog.getByRole('button', { name: 'Save client' }).click();
  await expect(clientDialog).toBeHidden();
  await page.getByLabel('Item 1 name').fill('Printing');
  await page.getByLabel('Item 1 unit price').fill('120');
  // Saved and downloaded at once: the draft's copy, and the download says why.
  const saved = await downloadFrom(page, async () => {
    await page.getByRole('button', { name: 'More save options' }).click();
    await page.getByRole('menuitem', { name: 'Save and download PDF' }).click();
  });
  await expect(page).toHaveURL(/#\/invoices\/[0-9a-f-]{36}$/);
  expect(await pdfText(saved.content)).toContain('DRAFT');
  await expect(page.getByText('Mark it as sent for the copy to share.')).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });

  // The draft: watermarked, and the download says why.
  const draft = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  expect(await pdfText(draft.content)).toContain('DRAFT');
  await expect(
    page.getByText('Drafts print with a DRAFT watermark, without the signature and stamp.').first(),
  ).toBeVisible();

  // Sent from the draft and marked as sent at once: the copy shared is the sent one.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const send = page.getByRole('dialog', { name: /^Send INV-/ });
  await send.getByLabel('Mark as sent').uncheck();
  await expect(
    send.getByText('The PDF stays a draft: a DRAFT watermark, without the signature and stamp.'),
  ).toBeVisible();
  await send.getByLabel('Mark as sent').check();
  await send.getByRole('button', { name: 'Share PDF…' }).click();
  await expect(send).toBeHidden();
  await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible();
  const shared = await page.evaluate(
    () => (window as unknown as { sharedPdf: Promise<string> }).sharedPdf,
  );
  const sentText = await pdfText(Buffer.from(shared, 'base64'));
  expect(sentText).not.toContain('DRAFT');
  expect(sentText).toContain('INV-');

  // Downloaded once sent: no watermark either.
  const sent = await downloadFrom(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  expect(await pdfText(sent.content)).not.toContain('DRAFT');
});

test('the Templates page says what the QR code opens, and where to turn it off', async ({
  page,
}) => {
  await createCompany(page, 'Sample Print Co.');
  await page.goto('#/templates');
  const opens = page.getByLabel('The QR code opens');
  await expect(opens).toHaveValue('payment_link');
  await expect(opens.locator('option[value="pay_page"]')).toBeDisabled();

  await page.getByRole('link', { name: 'Turn it on or off in Payment details' }).click();
  await expect(page).toHaveURL(/#\/settings\/payments$/);
  const qr = page.getByRole('switch', { name: 'Print a QR code' });
  if ((await qr.getAttribute('aria-checked')) === 'true') await qr.click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  await page.goto('#/templates');
  await expect(page.getByText('The QR code is off, so documents print none.')).toBeVisible();
  await expect(page.getByLabel('The QR code opens')).toBeDisabled();
});
