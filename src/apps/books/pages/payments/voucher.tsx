import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Printer } from 'lucide-react';
import { db } from '@/db/db';
import type { InvoiceDocument } from '@/db/types';
import { useCompany } from '@/app/company';
import { formatDate, formatMoney } from '@/lib/format';
import { formatHijri } from '@/lib/kuwait';
import { amountInWords } from '@/lib/words';
import { bankName } from '@/lib/cheques';
import { methodInfo, providerLabel } from '@/lib/payment-methods';
import { t } from '@/i18n';
import arabic from '@/i18n/ar/payments';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import {
  PAYMENT_COPY,
  paymentDirection,
  type PaymentDirection,
} from '@/apps/books/features/payments/direction';

const EN = 'en-KW';
const AR = 'ar-KW-u-nu-latn';

/** Arabic of a label from the payments dictionary, whatever the interface language. */
function inArabic(text: string): string {
  const found = (arabic as Record<string, unknown>)[text];
  return typeof found === 'string' ? found : text;
}

/** Wording printed on vouchers, always in both languages. */
const WORDS = {
  receipt: { en: 'Receipt voucher', ar: 'سند قبض' },
  payment: { en: 'Payment voucher', ar: 'سند صرف' },
  number: { en: 'No.', ar: 'رقم' },
  date: { en: 'Date', ar: 'التاريخ' },
  amount: { en: 'Amount', ar: 'المبلغ' },
  receivedFrom: { en: 'Received from', ar: 'استلمنا من' },
  paidTo: { en: 'Paid to', ar: 'اصرفوا إلى' },
  sum: { en: 'The sum of', ar: 'مبلغ وقدره' },
  method: { en: 'Paid by', ar: 'طريقة الدفع' },
  cheque: { en: 'Cheque no.', ar: 'شيك رقم' },
  bank: { en: 'Bank', ar: 'البنك' },
  chequeDate: { en: 'Cheque date', ar: 'تاريخ الشيك' },
  drawer: { en: 'Drawer', ar: 'الساحب' },
  payee: { en: 'Pay to', ar: 'ادفعوا لأمر' },
  being: { en: 'Being', ar: 'وذلك عن' },
  reference: { en: 'Reference', ar: 'المرجع' },
  receivedBy: { en: 'Received by', ar: 'المستلم' },
  accountant: { en: 'Accountant', ar: 'المحاسب' },
  approvedBy: { en: 'Approved by', ar: 'اعتمده' },
  payer: { en: 'Customer', ar: 'العميل' },
  receiver: { en: 'Receiver’s signature', ar: 'توقيع المستلم' },
  void: { en: 'VOID', ar: 'ملغى' },
};

