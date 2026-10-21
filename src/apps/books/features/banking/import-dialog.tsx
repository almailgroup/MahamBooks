import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileUp, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { importStatement } from '@/db/banking';
import type { Account, StatementFormat } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import {
  checkBalances,
  csvStatement,
  DATE_FORMATS,
  detectDateFormats,
  type CsvMapping,
  type StatementLine,
} from '@/lib/banking/statement';
import {
  guessLayout,
  rememberedFormat,
  statementLayout,
  statementTable,
} from '@/lib/banking/layout';
import {
  applyPreset,
  presetOf,
  STATEMENT_PRESETS,
  type StatementPreset,
} from '@/lib/banking/presets';
import { readStatementFile } from './read-statement';
import { cn } from '@/lib/cn';
import { t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Field, Select, Switch } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';

type Loaded =
  | { kind: 'table'; file: StatementFormat['kind']; name: string; rows: string[][] }
  | { kind: 'ofx'; name: string; lines: StatementLine[] };

const MAX_BYTES = 5 * 1024 * 1024;

/** Rows offered as the start of the table. */
const START_ROWS = 50;

/** A row of the file in a few words, for choosing where the table starts. */
const sample = (row: string[]) => {
  const text = row
    .filter((v) => v.trim() !== '')
    .slice(0, 4)
    .join(' · ');
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
};

