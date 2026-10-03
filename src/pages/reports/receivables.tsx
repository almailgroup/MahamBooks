import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { heldRetention } from '@/db/retention';
import { isCustomer, isVendor } from '@/db/purchases';
import type { Client, InvoiceDocument, Payment } from '@/db/types';
import { DOCUMENT_ROUTES, useCompany, useFormat } from '@/app/company';
import { isPosted } from '@/lib/accounting/ledger';
import { downloadCsv } from '@/lib/csv';
import { daysBetween, today } from '@/lib/dates';
import { fromMinor } from '@/lib/money';
import { cn } from '@/lib/cn';
import {
  buildStatement,
  contactPosition,
  STATEMENT_PERIODS,
  statementRange,
  type StatementPeriod,
} from '@/lib/statements';
import { retentionKindLabel, RETENTION_STATUS_META, retentionStatus } from '@/lib/retention';
import { msg, t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Field, Select } from '@/components/ui/form';
import { Badge, Card, EmptyState, Segmented, Spinner } from '@/components/ui/misc';
import { CreditBar } from '@/features/clients/contact-summary';
import { statementLanguageFor, statementPdf } from '@/features/statements/statement-panel';
import { downloadBlob } from '@/pdf/client';
import { DOCUMENT_LANGUAGES } from '@/pdf/languages';
import type { StatementLanguage } from '@/pdf/statement/words';

export type ReceivablesReportId = 'statements' | 'retentions' | 'exposure';

function Th({ children, end }: { children?: ReactNode; end?: boolean }) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-xs font-medium tracking-wide whitespace-nowrap text-slate-500 uppercase',
        end ? 'text-end' : 'text-start',
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  end,
  className,
}: {
  children?: ReactNode;
  end?: boolean;
  className?: string;
}) {
  return (
    <td className={cn('px-4 py-2.5', end && 'tabular text-end whitespace-nowrap', className)}>
      {children}
    </td>
  );
}

