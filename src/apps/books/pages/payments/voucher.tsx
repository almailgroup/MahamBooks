import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Download, Printer, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import type { InvoiceDocument } from '@/db/types';
import { useCompany } from '@/app/company';
import { cn } from '@/lib/cn';
import { downloadName } from '@/lib/file-names';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { downloadBlob, pdfFileName } from '@/pdf/client';
import {
  buildVoucherModel,
  hasVoucher,
  VOUCHER_WORDS,
  type Bilingual,
  type VoucherLine,
  type VoucherModel,
} from '@/pdf/voucher/model';
import {
  PAYMENT_COPY,
  paymentDirection,
  type PaymentDirection,
} from '@/apps/books/features/payments/direction';
import { canSharePdf } from '@/apps/books/features/documents/send-dialog';

function LabelledRow({ label, children }: { label: Bilingual; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_7.5rem] items-baseline gap-3 border-b border-dotted border-slate-300 py-2.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)_9rem]">
      <span dir="ltr" className="text-start font-medium text-slate-500">
        {label.en}
      </span>
      <div className="min-w-0 text-center text-slate-900">{children}</div>
      <span dir="rtl" className="text-start font-medium text-slate-500">
        {label.ar}
      </span>
    </div>
  );
}

/** A line of a value: one part in its own direction, or several with " / " between. */
function ValueLine({ line }: { line: VoucherLine }) {
  const style = cn(line.strong && 'font-semibold', line.multiline && 'whitespace-pre-line');
  if (line.parts.length === 1) {
    return (
      <p dir={line.parts[0].dir} className={style || undefined}>
        {line.parts[0].text}
      </p>
    );
  }
  return (
    <p className={style || undefined}>
      {line.parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? ' / ' : null}
          <span dir={part.dir}>{part.text}</span>
        </Fragment>
      ))}
    </p>
  );
}

const COLUMNS = ['grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4'];

function Missing({ text, to, label }: { text: string; to: string; label: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div>
        <p className="text-slate-600">{text}</p>
        <Link to={to} className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {label}
        </Link>
      </div>
    </div>
  );
}

/**
 * The voucher on the page, printed by the browser, with its PDF to download
 * or share.
 */
