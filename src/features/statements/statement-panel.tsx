import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Download, FileSpreadsheet, MessageCircle, Printer } from 'lucide-react';
import { toast } from 'sonner';
import type { Client, InvoiceDocument, Payment } from '@/db/types';
import { DOCUMENT_ROUTES, useCompany, useFormat } from '@/app/company';
import {
  buildStatement,
  STATEMENT_PERIODS,
  statementRange,
  type Statement,
  type StatementPeriod,
  type StatementSide,
} from '@/lib/statements';
import { bankName } from '@/lib/cheques';
import { downloadCsv } from '@/lib/csv';
import { today } from '@/lib/dates';
import { fromMinor } from '@/lib/money';
import { cn } from '@/lib/cn';
import { whatsappUrl } from '@/lib/whatsapp';
import { currentLanguage, t } from '@/i18n';
import { CHEQUE_STATUS_META } from '@/lib/status';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Segmented } from '@/components/ui/misc';
import { downloadBlob, printBlob } from '@/pdf/client';
import { DOCUMENT_LANGUAGES } from '@/pdf/languages';
import { buildStatementModel } from '@/pdf/statement/model';
import type { StatementLanguage } from '@/pdf/statement/words';
import {
  entryKindLabel,
  statementCsv,
  statementFileName,
  statementMessage,
  STATEMENT_AGING,
} from './export';

const LANGUAGES = DOCUMENT_LANGUAGES.filter(
  (l): l is { value: StatementLanguage; label: string } =>
    l.value === 'ar-en' || l.value === 'ar' || l.value === 'en',
);

/** The statement language: the contact's document language when it has one we print. */
export function statementLanguageFor(
  client: Pick<Client, 'language'>,
  companyLanguage: string,
): StatementLanguage {
  const pick = client.language ?? companyLanguage;
  return pick === 'ar' || pick === 'en' || pick === 'ar-en' ? pick : 'ar-en';
}

/** Renders a statement to a PDF (the PDF code loads on first use). */
export async function statementPdf(models: Parameters<typeof buildStatementModel>[]) {
  const { renderStatementPdf } = await import('@/pdf/statement/render');
  return renderStatementPdf(models.map((args) => buildStatementModel(...args)));
}

