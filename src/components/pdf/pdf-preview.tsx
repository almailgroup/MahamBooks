import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/misc';
import { t } from '@/i18n';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<PdfJs> | null = null;

// The "legacy" build includes polyfills, so previews work in older browsers too.
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsPromise;
}

/**
 * Renders every page of a PDF blob onto canvases (via pdf.js), so previews
 * look identical in every browser, including mobile ones that cannot show
 * PDFs inline. New renders replace the old pages only when ready (no flicker).
 */
export function PdfPreview({
  blob,
  loading = false,
  error,
  className,
  maxPages = 20,
}: {
  blob: Blob | null;
  loading?: boolean;
  error?: string | null;
  className?: string;
  maxPages?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      setWidth((prev) => (Math.abs(prev - next) > 8 ? next : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = container.current;
    if (!blob || !el || width === 0) return;
    let cancelled = false;
    let destroy: (() => void) | null = null;

    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const data = new Uint8Array(await blob.arrayBuffer());
        const task = pdfjs.getDocument({ data });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const canvases: HTMLCanvasElement[] = [];
        for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className =
            'block w-full rounded-sm bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_8px_24px_-8px_rgba(15,23,42,0.18)]';
          canvas.setAttribute('aria-label', t('Page {number}', { number: n }));
          await page.render({ canvas, viewport }).promise;
          if (cancelled) return;
          canvases.push(canvas);
        }
        if (cancelled) return;
        el.replaceChildren(...canvases);
        setRendered(true);
        setRenderError(null);
      } catch (e) {
        if (!cancelled)
          setRenderError(e instanceof Error ? e.message : t('Could not display the PDF.'));
      }
    })();

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [blob, width, maxPages]);

  const message = error ?? renderError;

  return (
    <div className={cn('relative', className)}>
      <div ref={container} className="flex flex-col gap-4" />
      {!rendered && !message ? (
        <div className="paper flex aspect-[1/1.414] w-full items-center justify-center rounded-sm bg-white shadow-sm">
          <Spinner label={t('Preparing preview…')} />
        </div>
      ) : null}
      {loading && rendered ? (
        <div className="bg-surface/90 absolute end-3 top-3 rounded-full px-3 py-1.5 shadow-sm ring-1 ring-slate-200">
          <Spinner label={t('Updating…')} />
        </div>
      ) : null}
      {message ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{message}</span>
        </div>
      ) : null}
    </div>
  );
}
