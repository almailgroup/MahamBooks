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
import { useAccounts } from '@/apps/books/features/accounting/account-pickers';
import { ExpenseDialog, includedTax } from '@/features/purchases/expense-dialog';
import { t, tp } from '@/i18n';
import { localName } from '@/i18n/names';

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
    const vendors = new Map(clients.map((c) => [c.id, c]));
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const bank = accounts.find((a) => a.role === 'bank');
    return expenses
      .map((e) => {
        const vendor = e.vendorId ? vendors.get(e.vendorId) : undefined;
        const category = byId.get(e.accountId);
        const paidFrom = e.paidFromAccountId ? byId.get(e.paidFromAccountId) : bank;
        return {
          expense: e,
          vendor: localName(vendor),
          category: localName(category) || '—',
          paidFrom: localName(paidFrom) || '—',
          // Search finds English and Arabic names alike.
          search: [
            e.number,
            e.description,
            e.reference,
            vendor?.name,
            vendor?.nameAr,
            category?.name,
            category?.nameAr,
          ]
            .join(' ')
            .toLowerCase(),
        };
      })
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
      (r) => (!category || r.expense.accountId === category) && (!q || r.search.includes(q)),
    );
  }, [rows, query, category]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      map.set(r.expense.currency, (map.get(r.expense.currency) ?? 0) + r.expense.amount);
    }
    return [...map.entries()];
  }, [filtered]);

  if (!rows || !accounts) return <Spinner className="py-24" label={t('Loading…')} />;

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
        t('Number'),
        t('Date'),
        t('Description'),
        t('Category'),
        t('Vendor'),
        t('Paid from'),
        t('Reference'),
        t('Currency'),
        t('Amount'),
        t('Tax included'),
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
        title={t('Expenses')}
        description={t('Receipts and costs paid straight away, without a bill.')}
        actions={
          <>
            {rows.length > 0 ? (
              <Button variant="outline" onClick={exportCsv}>
                <Download /> {t('Export CSV')}
              </Button>
            ) : null}
            <Button onClick={startNew}>
              <Plus /> {t('Record expense')}
            </Button>
          </>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet />}
            title={t('No expenses yet')}
            description={t(
              'Snap a receipt and record what you spent; it goes straight into your books.',
            )}
            action={
              <Button onClick={startNew}>
                <Plus /> {t('Record expense')}
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
                aria-label={t('Filter by category')}
              >
                <option value="">{t('All categories')}</option>
                {usedCategories.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {localName(a)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Search expenses…')}
                className="ps-9"
                aria-label={t('Search expenses')}
              />
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">
              {t('No expenses match.')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-start text-xs font-medium tracking-wide text-slate-500 uppercase">
                    <th className="px-4 py-3 sm:px-5">{t('Expense')}</th>
                    <th className="hidden px-3 py-3 sm:table-cell">{t('Category')}</th>
                    <th className="hidden px-3 py-3 md:table-cell">{t('Vendor')}</th>
                    <th className="hidden px-3 py-3 lg:table-cell">{t('Paid from')}</th>
                    <th className="px-4 py-3 text-end sm:px-5">{t('Amount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((r) => (
                    <tr
                      key={r.expense.id}
                      onClick={() => setParams({ open: r.expense.id }, { replace: true })}
                      className="cursor-pointer hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 sm:px-5">
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
                        <span className="block text-xs text-slate-500 sm:hidden">{r.category}</span>
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">
                        {r.category}
                      </td>
                      <td className="hidden max-w-48 truncate px-3 py-3 text-slate-600 md:table-cell">
                        {r.vendor || '—'}
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 lg:table-cell">
                        {r.paidFrom}
                      </td>
                      <td className="tabular px-4 py-3 text-end font-medium whitespace-nowrap text-slate-900 sm:px-5">
                        {withFiles?.has(r.expense.id) ? (
                          <Paperclip
                            className="me-1.5 inline size-3.5 text-slate-400"
                            role="img"
                            aria-label={t('Receipt attached')}
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
            <span>{tp(filtered.length, '{count} expense', '{count} expenses')}</span>
            <span className="tabular flex flex-wrap gap-x-4">
              {totals.map(([currency, amount]) => (
                <span key={currency}>
                  {t('Total')}{' '}
                  <strong className="text-slate-900">{fmt.money(amount, currency)}</strong>
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
