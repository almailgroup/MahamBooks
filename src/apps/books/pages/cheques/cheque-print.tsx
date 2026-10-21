import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ArrowLeft, Info, Printer, Ruler } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import {
  deviceChequeOffset,
  recordChequePrintAttempt,
  recordChequePrinted,
  recordSpoiledLeaf,
} from '@/db/cheque-print';
import type { ChequeDetails, ChequeLayout, Client, Payment } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { layoutFor } from '@/lib/cheque-layouts';
import {
  chequeFace,
  chequePayee,
  nextLeafNumber,
  printedText,
  printRefusal,
  REFUSAL_TEXT,
} from '@/lib/cheque-print';
import { bankName } from '@/lib/cheques';
import { cn } from '@/lib/cn';
import { currentLanguage, t } from '@/i18n';
import { Button, ButtonLink } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { Spinner } from '@/components/ui/misc';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { MmPageStyle } from '@/features/print/mm-page';
import { useRoleView } from '@/features/cloud/role-gates';
import { ChequeLeaf, useChequeFit } from '@/apps/books/features/cheques/cheque-leaf';

type ChequePayment = Payment & { cheque: ChequeDetails };

const BASE = '/payments-made';

function Note({
  tone,
  children,
}: {
  tone: 'info' | 'warning' | 'danger';
  children: React.ReactNode;
}) {
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <p
      role={tone === 'info' ? undefined : 'alert'}
      className={cn(
        'flex gap-2 rounded-md px-3 py-2 text-sm',
        tone === 'info' && 'bg-slate-50 text-slate-700 ring-1 ring-slate-200',
        tone === 'warning' && 'bg-amber-50 text-amber-900',
        tone === 'danger' && 'bg-red-50 text-red-800',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/**
 * Prints a cheque issued onto its bank's leaf, then asks whether it printed
 * correctly: the print is recorded on the cheque, or the leaf is recorded
 * as spoiled and the cheque moves to the next leaf. A cheque prints once;
 * printing it again first marks the printed leaf spoiled.
 */
export default function ChequePrintPage() {
  const { id = '' } = useParams();
  const company = useCompany();
  const payment = useLiveQuery(() => db.payments.get(id), [id]);
  const vendor = useLiveQuery(
    async () => (payment?.clientId ? ((await db.clients.get(payment.clientId)) ?? null) : null),
    [payment?.clientId],
  );
  const saved = useLiveQuery(
    () => db.chequeLayouts.where('companyId').equals(company.id).toArray(),
    [company.id],
  );

  if (payment === undefined || vendor === undefined || !saved) {
    return <Spinner className="min-h-dvh" label={t('Loading…')} />;
  }
  const cheque = payment?.cheque;
  if (!payment || payment.companyId !== company.id || payment.direction !== 'out' || !cheque) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-slate-600">{t('This cheque could not be found.')}</p>
        <Link to={BASE} className="text-primary-700 text-sm font-medium">
          {t('Back to {list}', { list: t('Payments made') })}
        </Link>
      </div>
    );
  }
  const layout = layoutFor(cheque.bank, saved, company.id);
  if (!layout) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-slate-600">
          {t('There is no cheque layout for {bank}. Cheques on Burgan Bank and KFH are printed.', {
            bank: bankName(cheque.bank, currentLanguage()) || t('this bank'),
          })}
        </p>
        <Link to={`${BASE}/${payment.id}`} className="text-primary-700 text-sm font-medium">
          {t('Back to payment {number}', { number: payment.number })}
        </Link>
      </div>
    );
  }
  return <PrintView payment={payment as ChequePayment} vendor={vendor} layout={layout} />;
}

