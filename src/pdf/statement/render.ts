import type { StatementRenderModel } from './model';

/**
 * Renders statements to one PDF. Runs on the page (the shared worker only
 * knows invoice templates); the PDF code and fonts load on first use.
 */
export async function renderStatementPdf(models: StatementRenderModel[]): Promise<Blob> {
  if (models.length === 0) throw new Error('No statements to print.');
  await import('../buffer-shim');
  const [{ pdf }, { registerFonts }, fonts, { statementDocument, STATEMENT_FONTS }] =
    await Promise.all([
      import('@react-pdf/renderer'),
      import('../fonts'),
      import('../font-urls'),
      import('./document'),
    ]);
  registerFonts(STATEMENT_FONTS, fonts.resolveFontUrl);
  return pdf(statementDocument(models)).toBlob();
}