function Bilingual({
  label,
  children,
}: {
  label: { en: string; ar: string };
  children: React.ReactNode;
}) {
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

/**
 * A printable receipt voucher (سند قبض) for money received, or payment
 * voucher (سند صرف) for money paid: bilingual, with the amount in words and
 * signature lines. Printed by the browser.
 */
export default function PaymentVoucherPage({ direction = 'in' }: { direction?: PaymentDirection }) {
  const { id = '' } = useParams();
  const company = useCompany();
  const copy = PAYMENT_COPY[direction];
  const payment = useLiveQuery(() => db.payments.get(id), [id]);
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
  const title = direction === 'out' ? WORDS.payment : WORDS.receipt;

  useEffect(() => {
    if (!payment) return;
    const before = document.title;
    document.title = `${title.en} ${payment.number}`;
    return () => {
      document.title = before;
    };
  }, [payment, title.en]);

  if (payment === undefined || client === undefined || !docs) {
    return <Spinner className="min-h-dvh" label={t('Loading…')} />;
  }
  if (!payment || payment.companyId !== company.id || paymentDirection(payment) !== direction) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div>
          <p className="text-slate-600">{t('This payment could not be found.')}</p>
          <Link to={copy.base} className="text-primary-700 mt-4 inline-block text-sm font-medium">
            {t('Back to {list}', { list: t(copy.title) })}
          </Link>
        </div>
      </div>
    );
  }

  const display = company.currencyDisplay ?? 'local';
  const moneyEn = formatMoney(payment.amount, payment.currency, EN, display);
  const moneyAr = formatMoney(payment.amount, payment.currency, AR, display);
  const method = methodInfo(payment.method).label;
  const cheque = payment.cheque;
  const numbers = docs.map((d) => d.number).join(', ');
  const docWord =
    direction === 'out'
      ? { en: 'Payment of bills', ar: 'سداد فواتير المشتريات' }
      : { en: 'Payment of invoices', ar: 'سداد الفواتير' };
  const companyAr = company.nameAr?.trim() || company.name;
  const partyAr = client?.nameAr?.trim() || client?.name || '';

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 print:hidden">
        <Link
          to={`${copy.base}/${payment.id}`}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" /> {t('Back to the payment')}
        </Link>
        <Button onClick={() => window.print()}>
          <Printer /> {t('Print')}
        </Button>
      </div>

      {/* Like payslips, the sheet reads the same in both languages: English on the left. */}
      <article
        dir="ltr"
        className="paper relative mx-auto max-w-3xl overflow-hidden bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-10 print:max-w-none print:p-0 print:shadow-none print:ring-0"
      >
        {payment.voided ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <span className="-rotate-12 rounded-lg border-4 border-red-500/60 px-6 py-2 text-5xl font-bold tracking-widest text-red-500/60">
              {WORDS.void.en} · {WORDS.void.ar}
            </span>
          </div>
        ) : null}

        <header className="flex flex-col items-center gap-3 border-b-2 border-slate-800 pb-5 text-center sm:flex-row sm:items-start sm:justify-between sm:text-start">
          <div dir="ltr" className="min-w-0 sm:w-1/3">
            {company.branding.logo ? (
              <img src={company.branding.logo} alt="" className="mb-2 max-h-14 object-contain" />
            ) : null}
            <p className="font-semibold text-slate-900">{company.name}</p>
            {company.registrationNumber ? (
              <p className="text-xs text-slate-500">
                {company.registrationLabel} {company.registrationNumber}
              </p>
            ) : null}
          </div>
          <div className="text-center sm:w-1/3">
            <h1 className="text-xl font-bold text-slate-900">{title.ar}</h1>
            <p className="text-sm font-semibold tracking-wide text-slate-600 uppercase">
              {title.en}
            </p>
          </div>
          <div dir="rtl" className="min-w-0 sm:w-1/3">
            <p className="font-semibold text-slate-900">{companyAr}</p>
            {company.phone ? (
              <p dir="ltr" className="text-xs text-slate-500">
                {company.phone}
              </p>
            ) : null}
          </div>
        </header>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-stretch sm:justify-between">
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-slate-500">
                {WORDS.number.en} / {WORDS.number.ar}:
              </span>{' '}
              <strong dir="ltr">{payment.number}</strong>
            </p>
            <p>
              <span className="text-slate-500">
                {WORDS.date.en} / {WORDS.date.ar}:
              </span>{' '}
              <strong dir="ltr">{formatDate(payment.date, company.dateFormat, EN)}</strong>
              <span className="ms-2 text-slate-500" dir="rtl">
                {formatHijri(payment.date, 'ar')}
              </span>
            </p>
          </div>
          <div className="rounded-lg border-2 border-slate-800 px-4 py-2 text-center">
            <p className="text-xs text-slate-500">
              {WORDS.amount.en} / {WORDS.amount.ar}
            </p>
            <p dir="ltr" className="tabular text-lg font-bold text-slate-900">
              {moneyEn}
            </p>
            <p dir="rtl" className="tabular text-sm font-semibold text-slate-700">
              {moneyAr}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <Bilingual label={direction === 'out' ? WORDS.paidTo : WORDS.receivedFrom}>
            <p className="font-semibold">{client?.name ?? '—'}</p>
            {partyAr && partyAr !== client?.name ? (
              <p dir="rtl" className="font-semibold">
                {partyAr}
              </p>
            ) : null}
          </Bilingual>
          <Bilingual label={WORDS.sum}>
            <p dir="ltr">{amountInWords(payment.amount, payment.currency, 'en')}</p>
            <p dir="rtl">{amountInWords(payment.amount, payment.currency, 'ar')}</p>
          </Bilingual>
          <Bilingual label={WORDS.method}>
            <p>
              <span dir="ltr">
                {method}
                {payment.provider ? ` (${providerLabel(payment.provider)})` : ''}
              </span>
              {' / '}
              <span dir="rtl">
                {inArabic(method)}
                {payment.provider ? ` (${inArabic(providerLabel(payment.provider))})` : ''}
              </span>
            </p>
          </Bilingual>
          {cheque ? (
            <>
              <Bilingual label={WORDS.cheque}>
                <span dir="ltr" className="font-semibold">
                  {cheque.number}
                </span>
              </Bilingual>
              {cheque.bank ? (
                <Bilingual label={WORDS.bank}>
                  <p>
                    <span dir="ltr">{bankName(cheque.bank, 'en')}</span>
                    {bankName(cheque.bank, 'ar') !== bankName(cheque.bank, 'en') ? (
                      <>
                        {' / '}
                        <span dir="rtl">{bankName(cheque.bank, 'ar')}</span>
                      </>
                    ) : null}
                  </p>
                </Bilingual>
              ) : null}
              <Bilingual label={WORDS.chequeDate}>
                <span dir="ltr">{formatDate(cheque.date, company.dateFormat, EN)}</span>
              </Bilingual>
              {cheque.drawer ? (
                <Bilingual label={direction === 'out' ? WORDS.payee : WORDS.drawer}>
                  {cheque.drawer}
                </Bilingual>
              ) : null}
            </>
          ) : null}
          {numbers || payment.notes ? (
            <Bilingual label={WORDS.being}>
              {numbers ? (
                <p>
                  <span dir="ltr">
                    {docWord.en} {numbers}
                  </span>
                  <br />
                  <span dir="rtl">
                    {docWord.ar} {numbers}
                  </span>
                </p>
              ) : null}
              {payment.notes ? <p className="whitespace-pre-line">{payment.notes}</p> : null}
            </Bilingual>
          ) : null}
          {payment.reference && payment.reference !== cheque?.number ? (
            <Bilingual label={WORDS.reference}>
              <span dir="ltr">{payment.reference}</span>
            </Bilingual>
          ) : null}
        </div>

        <footer className="mt-14 grid grid-cols-3 gap-4 text-center text-xs text-slate-600 sm:gap-8">
          {(direction === 'out'
            ? [WORDS.accountant, WORDS.approvedBy, WORDS.receiver]
            : [WORDS.receivedBy, WORDS.accountant, WORDS.payer]
          ).map((w) => (
            <div key={w.en}>
              <div className="mb-2 h-10 border-b border-slate-400" />
              <p>{w.en}</p>
              <p dir="rtl">{w.ar}</p>
            </div>
          ))}
        </footer>
      </article>
    </div>
  );
}