export function StatementPanel({
  client,
  side,
  documents,
  payments,
}: {
  client: Client;
  side: StatementSide;
  documents: InvoiceDocument[];
  payments: Payment[];
}) {
  const company = useCompany();
  const fmt = useFormat();
  const now = today();
  const [period, setPeriod] = useState<StatementPeriod>('this-month');
  const [custom, setCustom] = useState(() => statementRange('this-month', now));
  const [language, setLanguage] = useState<StatementLanguage>(() =>
    statementLanguageFor(client, company.language),
  );
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null);
  const currencies = useMemo(() => {
    const own = client.currency ?? company.currency;
    const used = new Set(
      documents.filter((d) => d.status !== 'draft' && d.status !== 'void').map((d) => d.currency),
    );
    return [own, ...[...used].filter((c) => c !== own).sort()];
  }, [documents, client.currency, company.currency]);
  const [currency, setCurrency] = useState(currencies[0]);

  const range = statementRange(period, now, custom);
  const statement = useMemo(
    () =>
      buildStatement({
        side,
        documents,
        payments,
        from: range.from,
        to: range.to,
        currency,
      }),
    [side, documents, payments, range.from, range.to, currency],
  );

  const major = (minor: number) => fromMinor(minor, statement.precision);
  const money = (minor: number) => fmt.money(major(minor), currency);
  const plain = (minor: number) => (minor === 0 ? '' : money(minor));

  const render = async (mode: 'pdf' | 'print') => {
    setBusy(mode);
    try {
      const blob = await statementPdf([
        [statement, company, client, { language, printedOn: today() }],
      ]);
      if (mode === 'print') printBlob(blob);
      else downloadBlob(blob, `${statementFileName(client, statement)}.pdf`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not create the PDF.'));
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = () => {
    const { headers, rows } = statementCsv(statement, (d) => fmt.date(d));
    downloadCsv(statementFileName(client, statement), headers, rows);
  };

  const phone = client.phone || client.contacts.find((c) => c.primary)?.phone || '';
  const share = () => {
    window.open(
      whatsappUrl(phone, statementMessage(statement, company, client, language)),
      '_blank',
      'noopener',
    );
  };

  const docLink = (id: string | null) => {
    const doc = id ? documents.find((d) => d.id === id) : undefined;
    return doc ? `${DOCUMENT_ROUTES[doc.type]}/${doc.id}` : null;
  };
  const payLink = (id: string | null) =>
    id ? `${side === 'vendor' ? '/payments-made' : '/payments'}/${id}` : null;
  const linkOf = (e: Statement['entries'][number]) => payLink(e.paymentId) ?? docLink(e.documentId);

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div role="group" aria-label={t('Statement period')} className="max-w-full">
            <Segmented
              size="sm"
              value={period}
              onChange={setPeriod}
              options={STATEMENT_PERIODS.map((p) => ({ value: p.value, label: t(p.label) }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={t('Statement language')}
              value={language}
              onChange={(e) => setLanguage(e.target.value as StatementLanguage)}
              className="h-8 w-auto text-xs"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {t(l.label)}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={() => void render('pdf')} loading={busy === 'pdf'}>
              <Download /> {t('Download PDF')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void render('print')}
              loading={busy === 'print'}
            >
              <Printer /> {t('Print')}
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <FileSpreadsheet /> {t('CSV')}
            </Button>
            <Button size="sm" variant="outline" onClick={share}>
              <MessageCircle /> {t('WhatsApp')}
            </Button>
          </div>
        </div>
        {period === 'custom' || currencies.length > 1 ? (
          <div className="flex flex-wrap items-end gap-3">
            {period === 'custom' ? (
              <>
                <Field label={t('From')} className="w-40">
                  {(id) => (
                    <Input
                      id={id}
                      type="date"
                      value={custom.from}
                      onChange={(e) =>
                        e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))
                      }
                    />
                  )}
                </Field>
                <Field label={t('To')} className="w-40">
                  {(id) => (
                    <Input
                      id={id}
                      type="date"
                      value={custom.to}
                      onChange={(e) =>
                        e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))
                      }
                    />
                  )}
                </Field>
              </>
            ) : null}
            {currencies.length > 1 ? (
              <Field label={t('Currency')} className="w-32">
                {(id) => (
                  <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {currencies.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
          </div>
        ) : null}
        <p className="text-sm text-slate-500">
          {t('{from} to {to}', { from: fmt.date(range.from), to: fmt.date(range.to) })}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: t('Opening balance'), value: money(statement.opening) },
          { label: t('Debits'), value: money(statement.debits) },
          { label: t('Credits'), value: money(statement.credits) },
          {
            label: statement.closing < 0 ? t('In credit') : t('Balance due'),
            value: money(Math.abs(statement.closing)),
            strong: true,
          },
        ].map((item) => (
          <div
            key={item.label}
            className={cn(
              'rounded-lg border px-4 py-3',
              item.strong ? 'border-primary-200 bg-primary-50' : 'border-slate-200 bg-white',
            )}
          >
            <dt
              className={cn(
                'text-xs',
                item.strong ? 'text-primary-700 font-medium' : 'text-slate-500',
              )}
            >
              {item.label}
            </dt>
            <dd
              className={cn(
                'tabular mt-1 font-semibold',
                item.strong ? 'text-primary-800 text-lg' : 'text-slate-900',
              )}
              data-testid={item.strong ? 'statement-balance' : undefined}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      {statement.otherCurrencies.length ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('Documents in {currencies} are on their own statement. Pick the currency above.', {
            currencies: statement.otherCurrencies.join(', '),
          })}
        </p>
      ) : null}

      {/* Phones: one card per line. */}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 md:hidden">
        <li className="flex items-center justify-between bg-slate-50 px-4 py-2.5 text-sm">
          <span className="font-medium text-slate-700">{t('Balance brought forward')}</span>
          <span className="tabular font-semibold text-slate-900">{money(statement.opening)}</span>
        </li>
        {statement.entries.map((e) => {
          const href = linkOf(e);
          const label = (
            <>
              {entryKindLabel(e, side)} <bdi className="whitespace-nowrap">{e.number}</bdi>
            </>
          );
          return (
            <li key={e.key} className="px-4 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  {href ? (
                    <Link to={href} className="text-sm font-medium text-slate-900 hover:underline">
                      {label}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-slate-900">{label}</span>
                  )}
                  <span className="block text-xs text-slate-500">
                    {[fmt.date(e.date), e.reference].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-end">
                  <span
                    className={cn(
                      'tabular block text-sm font-medium',
                      e.amount < 0 ? 'text-emerald-700' : 'text-slate-900',
                    )}
                  >
                    {e.debit ? money(e.debit) : money(-e.credit)}
                  </span>
                  <span className="tabular text-xs text-slate-500">{money(e.balance)}</span>
                </span>
              </div>
            </li>
          );
        })}
        <li className="flex items-center justify-between bg-slate-50 px-4 py-2.5 text-sm">
          <span className="font-semibold text-slate-900">{t('Closing balance')}</span>
          <span className="tabular font-semibold text-slate-900">{money(statement.closing)}</span>
        </li>
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block">
        <table className="w-full text-sm" aria-label={t('Statement of account')}>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium tracking-wide text-slate-500 uppercase">
              <th className="px-4 py-2.5 text-start">{t('Date')}</th>
              <th className="px-3 py-2.5 text-start">{t('Description')}</th>
              <th className="px-3 py-2.5 text-start">{t('Reference')}</th>
              <th className="px-3 py-2.5 text-start">{t('Due date')}</th>
              <th className="px-3 py-2.5 text-end">{t('Debit')}</th>
              <th className="px-3 py-2.5 text-end">{t('Credit')}</th>
              <th className="px-4 py-2.5 text-end">{t('Balance')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-slate-50/60">
              <td className="px-4 py-2 text-slate-500">{fmt.date(statement.from)}</td>
              <td className="px-3 py-2 font-medium text-slate-700" colSpan={5}>
                {t('Balance brought forward')}
              </td>
              <td className="tabular px-4 py-2 text-end font-semibold text-slate-900">
                {money(statement.opening)}
              </td>
            </tr>
            {statement.entries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  {t('No transactions in this period.')}
                </td>
              </tr>
            ) : null}
            {statement.entries.map((e) => {
              const href = linkOf(e);
              const label = (
                <>
                  {entryKindLabel(e, side)} <bdi className="whitespace-nowrap">{e.number}</bdi>
                </>
              );
              const muted = e.kind === 'retention' || e.voided || e.kind === 'release_undone';
              return (
                <tr key={e.key} className={muted ? 'text-slate-500' : 'text-slate-800'}>
                  <td className="tabular px-4 py-2 whitespace-nowrap">{fmt.date(e.date)}</td>
                  <td className="px-3 py-2">
                    {href ? (
                      <Link to={href} className="hover:text-primary-700 hover:underline">
                        {label}
                      </Link>
                    ) : (
                      label
                    )}
                    {e.voided ? (
                      <Badge tone="red" className="ms-2">
                        {t('Returned')}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {e.cheque
                      ? `${e.cheque.number} · ${bankName(e.cheque.bank, currentLanguage())}`
                      : e.reference}
                  </td>
                  <td className="tabular px-3 py-2 whitespace-nowrap text-slate-500">
                    {fmt.date(e.dueDate)}
                  </td>
                  <td className="tabular px-3 py-2 text-end">{plain(e.debit)}</td>
                  <td className="tabular px-3 py-2 text-end">{plain(e.credit)}</td>
                  <td className="tabular px-4 py-2 text-end font-medium text-slate-900">
                    {money(e.balance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
              <td className="px-4 py-2.5">{fmt.date(statement.to)}</td>
              <td className="px-3 py-2.5" colSpan={3}>
                {t('Closing balance')}
              </td>
              <td className="tabular px-3 py-2.5 text-end">{money(statement.debits)}</td>
              <td className="tabular px-3 py-2.5 text-end">{money(statement.credits)}</td>
              <td className="tabular px-4 py-2.5 text-end">{money(statement.closing)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <section aria-labelledby="statement-aging">
        <h3 id="statement-aging" className="mb-2 text-sm font-semibold text-slate-900">
          {t('Aging on {date}', { date: fmt.date(statement.to) })}
        </h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {STATEMENT_AGING.map((label, i) => (
            <div key={label} className="rounded-lg border border-slate-200 px-3 py-2">
              <dt className="text-xs text-slate-500">{t(label)}</dt>
              <dd
                className={cn(
                  'tabular mt-0.5 text-sm font-semibold',
                  i > 0 && statement.aging.buckets[i] > 0 ? 'text-red-600' : 'text-slate-900',
                )}
              >
                {money(statement.aging.buckets[i])}
              </dd>
            </div>
          ))}
          <div className="border-primary-200 bg-primary-50 rounded-lg border px-3 py-2">
            <dt className="text-primary-700 text-xs">{t('Total')}</dt>
            <dd className="tabular text-primary-800 mt-0.5 text-sm font-semibold">
              {money(statement.aging.buckets.reduce((a, b) => a + b, 0))}
            </dd>
          </div>
        </dl>
        {statement.aging.unapplied !== 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            {t('Less credits not yet applied: {amount}', {
              amount: money(statement.aging.unapplied),
            })}
          </p>
        ) : null}
      </section>

      {statement.retentionHeld !== 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <span>{t('Retention held, not yet due')}</span>
          <span className="tabular font-semibold">{money(statement.retentionHeld)}</span>
        </div>
      ) : null}

      {statement.cheques.length ? (
        <section aria-labelledby="statement-cheques">
          <h3 id="statement-cheques" className="text-sm font-semibold text-slate-900">
            {side === 'vendor' ? t('Cheques not yet presented') : t('Cheques not yet cleared')}
          </h3>
          <p className="mb-2 text-xs text-slate-500">
            {t('They are in the payments above and count once the bank clears them.')}
          </p>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {statement.cheques.map((c) => (
              <li
                key={c.paymentId}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
              >
                <span>
                  <span className="font-medium text-slate-800">
                    {t('Cheque {number}', { number: c.chequeNumber })}
                  </span>
                  <span className="ms-2 text-xs text-slate-500">
                    {[bankName(c.bank, currentLanguage()), fmt.date(c.date)].join(' · ')}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={CHEQUE_STATUS_META[c.status].tone}>
                    {t(CHEQUE_STATUS_META[c.status].label)}
                  </Badge>
                  <span className="tabular font-semibold text-slate-900">{money(c.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
