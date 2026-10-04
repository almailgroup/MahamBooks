import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  FileUp,
  Package,
  Scale,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCompany, useFormat } from '@/app/company';
import {
  commitImport,
  loadImportContext,
  planImport,
  type ImportOptions,
  type ImportPlan,
  type ImportResult,
  type PlannedRow,
  type RowIssue,
} from '@/db/import';
import {
  BILL_TEMPLATE_ROWS,
  decodeCsv,
  guessColumns,
  IMPORT_COLUMNS,
  TEMPLATE_ROWS,
  type ColumnMapping,
  type ImportKind,
} from '@/features/company/import-columns';
import {
  detectDateFormats,
  parseCsvRows,
  type DateFormat as CsvDateFormat,
} from '@/lib/banking/statement';
import { downloadCsv } from '@/lib/csv';
import { fromMinor, currencyPrecision } from '@/lib/money';
import { addDaysISO, isISODate, today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { msg, t, tp } from '@/i18n';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { Badge, Segmented } from '@/components/ui/misc';
import { SettingsSection } from './shared';
import { DateField } from '@/components/ui/date-field';

const MAX_BYTES = 5 * 1024 * 1024;
const PREVIEW_LIMIT = 200;

const KINDS: { value: ImportKind; title: string; text: string; icon: ReactNode }[] = [
  {
    value: 'contacts',
    title: msg('Customers and vendors'),
    text: msg('Names in English and Arabic, contact details, addresses and what they owe.'),
    icon: <Users />,
  },
  {
    value: 'products',
    title: msg('Products and services'),
    text: msg('Names in English and Arabic, codes, units and prices.'),
    icon: <Package />,
  },
  {
    value: 'opening',
    title: msg('Opening balances'),
    text: msg('Account balances on the day you start, from your trial balance.'),
    icon: <Scale />,
  },
  {
    value: 'documents',
    title: msg('Open invoices and bills'),
    text: msg('Invoices your customers have not paid yet, and bills you have not paid.'),
    icon: <FileText />,
  },
];

const DATE_FORMATS: { value: CsvDateFormat; label: string }[] = [
  { value: 'dd/MM/yyyy', label: msg('31/12/2026 (day first)') },
  { value: 'MM/dd/yyyy', label: msg('12/31/2026 (month first)') },
  { value: 'yyyy-MM-dd', label: '2026-12-31' },
  { value: 'dd.MM.yyyy', label: '31.12.2026' },
  { value: 'dd-MM-yyyy', label: '31-12-2026' },
  { value: 'd MMM yyyy', label: msg('31 Dec 2026') },
  { value: 'yyyyMMdd', label: '20261231' },
];

/** Last day of the previous month: balances are usually brought in as at a month end. */
function defaultAsOf(): string {
  return addDaysISO(`${today().slice(0, 8)}01`, -1);
}

function readyText(kind: ImportKind, documentType: 'invoice' | 'bill', count: number): string {
  if (kind === 'contacts') return tp(count, '{count} contact ready', '{count} contacts ready');
  if (kind === 'products') return tp(count, '{count} item ready', '{count} items ready');
  if (kind === 'opening') return tp(count, '{count} balance ready', '{count} balances ready');
  return documentType === 'invoice'
    ? tp(count, '{count} invoice ready', '{count} invoices ready')
    : tp(count, '{count} bill ready', '{count} bills ready');
}

function importLabel(kind: ImportKind, documentType: 'invoice' | 'bill', count: number): string {
  if (kind === 'contacts') return tp(count, 'Import {count} contact', 'Import {count} contacts');
  if (kind === 'products') return tp(count, 'Import {count} item', 'Import {count} items');
  if (kind === 'opening') return t('Post opening balances');
  return documentType === 'invoice'
    ? tp(count, 'Import {count} invoice', 'Import {count} invoices')
    : tp(count, 'Import {count} bill', 'Import {count} bills');
}

function doneText(result: ImportResult, documentType: 'invoice' | 'bill'): string {
  const n = result.added;
  if (result.kind === 'contacts')
    return tp(n, '{count} contact imported', '{count} contacts imported');
  if (result.kind === 'products') return tp(n, '{count} item imported', '{count} items imported');
  if (result.kind === 'opening')
    return t('Opening balances posted in journal {number}', { number: result.journalNumber ?? '' });
  return documentType === 'invoice'
    ? tp(n, '{count} invoice imported', '{count} invoices imported')
    : tp(n, '{count} bill imported', '{count} bills imported');
}

const ISSUE_TONE: Record<RowIssue['level'], string> = {
  error: 'text-red-700',
  skip: 'text-slate-500',
  warning: 'text-amber-700',
  info: 'text-sky-700',
};

function LabeledGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col items-start gap-1.5">
      <p id={id} className="text-sm font-medium text-slate-700">
        {label}
      </p>
      {children}
    </div>
  );
}

