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
import { Button } from '@/components/ui/button';
import { Field, Select, Switch } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';

type Loaded =
  | { kind: 'csv'; name: string; rows: string[][] }
  | { kind: 'ofx'; name: string; lines: StatementLine[] };

const MAX_BYTES = 5 * 1024 * 1024;

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
    if (file.size > MAX_BYTES) return toast.error('Please choose a file smaller than 5 MB.');
    const text = await file.text();
    if (isOfx(text)) {
      const { lines } = parseOfx(text);
      if (!lines.length) return toast.error('No transactions were found in this file.');
      setLoaded({ kind: 'ofx', name: file.name, lines });
      setMapping(null);
      return;
    }
    const rows = parseCsvRows(text);
    if (rows.length < 1) return toast.error('This file has no rows.');
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
        ? first[i] || `Column ${i + 1}`
        : `Column ${i + 1} (${first[i] ?? ''})`,
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
          {optional ? <option value="">None</option> : null}
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
    if (!parsed?.lines.length) return toast.error('There is nothing to import.');
    setSaving(true);
    try {
      const { added, duplicates } = await importStatement(
        company.id,
        accountId,
        parsed.lines,
        loaded?.name ?? '',
      );
      toast.success(
        `${added} ${added === 1 ? 'line' : 'lines'} imported${duplicates ? `, ${duplicates} already there` : ''}`,
      );
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not import the statement.');
      setSaving(false);
    }
  };

  const split = mapping !== null && mapping.amount === null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Import a bank statement"
        description="Download a statement from your online banking as CSV or OFX, then choose it here."
        size="xl"
      >
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account">
              {(id) => (
                <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Statement file">
              {() => (
                <div className="flex items-center gap-3">
                  <input
                    ref={input}
                    type="file"
                    accept=".csv,.txt,.ofx,.qfx,text/csv,application/x-ofx"
                    className="sr-only"
                    tabIndex={-1}
                    aria-label="Statement file"
                    onChange={(e) => void read(e.target.files?.[0])}
                  />
                  <Button variant="outline" onClick={() => input.current?.click()}>
                    <FileUp /> Choose file
                  </Button>
                  <span className="truncate text-sm text-slate-500">
                    {loaded?.name ?? 'CSV, OFX or QFX'}
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
                label="The first row has column names"
              />
              <div className="grid gap-4 sm:grid-cols-3">
                {columnSelect('Date', mapping.date, (date) => date !== null && set({ date }))}
                <Field label="Date format">
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
                          {f.label}
                          {dateFormats.includes(f.value) ? '' : ' — doesn’t fit'}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {columnSelect(
                  'Description',
                  mapping.description,
                  (description) => description !== null && set({ description }),
                )}
                <Field label="Amounts">
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
                      <option value="single">One column (minus for money out)</option>
                      <option value="split">Money in and money out columns</option>
                    </Select>
                  )}
                </Field>
                {split ? (
                  <>
                    {columnSelect('Money in', mapping.moneyIn, (moneyIn) => set({ moneyIn }))}
                    {columnSelect('Money out', mapping.moneyOut, (moneyOut) => set({ moneyOut }))}
                  </>
                ) : (
                  columnSelect('Amount', mapping.amount, (amount) => set({ amount }))
                )}
                {columnSelect('Balance', mapping.balance, (balance) => set({ balance }), true)}
                {columnSelect(
                  'Reference',
                  mapping.reference,
                  (reference) => set({ reference }),
                  true,
                )}
              </div>
              <Switch
                checked={mapping.invert}
                onChange={(invert) => set({ invert })}
                label="Flip the signs"
                description="For card statements that show spending as positive amounts."
              />
            </div>
          ) : null}

          {parsed ? (
            <div>
              <p className="mb-2 text-sm text-slate-600">
                {parsed.lines.length} {parsed.lines.length === 1 ? 'line' : 'lines'} to import
                {parsed.skipped
                  ? ` · ${parsed.skipped} ${parsed.skipped === 1 ? 'row' : 'rows'} without a date or amount left out`
                  : ''}
              </p>
              <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-start text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Description</th>
                      <th className="px-3 py-2 text-end font-medium">Amount</th>
                      <th className="px-3 py-2 text-end font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.lines.slice(0, 50).map((l, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 whitespace-nowrap">{fmt.date(l.date)}</td>
                        <td className="max-w-80 truncate px-3 py-1.5">{l.description}</td>
                        <td
                          className={cn(
                            'tabular px-3 py-1.5 text-end whitespace-nowrap',
                            l.amount < 0 ? 'text-slate-800' : 'text-emerald-700',
                          )}
                        >
                          {fmt.money(l.amount)}
                        </td>
                        <td className="tabular px-3 py-1.5 text-end whitespace-nowrap text-slate-500">
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
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!parsed?.lines.length}>
            Import {parsed?.lines.length ? parsed.lines.length : ''}{' '}
            {parsed?.lines.length === 1 ? 'line' : 'lines'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
