import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/misc';
import { msg, t } from '@/i18n';
import { useReportLanguage, type ReportLanguage } from './report-language';

const LANGUAGE_OPTIONS: { value: ReportLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
  { value: 'both', label: msg('Both') },
];

/** Picks the language a report is shown, printed and exported in. */
export function ReportLanguageToggle() {
  const { language, setLanguage } = useReportLanguage();
  return (
    <div role="group" aria-label={t('Report language')}>
      <Segmented
        size="sm"
        value={language}
        onChange={setLanguage}
        options={LANGUAGE_OPTIONS.map((o) => ({
          value: o.value,
          label: o.value === 'both' ? t(o.label) : <span lang={o.value}>{o.label}</span>,
        }))}
      />
    </div>
  );
}

const PRINT_CSS = `
@media screen { .report-print { display: none !important; } }
@media print {
  @page { size: A4; margin: 14mm 12mm; }
  body > *:not(.report-print) { display: none !important; }
  body { background: #fff !important; }
  .report-print { display: block !important; color: #0f172a; }
  .report-print .print-page + .print-page { break-before: page; }
  .report-print tr { break-inside: avoid; }
  .report-print thead { display: table-header-group; }
}`;

/**
 * Prints part of the page: the content is rendered outside the app, the
 * rest of the page is hidden while the browser prints, and it is removed
 * again afterwards.
 */
export function usePrint(): { print: (content: ReactNode) => void; portal: ReactNode } {
  const [content, setContent] = useState<ReactNode>(null);
  const print = useCallback((next: ReactNode) => setContent(next), []);
  useEffect(() => {
    if (!content) return;
    const style = document.createElement('style');
    style.textContent = PRINT_CSS;
    document.head.appendChild(style);
    const done = () => setContent(null);
    window.addEventListener('afterprint', done);
    // Give the browser a frame to lay the content out (and load Arabic fonts).
    const timer = window.setTimeout(() => {
      void (document.fonts?.ready ?? Promise.resolve()).then(() => window.print());
    }, 120);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
      style.remove();
    };
  }, [content]);
  const portal = content
    ? createPortal(<div className="report-print bg-white">{content}</div>, document.body)
    : null;
  return { print, portal };
}

export function PrintButton({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Printer /> {label ?? t('Print')}
    </Button>
  );
}

export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Download /> {t('Export CSV')}
    </Button>
  );
}
