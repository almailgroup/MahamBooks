import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Printer } from 'lucide-react';
import { db } from '@/db/db';
import type { Client } from '@/db/types';
import { useCompany } from '@/app/company';
import {
  bankName,
  chequePayments,
  daysToMaturity,
  isOpenCheque,
  matchesChequeFilter,
  paymentMinor,
  sortCheques,
  type ChequeFilter,
} from '@/lib/cheques';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { currencyPrecision, fromMinor } from '@/lib/money';
import { today } from '@/lib/dates';
import { chequeStatusMeta, SECURITY_CHEQUE_STATUS_META } from '@/lib/status';
import { t } from '@/i18n';
import arabic from '@/i18n/ar/payments';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { registerFilter, registerTab, type RegisterTab } from '@/features/cheques/register';

const EN = 'en-KW';

/** Arabic of a label from the payments dictionary, whatever the interface language. */
function inArabic(text: string): string {
  const found = (arabic as Record<string, unknown>)[text];
  return typeof found === 'string' ? found : text;
}

type Words = { en: string; ar: string };

const TITLES: Record<RegisterTab, Words> = {
  received: { en: 'Cheques received', ar: 'الشيكات المستلمة' },
  issued: { en: 'Cheques issued', ar: 'الشيكات الصادرة' },
  security: { en: 'Security cheques', ar: 'شيكات الضمان' },
};

const FILTERS: Record<ChequeFilter, Words> = {
  open: { en: 'Open', ar: 'قائمة' },
  week: { en: 'Due in 7 days', ar: 'تستحق خلال 7 أيام' },
  overdue: { en: 'Overdue', ar: 'متأخرة' },
  returned: { en: 'Returned', ar: 'مرتجعة' },
  all: { en: 'All', ar: 'الكل' },
};

const COLUMNS = {
  date: { en: 'Cheque date', ar: 'تاريخ الشيك' },
  number: { en: 'Number', ar: 'الرقم' },
  bank: { en: 'Bank', ar: 'البنك' },
  drawer: { en: 'Drawer', ar: 'الساحب' },
  payee: { en: 'Payee', ar: 'المستفيد' },
  purpose: { en: 'Purpose', ar: 'الغرض' },
  amount: { en: 'Amount', ar: 'المبلغ' },
  status: { en: 'Status', ar: 'الحالة' },
  days: { en: 'Days', ar: 'الأيام' },
  total: { en: 'Total', ar: 'الإجمالي' },
  printed: { en: 'Printed', ar: 'تاريخ الطباعة' },
  register: { en: 'Cheque register', ar: 'سجل الشيكات' },
  none: { en: 'No cheques.', ar: 'لا توجد شيكات.' },
};

function Head({ words, end }: { words: Words; end?: boolean }) {
  return (
    <th
      className={`border border-slate-300 px-2 py-1.5 font-semibold ${end ? 'text-end' : 'text-start'}`}
    >
      <span className="block">{words.en}</span>
      <span className="block font-normal text-slate-600" dir="rtl">
        {words.ar}
      </span>
    </th>
  );
}

function Both({ en, ar }: Words) {
  return (
    <>
      <span className="block">{en}</span>
      {ar !== en ? (
        <span className="block text-slate-600" dir="rtl">
          {ar}
        </span>
      ) : null}
    </>
  );
}