function PrintView({
  payment,
  vendor,
  layout,
}: {
  payment: ChequePayment;
  vendor: Client | null;
  layout: ChequeLayout;
}) {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const { readOnly } = useRoleView();
  const [crossed, setCrossed] = useState(Boolean(payment.cheque.crossed));
  const [asking, setAsking] = useState<'result' | 'spoil' | 'reprint' | 'next' | null>(null);
  const device = useLiveQuery(() => deviceChequeOffset(layout), [layout.id, layout.bank]);
  const cheque = payment.cheque;
  const face = chequeFace(
    {
      amount: payment.amount,
      date: cheque.date,
      payee: chequePayee(cheque, vendor, layout.wordsLanguage),
    },
    layout,
    { crossed },
  );
  const fit = useChequeFit(layout, face);
  const refusal = printRefusal(payment);
  const language = currentLanguage();
  const bank = bankName(layout.bank, language);
  const layoutName = language === 'ar' && layout.nameAr ? layout.nameAr : layout.name;
  const offset = {
    x: layout.offset.x + (device?.x ?? 0),
    y: layout.offset.y + (device?.y ?? 0),
  };
  const blocked =
    !company.chequePrinting ||
    readOnly.readOnly ||
    refusal !== null ||
    !face.payee ||
    !fit.fits ||
    !device;

  // Every print is logged and asked about, from the button or from the
  // browser's own Print command.
  const fromButton = useRef(false);
  const sent = () =>
    void recordChequePrintAttempt(payment.id).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : t('Something went wrong.')),
    );
  const print = () => {
    fromButton.current = true;
    sent();
    window.print();
    setAsking('result');
  };
  useEffect(() => {
    if (blocked) return;
    const printed = () => {
      if (fromButton.current) {
        fromButton.current = false;
        return;
      }
      sent();
      setAsking((asked) => asked ?? 'result');
    };
    window.addEventListener('afterprint', printed);
    return () => window.removeEventListener('afterprint', printed);
    // `sent` only names the payment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, payment.id]);

  const recordPrint = async () => {
    try {
      await recordChequePrinted(payment.id, {
        layout,
        text: printedText(face, fit.words.lines, layout),
        crossed,
      });
      toast.success(t('Cheque {number} printed', { number: cheque.number }));
      navigate(`${BASE}/${payment.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
    }
  };

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <MmPageStyle width={layout.size.width} height={layout.size.height} />
      <div className="mx-auto mb-4 max-w-4xl space-y-4 px-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to={`${BASE}/${payment.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />{' '}
            {t('Payment {number}', { number: payment.number })}
          </Link>
          <div className="flex flex-wrap gap-2">
            <ButtonLink
              variant="outline"
              to={`/cheques/test-print?bank=${encodeURIComponent(layout.bank)}`}
            >
              <Ruler /> {t('Test print')}
            </ButtonLink>
            <Button onClick={print} disabled={blocked}>
              <Printer /> {t('Print cheque')}
            </Button>
          </div>
        </div>
        <div className="bg-surface space-y-4 rounded-xl p-4 shadow-xs ring-1 ring-slate-200">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              {t('Print cheque {number}', { number: cheque.number })}
            </h1>
            <p className="text-sm text-slate-500">
              {[
                bank,
                layoutName === bank ? '' : layoutName,
                fmt.money(payment.amount, payment.currency),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {!company.chequePrinting ? (
            <Note tone="info">
              {t('Cheque printing is off. The owner turns it on in Settings → Payment details.')}
            </Note>
          ) : null}
          {readOnly.readOnly ? (
            <Note tone="info">{t('You can view this company but not change it.')}</Note>
          ) : null}
          {refusal === 'printed' && cheque.printedAt ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <span>
                {t('Printed on {date} on leaf {number}.', {
                  date: fmt.dateTime(cheque.printedAt),
                  number: cheque.number,
                })}{' '}
                {t('To print it again, mark that leaf spoiled first.')}
              </span>
              {!readOnly.readOnly && company.chequePrinting ? (
                <Button variant="outline" size="sm" onClick={() => setAsking('reprint')}>
                  {t('Print again on a new leaf')}
                </Button>
              ) : null}
            </div>
          ) : refusal === 'leaf_spoiled' ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span>
                {t(
                  'Leaf {number} was recorded as spoiled when the cheque changed after printing. Take the next leaf.',
                  { number: cheque.number },
                )}
              </span>
              {!readOnly.readOnly && company.chequePrinting ? (
                <Button variant="outline" size="sm" onClick={() => setAsking('next')}>
                  {t('Take the next leaf')}
                </Button>
              ) : null}
            </div>
          ) : refusal ? (
            <Note tone="danger">{t(REFUSAL_TEXT[refusal])}</Note>
          ) : null}
          {!face.payee ? (
            <Note tone="danger">
              {t('Enter who the cheque is payable to (Pay to) on the payment first.')}
            </Note>
          ) : null}
          {!fit.words.fits ? (
            <Note tone="danger">
              {t(
                'The amount in words doesn’t fit on the two lines of the leaf. Make the lines longer in the cheque layout.',
              )}
            </Note>
          ) : null}
          {face.payee && !fit.payee.fits ? (
            <Note tone="danger">
              {t(
                'The payee’s name doesn’t fit on its line. Shorten it on the payment, or make the line longer in the cheque layout.',
              )}
            </Note>
          ) : null}
          {!fit.figures.fits || !fit.date.fits ? (
            <Note tone="danger">
              {t(
                'The amount in figures or the date doesn’t fit in its box. Make the box wider in the cheque layout.',
              )}
            </Note>
          ) : null}
          {!layout.calibrated ? (
            <Note tone="warning">
              {t(
                'This layout has not been checked against a real leaf yet. Make a test print on plain paper first and hold it over a leaf.',
              )}
            </Note>
          ) : null}
          {!blocked ? (
            <Note tone="info">
              {t(
                'Put leaf {number} in the printer. Print at 100% (actual size) with no margins, from Chrome or Edge.',
                { number: cheque.number },
              )}
            </Note>
          ) : null}
          {layout.fields.crossing ? (
            <Checkbox
              label={t('Cross the cheque: A/C payee only')}
              description={t('Prints “يصرف للمستفيد الأول / A/C Payee Only”.')}
              checked={crossed}
              disabled={refusal !== null}
              onChange={(e) => setCrossed(e.target.checked)}
            />
          ) : null}
        </div>
      </div>

      {blocked ? (
        // Nothing reaches a leaf that can't be printed, even from the browser's Print command.
        <p className="hidden p-8 text-sm print:block">
          {t('This cheque can’t be printed now. The page on screen says why.')}
        </p>
      ) : null}
      <div
        className={cn(
          'overflow-x-auto px-4 print:overflow-visible print:px-0',
          blocked && 'print:hidden',
        )}
      >
        <ChequeLeaf
          layout={layout}
          face={face}
          fit={fit}
          offset={offset}
          guides="screen"
          label={t('Cheque {number}', { number: cheque.number })}
        />
      </div>

      <Dialog open={asking === 'result'} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent
          title={t('Did the cheque print correctly?')}
          description={t(
            'Check leaf {number}: the date, the payee, and the amount in words and in figures.',
            { number: cheque.number },
          )}
          className="print:hidden"
        >
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAsking(null)}>
              {t('It didn’t print')}
            </Button>
            <Button variant="outline" onClick={() => setAsking('spoil')}>
              {t('No, the leaf is spoiled')}
            </Button>
            <Button onClick={() => void recordPrint()}>{t('Yes, record the print')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {asking === 'spoil' || asking === 'reprint' || asking === 'next' ? (
        <SpoilDialog
          payment={payment}
          misprint={asking === 'spoil' ? printedText(face, fit.words.lines, layout) : undefined}
          nextOnly={asking === 'next'}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </div>
  );
}

function SpoilDialog({
  payment,
  misprint,
  nextOnly,
  onClose,
}: {
  payment: ChequePayment;
  /** What was just printed on the leaf, when it printed wrongly. */
  misprint?: ReturnType<typeof printedText>;
  /** The leaf is already recorded as spoiled: only the next one is asked for. */
  nextOnly?: boolean;
  onClose: () => void;
}) {
  const number = payment.cheque.number;
  const [reason, setReason] = useState(misprint ? t('Printed wrongly') : t('Printed again'));
  const [next, setNext] = useState(nextLeafNumber(number));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await recordSpoiledLeaf(payment.id, { reason, nextNumber: next, text: misprint });
      toast.success(
        nextOnly
          ? t('Put leaf {next} in the printer.', { next: next.trim() })
          : t('Leaf {number} recorded as spoiled. Put leaf {next} in the printer.', {
              number,
              next: next.trim(),
            }),
      );
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={nextOnly ? t('Take the next leaf') : t('Spoiled leaf')}
        description={
          nextOnly
            ? t('Leaf {number} is spoiled. The cheque prints on the next leaf.', { number })
            : t(
                'Leaf {number} is recorded as spoiled: destroy it. The cheque then prints on the next leaf.',
                { number },
              )
        }
        className="print:hidden"
      >
        <DialogBody>
          {nextOnly ? null : (
            <Field label={t('Reason')}>
              {(fid) => (
                <Input id={fid} value={reason} onChange={(e) => setReason(e.target.value)} />
              )}
            </Field>
          )}
          <Field
            label={t('Number of the next leaf')}
            hint={t('The number the bank printed on the next leaf of the cheque book.')}
          >
            {(fid) => (
              <Input
                id={fid}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                inputMode="numeric"
                dir="ltr"
                className="rtl:text-end"
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
          <Button
            variant={nextOnly ? 'primary' : 'danger'}
            onClick={() => void save()}
            loading={busy}
          >
            {nextOnly ? t('Use this leaf') : t('Record the spoiled leaf')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
