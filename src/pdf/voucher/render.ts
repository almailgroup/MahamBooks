import type { VoucherModel } from './model';

/**
 * Renders a voucher to a PDF. Runs on the page (the shared worker only
 * knows invoice templates); the PDF code and fonts load on first use.
 */
export async function renderVoucherPdf(model: VoucherModel): Promise<Blob> {
  await import('../buffer-shim');
  const [{ pdf }, { registerFonts }, fonts, { voucherDocument, VOUCHER_FONTS }] = await Promise.all(
    [
      import('@react-pdf/renderer'),
      import('../fonts'),
      import('../font-urls'),
      import('./document'),
    ],
  );
  registerFonts(VOUCHER_FONTS, fonts.resolveFontUrl);
  return pdf(voucherDocument(model)).toBlob();
}