/** The cheque register laid out for printing, in English and Arabic. */
export default function ChequeRegisterPrintPage() {
  const company = useCompany();
  const [params] = useSearchParams();
  const tab = registerTab(params.get('tab'));
  const filter = registerFilter(params.get('filter'));
  const allSecurity = params.get('all') === '1';
  const payments = useLiveQuery(
    () => db.payments.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const security = useLiveQuery(
    () => db.securityCheques.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const [now] = useState(today);
  const precision = currencyPrecision(company.currency);
  const display = company.currencyDisplay ?? 'local';

  useEffect(() => {
    const before = document.title;
    document.title = `${COLUMNS.register.en} – ${TITLES[tab].en}`;
    return () => {
      document.title = before;
    };
  }, [tab]);

  const rows = useMemo(() => {
    if (!payments) return [];
    const list = chequePayments(payments, tab === 'issued' ? 'out' : 'in').filter((p) =>
      matchesChequeFilter(p.cheque, filter, now),
    );
    return sortCheques(list, filter);
  }, [payments, tab, filter, now]);

  if (!payments || !clients || !security)
    return <Spinner className="min-h-dvh" label={t('Loading…')} />;

  const byClient = new Map<string, Client>(clients.map((c) => [c.id, c]));
  const name = (clientId: string | null) => {
    const c = clientId ? byClient.get(clientId) : undefined;
    return c ? { en: c.name, ar: c.nameAr?.trim() || c.name } : { en: '', ar: '' };
  };
  const securityRows = security
    .filter((s) => allSecurity || s.status === 'held')
    .sort((a, b) => (b.date ?? b.createdAt).localeCompare(a.date ?? a.createdAt));
  const total =
    tab === 'security'
      ? securityRows
          .filter((s) => s.currency === company.currency)
          .reduce((sum, s) => sum + paymentMinor(s, company.currency, precision), 0)
      : rows
          .filter((p) => !p.voided)
          .reduce((sum, p) => sum + paymentMinor(p, company.currency, precision), 0);
  const companyAr = company.nameAr?.trim() || company.name;
  const count = tab === 'security' ? securityRows.length : rows.length;

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 print:hidden">
        <Link
          to={`/cheques?tab=${tab}&filter=${filter}`}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" /> {t('Back to the register')}
        </Link>
        <Button onClick={() => window.print()}>
          <Printer /> {t('Print')}
        </Button>
      </div>

      <article className="mx-auto max-w-5xl bg-white p-4 text-xs shadow-sm ring-1 ring-slate-200 sm:p-8 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b-2 border-slate-800 pb-3">
          <div dir="ltr">
            <p className="text-sm font-semibold text-slate-900">{company.name}</p>
            <p className="text-slate-600">
              {COLUMNS.register.en} – {TITLES[tab].en}
              {tab === 'security' ? '' : ` (${FILTERS[filter].en})`}
            </p>
          </div>
          <div dir="rtl" className="text-start">
            <p className="text-sm font-semibold text-slate-900">{companyAr}</p>
            <p className="text-slate-600">
              {COLUMNS.register.ar} – {TITLES[tab].ar}
              {tab === 'security' ? '' : ` (${FILTERS[filter].ar})`}
            </p>
          </div>
          <p className="w-full text-slate-500">
            {COLUMNS.printed.en} / {COLUMNS.printed.ar}:{' '}
            <span dir="ltr">{formatDateTime(new Date().toISOString(), EN)}</span>
          </p>
        </header>

        {count === 0 ? (
          <p className="py-6 text-center text-slate-500">
            {COLUMNS.none.en} <span dir="rtl">{COLUMNS.none.ar}</span>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <Head words={COLUMNS.date} />
                  <Head words={COLUMNS.number} />
                  <Head words={COLUMNS.bank} />
                  <Head words={tab === 'issued' ? COLUMNS.payee : COLUMNS.drawer} />
                  {tab === 'security' ? <Head words={COLUMNS.purpose} /> : null}
                  <Head words={COLUMNS.amount} end />
                  <Head words={COLUMNS.status} />
                  {tab === 'security' ? null : <Head words={COLUMNS.days} end />}
                </tr>
              </thead>
              <tbody>
                {tab === 'security'
                  ? securityRows.map((s) => {
                      const meta = SECURITY_CHEQUE_STATUS_META[s.status];
                      const who = name(s.clientId);
                      return (
                        <tr key={s.id} className="break-inside-avoid">
                          <td className="border border-slate-300 px-2 py-1.5" dir="ltr">
                            {s.date ? formatDate(s.date, company.dateFormat, EN) : '—'}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5" dir="ltr">
                            {s.number}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5">
                            {s.bank ? (
                              <Both en={bankName(s.bank, 'en')} ar={bankName(s.bank, 'ar')} />
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5">
                            {s.drawer || <Both {...who} />}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5">{s.purpose}</td>
                          <td
                            className="tabular border border-slate-300 px-2 py-1.5 text-end"
                            dir="ltr"
                          >
                            {formatMoney(s.amount, s.currency, EN, display)}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5">
                            <Both en={meta.label} ar={inArabic(meta.label)} />
                          </td>
                        </tr>
                      );
                    })
                  : rows.map((p) => {
                      const meta = chequeStatusMeta(
                        p.cheque.status,
                        tab === 'issued' ? 'out' : 'in',
                      );
                      const who = name(p.clientId);
                      const days = isOpenCheque(p.cheque.status)
                        ? daysToMaturity(p.cheque.date, now)
                        : null;
                      return (
                        <tr key={p.id} className="break-inside-avoid">
                          <td className="border border-slate-300 px-2 py-1.5" dir="ltr">
                            {formatDate(p.cheque.date, company.dateFormat, EN)}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5" dir="ltr">
                            {p.cheque.number}
                            <span className="block text-slate-500">{p.number}</span>
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5">
                            {p.cheque.bank ? (
                              <Both
                                en={bankName(p.cheque.bank, 'en')}
                                ar={bankName(p.cheque.bank, 'ar')}
                              />
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5">
                            {p.cheque.drawer ? (
                              <span className="block">{p.cheque.drawer}</span>
                            ) : null}
                            {who.en && who.en !== p.cheque.drawer ? <Both {...who} /> : null}
                          </td>
                          <td
                            className={`tabular border border-slate-300 px-2 py-1.5 text-end ${p.voided ? 'text-slate-400 line-through' : ''}`}
                            dir="ltr"
                          >
                            {formatMoney(p.amount, p.currency, EN, display)}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5">
                            <Both en={meta.label} ar={inArabic(meta.label)} />
                          </td>
                          <td
                            className="tabular border border-slate-300 px-2 py-1.5 text-end"
                            dir="ltr"
                          >
                            {days === null ? '—' : days > 0 ? `+${days}` : String(days)}
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td
                    className="border border-slate-300 px-2 py-1.5"
                    colSpan={tab === 'security' ? 5 : 4}
                  >
                    {COLUMNS.total.en} / <span dir="rtl">{COLUMNS.total.ar}</span> ({count})
                  </td>
                  <td className="tabular border border-slate-300 px-2 py-1.5 text-end" dir="ltr">
                    {formatMoney(fromMinor(total, precision), company.currency, EN, display)}
                  </td>
                  <td className="border border-slate-300" colSpan={tab === 'security' ? 1 : 2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}