function StatusBadge({ row }: { row: PlannedRow }) {
  if (row.status === 'error') return <Badge tone="red">{t('Problem')}</Badge>;
  if (row.status === 'skipped') return <Badge tone="gray">{t('Skipped')}</Badge>;
  return <Badge tone="green">{t('Ready')}</Badge>;
}

/** The few values that identify a row, by kind; amounts as they will be booked. */
function rowSummary(kind: ImportKind, row: PlannedRow, money: (amount: number) => string) {
  const { cells, record } = row;
  switch (kind) {
    case 'contacts': {
      const balance = record?.kind === 'contacts' ? record.value.openingBalance : 0;
      return {
        title: cells.name || cells.nameAr,
        details: [cells.name ? cells.nameAr : '', cells.phone, cells.email, cells.area],
        amount: balance ? money(balance) : record ? '' : cells.openingBalance,
      };
    }
    case 'products':
      return {
        title: cells.name || cells.nameAr,
        details: [cells.name ? cells.nameAr : '', cells.sku, cells.unit],
        amount: cells.price,
      };
    case 'opening': {
      const line = record?.kind === 'opening' ? record.value : null;
      return {
        title: [cells.code, cells.account].filter(Boolean).join(' · '),
        details: [cells.matched && cells.matched !== cells.account ? cells.matched : ''],
        amount: line
          ? line.debit
            ? `${t('Debit')} ${money(line.debit)}`
            : `${t('Credit')} ${money(line.credit)}`
          : [cells.debit, cells.credit, cells.balance].filter(Boolean).join(' / '),
      };
    }
    case 'documents': {
      const doc = record?.kind === 'documents' ? record.value.doc : null;
      return {
        title: cells.number,
        details: [cells.contact, cells.date, cells.dueDate ? `→ ${cells.dueDate}` : ''],
        amount: doc ? money(doc.items[0]?.unitPrice ?? 0) : cells.amount,
      };
    }
  }
}

