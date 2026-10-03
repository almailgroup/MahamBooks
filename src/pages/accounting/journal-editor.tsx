import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import type { ManualJournal } from '@/db/types';
import {
  createJournal,
  deleteJournal,
  journalTotals,
  newJournalLine,
  saveJournal,
} from '@/db/accounting';
import { useCompany, useFormat } from '@/app/company';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { currencyPrecision } from '@/lib/money';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Spinner } from '@/components/ui/misc';
import { Field, Input, NumberInput, Textarea } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';
import { useConfirm } from '@/components/ui/overlay';

function Editor({ initial, isNew }: { initial: ManualJournal; isNew: boolean }) {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [journal, setJournal] = useState(initial);
  const [saving, setSaving] = useState<'draft' | 'posted' | null>(null);
  const dirty = JSON.stringify(journal) !== JSON.stringify(initial);
  const allowNavigation = useUnsavedGuard(dirty && saving === null);
  const accounts = useLiveQuery(
    () => db.accounts.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  if (!accounts) return <Spinner className="py-24" label="Loading…" />;

  const p = currencyPrecision(company.currency);
  const totals = journalTotals(journal.lines, p);
  // The entry that closes a VAT return belongs to the return.
  const closesReturn = Boolean(initial.vatReturnId);
  const options = accounts
    .filter((a) => !a.archived || journal.lines.some((l) => l.accountId === a.id))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));

  const update = (patch: Partial<ManualJournal>) => setJournal((j) => ({ ...j, ...patch }));
  const updateLine = (id: string, patch: Partial<ManualJournal['lines'][number]>) =>
    setJournal((j) => ({
      ...j,
      lines: j.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));

  const save = async (status: 'draft' | 'posted') => {
    setSaving(status);
    try {
      const saved = await saveJournal({ ...journal, status });
      toast.success(`Journal ${saved.number} ${status === 'posted' ? 'posted' : 'saved as draft'}`);
      allowNavigation();
      navigate('/journals');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the journal.');
      setSaving(null);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete journal ${journal.number}?`,
      description: 'Its amounts are removed from the books.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteJournal(journal.id);
      toast.success('Journal deleted');
      allowNavigation();
      navigate('/journals');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the journal.');
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-sm text-slate-500">
            <Link to="/journals" className="hover:text-slate-700">
              Manual journals
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {isNew ? 'New journal' : `Journal ${journal.number}`}
          </h1>
        </div>
        {closesReturn ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {!isNew ? (
              <Button
                variant="ghost"
                className="text-red-600 hover:bg-red-50"
                onClick={() => void remove()}
              >
                <Trash2 /> Delete
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => void save('draft')}
              loading={saving === 'draft'}
              disabled={saving !== null}
            >
              Save as draft
            </Button>
            <Button
              onClick={() => void save('posted')}
              loading={saving === 'posted'}
              disabled={saving !== null}
            >
              Save and post
            </Button>
          </div>
        )}
      </div>

      {closesReturn ? (
        <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-blue-900">
          This entry moves the period's VAT to the VAT liability account. It was made when the
          return was filed and can only be removed by{' '}
          <Link to="/vat" className="font-medium underline">
            undoing the filing
          </Link>
          .
        </div>
      ) : null}

      <Card className="mb-6">
        <CardBody className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
          <Field label="Date">
            {(id) => (
              <Input
                id={id}
                type="date"
                value={journal.date}
                onChange={(e) => update({ date: e.target.value || journal.date })}
              />
            )}
          </Field>
          <Field label="Reference" hint="Shown in the reports, e.g. “Owner investment”.">
            {(id) => (
              <Input
                id={id}
                value={journal.reference}
                onChange={(e) => update({ reference: e.target.value })}
              />
            )}
          </Field>
          <Field label="Notes" optional className="md:col-span-2">
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={journal.notes}
                onChange={(e) => update({ notes: e.target.value })}
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Lines"
          description={`Amounts in ${company.currency}. Each line has a debit or a credit.`}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-100 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="w-[34%] px-4 py-2.5 text-start font-medium">Account</th>
                <th className="px-3 py-2.5 text-start font-medium">Description</th>
                <th className="w-36 px-3 py-2.5 text-end font-medium">Debit</th>
                <th className="w-36 px-3 py-2.5 text-end font-medium">Credit</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {journal.lines.map((line, index) => (
                <tr key={line.id}>
                  <td className="px-4 py-2">
                    <Combobox
                      value={line.accountId || null}
                      onChange={(accountId) => updateLine(line.id, { accountId })}
                      options={options}
                      placeholder="Choose an account…"
                      searchPlaceholder="Search accounts…"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Line ${index + 1} description`}
                      value={line.description}
                      onChange={(e) => updateLine(line.id, { description: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <NumberInput
                      aria-label={`Line ${index + 1} debit`}
                      value={line.debit}
                      allowNegative={false}
                      blankZero
                      onValueChange={(debit) =>
                        updateLine(line.id, { debit, ...(debit ? { credit: 0 } : {}) })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <NumberInput
                      aria-label={`Line ${index + 1} credit`}
                      value={line.credit}
                      allowNegative={false}
                      blankZero
                      onValueChange={(credit) =>
                        updateLine(line.id, { credit, ...(credit ? { debit: 0 } : {}) })
                      }
                    />
                  </td>
                  <td className="px-2 py-2 text-end">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove line ${index + 1}`}
                      disabled={journal.lines.length <= 2}
                      onClick={() =>
                        update({ lines: journal.lines.filter((l) => l.id !== line.id) })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200">
              <tr>
                <td className="px-4 py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => update({ lines: [...journal.lines, newJournalLine()] })}
                  >
                    <Plus /> Add line
                  </Button>
                </td>
                <td className="px-3 py-3 text-end font-medium text-slate-700">Total</td>
                <td className="tabular px-3 py-3 text-end font-semibold text-slate-900">
                  {fmt.money(totals.debit)}
                </td>
                <td className="tabular px-3 py-3 text-end font-semibold text-slate-900">
                  {fmt.money(totals.credit)}
                </td>
                <td />
              </tr>
              {totals.difference !== 0 ? (
                <tr>
                  <td colSpan={2} className="px-3 pb-3 text-end text-sm text-red-600">
                    Difference
                  </td>
                  <td
                    colSpan={2}
                    className={cn('tabular px-3 pb-3 text-end font-semibold text-red-600')}
                  >
                    {fmt.money(Math.abs(totals.difference))}{' '}
                    {totals.difference > 0 ? 'more debit' : 'more credit'}
                  </td>
                  <td />
                </tr>
              ) : null}
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function JournalEditorPage() {
  const { id } = useParams();
  const company = useCompany();
  const existing = useLiveQuery(
    async () => (id ? ((await db.journals.get(id)) ?? null) : null),
    [id],
  );
  const [fresh] = useState(() => createJournal(company.id, { status: 'draft' }));
  if (id && existing === undefined) return <Spinner className="py-24" label="Loading…" />;
  if (id && existing === null) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">This journal could not be found.</p>
        <Link to="/journals" className="text-primary-700 mt-4 inline-block text-sm font-medium">
          Back to manual journals
        </Link>
      </Card>
    );
  }
  const initial = existing ?? fresh;
  return (
    <Editor key={initial.id + (existing?.updatedAt ?? '')} initial={initial} isNew={!existing} />
  );
}