function VoucherSheet({
  model,
  back,
}: {
  model: VoucherModel;
  back: { to: string; label: string };
}) {
  const [busy, setBusy] = useState<'pdf' | 'share' | null>(null);
  const canShare = canSharePdf();

  useEffect(() => {
    const before = document.title;
    document.title = model.documentTitle;
    return () => {
      document.title = before;
    };
  }, [model.documentTitle]);

  const pdf = async (mode: 'pdf' | 'share') => {
    setBusy(mode);
    try {
      const { renderVoucherPdf } = await import('@/pdf/voucher/render');
      const blob = await renderVoucherPdf(model);
      const name = pdfFileName(model.documentTitle, model.partyName);
      if (mode === 'pdf') downloadBlob(blob, name);
      else {
        const file = new File([blob], downloadName(name), { type: 'application/pdf' });
        await navigator.share({ files: [file], title: model.documentTitle });
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        toast.error(error instanceof Error ? error.message : t('Could not create the PDF.'));
      }
    } finally {
      setBusy(null);
    }
  };

  const { title, company } = model;
  const signed = model.signatures.some((s) => s.signature || s.stamp);

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 print:hidden">
        <Link
          to={back.to}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" /> {back.label}
        </Link>
        <div className="flex flex-wrap gap-2">
          {canShare ? (
            <Button
              variant="outline"
              onClick={() => void pdf('share')}
              loading={busy === 'share'}
              disabled={busy !== null}
            >
              <Share2 /> {t('Share PDF…')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => void pdf('pdf')}
            loading={busy === 'pdf'}
            disabled={busy !== null}
          >
            <Download /> {t('Download PDF')}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer /> {t('Print')}
          </Button>
        </div>
      </div>

      {/* Like payslips, the sheet reads the same in both languages: English on the left. */}
      <article
        dir="ltr"
        className="paper relative mx-auto max-w-3xl overflow-hidden bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-10 print:max-w-none print:p-0 print:shadow-none print:ring-0"
      >
        {model.voided ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <span className="-rotate-12 rounded-lg border-4 border-red-500/60 px-6 py-2 text-5xl font-bold tracking-widest text-red-500/60">
              {VOUCHER_WORDS.void.en} · {VOUCHER_WORDS.void.ar}
            </span>
          </div>
        ) : null}

        <header className="flex flex-col items-center gap-3 border-b-2 border-slate-800 pb-5 text-center sm:flex-row sm:items-start sm:justify-between sm:text-start">
          <div dir="ltr" className="min-w-0 sm:w-1/3">
            {company.logo ? (
              <img src={company.logo} alt="" className="mb-2 max-h-14 object-contain" />
            ) : null}
            <p className="font-semibold text-slate-900">{company.name}</p>
            {company.registration ? (
              <p className="text-xs text-slate-500">{company.registration}</p>
            ) : null}
            {company.address?.en ? (
              <p className="text-xs text-slate-500">{company.address.en}</p>
            ) : null}
            {company.email ? <p className="text-xs text-slate-500">{company.email}</p> : null}
          </div>
          <div className="text-center sm:w-1/3">
            <h1 className="text-xl font-bold text-slate-900">{title.ar}</h1>
            <p className="text-sm font-semibold tracking-wide text-slate-600 uppercase">
              {title.en}
            </p>
          </div>
          <div dir="rtl" className="min-w-0 sm:w-1/3">
            <p className="font-semibold text-slate-900">{company.nameAr}</p>
            {company.phone ? (
              <p dir="ltr" className="text-xs text-slate-500">
                {company.phone}
              </p>
            ) : null}
            {company.address?.ar ? (
              <p className="text-xs text-slate-500">{company.address.ar}</p>
            ) : null}
          </div>
        </header>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-stretch sm:justify-between">
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-slate-500">
                {VOUCHER_WORDS.number.en} / {VOUCHER_WORDS.number.ar}:
              </span>{' '}
              <strong dir="ltr">{model.number}</strong>
            </p>
            <p>
              <span className="text-slate-500">
                {VOUCHER_WORDS.date.en} / {VOUCHER_WORDS.date.ar}:
              </span>{' '}
              <strong dir="ltr">{model.date}</strong>
              <span className="ms-2 text-slate-500" dir="rtl">
                {model.hijri}
              </span>
            </p>
          </div>
          <div className="rounded-lg border-2 border-slate-800 px-4 py-2 text-center">
            <p className="text-xs text-slate-500">
              {VOUCHER_WORDS.amount.en} / {VOUCHER_WORDS.amount.ar}
            </p>
            <p dir="ltr" className="tabular text-lg font-bold text-slate-900">
              {model.amount.en}
            </p>
            <p dir="rtl" className="tabular text-sm font-semibold text-slate-700">
              {model.amount.ar}
            </p>
          </div>
        </div>

        <div className="mt-4">
          {model.rows.map((row) => (
            <LabelledRow key={row.key} label={row.label}>
              {row.lines.map((line, i) => (
                <ValueLine key={i} line={line} />
              ))}
            </LabelledRow>
          ))}
        </div>

        <footer
          className={cn(
            'mt-14 grid gap-4 text-center text-xs text-slate-600 sm:gap-8',
            COLUMNS[model.signatures.length - 1] ?? 'grid-cols-4',
          )}
        >
          {model.signatures.map((line, i) => (
            <div key={i}>
              <div
                className={cn(
                  'mb-2 flex items-end justify-center gap-1 border-b border-slate-400',
                  signed ? 'h-16' : 'h-10',
                )}
              >
                {line.signature ? (
                  <img
                    src={line.signature}
                    alt={t('Authorised signature')}
                    className="max-h-14 max-w-[60%] object-contain"
                  />
                ) : null}
                {line.stamp ? (
                  <img
                    src={line.stamp}
                    alt={t('Stamp')}
                    className="max-h-16 max-w-[40%] object-contain"
                  />
                ) : null}
              </div>
              {line.label.en ? <p>{line.label.en}</p> : null}
              {line.label.ar ? <p dir="rtl">{line.label.ar}</p> : null}
            </div>
          ))}
        </footer>
      </article>
    </div>
  );
}