/** Imports an Excel, CSV or OFX statement into one bank, cash or card account. */
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
  const [start, setStart] = useState(0);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  // The layout came from the account; and whether to remember it there.
  const [remembered, setRemembered] = useState(false);
  const [remember, setRemember] = useState(false);
  const [saving, setSaving] = useState(false);
  const preferDayFirst = !fmt.locale.endsWith('US');
  const account = accounts.find((a) => a.id === accountId);

  /** Reads the table with the account's remembered layout, or with a guess. */
  const layOut = (rows: string[][], owner: Account | undefined) => {
    const layout = statementLayout(rows, owner?.statementFormat, preferDayFirst);
    setStart(layout.start);
    setMapping(layout.mapping);
    setRemembered(layout.remembered);
    setRemember(Boolean(owner?.statementFormat));
  };

  const read = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) return toast.error(t('Choose a file smaller than 5 MB.'));
    let content;
    try {
      content = await readStatementFile(await file.arrayBuffer());
    } catch (error) {
      return toast.error(
        error instanceof Error ? error.message : t('Could not import the statement.'),
      );
    }
    if (content.kind === 'ofx') {
      if (!content.lines.length) return toast.error(t('No transactions were found in this file.'));
      setLoaded({ kind: 'ofx', name: file.name, lines: content.lines });
      setMapping(null);
      return;
    }
    if (content.rows.length < 1) return toast.error(t('This file has no rows.'));
    setLoaded({ kind: 'table', file: content.kind, name: file.name, rows: content.rows });
    layOut(content.rows, account);
  };

  const chooseAccount = (id: string) => {
    setAccountId(id);
    if (loaded?.kind === 'table') {
      layOut(
        loaded.rows,
        accounts.find((a) => a.id === id),
      );
    }
  };

  const rows = loaded?.kind === 'table' ? loaded.rows : null;
  const table = useMemo(() => (rows ? statementTable(rows, start) : []), [rows, start]);
  // Totals and notes after the last line.
  const footer = rows ? rows.length - start - table.length : 0;

  const parsed = useMemo(() => {
    if (!loaded) return null;
    if (loaded.kind === 'ofx') return { lines: loaded.lines, skipped: 0 };
    return mapping ? csvStatement(table, mapping) : null;
  }, [loaded, table, mapping]);
  const balances = useMemo(() => (parsed ? checkBalances(parsed.lines) : null), [parsed]);

  const columns = useMemo(() => {
    if (!rows) return [];
    const width = Math.max(...table.slice(0, 20).map((r) => r.length));
    const first = table[0] ?? [];
    return Array.from({ length: width }, (_, i) => ({
      value: i,
      label: mapping?.header
        ? first[i] || t('Column {number}', { number: i + 1 })
        : t('Column {number} ({sample})', { number: i + 1, sample: first[i] ?? '' }),
    }));
  }, [rows, table, mapping?.header]);

  const dateFormats = useMemo(() => {
    if (!rows || !mapping) return [];
    const body = mapping.header ? table.slice(1) : table;
    return detectDateFormats(
      body.map((r) => r[mapping.date] ?? ''),
      preferDayFirst,
    );
  }, [rows, table, mapping, preferDayFirst]);

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

  const startAt = (row: number) => {
    if (!rows) return;
    const layout = guessLayout(rows, row, preferDayFirst);
    setStart(layout.start);
    setMapping(layout.mapping);
    setRemembered(false);
  };

  const save = async () => {
    if (!parsed?.lines.length) return toast.error(t('There is nothing to import.'));
    // Remember the layout, forget the one the account had, or (OFX) leave it.
    let format: StatementFormat | null | undefined;
    if (loaded?.kind === 'table' && mapping) {
      if (remember) format = rememberedFormat(loaded.file, loaded.rows, start, mapping);
      else if (account?.statementFormat) format = null;
    }
    setSaving(true);
    try {
      const { added, duplicates } = await importStatement(
        company.id,
        accountId,
        parsed.lines,
        loaded?.name ?? '',
        format,
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

  const preset = mapping ? presetOf(mapping) : 'signed';
  // The rows above the table and a few of it, as they are in the file.
  const shown = rows ? rows.slice(0, Math.min(START_ROWS, Math.max(12, start + 4))) : [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('Import a bank statement')}
        description={t(
          'Download a statement from your online banking as Excel, CSV or OFX, then choose it here.',
        )}
        size="xl"
      >
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Account')}>
              {(id) => (
                <Select id={id} value={accountId} onChange={(e) => chooseAccount(e.target.value)}>
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
                    accept=".xlsx,.xls,.csv,.txt,.htm,.html,.xml,.ofx,.qfx,text/csv,application/x-ofx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="sr-only"
                    tabIndex={-1}
                    aria-label={t('Statement file')}
                    onChange={(e) => void read(e.target.files?.[0])}
                  />
                  <Button variant="outline" onClick={() => input.current?.click()}>
                    <FileUp /> {t('Choose file')}
                  </Button>
                  <span className="truncate text-sm text-slate-500">
                    {loaded?.name ?? t('Excel, CSV, OFX or QFX')}
                  </span>
                </div>
              )}
            </Field>
          </div>

          {rows && mapping ? (
            <div className="space-y-4 rounded-lg border border-slate-200 p-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field
                  label={t('The table starts at row')}
                  hint={t('Rows above it, such as the account name and the period, are left out.')}
                >
                  {(id) => (
                    <Select
                      id={id}
                      value={String(start)}
                      onChange={(e) => startAt(Number(e.target.value))}
                    >
                      {rows.slice(0, START_ROWS).map((row, i) => (
                        <option key={i} value={i}>
                          {t('Row {number}: {sample}', { number: i + 1, sample: sample(row) })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div
                  className="max-h-40 overflow-auto rounded-lg border border-slate-200 sm:col-span-2"
                  role="group"
                  aria-label={t('The file as it is')}
                >
                  <table className="w-full text-xs">
                    <tbody>
                      {shown.map((row, i) => (
                        <tr
                          key={i}
                          onClick={() => startAt(i)}
                          className={cn(
                            'cursor-pointer border-t border-slate-100 first:border-t-0 hover:bg-slate-50',
                            i < start && 'text-slate-400',
                            i === start && 'bg-primary-50 font-medium text-slate-900',
                          )}
                        >
                          <td className="tabular w-8 px-2 py-1 text-end text-slate-400">{i + 1}</td>
                          {row.slice(0, 8).map((cell, c) => (
                            <td key={c} className="max-w-32 truncate px-2 py-1">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
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
                      value={preset}
                      onChange={(e) =>
                        setMapping(applyPreset(table, mapping, e.target.value as StatementPreset))
                      }
                    >
                      {STATEMENT_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {t(p.label)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {preset === 'debit-credit' ? (
                  <>
                    {columnSelect(t('Money in'), mapping.moneyIn, (moneyIn) => set({ moneyIn }))}
                    {columnSelect(t('Money out'), mapping.moneyOut, (moneyOut) =>
                      set({ moneyOut }),
                    )}
                  </>
                ) : (
                  columnSelect(t('Amount'), mapping.amount, (amount) => set({ amount }))
                )}
                {preset === 'amount-type'
                  ? columnSelect(
                      t('Debit or credit'),
                      mapping.debitCredit ?? null,
                      (debitCredit) => set({ debitCredit }),
                      true,
                    )
                  : null}
                {columnSelect(t('Balance'), mapping.balance, (balance) => set({ balance }), true)}
                {columnSelect(
                  t('Reference'),
                  mapping.reference,
                  (reference) => set({ reference }),
                  true,
                )}
                {columnSelect(
                  t('Value date'),
                  mapping.valueDate ?? null,
                  (valueDate) => set({ valueDate }),
                  true,
                )}
              </div>
              <Switch
                checked={mapping.invert}
                onChange={(invert) => set({ invert })}
                label={t('Flip the signs')}
                description={t('For card statements that show spending as positive amounts.')}
              />
              <Switch
                checked={remember}
                onChange={setRemember}
                label={t('Remember this layout for this account')}
                description={
                  remembered
                    ? t('Read with the layout remembered for this account.')
                    : t('Its next statements are then read the same way.')
                }
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
                {footer
                  ? ` · ${tp(
                      footer,
                      '{count} row of totals or notes after the lines left out',
                      '{count} rows of totals or notes after the lines left out',
                    )}`
                  : ''}
              </p>
              {balances === 'agrees' ? (
                <p className="mb-2 flex items-center gap-1.5 text-xs text-emerald-700">
                  <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                  {t('The amounts add up to the balances in the file.')}
                </p>
              ) : balances ? (
                <p
                  role="alert"
                  className="mb-2 flex items-start gap-1.5 text-xs font-medium text-amber-700"
                >
                  <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                  {balances === 'flipped'
                    ? t(
                        'The balances go the other way: money in and money out look swapped. Check the amount columns, or flip the signs.',
                      )
                    : t(
                        'The amounts don’t add up to the balances in the file. Check the amount columns before importing.',
                      )}
                </p>
              ) : null}
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
                          {l.valueDate && l.valueDate !== l.date ? (
                            <span className="block text-slate-500">
                              {t('Value date {date}', { date: fmt.date(l.valueDate) })}
                            </span>
                          ) : null}
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
