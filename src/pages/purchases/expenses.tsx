import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Paperclip, Plus, Search, Wallet } from 'lucide-react';
import { db } from '@/db/db';
import { createExpense } from '@/db/purchases';
import type { Expense } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { downloadCsv } from '@/lib/csv';
import { today } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { Input, Select } from '@/components/ui/form';
import { useAccounts } from '@/features/accounting/account-pickers';
import { ExpenseDialog, includedTax } from '@/features/purchases/expense-dialog';

export default function ExpensesPage() {
  const company = useCompany();
  const fmt = useFormat();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [fresh, setFresh] = useState<Expense | null>(null);

  const expenses = useLiveQuery(
    () => db.expenses.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  // Only the owners: the files themselves can be large.
  const withFiles = useLiveQuery(
    async () => new Set((await db.attachments.orderBy('ownerId').uniqueKeys()).map(String)),
    [],
  );
  const accounts = useAccounts();

  const openId = params.get('open');
  const creating = params.get('new') === '1';
  const editing = openId ? (expenses?.find((e) => e.id === openId) ?? null) : null;

  const rows = useMemo(() => {
    if (!expenses || !clients || !accounts) return null;
    const vendors = new Map(clients.map((c) => [c.id, c.name]));
    const names = new Map(accounts.map((a) => [a.id, a.name]));
    const bank = accounts.find((a) => a.role === 'bank');
    return expenses
      .map((e) => ({
        expense: e,
        vendor: e.vendorId ? (vendors.get(e.vendorId) ?? '') : '',
        category: names.get(e.accountId) ?? '—',
        paidFrom: e.paidFromAccountId
          ? (names.get(e.paidFromAccountId) ?? '—')
          : (bank?.name ?? '—'),
      }))
      .sort(
        (a, b) =>
          b.expense.date.localeCompare(a.expense.date) ||
          b.expense.number.localeCompare(a.expense.number, undefined, { numeric: true }),
      );
  }, [expenses, clients, accounts]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!category || r.expense.accountId === category) &&
        (!q ||
          `${r.expense.number} ${r.expense.description} ${r.vendor} ${r.category} ${r.expense.reference}`
            .toLowerCase()
            .includes(q)),
    );
  }, [rows, query, category]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      map.set(r.expense.currency, (map.get(r.expense.currency) ?? 0) + r.expense.amount);
    }
    return [...map.entries()];
  }, [filtered]);

  if (!rows || !accounts) return <Spinner className="py-24" label="Loading…" />;

  const newExpense = () =>
    createExpense(company.id, {
      currency: company.currency,
      accountId: accounts.find((a) => a.role === 'expense')?.id ?? '',
      vendorId: params.get('vendor') || null,
    });
  // "?new=1" can come from elsewhere (the New menu, a vendor page): start one once.
  if (creating && !fresh) setFresh(newExpense());
  const close = () => {
    setFresh(null);
    setParams({}, { replace: true });
  };
  const startNew = () => {
    setFresh(newExpense());
    setParams({ new: '1' }, { replace: true });
  };
  const usedCategories = accounts
    .filter((a) => rows.some((r) => r.expense.accountId === a.id))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const exportCsv = () =>
    downloadCsv(
      `expenses-${today()}`,
      [
        'Number',
        'Date',
        'Description',
        'Category',
        'Vendor',
        'Paid from',
        'Reference',
        'Currency',
        'Amount',
        'Tax included',
      ],
      filtered.map((r) => [
        r.expense.number,
        r.expense.date,
        r.expense.description,
        r.category,
        r.vendor,
        r.paidFrom,
        r.expense.reference,
        r.expense.currency,
        r.expense.amount,
        includedTax(r.expense.amount, r.expense.taxes, r.expense.currency),
      ]),
    );

  const dialogExpense = creating ? fresh : editing;

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Receipts and costs paid straight away, without a bill."
        actions={
          <>
            {rows.length > 0 ? (
              <Button variant="outline" onClick={exportCsv}>
                <Download /> Export CSV
              </Button>
            ) : null}
            <Button onClick={startNew}>
              <Plus /> Record expense
            </Button>
          </>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet />}
            title="No expenses yet"
            description="Snap a receipt and record what you spent; it goes straight into your books."
            action={
              <Button onClick={startNew}>
                <Plus /> Record expense
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:w-64">
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Filter by category"
              >
                <option value="">All categories</option>
                {usedCategories.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search expenses…"
                className="ps-9"
                aria-label="Search expenses"
              />
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">No expenses match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-start text-xs font-medium tracking-wide text-slate-500 uppercase">
                    <th className="px-5 py-3">Expense</th>
                    <th className="px-3 py-3">Category</th>
                    <th className="hidden px-3 py-3 md:table-cell">Vendor</th>
                    <th className="hidden px-3 py-3 lg:table-cell">Paid from</th>
                    <th className="px-5 py-3 text-end">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((r) => (
                    <tr
                      key={r.expense.id}
                      onClick={() => setParams({ open: r.expense.id }, { replace: true })}
                      className="cursor-pointer hover:bg-slate-50"
                    >
                      <td className="px-5 py-3">
                        <button
                          type="button"
                          className="hover:text-primary-700 text-start font-medium text-slate-900"
                          onClick={(e) => {
                            e.stopPropagation();
                            setParams({ open: r.expense.id }, { replace: true });
                          }}
                        >
                          {r.expense.description || r.expense.number}
                        </button>
                        <span className="block text-xs text-slate-500">
                          {fmt.date(r.expense.date)} · {r.expense.number}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{r.category}</td>
                      <td className="hidden max-w-48 truncate px-3 py-3 text-slate-600 md:table-cell">
                        {r.vendor || '—'}
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 lg:table-cell">
                        {r.paidFrom}
                      </td>
                      <td className="tabular px-5 py-3 text-end font-medium whitespace-nowrap text-slate-900">
                        {withFiles?.has(r.expense.id) ? (
                          <Paperclip
                            className="me-1.5 inline size-3.5 text-slate-400"
                            role="img"
                            aria-label="Receipt attached"
                          />
                        ) : null}
                        {fmt.money(r.expense.amount, r.expense.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
            <span>
              {filtered.length} {filtered.length === 1 ? 'expense' : 'expenses'}
            </span>
            <span className="tabular flex flex-wrap gap-x-4">
              {totals.map(([currency, amount]) => (
                <span key={currency}>
                  Total <strong className="text-slate-900">{fmt.money(amount, currency)}</strong>
                </span>
              ))}
            </span>
          </div>
        </Card>
      )}

      {dialogExpense ? (
        <ExpenseDialog
          key={dialogExpense.id}
          expense={dialogExpense}
          isNew={creating}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
