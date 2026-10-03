import { useMemo, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { toast } from 'sonner';
import { importStatement } from '@/db/banking';
import type { Account } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import {
  csvStatement,
  DATE_FORMATS,
  detectDateFormats,
  guessMapping,
  isOfx,
  parseCsvRows,
  parseOfx,
  type CsvMapping,
  type StatementLine,
} from '@/lib/banking/statement';
import { cn } from '@/lib/cn';
import { t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Field, Select, Switch } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';

type Loaded =
  | { kind: 'csv'; name: string; rows: string[][] }
  | { kind: 'ofx'; name: string; lines: StatementLine[] };

const MAX_BYTES = 5 * 1024 * 1024;

/** A statement's text: UTF-8, or Windows-1256, which older Arabic exports use. */
async function readText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1256').decode(bytes);
  }
}

/** Imports a CSV or OFX statement into one bank, cash or card account. */
export function ImportStatementDialog({
  accounts,
  initialAccountId,
  onClose,
}: {
  accounts: Account[];
  initialAccountId: string;
  onClose: () => void;
}) {
  const company = useCompany();
  const fmt = useFormat();
  const input = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(initialAccountId);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [saving, setSaving] = useState(false);
  const preferDayFirst = !fmt.locale.endsWith('US');

  const read = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) return toast.error(t('Choose a file smaller than 5 MB.'));
    const text = await readText(file);
    if (isOfx(text)) {
      const { lines } = parseOfx(text);
      if (!lines.length) return toast.error(t('No transactions were found in this file.'));
      setLoaded({ kind: 'ofx', name: file.name, lines });
      setMapping(null);
      return;
    }
    const rows = parseCsvRows(text);
    if (rows.length < 1) return toast.error(t('This file has no rows.'));
    setLoaded({ kind: 'csv', name: file.name, rows });
    setMapping(guessMapping(rows, preferDayFirst));
  };

  const parsed = useMemo(() => {
    if (!loaded) return null;
    if (loaded.kind === 'ofx') return { lines: loaded.lines, skipped: 0 };
    return mapping ? csvStatement(loaded.rows, mapping) : null;
  }, [loaded, mapping]);

  const columns = useMemo(() => {
    if (loaded?.kind !== 'csv') return [];
    const width = Math.max(...loaded.rows.slice(0, 20).map((r) => r.length));
    const first = loaded.rows[0] ?? [];
    return Array.from({ length: width }, (_, i) => ({
      value: i,
      label: mapping?.header
        ? first[i] || t('Column {number}', { number: i + 1 })
        : t('Column {number} ({sample})', { number: i + 1, sample: first[i] ?? '' }),
    }));
  }, [loaded, mapping?.header]);

  const dateFormats = useMemo(() => {
    if (loaded?.kind !== 'csv' || !mapping) return [];
    const body = mapping.header ? loaded.rows.slice(1) : loaded.rows;
    return detectDateFormats(
      body.map((r) => r[mapping.date] ?? ''),
      preferDayFirst,
    );
  }, [loaded, mapping, preferDayFirst]);

  const set = (patch: Partial<CsvMapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));
  const columnSelect = (
    label: string,
    value: number | null,
    onChange: (value: number | null) => void,
    optional = false,
  ) => (
    <Field label={label} optional={optional}>
      {(id) => (
        <Select
          id={id}
          value={value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        >
          {optional ? <option value="">{t('None')}</option> : null}
          {columns.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  const save = async () => {
    if (!parsed?.lines.length) return toast.error(t('There is nothing to import.'));
    setSaving(true);
    try {
      const { added, duplicates } = await importStatement(
        company.id,
        accountId,
        parsed.lines,
        loaded?.name ?? '',
      );
      toast.success(
        duplicates
          ? tp(
              added,
              '{count} line imported, {duplicates} already there',
              '{count} lines imported, {duplicates} already there',
              { duplicates },
            )
          : tp(added, '{count} line imported', '{count} lines imported'),
      );
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not import the statement.'));
      setSaving(false);
    }
  };

  const split = mapping !== null && mapping.amount === null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('Import a bank statement')}
        description={t(
          'Download a statement from your online banking as CSV or OFX, then choose it here.',
        )}
        size="xl"
      >
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Account')}>
              {(id) => (
                <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {localName(a)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('Statement file')}>
              {() => (
                <div className="flex items-center gap-3">
                  <input
                    ref={input}
                    type="file"
                    accept=".csv,.txt,.ofx,.qfx,text/csv,application/x-ofx"
                    className="sr-only"
                    tabIndex={-1}
                    aria-label={t('Statement file')}
                    onChange={(e) => void read(e.target.files?.[0])}
                  />
                  <Button variant="outline" onClick={() => input.current?.click()}>
                    <FileUp /> {t('Choose file')}
                  </Button>
                  <span className="truncate text-sm text-slate-500">
                    {loaded?.name ?? t('CSV, OFX or QFX')}
                  </span>
                </div>
              )}
            </Field>
          </div>

          {loaded?.kind === 'csv' && mapping ? (
            <div className="space-y-4 rounded-lg border border-slate-200 p-4">
              <Switch
                checked={mapping.header}
                onChange={(header) => set({ header })}
                label={t('The first row has column names')}
              />
              <div className="grid gap-4 sm:grid-cols-3">
                {columnSelect(t('Date'), mapping.date, (date) => date !== null && set({ date }))}
                <Field label={t('Date format')}>
                  {(id) => (
                    <Select
                      id={id}
                      value={mapping.dateFormat}
                      onChange={(e) =>
                        set({ dateFormat: e.target.value as CsvMapping['dateFormat'] })
                      }
                    >
                      {DATE_FORMATS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {dateFormats.includes(f.value)
                            ? t(f.label)
                            : t('{format} — doesn’t fit', { format: t(f.label) })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {columnSelect(
                  t('Description'),
                  mapping.description,
                  (description) => description !== null && set({ description }),
                )}
                <Field label={t('Amounts')}>
                  {(id) => (
                    <Select
                      id={id}
                      value={split ? 'split' : 'single'}
                      onChange={(e) =>
                        e.target.value === 'split'
                          ? set({
                              amount: null,
                              moneyIn: mapping.moneyIn ?? mapping.amount ?? 0,
                              moneyOut: mapping.moneyOut ?? mapping.amount ?? 0,
                            })
                          : set({
                              amount: mapping.amount ?? mapping.moneyIn ?? 0,
                              moneyIn: null,
                              moneyOut: null,
                            })
                      }
                    >
                      <option value="single">{t('One column (minus for money out)')}</option>
                      <option value="split">{t('Money in and money out columns')}</option>
                    </Select>
                  )}
                </Field>
                {split ? (
                  <>
                    {columnSelect(t('Money in'), mapping.moneyIn, (moneyIn) => set({ moneyIn }))}
                    {columnSelect(t('Money out'), mapping.moneyOut, (moneyOut) =>
                      set({ moneyOut }),
                    )}
                  </>
                ) : (
                  columnSelect(t('Amount'), mapping.amount, (amount) => set({ amount }))
                )}
                {columnSelect(t('Balance'), mapping.balance, (balance) => set({ balance }), true)}
                {columnSelect(
                  t('Reference'),
                  mapping.reference,
                  (reference) => set({ reference }),
                  true,
                )}
              </div>
              <Switch
                checked={mapping.invert}
                onChange={(invert) => set({ invert })}
                label={t('Flip the signs')}
                description={t('For card statements that show spending as positive amounts.')}
              />
            </div>
          ) : null}

          {parsed ? (
            <div>
              <p className="mb-2 text-sm text-slate-600">
                {tp(parsed.lines.length, '{count} line to import', '{count} lines to import')}
                {parsed.skipped
                  ? ` · ${tp(
                      parsed.skipped,
                      '{count} row without a date or amount left out',
                      '{count} rows without a date or amount left out',
                    )}`
                  : ''}
              </p>
              <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-start text-slate-500">
                    <tr>
                      <th className="hidden px-3 py-2 font-medium sm:table-cell">{t('Date')}</th>
                      <th className="px-3 py-2 font-medium">{t('Description')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('Amount')}</th>
                      <th className="hidden px-3 py-2 text-end font-medium sm:table-cell">
                        {t('Balance')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.lines.slice(0, 50).map((l, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="hidden px-3 py-1.5 whitespace-nowrap sm:table-cell">
                          {fmt.date(l.date)}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="block max-w-40 truncate sm:max-w-80">
                            {l.description}
                          </span>
                          <span className="block text-slate-500 sm:hidden">{fmt.date(l.date)}</span>
                        </td>
                        <td
                          className={cn(
                            'tabular px-3 py-1.5 text-end whitespace-nowrap',
                            l.amount < 0 ? 'text-slate-800' : 'text-emerald-700',
                          )}
                        >
                          {fmt.money(l.amount)}
                        </td>
                        <td className="tabular hidden px-3 py-1.5 text-end whitespace-nowrap text-slate-500 sm:table-cell">
                          {l.balance === null ? '' : fmt.money(l.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!parsed?.lines.length}>
            {parsed?.lines.length
              ? tp(parsed.lines.length, 'Import {count} line', 'Import {count} lines')
              : t('Import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