function PaymentVoucher({ direction }: { direction: PaymentDirection }) {
  const { id = '' } = useParams();
  const company = useCompany();
  const copy = PAYMENT_COPY[direction];
  const payment = useLiveQuery(async () => (await db.payments.get(id)) ?? null, [id]);
  const client = useLiveQuery(
    async () => (payment?.clientId ? ((await db.clients.get(payment.clientId)) ?? null) : null),
    [payment?.clientId],
  );
  const docs = useLiveQuery(async () => {
    if (!payment) return [];
    return (await db.documents.bulkGet(payment.documentIds)).filter((d): d is InvoiceDocument =>
      Boolean(d),
    );
  }, [payment]);

  if (payment === undefined || client === undefined || !docs) {
    return <Spinner className="min-h-dvh" label={t('Loading…')} />;
  }
  if (!payment || payment.companyId !== company.id || paymentDirection(payment) !== direction) {
    return (
      <Missing
        text={t('This payment could not be found.')}
        to={copy.base}
        label={t('Back to {list}', { list: t(copy.title) })}
      />
    );
  }
  const back = { to: `${copy.base}/${payment.id}`, label: t('Back to the payment') };
  if (!hasVoucher(payment)) {
    return (
      <Missing text={t('A credit note applied moved no money, so it has no voucher.')} {...back} />
    );
  }
  const model = buildVoucherModel({
    kind: 'payment',
    source: payment,
    company,
    party: client,
    documents: docs,
  });
  return <VoucherSheet model={model} back={back} />;
}

function ExpenseVoucher() {
  const { id = '' } = useParams();
  const company = useCompany();
  const expense = useLiveQuery(async () => (await db.expenses.get(id)) ?? null, [id]);
  const vendor = useLiveQuery(
    async () => (expense?.vendorId ? ((await db.clients.get(expense.vendorId)) ?? null) : null),
    [expense?.vendorId],
  );
  const accounts = useLiveQuery(async () => {
    if (!expense) return null;
    const [category, chosen] = await db.accounts.bulkGet([
      expense.accountId,
      expense.paidFromAccountId ?? '',
    ]);
    // No account named: paid from the bank, as the books have it.
    const paidFrom =
      chosen ??
      (await db.accounts.where('[companyId+role]').equals([expense.companyId, 'bank']).first());
    return { category: category ?? null, paidFrom: paidFrom ?? null };
  }, [expense]);

  if (expense === undefined || vendor === undefined || accounts === undefined) {
    return <Spinner className="min-h-dvh" label={t('Loading…')} />;
  }
  if (!expense || !accounts || expense.companyId !== company.id) {
    return (
      <Missing
        text={t('This expense could not be found.')}
        to="/expenses"
        label={t('Back to {list}', { list: t('Expenses') })}
      />
    );
  }
  const model = buildVoucherModel({
    kind: 'expense',
    source: expense,
    company,
    party: vendor,
    ...accounts,
  });
  return (
    <VoucherSheet
      model={model}
      back={{ to: `/expenses?open=${expense.id}`, label: t('Back to the expense') }}
    />
  );
}

/**
 * A printable receipt voucher (سند قبض) for money received, or payment
 * voucher (سند صرف) for money paid or spent: bilingual, with the amount in
 * words and signature lines, printed by the browser or saved as a PDF.
 */
export default function PaymentVoucherPage({
  direction = 'in',
  source = 'payment',
}: {
  direction?: PaymentDirection;
  source?: 'payment' | 'expense';
}) {
  return source === 'expense' ? <ExpenseVoucher /> : <PaymentVoucher direction={direction} />;
}
