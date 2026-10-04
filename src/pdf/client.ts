import { t } from '@/i18n';
import { downloadName, fileName } from '@/lib/file-names';
import type { RenderModel } from './model';
import type { PdfRequest, PdfResponse } from './pdf.worker';

const TIMEOUT_MS = 45_000;

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<
  number,
  {
    resolve: (blob: Blob) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

function failAll(error: Error) {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(error);
    pending.delete(id);
  }
}

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<PdfResponse>) => {
      const data = event.data;
      const p = pending.get(data.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(data.id);
      if (data.ok) p.resolve(new Blob([data.buffer], { type: 'application/pdf' }));
      else p.reject(new Error(data.error));
    };
    worker.onerror = () => {
      // Module workers are unsupported or the bundle failed: use the main thread.
      workerBroken = true;
      worker?.terminate();
      worker = null;
      failAll(new Error('worker-unavailable'));
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

async function renderOnMainThread(model: RenderModel, templateId: string | null): Promise<Blob> {
  await import('./buffer-shim');
  const [{ pdf }, { registerFonts }, { createPdfElement }, fonts] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./fonts'),
    import('./element'),
    import('./font-urls'),
  ]);
  const { element, fonts: needed } = createPdfElement(model, templateId);
  registerFonts(needed, fonts.resolveFontUrl);
  return pdf(element).toBlob();
}

/**
 * Renders a document to a PDF blob. Runs in a Web Worker so the page stays
 * responsive; a render that takes too long is cancelled.
 */
export async function renderPdf(model: RenderModel, templateId: string | null): Promise<Blob> {
  const w = getWorker();
  if (!w) return renderOnMainThread(model, templateId);
  const id = nextId++;
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        // A stuck render can't be interrupted, so replace the worker.
        worker?.terminate();
        worker = null;
        failAll(new Error('PDF generation timed out.'));
        reject(
          new Error(
            t('PDF generation took too long. Please check the logo and content, then try again.'),
          ),
        );
      }, TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      w.postMessage({ id, model, templateId } satisfies PdfRequest);
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'worker-unavailable') {
      return renderOnMainThread(model, templateId);
    }
    throw error;
  }
}

/**
 * e.g. "Invoice INV-2026-0001 - Client name.pdf", in ASCII so it saves in
 * every language: a client name in Arabic letters is left out.
 */
export function pdfFileName(title: string, clientName = ''): string {
  return fileName([title, clientName], 'pdf', 'document');
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Opens the browser's print dialog for a PDF blob. */
export function printBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank');
    }
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  document.body.appendChild(frame);
}
