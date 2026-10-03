import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeftRight,
  Banknote,
  CheckCircle2,
  CreditCard,
  EyeOff,
  FileUp,
  Link2,
  MoreHorizontal,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import {
  createFromTransaction,
  deleteTransaction,
  ignoreTransaction,
  matchTransaction,
  unmatchTransaction,
  type CreateAction,
} from '@/db/banking';
import type { Account, BankTransaction, InvoiceDocument, TaxLine, TaxRate } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { useLedger } from '@/features/accounting/use-ledger';
import { SOURCE_LABELS, sourceLink } from '@/features/accounting/source-link';
import { categoryOptions } from '@/features/accounting/account-pickers';
import { ImportStatementDialog } from '@/features/banking/import-dialog';
import { TransferDialog } from '@/features/banking/transfer-dialog';
import { TaxSelect } from '@/features/editor/tax-select';
import {
  bookEntries,
  matchKey,
  reconciliation,
  suggestMatches,
  type BookEntry,
} from '@/lib/banking/match';
import { isMoneyAccount } from '@/lib/accounting/account-types';
import { currencyPrecision, fromMinor, sameAmount, toMinor } from '@/lib/money';
import { cn } from '@/lib/cn';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/misc';
import { Select } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from '@/components/ui/overlay';

function useMoneyAccounts() {
  const company = useCompany();
  const accounts = useLiveQuery(
    () => db.accounts.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const money = useMemo(
    () =>
      (accounts ?? [])
        .filter((a) => isMoneyAccount(a.type) && !a.archived)
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    [accounts],
  );
  return { accounts, money };
}

function useMinorMoney() {
  const company = useCompany();
  const fmt = useFormat();
  const p = currencyPrecision(company.currency);
  return {
    p,
    money: (minor: number) => fmt.money(fromMinor(minor, p)),
    minor: (major: number) => toMinor(major, p),
  };
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

function BankingOverview() {
  const company = useCompany();
  const fmt = useFormat();
  const ledger = useLedger();
  const { money: moneyAccounts } = useMoneyAccounts();
  const transactions = useLiveQuery(
    () => db.bankTransactions.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const { money } = useMinorMoney();
  const [dialog, setDialog] = useState<'import' | 'transfer' | null>(null);

  if (!ledger || !transactions) return <Spinner className="py-24" label="Loading…" />;

  return (
    <div>
      <PageHeader
        title="Banking"
        description="Import statements, match them to your books and keep every account reconciled."
        actions={
          moneyAccounts.length ? (
            <>
              <Button variant="outline" onClick={() => setDialog('transfer')}>
                <ArrowLeftRight /> Transfer money
              </Button>
              <Button onClick={() => setDialog('import')}>
                <FileUp /> Import statement
              </Button>
            </>
          ) : null
        }
      />
      {moneyAccounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Banknote />}
            title="No bank accounts yet"
            description="Add your bank, cash and card accounts in the chart of accounts."
            action={<ButtonLink to="/accounts">Open chart of accounts</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {moneyAccounts.map((account) => {
            const own = transactions.filter((t) => t.accountId === account.id);
            const keys = new Set(bookEntries(ledger.lines, account.id).map(matchKey));
            const unmatched = own.filter(
              (t) => !t.ignored && (!t.match || !keys.has(matchKey(t.match))),
            ).length;
            const balance = ledger.lines
              .filter((l) => l.accountId === account.id)
              .reduce((s, l) => s + l.amount, 0);
            const last = [...own].sort(
              (a, b) => b.date.localeCompare(a.date) || b.position - a.position,
            )[0];
            return (
              <Link
                key={account.id}
                to={`/banking/${account.id}`}
                className="hover:border-primary-300 block rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{account.name}</p>
                    <p className="text-xs text-slate-500">
                      {account.code}
                      {account.bank?.institution ? ` · ${account.bank.institution}` : ''}
                    </p>
                  </div>
                  <span className="text-slate-400 [&_svg]:size-5">
                    {account.type === 'liability_credit_card' ? <CreditCard /> : <Banknote />}
                  </span>
                </div>
                <p className="tabular mt-4 text-2xl font-semibold text-slate-900">
                  {money(account.type === 'liability_credit_card' ? -balance : balance)}
                </p>
                <p className="text-xs text-slate-500">
                  {account.type === 'liability_credit_card' ? 'Owed on the card' : 'In your books'}
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                  <span className="text-slate-500">
                    {last ? `Statement to ${fmt.date(last.date)}` : 'No statement imported'}
                  </span>
                  {own.length ? (
                    unmatched ? (
                      <Badge tone="amber">{unmatched} to match</Badge>
                    ) : (
                      <Badge tone="green">All matched</Badge>
                    )
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {dialog === 'import' ? (
        <ImportStatementDialog
          accounts={moneyAccounts}
          initialAccountId={moneyAccounts[0].id}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'transfer' ? (
        <TransferDialog accounts={moneyAccounts} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One account                                                                */
/* -------------------------------------------------------------------------- */

type Tab = 'match' | 'matched' | 'ignored';

function BankAccountPage({ accountId }: { accountId: string }) {
  const company = useCompany();
  const fmt = useFormat();
  const ledger = useLedger();
  const { accounts, money: moneyAccounts } = useMoneyAccounts();
  const transactions = useLiveQuery(
    () => db.bankTransactions.where('accountId').equals(accountId).toArray(),
    [accountId],
  );
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const openDocs = useLiveQuery(
    () =>
      db.documents
        .where('companyId')
        .equals(company.id)
        .filter(
          (d) =>
            (d.type === 'invoice' || d.type === 'bill') &&
            (d.status === 'sent' || d.status === 'partial') &&
            d.currency === company.currency,
        )
        .toArray(),
    [company.id, company.currency],
  );
  const taxRates = useLiveQuery(
    () => db.taxRates.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const { money, minor } = useMinorMoney();
  const [tab, setTab] = useState<Tab>('match');
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'import' | 'transfer' | null>(null);

  const entries = useMemo(
    () => (ledger ? bookEntries(ledger.lines, accountId) : []),
    [ledger, accountId],
  );

  if (!ledger || !transactions || !accounts || !clients || !openDocs || !taxRates)
    return <Spinner className="py-24" label="Loading…" />;
  const account = accounts.find((a) => a.id === accountId);
  if (!account || account.companyId !== company.id) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">This account could not be found.</p>
        <Link to="/banking" className="text-primary-700 mt-4 inline-block text-sm font-medium">
          Back to banking
        </Link>
      </Card>
    );
  }

  const names = new Map(clients.map((c) => [c.id, c.name]));
  const byKey = new Map(entries.map((e) => [matchKey(e), e]));
  const matchedTo = (t: BankTransaction) => (t.match ? byKey.get(matchKey(t.match)) : undefined);
  const taken = new Set(transactions.filter((t) => matchedTo(t)).map((t) => matchKey(t.match!)));
  const sorted = [...transactions].sort(
    (a, b) => b.date.localeCompare(a.date) || b.position - a.position,
  );
  const lists: Record<Tab, BankTransaction[]> = {
    match: sorted.filter((t) => !t.ignored && !matchedTo(t)),
    matched: sorted.filter((t) => !t.ignored && matchedTo(t)),
    ignored: sorted.filter((t) => t.ignored),
  };
  const rec = reconciliation(transactions, ledger.lines, accountId, minor);
  const card = account.type === 'liability_credit_card';
  const reconciled = rec.total > 0 && rec.unmatched === 0 && rec.difference === 0;

  const run = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast.success(message);
      setOpen(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong.');
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-sm text-slate-500">
            <Link to="/banking" className="hover:text-slate-700">
              Banking
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{account.name}</h1>
            {reconciled ? <Badge tone="green">Reconciled</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {account.code}
            {account.bank?.institution ? ` · ${account.bank.institution}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialog('transfer')}>
            <ArrowLeftRight /> Transfer
          </Button>
          <Button onClick={() => setDialog('import')}>
            <FileUp /> Import statement
          </Button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-slate-500">
            Statement balance
            {rec.statementDate ? ` · ${fmt.date(rec.statementDate)}` : ''}
          </p>
          <p className="tabular mt-1 text-2xl font-semibold text-slate-900">
            {rec.statementBalance === null
              ? '—'
              : money(card ? -rec.statementBalance : rec.statementBalance)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">
            In your books
            {rec.statementDate ? ` · ${fmt.date(rec.statementDate)}` : ''}
          </p>
          <p className="tabular mt-1 text-2xl font-semibold text-slate-900">
            {money(card ? -rec.bookBalance : rec.bookBalance)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">Difference</p>
          <p
            className={cn(
              'tabular mt-1 text-2xl font-semibold',
              rec.difference ? 'text-amber-700' : 'text-slate-900',
            )}
          >
            {rec.difference === null ? '—' : money(Math.abs(rec.difference))}
          </p>
          <p className="text-xs text-slate-500">
            {rec.difference === null
              ? 'Shown once a statement with balances is imported.'
              : rec.unmatched
                ? `${rec.unmatched} statement ${rec.unmatched === 1 ? 'line' : 'lines'} to match`
                : rec.difference
                  ? 'Check for missing or duplicated transactions.'
                  : 'Your books agree with the bank.'}
          </p>
        </Card>
      </div>

      <Card>
        <div className="border-b border-slate-100 p-4">
          <Segmented
            value={tab}
            onChange={(t) => {
              setTab(t);
              setOpen(null);
            }}
            options={[
              { value: 'match', label: 'To match', count: lists.match.length },
              { value: 'matched', label: 'Matched', count: lists.matched.length },
              { value: 'ignored', label: 'Ignored', count: lists.ignored.length },
            ]}
          />
        </div>
        {transactions.length === 0 ? (
          <EmptyState
            icon={<FileUp />}
            title="No statement yet"
            description="Import a CSV or OFX statement from your online banking to match it to your books."
            action={
              <Button onClick={() => setDialog('import')}>
                <FileUp /> Import statement
              </Button>
            }
          />
        ) : lists[tab].length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <CheckCircle2 className="size-8 text-emerald-500" />
            <p className="mt-2 text-sm text-slate-600">
              {tab === 'match' ? 'Everything is matched.' : 'Nothing here.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lists[tab].map((t) => {
              const entry = matchedTo(t);
              const isOpen = open === t.id;
              return (
                <li key={t.id}>
                  <div
                    className={cn(
                      'flex items-center gap-3 px-5 py-3',
                      tab === 'match' && 'cursor-pointer hover:bg-slate-50',
                      isOpen && 'bg-slate-50',
                    )}
                    onClick={tab === 'match' ? () => setOpen(isOpen ? null : t.id) : undefined}
                  >
                    <div className="w-24 shrink-0 text-sm text-slate-600">{fmt.date(t.date)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {t.description || '—'}
                      </p>
                      {entry ? (
                        <Link
                          to={sourceLink({ source: entry.source, sourceId: entry.id })}
                          className="text-primary-700 inline-flex items-center gap-1 text-xs hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link2 className="size-3" /> {SOURCE_LABELS[entry.source]} {entry.number}
                          {entry.contactId && names.get(entry.contactId)
                            ? ` · ${names.get(entry.contactId)}`
                            : ''}
                        </Link>
                      ) : t.match ? (
                        <p className="text-xs text-amber-700">
                          What it was matched to has been deleted.
                        </p>
                      ) : t.reference ? (
                        <p className="truncate text-xs text-slate-500">{t.reference}</p>
                      ) : null}
                    </div>
                    <div
                      className={cn(
                        'tabular shrink-0 text-end text-sm font-semibold',
                        t.amount > 0 ? 'text-emerald-700' : 'text-slate-900',
                      )}
                    >
                      {fmt.money(t.amount)}
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${t.description}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownTrigger>
                        <DropdownContent>
                          {tab === 'matched' ? (
                            <DropdownItem
                              icon={<Undo2 />}
                              onSelect={() =>
                                void run(() => unmatchTransaction(t.id), 'Match removed')
                              }
                            >
                              Unmatch
                            </DropdownItem>
                          ) : null}
                          {tab === 'ignored' ? (
                            <DropdownItem
                              icon={<Undo2 />}
                              onSelect={() =>
                                void run(() => ignoreTransaction(t.id, false), 'Line restored')
                              }
                            >
                              Restore
                            </DropdownItem>
                          ) : (
                            <DropdownItem
                              icon={<EyeOff />}
                              onSelect={() =>
                                void run(() => ignoreTransaction(t.id, true), 'Line ignored')
                              }
                            >
                              Ignore
                            </DropdownItem>
                          )}
                          <DropdownItem
                            icon={<Trash2 />}
                            danger
                            onSelect={() =>
                              void run(() => deleteTransaction(t.id), 'Statement line deleted')
                            }
                          >
                            Delete line
                          </DropdownItem>
                        </DropdownContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {isOpen ? (
                    <MatchPanel
                      transaction={t}
                      candidates={suggestMatches(
                        {
                          date: t.date,
                          amount: minor(t.amount),
                          description: t.description,
                          reference: t.reference,
                        },
                        entries,
                        taken,
                        names,
                        30,
                      )}
                      names={names}
                      accounts={accounts}
                      moneyAccounts={moneyAccounts.filter((a) => a.id !== accountId)}
                      openDocs={openDocs}
                      taxRates={taxRates}
                      money={money}
                      onMatch={(entry) =>
                        void run(
                          () => matchTransaction(t.id, { source: entry.source, id: entry.id }),
                          'Matched',
                        )
                      }
                      onCreate={(action, message) =>
                        void run(() => createFromTransaction(t.id, action), message)
                      }
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {dialog === 'import' ? (
        <ImportStatementDialog
          accounts={moneyAccounts.some((a) => a.id === accountId) ? moneyAccounts : [account]}
          initialAccountId={accountId}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'transfer' ? (
        <TransferDialog
          accounts={moneyAccounts.some((a) => a.id === accountId) ? moneyAccounts : [account]}
          initialFrom={accountId}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

type Recipe = 'document' | 'expense' | 'transfer' | 'account';

function MatchPanel({
  transaction,
  candidates,
  names,
  accounts,
  moneyAccounts,
  openDocs,
  taxRates,
  money,
  onMatch,
  onCreate,
}: {
  transaction: BankTransaction;
  candidates: { entry: BookEntry; score: number }[];
  names: Map<string, string>;
  accounts: Account[];
  moneyAccounts: Account[];
  openDocs: InvoiceDocument[];
  taxRates: TaxRate[];
  money: (minor: number) => string;
  onMatch: (entry: BookEntry) => void;
  onCreate: (action: CreateAction, message: string) => void;
}) {
  const fmt = useFormat();
  const into = transaction.amount > 0;
  const amount = Math.abs(transaction.amount);
  const docs = openDocs
    .filter((d) => d.type === (into ? 'invoice' : 'bill'))
    .sort(
      (a, b) =>
        Number(sameAmount(b.totals.balance, amount, b.currency)) -
          Number(sameAmount(a.totals.balance, amount, a.currency)) ||
        a.issueDate.localeCompare(b.issueDate),
    );
  const exactDoc = docs.find((d) => sameAmount(d.totals.balance, amount, d.currency));
  const recipes: { value: Recipe; label: string }[] = into
    ? [
        { value: 'document', label: 'Invoice payment' },
        { value: 'transfer', label: 'Transfer' },
        { value: 'account', label: 'Other' },
      ]
    : [
        { value: 'expense', label: 'Expense' },
        { value: 'document', label: 'Bill payment' },
        { value: 'transfer', label: 'Transfer' },
        { value: 'account', label: 'Other' },
      ];
  // Good first guesses from the bank's description.
  const text = `${transaction.description} ${transaction.reference}`;
  const looksLikeTransfer =
    moneyAccounts.length > 0 && /transfer|repayment|top.?up|tfr/i.test(text);
  const looksLikeFee = /\bfees?\b|charges?|commission|interest/i.test(text);
  const [recipe, setRecipe] = useState<Recipe>(
    exactDoc ? 'document' : looksLikeTransfer ? 'transfer' : into ? 'account' : 'expense',
  );
  const expenseRole = accounts.find((a) => a.role === 'expense');
  const feeRole = accounts.find((a) => a.role === 'bank_fees');
  const [category, setCategory] = useState(
    (looksLikeFee ? feeRole?.id : undefined) ?? expenseRole?.id ?? '',
  );
  const [taxes, setTaxes] = useState<TaxLine[]>([]);
  const [documentId, setDocumentId] = useState(exactDoc?.id ?? docs[0]?.id ?? '');
  const [otherMoney, setOtherMoney] = useState(
    (/card/i.test(text)
      ? moneyAccounts.find((a) => a.type === 'liability_credit_card')?.id
      : undefined) ??
      moneyAccounts[0]?.id ??
      '',
  );
  const [otherAccount, setOtherAccount] = useState('');

  const otherOptions = accounts
    .filter((a) => !a.archived && a.id !== transaction.accountId)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));

  return (
    <div className="space-y-5 border-t border-slate-100 bg-slate-50/70 px-5 py-4">
      {candidates.length ? (
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
            Found in your books
          </p>
          <ul className="space-y-2">
            {candidates.slice(0, 4).map(({ entry }) => (
              <li
                key={matchKey(entry)}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-medium text-slate-800">
                    {SOURCE_LABELS[entry.source]} {entry.number}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {fmt.date(entry.date)}
                    {entry.contactId && names.get(entry.contactId)
                      ? ` · ${names.get(entry.contactId)}`
                      : ''}
                    {entry.description ? ` · ${entry.description}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="tabular text-sm font-semibold">{money(entry.amount)}</span>
                  <Button size="sm" onClick={() => onMatch(entry)}>
                    Match
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
          {candidates.length ? 'Or record it as' : 'Record it as'}
        </p>
        <Segmented value={recipe} onChange={setRecipe} options={recipes} />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          {recipe === 'document' ? (
            docs.length ? (
              <label className="flex-1 text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  {into ? 'Invoice' : 'Bill'}
                </span>
                <Select
                  value={documentId}
                  onChange={(e) => setDocumentId(e.target.value)}
                  aria-label={into ? 'Invoice' : 'Bill'}
                >
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.number} · {names.get(d.clientId) ?? '—'} · balance{' '}
                      {fmt.money(d.totals.balance, d.currency)}
                      {sameAmount(d.totals.balance, amount, d.currency) ? ' · same amount' : ''}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <p className="flex-1 text-sm text-slate-500">
                No open {into ? 'invoices' : 'bills'} in {fmt.currency}.
              </p>
            )
          ) : null}
          {recipe === 'expense' ? (
            <>
              <label className="flex-1 text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">Category</span>
                <Combobox
                  ariaLabel="Expense category"
                  value={category || null}
                  onChange={setCategory}
                  options={categoryOptions(accounts, [category])}
                  placeholder="Choose a category…"
                  searchPlaceholder="Search accounts…"
                />
              </label>
              <label className="text-sm sm:w-44">
                <span className="mb-1 block text-xs font-medium text-slate-500">Tax included</span>
                <TaxSelect value={taxes} onChange={setTaxes} rates={taxRates} />
              </label>
            </>
          ) : null}
          {recipe === 'transfer' ? (
            moneyAccounts.length ? (
              <label className="flex-1 text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  {into ? 'From' : 'To'}
                </span>
                <Select
                  value={otherMoney}
                  onChange={(e) => setOtherMoney(e.target.value)}
                  aria-label={into ? 'Transfer from' : 'Transfer to'}
                >
                  {moneyAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <p className="flex-1 text-sm text-slate-500">No other bank or cash account.</p>
            )
          ) : null}
          {recipe === 'account' ? (
            <label className="flex-1 text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">Account</span>
              <Combobox
                ariaLabel="Other account"
                value={otherAccount || null}
                onChange={setOtherAccount}
                options={otherOptions}
                placeholder="Choose an account…"
                searchPlaceholder="Search accounts…"
              />
            </label>
          ) : null}
          <Button
            disabled={
              (recipe === 'document' && !documentId) ||
              (recipe === 'expense' && !category) ||
              (recipe === 'transfer' && !otherMoney) ||
              (recipe === 'account' && !otherAccount)
            }
            onClick={() => {
              if (recipe === 'document')
                onCreate({ kind: 'document', documentId }, 'Payment recorded and matched');
              else if (recipe === 'expense')
                onCreate(
                  { kind: 'expense', accountId: category, taxes, vendorId: null },
                  'Expense recorded and matched',
                );
              else if (recipe === 'transfer')
                onCreate(
                  { kind: 'transfer', otherAccountId: otherMoney },
                  'Transfer recorded and matched',
                );
              else onCreate({ kind: 'account', accountId: otherAccount }, 'Recorded and matched');
            }}
          >
            Record and match
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function BankingPage() {
  const { accountId } = useParams();
  return accountId ? (
    <BankAccountPage key={accountId} accountId={accountId} />
  ) : (
    <BankingOverview />
  );
}
