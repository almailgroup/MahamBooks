import { t } from '@/i18n';
import { useEffect, useRef, useState } from 'react';
import type { Client, Company, DocumentLanguage } from '@/db/types';
import { buildRenderModel, qrLinkOf, type RenderableDocument, type RenderModel } from '@/pdf/model';
import { renderPdf } from '@/pdf/client';
import { documentLayout, documentTemplate } from '@/pdf/template-resolve';
import { mainProductImages } from '@/db/product-images';
import { imageThumbnail } from '@/lib/image';
import { qrDataUrl } from '@/lib/qr';

// Drawn in lib/qr.ts, which item labels use too.
export { qrDataUrl } from '@/lib/qr';

/** Item pictures are printed from copies this size (px): sharp at the 30 pt they print at. */
const ITEM_IMAGE_PX = 160;

/**
 * Small copies of the main pictures of the document's items, by item id,
 * when the company's items have pictures and the document's design prints
 * them. A picture this device doesn't have yet is left out, so it never
 * holds up the PDF.
 */
async function itemImagesOf(
  doc: RenderableDocument,
  company: Company,
): Promise<Record<string, string> | undefined> {
  if (!company.items?.images || !documentLayout(doc, company).showItemImages) return undefined;
  const ids = doc.items.flatMap((item) => (item.productId ? [item.productId] : []));
  if (ids.length === 0) return undefined;
  const files = await mainProductImages(ids);
  const images = await Promise.all(
    [...files].map(
      async ([productId, file]) =>
        [productId, await imageThumbnail(file.id, file.dataUrl, ITEM_IMAGE_PX)] as const,
    ),
  );
  return Object.fromEntries(images);
}

/**
 * Builds the render model, including the QR code (of the payment link: the
 * document's own link, else the company's) when enabled, and the items'
 * pictures when the design prints them.
 */
export async function prepareModel(
  doc: RenderableDocument,
  company: Company,
  client: Client | null,
  accent?: string,
  language?: DocumentLanguage,
): Promise<RenderModel> {
  const link = company.payment.showQrCode ? qrLinkOf(doc, company) : '';
  const [qrCode, itemImages] = await Promise.all([
    link ? qrDataUrl(link) : null,
    itemImagesOf(doc, company),
  ]);
  return buildRenderModel(doc, company, client, { qrCode, accent, language, itemImages });
}

export async function generatePdf(
  doc: RenderableDocument & { templateId?: string | null },
  company: Company,
  client: Client | null,
  templateId?: string | null,
): Promise<{ blob: Blob; model: RenderModel }> {
  const model = await prepareModel(doc, company, client);
  const blob = await renderPdf(model, templateId ?? documentTemplate(doc, company));
  return { blob, model };
}

/**
 * Generates a PDF whenever the inputs change, debounced so typing stays smooth.
 * Pass `null` for `doc` to skip rendering.
 */
export function useLivePdf(
  doc: RenderableDocument | null,
  company: Company,
  client: Client | null,
  templateId: string | null,
  options: { delay?: number; accent?: string; language?: DocumentLanguage } = {},
) {
  const { delay = 350, accent, language } = options;
  // The latest finished render; `loading` is derived by comparing keys.
  const [done, setDone] = useState<{ key: string; blob: Blob | null; error: string | null } | null>(
    null,
  );
  const latest = useRef<string | null>(null);

  // A stable key so re-renders with equal data don't regenerate the PDF.
  const key = doc ? JSON.stringify([doc, company, client, templateId, accent, language]) : null;

  useEffect(() => {
    latest.current = key;
    if (!key || !doc) return;
    const timer = setTimeout(async () => {
      let blob: Blob | null = null;
      let error: string | null = null;
      try {
        const model = await prepareModel(doc, company, client, accent, language);
        blob = await renderPdf(model, templateId);
      } catch (e) {
        error = e instanceof Error ? e.message : t('Could not create the PDF.');
      }
      if (latest.current !== key) return;
      setDone((prev) => ({ key, blob: blob ?? prev?.blob ?? null, error }));
    }, delay);
    return () => clearTimeout(timer);
    // `key` captures every input; the objects themselves change identity often.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delay]);

  return {
    blob: done?.blob ?? null,
    loading: key !== null && done?.key !== key,
    error: done?.key === key ? (done?.error ?? null) : null,
  };
}