export default function ImportSettings() {
  const company = useCompany();
  const fmt = useFormat();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ImportKind>('contacts');
  const [contactType, setContactType] = useState<'customer' | 'vendor'>('customer');
  const [documentType, setDocumentType] = useState<'invoice' | 'bill'>('invoice');
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [dateFormat, setDateFormat] = useState<CsvDateFormat>('dd/MM/yyyy');
  const [filter, setFilter] = useState<'all' | 'ready' | 'problems'>('all');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [allColumns, setAllColumns] = useState(false);
  const context = useLiveQuery(() => loadImportContext(company.id), [company.id]);
  const precision = currencyPrecision(company.currency);

  const options: ImportOptions = useMemo(
    () => ({
      contactType,
      documentType,
      asOf: isISODate(asOf) ? asOf : today(),
      dateFormat,
      fileName: file?.name ?? '',
      formatDate: fmt.date,
    }),
    [contactType, documentType, asOf, dateFormat, file, fmt],
  );

  const plan: ImportPlan | null = useMemo(
    () =>
      file && mapping && context ? planImport(kind, file.rows, mapping, options, context) : null,
    [file, mapping, context, kind, options],
  );

  const headers = file?.rows[0] ?? [];
  const columns = IMPORT_COLUMNS[kind];
  const missing = mapping ? columns.filter((c) => c.required && mapping[c.key] == null) : [];
  // Columns the file has (or must have) first; the rest on request.
  const shownColumns =
    allColumns || !mapping ? columns : columns.filter((c) => c.required || mapping[c.key] != null);
  const hiddenColumns = columns.length - shownColumns.length;

  const guessDateFormat = (rows: string[][], map: ColumnMapping) => {
    const index = map.date;
    if (index == null) return;
    const found = detectDateFormats(
      rows.slice(1).map((r) => r[index] ?? ''),
      !fmt.locale.endsWith('US'),
    );
    if (found[0]) setDateFormat(found[0]);
  };

  const chooseKind = (next: ImportKind) => {
    setKind(next);
    setResult(null);
    setFilter('all');
    if (file) {
      const map = guessColumns(next, file.rows[0] ?? []);
      setMapping(map);
      if (next === 'documents') guessDateFormat(file.rows, map);
    }
  };

  const read = async (chosen: File | undefined) => {
    if (!chosen) return;
    if (chosen.size > MAX_BYTES) {
      toast.error(t('Please choose a file smaller than 5 MB.'));
      return;
    }
    const rows = parseCsvRows(decodeCsv(await chosen.arrayBuffer()));
    if (rows.length < 2) {
      toast.error(t('The file needs a row of column names and at least one row of data.'));
      return;
    }
    const map = guessColumns(kind, rows[0]);
    setFile({ name: chosen.name, rows });
    setAllColumns(false);
    setMapping(map);
    setResult(null);
    setFilter('all');
    if (kind === 'documents') guessDateFormat(rows, map);
  };

  const clear = () => {
    setFile(null);
    setMapping(null);
    setResult(null);
  };

  const template = () => {
    const rows =
      kind === 'documents' && documentType === 'bill' ? BILL_TEMPLATE_ROWS : TEMPLATE_ROWS[kind];
    downloadCsv(
      `almailbooks-${kind === 'documents' ? `open-${documentType}s` : kind}-template.csv`,
      columns.map((c) => t(c.label)),
      rows.map((r) => columns.map((c) => r[c.key] ?? '')),
    );
  };

  const run = async () => {
    if (!file || !mapping || !plan) return;
    setBusy(true);
    try {
      const done = await commitImport(company.id, kind, file.rows, mapping, options);
      setResult(done);
      setFile(null);
      setMapping(null);
      toast.success(doneText(done, documentType));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not import the file.'));
    } finally {
      setBusy(false);
    }
  };

  const visible = (plan?.rows ?? []).filter((r) =>
    filter === 'ready' ? r.status === 'ready' : filter === 'problems' ? r.status !== 'ready' : true,
  );
  const blocked = !plan || plan.ready === 0 || (kind === 'opening' && plan.errors > 0);
  const viewLink =
    kind === 'contacts'
      ? contactType === 'vendor'
        ? '/vendors'
        : '/clients'
      : kind === 'products'
        ? '/products'
        : kind === 'opening'
          ? '/journals'
          : documentType === 'invoice'
            ? '/invoices'
            : '/bills';

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('Import data')}
        description={t(
          'Bring your records over from a spreadsheet or another accounting system. Files are read in this browser and never uploaded.',
        )}
      >
        <div
          role="radiogroup"
          aria-label={t('What to import')}
          className="grid gap-3 sm:grid-cols-2"
        >
          {KINDS.map((k) => {
            const active = k.value === kind;
            return (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => chooseKind(k.value)}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-4 text-start transition-colors',
                  active
                    ? 'border-primary-500 bg-primary-50/60 ring-primary-500/20 ring-3'
                    : 'bg-surface border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4.5',
                    active ? 'bg-primary-solid text-on-primary' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {k.icon}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-slate-900">{t(k.title)}</span>
                  <span className="mt-0.5 block text-sm text-slate-500">{t(k.text)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('Your file')}
        description={t('A CSV file with one row per record and the column names in the first row.')}
        actions={
          <Button variant="outline" size="sm" onClick={template}>
            <Download /> {t('Download template')}
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {kind === 'contacts' ? (
            <LabeledGroup label={t('Rows without a type are')}>
              <Segmented
                value={contactType}
                onChange={setContactType}
                options={[
                  { value: 'customer', label: t('Customers') },
                  { value: 'vendor', label: t('Vendors') },
                ]}
              />
            </LabeledGroup>
          ) : null}
          {kind === 'documents' ? (
            <LabeledGroup label={t('These are')}>
              <Segmented
                value={documentType}
                onChange={setDocumentType}
                options={[
                  { value: 'invoice', label: t('Invoices to customers') },
                  { value: 'bill', label: t('Bills from vendors') },
                ]}
              />
            </LabeledGroup>
          ) : null}
          {kind === 'contacts' || kind === 'opening' ? (
            <Field
              label={t('Balances as at')}
              hint={t('Usually the last day before you start using AlmailBooks.')}
            >
              {(id) => (
                <DateField id={id} value={asOf} max={today()} onChange={(iso) => setAsOf(iso)} />
              )}
            </Field>
          ) : null}
          {kind === 'documents' && file ? (
            <Field label={t('Dates in the file look like')}>
              {(id) => (
                <Select
                  id={id}
                  value={dateFormat}
                  onChange={(e) => setDateFormat(e.target.value as CsvDateFormat)}
                >
                  {DATE_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {/^\d/.test(f.label) && !/[a-z]/i.test(f.label) ? f.label : t(f.label)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
        </div>

        {kind === 'opening' && company.openingBalances ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {t(
              'Opening balances were already imported as at {date}. Importing again adds to them.',
              { date: fmt.date(company.openingBalances.date) },
            )}
          </p>
        ) : null}
        {kind === 'documents' ? (
          <p className="text-sm text-slate-500">
            {t(
              'Each document is booked against opening balance equity, so sales and costs from before are not counted twice. Record payments on them as usual.',
            )}
          </p>
        ) : null}

        {file ? (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <FileSpreadsheet className="text-primary-600 size-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900" dir="auto">
                {file.name}
              </p>
              <p className="text-xs text-slate-500">
                {tp(file.rows.length - 1, '{count} row', '{count} rows')}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
              {t('Choose another file')}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={t('Remove file')} onClick={clear}>
              <X />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void read(e.dataTransfer.files[0]);
            }}
            className={cn(
              'flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              dragging
                ? 'border-primary-500 bg-primary-50'
                : 'bg-surface border-slate-300 hover:border-slate-400',
            )}
          >
            <span className="bg-primary-50 text-primary-600 flex size-11 items-center justify-center rounded-full">
              <FileUp className="size-5" aria-hidden />
            </span>
            <span className="font-medium text-slate-900">{t('Choose a CSV file')}</span>
            <span className="max-w-sm text-sm text-slate-500">
              {t(
                'Or drop it here. In Excel, use Save as → CSV. Arabic column names and text are fine.',
              )}
            </span>
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          aria-label={t('Choose a CSV file')}
          onChange={(e) => {
            void read(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </SettingsSection>

      {file && mapping ? (
        <SettingsSection
          title={t('Match the columns')}
          description={t('We matched what we could. Check the fields marked as required.')}
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shownColumns.map((c) => (
              <Field
                key={c.key}
                label={
                  <>
                    {t(c.label)}
                    {c.required ? (
                      <span className="ms-0.5 text-red-600" aria-hidden>
                        *
                      </span>
                    ) : null}
                  </>
                }
                error={c.required && mapping[c.key] == null ? t('Choose a column') : undefined}
              >
                {(id) => (
                  <Select
                    id={id}
                    value={mapping[c.key] == null ? '' : String(mapping[c.key])}
                    aria-required={c.required}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        [c.key]: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  >
                    <option value="">{t('Not in the file')}</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || t('Column {number}', { number: i + 1 })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ))}
          </div>
          {hiddenColumns > 0 || allColumns ? (
            <Button variant="ghost" size="sm" onClick={() => setAllColumns(!allColumns)}>
              {allColumns
                ? t('Show only the columns in the file')
                : tp(hiddenColumns, 'Show {count} more field', 'Show {count} more fields')}
            </Button>
          ) : null}
        </SettingsSection>
      ) : null}

      {result ? (
        <SettingsSection title={t('Import finished')}>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="size-6" aria-hidden />
            </span>
            <p className="text-base font-semibold text-slate-900">
              {doneText(result, documentType)}
            </p>
            <p className="text-sm text-slate-500">
              {[
                result.skipped
                  ? tp(result.skipped, '{count} row left out', '{count} rows left out')
                  : '',
                result.newContacts
                  ? tp(
                      result.newContacts,
                      '{count} new contact added',
                      '{count} new contacts added',
                    )
                  : '',
                result.kind === 'contacts' && result.documents
                  ? tp(
                      result.documents,
                      '{count} opening balance recorded',
                      '{count} opening balances recorded',
                    )
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <ButtonLink to={viewLink}>{t('View them')}</ButtonLink>
              <Button variant="outline" onClick={clear}>
                {t('Import another file')}
              </Button>
            </div>
          </div>
        </SettingsSection>
      ) : plan ? (
        <SettingsSection
          title={t('Check before importing')}
          description={
            missing.length
              ? t('Match the required columns to see the rows.')
              : t('Rows with problems are left out. Nothing is saved until you import.')
          }
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
              <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
              {readyText(kind, documentType, plan.ready)}
            </span>
            {plan.skipped ? (
              <span className="inline-flex items-center gap-1.5 text-slate-600">
                <span className="size-2 rounded-full bg-slate-400" aria-hidden />
                {tp(plan.skipped, '{count} skipped', '{count} skipped')}
              </span>
            ) : null}
            {plan.errors ? (
              <span className="inline-flex items-center gap-1.5 text-red-700">
                <span className="size-2 rounded-full bg-red-500" aria-hidden />
                {tp(plan.errors, '{count} with problems', '{count} with problems')}
              </span>
            ) : null}
            {plan.newContacts ? (
              <span className="inline-flex items-center gap-1.5 text-sky-700">
                <span className="size-2 rounded-full bg-sky-500" aria-hidden />
                {tp(plan.newContacts, '{count} new contact', '{count} new contacts')}
              </span>
            ) : null}
          </div>

          {kind === 'opening' && plan.ready ? (
            <dl className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm ring-1 ring-slate-200/70 sm:grid-cols-3">
              <div>
                <dt className="text-slate-500">{t('Debits')}</dt>
                <dd className="tabular font-semibold text-slate-900">
                  {fmt.money(fromMinor(plan.totals.debit, precision))}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('Credits')}</dt>
                <dd className="tabular font-semibold text-slate-900">
                  {fmt.money(fromMinor(plan.totals.credit, precision))}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('To opening balance equity')}</dt>
                <dd className="tabular font-semibold text-slate-900">
                  {plan.totals.difference === 0
                    ? t('Nothing, the file balances')
                    : plan.totals.difference > 0
                      ? `${t('Credit')} ${fmt.money(fromMinor(plan.totals.difference, precision))}`
                      : `${t('Debit')} ${fmt.money(fromMinor(-plan.totals.difference, precision))}`}
                </dd>
              </div>
            </dl>
          ) : null}

          {plan.rows.length ? (
            <>
              <Segmented
                size="sm"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: t('All'), count: plan.rows.length },
                  { value: 'ready', label: t('Ready'), count: plan.ready },
                  { value: 'problems', label: t('Left out'), count: plan.skipped + plan.errors },
                ]}
              />
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {visible.slice(0, PREVIEW_LIMIT).map((row) => {
                  const summary = rowSummary(kind, row, (n) => fmt.money(n));
                  return (
                    <li key={row.line} className="flex gap-3 px-3 py-2.5 sm:px-4">
                      <span className="tabular w-9 shrink-0 pt-0.5 text-xs text-slate-500">
                        {row.line}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span
                            className="min-w-0 truncate text-sm font-medium text-slate-900"
                            dir="auto"
                          >
                            {summary.title || '—'}
                          </span>
                          <StatusBadge row={row} />
                          {summary.amount ? (
                            <span className="tabular ms-auto text-sm text-slate-700">
                              {summary.amount}
                            </span>
                          ) : null}
                        </div>
                        {summary.details.some(Boolean) ? (
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {summary.details.filter(Boolean).join(' · ')}
                          </p>
                        ) : null}
                        {row.issues.length ? (
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {row.issues.map((issue, i) => (
                              <li key={i} className={ISSUE_TONE[issue.level]}>
                                {issue.text}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {visible.length > PREVIEW_LIMIT ? (
                <p className="text-xs text-slate-500">
                  {t('Showing the first {shown} of {total} rows.', {
                    shown: PREVIEW_LIMIT,
                    total: visible.length,
                  })}
                </p>
              ) : null}
            </>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              {kind === 'opening' && plan.errors
                ? t('Opening balances are imported only when every row is right.')
                : t('Everything is added in one step, or nothing if something goes wrong.')}
            </p>
            <Button onClick={() => void run()} loading={busy} disabled={blocked}>
              {importLabel(kind, documentType, plan.ready)}
            </Button>
          </div>
        </SettingsSection>
      ) : null}
    </div>
  );
}
