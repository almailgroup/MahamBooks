import { Link, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Printer, RotateCcw } from 'lucide-react';
import { db } from '@/db/db';
import { deviceChequeOffset, setDeviceChequeOffset } from '@/db/cheque-print';
import type { ChequeLayout } from '@/db/types';
import { useCompany } from '@/app/company';
import { layoutFor } from '@/lib/cheque-layouts';
import { bankName } from '@/lib/cheques';
import { today } from '@/lib/dates';
import { currentLanguage, t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { MmPageStyle, TestGrid } from '@/features/print/mm-page';
import {
  ChequeLeaf,
  LeafRulers,
  sampleFace,
  useChequeFit,
} from '@/apps/books/features/cheques/cheque-leaf';

/** How far each press moves the print, in millimetres. */
const STEP = 0.5;

/**
 * A test print of a cheque layout on plain paper: a 10 mm grid, millimetre
 * rulers and the fields' outlines with a sample cheque. Held over a real
 * leaf against the light, it shows how far this printer is off; the nudges
 * move every field for this device only (cheque-offset:<layout> in db.meta).
 */
export default function ChequeTestPrintPage() {
  const company = useCompany();
  const [params] = useSearchParams();
  const saved = useLiveQuery(
    () => db.chequeLayouts.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  if (!saved) return <Spinner className="min-h-dvh" label={t('Loading…')} />;
  const bank = (params.get('bank') ?? 'BRGN').toUpperCase();
  const layout = layoutFor(bank, saved, company.id);
  if (!layout) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-slate-600">
          {t('There is no cheque layout for {bank}. Cheques on Burgan Bank and KFH are printed.', {
            bank: bankName(bank, currentLanguage()),
          })}
        </p>
        <Link to="/cheques/layouts" className="text-primary-700 text-sm font-medium">
          {t('Cheque layouts')}
        </Link>
      </div>
    );
  }
  return <TestPrint layout={layout} />;
}

function TestPrint({ layout }: { layout: ChequeLayout }) {
  const device = useLiveQuery(() => deviceChequeOffset(layout), [layout.id, layout.bank]);
  const face = sampleFace(layout, today());
  const fit = useChequeFit(layout, face);
  if (!device) return <Spinner className="min-h-dvh" label={t('Loading…')} />;

  const move = (dx: number, dy: number) =>
    void setDeviceChequeOffset(layout.id, { x: device.x + dx, y: device.y + dy });
  const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
  const { width, height } = layout.size;

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <MmPageStyle width={width} height={height} />
      <div className="mx-auto mb-4 max-w-4xl space-y-4 px-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to={`/cheques/layouts?bank=${encodeURIComponent(layout.bank)}`}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="size-4" /> {t('Cheque layouts')}
          </Link>
          <Button onClick={() => window.print()}>
            <Printer /> {t('Print')}
          </Button>
        </div>
        <div className="bg-surface space-y-4 rounded-xl p-4 shadow-xs ring-1 ring-slate-200">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              {t('Test print: {name}', {
                name: currentLanguage() === 'ar' && layout.nameAr ? layout.nameAr : layout.name,
              })}
            </h1>
            <p className="text-sm text-slate-600">
              {t(
                'Print on plain paper at 100% (actual size) with no margins, then hold it over a real leaf against the light. If the fields are off, move them by that much and print again.',
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* The leaf doesn't turn round in Arabic: left is left. */}
            <div dir="ltr" className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label={t('Move 0.5 mm left')}
                onClick={() => move(-STEP, 0)}
              >
                {/* Not mirrored in Arabic either (index.css mirrors arrows on RTL pages). */}
                <ArrowLeft style={{ transform: 'none' }} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={t('Move 0.5 mm up')}
                onClick={() => move(0, -STEP)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={t('Move 0.5 mm down')}
                onClick={() => move(0, STEP)}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={t('Move 0.5 mm right')}
                onClick={() => move(STEP, 0)}
              >
                <ArrowRight style={{ transform: 'none' }} />
              </Button>
            </div>
            <p className="text-sm text-slate-700" aria-live="polite">
              {t('This printer: {x} mm across, {y} mm down', {
                x: signed(device.x),
                y: signed(device.y),
              })}
            </p>
            {device.x || device.y ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void setDeviceChequeOffset(layout.id, { x: 0, y: 0 })}
              >
                <RotateCcw /> {t('Reset')}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">
            {t(
              'Kept on this device only: each printer has its own. Moving the layout for every printer is in Cheque layouts.',
            )}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto px-4 print:overflow-visible print:px-0">
        <ChequeLeaf
          layout={layout}
          face={face}
          fit={fit}
          offset={{ x: layout.offset.x + device.x, y: layout.offset.y + device.y }}
          guides="print"
          label={t('Test print')}
        >
          <TestGrid width={width} height={height} />
          <LeafRulers width={width} height={height} />
        </ChequeLeaf>
      </div>
    </div>
  );
}