/** Everything of a company, grouped by contact. */
function useCompanyRecords() {
  const company = useCompany();
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const documents = useLiveQuery(
    () => db.documents.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const payments = useLiveQuery(
    () => db.payments.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  return useMemo(() => {
    if (!clients || !documents || !payments) return null;
    const docsBy = new Map<string, InvoiceDocument[]>();
    for (const d of documents) docsBy.set(d.clientId, [...(docsBy.get(d.clientId) ?? []), d]);
    const paysBy = new Map<string, Payment[]>();
    for (const p of payments) paysBy.set(p.clientId, [...(paysBy.get(p.clientId) ?? []), p]);
    return {
      clients: [...clients].sort((a, b) => localName(a).localeCompare(localName(b))),
      docsOf: (id: string) => docsBy.get(id) ?? [],
      paymentsOf: (id: string) => paysBy.get(id) ?? [],
    };
  }, [clients, documents, payments]);
}

const LANGUAGES = DOCUMENT_LANGUAGES.filter(
  (l): l is { value: StatementLanguage; label: string } =>
    l.value === 'ar-en' || l.value === 'ar' || l.value === 'en',
);

/* -------------------------------------------------------------------------- */
/* Statements for every customer with a balance                               */
/* -------------------------------------------------------------------------- */

function StatementsReport() {
  const company = useCompany();
  const fmt = useFormat();
  const records = useCompanyRecords();
  const now = today();
  const [period, setPeriod] = useState<StatementPeriod>('last-month');
  const [custom, setCustom] = useState(() => statementRange('last-month', now));
  const [language, setLanguage] = useState<StatementLanguage>(() =>
    statementLanguageFor({ language: null }, company.language),
  );
  const [busy, setBusy] = useState(false);
  const range = statementRange(period, now, custom);

  const rows = useMemo(() => {
    if (!records) return null;
    return records.clients
      .filter((c) => isCustomer(c) && !c.archived)
      .map((client) => ({
        client,
        statement: buildStatement({
          side: 'customer',
          documents: records.docsOf(client.id),
          payments: records.paymentsOf(client.id),
          from: range.from,
          to: range.to,
          currency: client.currency ?? company.currency,
        }),
      }))
      .filter((r) => r.statement.closing !== 0);
  }, [records, range.from, range.to, company.currency]);

  if (!rows) return <Spinner className="py-24" label={t('Loading…')} />;

  const money = (minor: number, currency: string, precision: number) =>
    fmt.money(fromMinor(minor, precision), currency);
  const downloadAll = async () => {
    setBusy(true);
    const pending = toast.loading(
      tp(rows.length, 'Preparing {count} statement…', 'Preparing {count} statements…'),
    );
    try {
      const blob = await statementPdf(
        rows.map((r) => [r.statement, company, r.client, { language, printedOn: today() }]),
      );
      downloadBlob(blob, `Statements ${range.from} to ${range.to}.pdf`);
      toast.success(tp(rows.length, '{count} statement ready', '{count} statements ready'), {
        id: pending,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not create the PDF.'), {
        id: pending,
      });
    } finally {
      setBusy(false);
    }
  };
  const exportCsv = () =>
    downloadCsv(
      `Statements ${range.from} to ${range.to}`,
      [
        t('Client'),
        t('Number'),
        t('Currency'),
        t('Opening balance'),
        t('Debits'),
        t('Credits'),
        t('Closing balance'),
        t('Overdue'),
        t('Retention held'),
      ],
      rows.map(({ client, statement: s }) => {
        const amount = (minor: number) => fromMinor(minor, s.precision).toFixed(s.precision);
        return [
          client.name,
          client.number,
          s.currency,
          amount(s.opening),
          amount(s.debits),
          amount(s.credits),
          amount(s.closing),
          amount(s.aging.buckets.slice(1).reduce((a, b) => a + b, 0)),
          amount(s.retentionHeld),
        ];
      }),
    );

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
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
            <Button
              size="sm"
              onClick={() => void downloadAll()}
              loading={busy}
              disabled={rows.length === 0}
            >
              <Download /> {t('Download all as one PDF')}
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <FileSpreadsheet /> {t('CSV')}
            </Button>
          </div>
        </div>
        {period === 'custom' ? (
          <div className="flex flex-wrap gap-3">
            <Field label={t('From')} className="w-40">
              {(id) => (
                <DateField
                  id={id}
                  required
                  value={custom.from}
                  onChange={(iso) => iso && setCustom((c) => ({ ...c, from: iso }))}
                />
              )}
            </Field>
            <Field label={t('To')} className="w-40">
              {(id) => (
                <DateField
                  id={id}
                  required
                  value={custom.to}
                  onChange={(iso) => iso && setCustom((c) => ({ ...c, to: iso }))}
                />
              )}
            </Field>
          </div>
        ) : null}
        <p className="text-sm text-slate-500">
          {t('Clients with a balance on {date}, with what happened from {from} to {to}.', {
            date: fmt.date(range.to),
            from: fmt.date(range.from),
            to: fmt.date(range.to),
          })}
        </p>
      </Card>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title={t('No client has a balance')}
            description={t('Statements show here for clients who owe you or are in credit.')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100">
                <tr>
                  <Th>{t('Client')}</Th>
                  <Th end>{t('Opening balance')}</Th>
                  <Th end>{t('Debits')}</Th>
                  <Th end>{t('Credits')}</Th>
                  <Th end>{t('Closing balance')}</Th>
                  <Th end>{t('Overdue')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ client, statement: s }) => {
                  const m = (minor: number) => money(minor, s.currency, s.precision);
                  const overdue = s.aging.buckets.slice(1).reduce((a, b) => a + b, 0);
                  return (
                    <tr key={client.id}>
                      <Td>
                        <Link
                          to={`/clients/${client.id}?tab=statement`}
                          className="hover:text-primary-700 font-medium text-slate-900"
                        >
                          {localName(client)}
                        </Link>
                        <span className="block text-xs text-slate-500">{client.number}</span>
                      </Td>
                      <Td end>{m(s.opening)}</Td>
                      <Td end>{m(s.debits)}</Td>
                      <Td end>{m(s.credits)}</Td>
                      <Td end className="font-semibold text-slate-900">
                        {m(s.closing)}
                      </Td>
                      <Td
                        end
                        className={overdue > 0 ? 'font-medium text-red-600' : 'text-slate-500'}
                      >
                        {m(overdue)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Retentions                                                                 */
/* -------------------------------------------------------------------------- */

const AGE_BANDS = [
  { label: msg('Under 3 months'), max: 90 },
  { label: msg('3 to 6 months'), max: 182 },
  { label: msg('6 to 12 months'), max: 365 },
  { label: msg('Over a year'), max: Infinity },
];

function RetentionsReport() {
  const company = useCompany();
  const fmt = useFormat();
  const records = useCompanyRecords();
  const [side, setSide] = useState<'customer' | 'vendor'>('customer');
  const now = today();

  const rows = useMemo(() => {
    if (!records) return null;
    const type = side === 'vendor' ? 'bill' : 'invoice';
    return records.clients
      .filter((c) => (side === 'vendor' ? isVendor(c) : isCustomer(c)))
      .flatMap((client) =>
        records
          .docsOf(client.id)
          .filter((d) => d.type === type && isPosted(d) && heldRetention(d) > 0)
          .sort((a, b) => a.issueDate.localeCompare(b.issueDate))
          .map((doc) => ({
            client,
            doc,
            held: heldRetention(doc),
            age: daysBetween(doc.issueDate, now),
            status: retentionStatus(doc.retentionKind ?? client.retentionKind, client, now),
          })),
      );
  }, [records, side, now]);

  if (!rows) return <Spinner className="py-24" label={t('Loading…')} />;
  const own = rows.filter((r) => r.doc.currency === company.currency);
  const total = own.reduce((s, r) => s + r.held, 0);
  const bands = AGE_BANDS.map((band, i) =>
    own
      .filter((r) => r.age <= band.max && (i === 0 || r.age > AGE_BANDS[i - 1].max))
      .reduce((s, r) => s + r.held, 0),
  );
  const base = side === 'vendor' ? '/vendors' : '/clients';
  const exportCsv = () =>
    downloadCsv(
      `Retentions ${now}`,
      [
        side === 'vendor' ? t('Vendor') : t('Client'),
        t('Document'),
        t('Date'),
        t('Days'),
        t('Kind'),
        t('Currency'),
        t('Retention'),
        t('Released'),
        t('Still held'),
        t('Status'),
      ],
      rows.map((r) => [
        r.client.name,
        r.doc.number,
        r.doc.issueDate,
        r.age,
        t(retentionKindLabel(r.doc.retentionKind ?? r.client.retentionKind)),
        r.doc.currency,
        r.doc.totals.retention ?? 0,
        (r.doc.totals.retention ?? 0) - r.held,
        r.held,
        t(RETENTION_STATUS_META[r.status].label),
      ]),
    );

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          size="sm"
          value={side}
          onChange={setSide}
          options={[
            { value: 'customer', label: t('Held by clients') },
            { value: 'vendor', label: t('Held from vendors') },
          ]}
        />
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <FileSpreadsheet /> {t('CSV')}
        </Button>
      </Card>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {AGE_BANDS.map((band, i) => (
          <div key={band.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <dt className="text-xs text-slate-500">{t(band.label)}</dt>
            <dd className="tabular mt-1 font-semibold text-slate-900">{fmt.money(bands[i])}</dd>
          </div>
        ))}
        <div className="border-primary-200 bg-primary-50 col-span-2 rounded-lg border px-4 py-3 lg:col-span-1">
          <dt className="text-primary-700 text-xs font-medium">{t('Total held')}</dt>
          <dd className="tabular text-primary-800 mt-1 font-semibold">{fmt.money(total)}</dd>
        </div>
      </dl>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title={t('Nothing is held back')}
            description={
              side === 'vendor'
                ? t('Retentions you hold from vendors’ bills show here until you release them.')
                : t('Retentions clients hold from your invoices show here until they are released.')
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100">
                <tr>
                  <Th>{side === 'vendor' ? t('Vendor') : t('Client')}</Th>
                  <Th>{t('Document')}</Th>
                  <Th end>{t('Age')}</Th>
                  <Th end>{t('Still held')}</Th>
                  <Th>{t('Status')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const meta = RETENTION_STATUS_META[r.status];
                  return (
                    <tr key={r.doc.id}>
                      <Td>
                        <Link
                          to={`${base}/${r.client.id}?tab=retentions`}
                          className="hover:text-primary-700 font-medium text-slate-900"
                        >
                          {localName(r.client)}
                        </Link>
                      </Td>
                      <Td>
                        <Link
                          to={`${DOCUMENT_ROUTES[r.doc.type]}/${r.doc.id}`}
                          className="hover:text-primary-700 text-slate-700"
                        >
                          {r.doc.number}
                        </Link>
                        <span className="block text-xs text-slate-500">
                          {[
                            fmt.date(r.doc.issueDate),
                            r.doc.retentionPercent ? fmt.percent(r.doc.retentionPercent) : '',
                            t(retentionKindLabel(r.doc.retentionKind ?? r.client.retentionKind)),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </Td>
                      <Td end>
                        {r.age > 0 ? tp(r.age, '{count} day', '{count} days') : t('Today')}
                      </Td>
                      <Td end className="font-semibold text-slate-900">
                        {fmt.money(r.held, r.doc.currency)}
                      </Td>
                      <Td>
                        <Badge tone={meta.tone}>{t(meta.label)}</Badge>
                      </Td>
                      <Td end>
                        <Link
                          to={`${base}/${r.client.id}?tab=retentions`}
                          className="text-primary-700 text-sm font-medium hover:underline"
                        >
                          {t('Release')}
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Customer exposure                                                          */
/* -------------------------------------------------------------------------- */

function ExposureReport() {
  const company = useCompany();
  const fmt = useFormat();
  const records = useCompanyRecords();
  const now = today();

  const rows = useMemo(() => {
    if (!records) return null;
    return records.clients
      .filter((c) => isCustomer(c) && !c.archived)
      .map((client: Client) => {
        const payments = records.paymentsOf(client.id);
        const position = contactPosition({
          side: 'customer',
          client,
          documents: records.docsOf(client.id),
          payments,
          companyCurrency: company.currency,
          todayIso: now,
        });
        const returned = payments.filter(
          (p) => p.direction !== 'out' && p.cheque?.status === 'returned',
        ).length;
        return { client, position, returned };
      })
      .filter(
        (r) =>
          r.position.exposure > 0 ||
          r.position.limit !== null ||
          r.client.creditHold ||
          r.returned > 0,
      )
      .sort((a, b) => {
        const share = (r: typeof a) =>
          r.position.limit ? r.position.exposure / r.position.limit : r.position.exposure ? 1 : 0;
        return share(b) - share(a) || b.position.exposure - a.position.exposure;
      });
  }, [records, company.currency, now]);

  if (!rows) return <Spinner className="py-24" label={t('Loading…')} />;
  const money = (minor: number, precision: number) => fmt.money(fromMinor(minor, precision));
  const exportCsv = () =>
    downloadCsv(
      `Customer exposure ${now}`,
      [
        t('Client'),
        t('Credit limit'),
        t('Balance due'),
        t('Cheques not yet cleared'),
        t('Exposure'),
        t('Available'),
        t('Overdue'),
        t('Returned cheques'),
        t('On credit hold'),
      ],
      rows.map(({ client, position: p, returned }) => {
        const amount = (minor: number) => fromMinor(minor, p.precision).toFixed(p.precision);
        return [
          client.name,
          p.limit === null ? '' : amount(p.limit),
          amount(p.balance),
          amount(p.uncleared),
          amount(p.exposure),
          p.available === null ? '' : amount(p.available),
          amount(p.overdue),
          returned,
          client.creditHold ? t('Yes') : '',
        ];
      }),
    );

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          {t('What each client owes, plus cheques they gave that have not cleared yet.')}
        </p>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <FileSpreadsheet /> {t('CSV')}
        </Button>
      </Card>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title={t('No credit to watch')}
            description={t('Clients who owe you, have a credit limit or are on hold show here.')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100">
                <tr>
                  <Th>{t('Client')}</Th>
                  <Th end>{t('Balance due')}</Th>
                  <Th end>{t('Cheques not yet cleared')}</Th>
                  <Th end>{t('Exposure')}</Th>
                  <Th>{t('Credit limit')}</Th>
                  <Th end>{t('Overdue')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ client, position: p, returned }) => (
                  <tr key={client.id}>
                    <Td>
                      <Link
                        to={`/clients/${client.id}`}
                        className="hover:text-primary-700 font-medium text-slate-900"
                      >
                        {localName(client)}
                      </Link>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {client.creditHold ? <Badge tone="red">{t('On credit hold')}</Badge> : null}
                        {returned ? (
                          <Badge tone="red">
                            {tp(returned, '{count} returned cheque', '{count} returned cheques')}
                          </Badge>
                        ) : null}
                      </span>
                    </Td>
                    <Td end>{money(p.balance, p.precision)}</Td>
                    <Td end>{money(p.uncleared, p.precision)}</Td>
                    <Td end className="font-semibold text-slate-900">
                      {money(p.exposure, p.precision)}
                    </Td>
                    <Td className="min-w-44">
                      {p.limit === null ? (
                        <span className="text-slate-500">{t('No credit limit')}</span>
                      ) : (
                        <>
                          <span className="tabular text-xs text-slate-600">
                            {p.available !== null && p.available < 0
                              ? t('{amount} over the limit of {limit}', {
                                  amount: money(-p.available, p.precision),
                                  limit: money(p.limit, p.precision),
                                })
                              : t('{amount} left of {limit}', {
                                  amount: money(p.available ?? 0, p.precision),
                                  limit: money(p.limit, p.precision),
                                })}
                          </span>
                          <CreditBar used={p.exposure} limit={p.limit} />
                        </>
                      )}
                    </Td>
                    <Td
                      end
                      className={p.overdue > 0 ? 'font-medium text-red-600' : 'text-slate-500'}
                    >
                      {money(p.overdue, p.precision)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function ReceivablesReports({ report }: { report: ReceivablesReportId }) {
  if (report === 'statements') return <StatementsReport />;
  if (report === 'retentions') return <RetentionsReport />;
  return <ExposureReport />;
}
