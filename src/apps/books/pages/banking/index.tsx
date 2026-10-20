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
import { useLedger } from '@/apps/books/features/accounting/use-ledger';
import { SOURCE_LABELS, sourceLink } from '@/apps/books/features/accounting/source-link';
import { categoryOptions } from '@/apps/books/features/accounting/account-pickers';
import { ImportStatementDialog } from '@/apps/books/features/banking/import-dialog';
import { TransferDialog } from '@/apps/books/features/banking/transfer-dialog';
import { PayrollNotIncluded } from '@/features/cloud/role-gates';
import { TaxSelect } from '@/apps/books/features/editor/tax-select';
import {
  bookEntries,
  matchKey,
  reconciliation,
  suggestMatches,
  type BookEntry,
} from '@/lib/banking/match';
import { isMoneyAccount } from '@/lib/accounting/account-types';
import { lineDescription } from '@/lib/accounting/ledger';
import { currencyPrecision, fromMinor, sameAmount, toMinor } from '@/lib/money';
import { cn } from '@/lib/cn';
import { t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
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

  if (!ledger || !transactions) return <Spinner className="py-24" label={t('Loading…')} />;

  return (
    <div>
      <PageHeader
        title={t('Banking')}
        description={t(
          'Import statements, match them to your books and keep every account reconciled.',
        )}
        actions={
          moneyAccounts.length ? (
            <>
              <Button variant="outline" onClick={() => setDialog('transfer')}>
                <ArrowLeftRight /> {t('Transfer money')}
              </Button>
              <Button onClick={() => setDialog('import')}>
                <FileUp /> {t('Import statement')}
              </Button>
            </>
          ) : null
        }
      />
      <PayrollNotIncluded className="mb-4" />
      {moneyAccounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Banknote />}
            title={t('No bank accounts yet')}
            description={t('Add your bank, cash and card accounts in the chart of accounts.')}
            action={<ButtonLink to="/accounts">{t('Open chart of accounts')}</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {moneyAccounts.map((account) => {
            const own = transactions.filter((tx) => tx.accountId === account.id);
            const keys = new Set(bookEntries(ledger.lines, account.id).map(matchKey));
            const unmatched = own.filter(
              (tx) => !tx.ignored && (!tx.match || !keys.has(matchKey(tx.match))),
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
                className="hover:border-primary-300 bg-surface block rounded-xl border border-slate-200 p-5 shadow-xs transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{localName(account)}</p>
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
                  {account.type === 'liability_credit_card'
                    ? t('Owed on the card')
                    : t('In your books')}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm">
                  <span className="text-slate-500">
                    {last
                      ? t('Statement to {date}', { date: fmt.date(last.date) })
                      : t('No statement imported')}
                  </span>
                  {own.length ? (
                    unmatched ? (
                      <Badge tone="amber">
                        {tp(unmatched, '{count} to match', '{count} to match')}
                      </Badge>
                    ) : (
                      <Badge tone="green">{t('All matched')}</Badge>
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
    return <Spinner className="py-24" label={t('Loading…')} />;
  const account = accounts.find((a) => a.id === accountId);
  if (!account || account.companyId !== company.id) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">{t('This account could not be found.')}</p>
        <Link to="/banking" className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {t('Back to banking')}
        </Link>
      </Card>
    );
  }

  const names = new Map(clients.map((c) => [c.id, localName(c)]));
  // Matching looks for either of a contact's names in the bank's description.
  const matchNames = new Map(clients.map((c) => [c.id, `${c.name} ${c.nameAr ?? ''}`.trim()]));
  const byKey = new Map(entries.map((e) => [matchKey(e), e]));
  const matchedTo = (tx: BankTransaction) => (tx.match ? byKey.get(matchKey(tx.match)) : undefined);
  const taken = new Set(
    transactions.filter((tx) => matchedTo(tx)).map((tx) => matchKey(tx.match!)),
  );
  const sorted = [...transactions].sort(
    (a, b) => b.date.localeCompare(a.date) || b.position - a.position,
  );
  const lists: Record<Tab, BankTransaction[]> = {
    match: sorted.filter((tx) => !tx.ignored && !matchedTo(tx)),
    matched: sorted.filter((tx) => !tx.ignored && matchedTo(tx)),
    ignored: sorted.filter((tx) => tx.ignored),
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
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-sm text-slate-500">
            <Link to="/banking" className="hover:text-slate-700">
              {t('Banking')}
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {localName(account)}
            </h1>
            {reconciled ? <Badge tone="green">{t('Reconciled')}</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {account.code}
            {account.bank?.institution ? ` · ${account.bank.institution}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialog('transfer')}>
            <ArrowLeftRight /> {t('Transfer')}
          </Button>
          <Button onClick={() => setDialog('import')}>
            <FileUp /> {t('Import statement')}
          </Button>
        </div>
      </div>

      <PayrollNotIncluded className="mb-6" />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-slate-500">
            {t('Statement balance')}
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
            {t('In your books')}
            {rec.statementDate ? ` · ${fmt.date(rec.statementDate)}` : ''}
          </p>
          <p className="tabular mt-1 text-2xl font-semibold text-slate-900">
            {money(card ? -rec.bookBalance : rec.bookBalance)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">{t('Difference')}</p>
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
              ? t('Shown once a statement with balances is imported.')
              : rec.unmatched
                ? tp(
                    rec.unmatched,
                    '{count} statement line to match',
                    '{count} statement lines to match',
                  )
                : rec.difference
                  ? t('Check for missing or duplicated transactions.')
                  : t('Your books agree with the bank.')}
          </p>
        </Card>
      </div>

      <Card>
        <div className="border-b border-slate-100 p-4">
          <Segmented
            value={tab}
            onChange={(value) => {
              setTab(value);
              setOpen(null);
            }}
            options={[
              { value: 'match', label: t('To match'), count: lists.match.length },
              { value: 'matched', label: t('Matched'), count: lists.matched.length },
              { value: 'ignored', label: t('Ignored'), count: lists.ignored.length },
            ]}
          />
        </div>
        {transactions.length === 0 ? (
          <EmptyState
            icon={<FileUp />}
            title={t('No statement yet')}
            description={t(
              'Import an Excel, CSV or OFX statement from your online banking to match it to your books.',
            )}
            action={
              <Button onClick={() => setDialog('import')}>
                <FileUp /> {t('Import statement')}
              </Button>
            }
          />
        ) : lists[tab].length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <CheckCircle2 className="size-8 text-emerald-500" />
            <p className="mt-2 text-sm text-slate-600">
              {tab === 'match' ? t('Everything is matched.') : t('Nothing here.')}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lists[tab].map((tx) => {
              const entry = matchedTo(tx);
              const isOpen = open === tx.id;
              return (
                <li key={tx.id}>
                  <div
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 sm:px-5',
                      tab === 'match' && 'cursor-pointer hover:bg-slate-50',
                      isOpen && 'bg-slate-50',
                    )}
                    onClick={tab === 'match' ? () => setOpen(isOpen ? null : tx.id) : undefined}
                  >
                    <div className="hidden w-24 shrink-0 text-sm text-slate-600 sm:block">
                      {fmt.date(tx.date)}
                      {tx.valueDate && tx.valueDate !== tx.date ? (
                        <span className="block text-xs text-slate-500">
                          {t('Value date {date}', { date: fmt.date(tx.valueDate) })}
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {tx.description || '—'}
                      </p>
                      <p className="text-xs text-slate-500 sm:hidden">{fmt.date(tx.date)}</p>
                      {entry ? (
                        <Link
                          to={sourceLink({ source: entry.source, sourceId: entry.id })}
                          className="text-primary-700 inline-flex max-w-full items-center gap-1 text-xs hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link2 className="size-3 shrink-0" />
                          <span className="min-w-0 truncate">
                            {t(SOURCE_LABELS[entry.source])} <bdi>{entry.number}</bdi>
                            {entry.contactId && names.get(entry.contactId)
                              ? ` · ${names.get(entry.contactId)}`
                              : ''}
                          </span>
                        </Link>
                      ) : tx.match ? (
                        <p className="text-xs text-amber-700">
                          {t('What it was matched to has been deleted.')}
                        </p>
                      ) : tx.reference ? (
                        <p className="truncate text-xs text-slate-500">{tx.reference}</p>
                      ) : null}
                    </div>
                    <div
                      className={cn(
                        'tabular shrink-0 text-end text-sm font-semibold',
                        tx.amount > 0 ? 'text-emerald-700' : 'text-slate-900',
                      )}
                    >
                      {fmt.money(tx.amount)}
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('Actions for {name}', { name: tx.description })}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownTrigger>
                        <DropdownContent>
                          {tab === 'matched' ? (
                            <DropdownItem
                              icon={<Undo2 />}
                              onSelect={() =>
                                void run(() => unmatchTransaction(tx.id), t('Match removed'))
                              }
                            >
                              {t('Unmatch')}
                            </DropdownItem>
                          ) : null}
                          {tab === 'ignored' ? (
                            <DropdownItem
                              icon={<Undo2 />}
                              onSelect={() =>
                                void run(() => ignoreTransaction(tx.id, false), t('Line restored'))
                              }
                            >
                              {t('Restore')}
                            </DropdownItem>
                          ) : (
                            <DropdownItem
                              icon={<EyeOff />}
                              onSelect={() =>
                                void run(() => ignoreTransaction(tx.id, true), t('Line ignored'))
                              }
                            >
                              {t('Ignore')}
                            </DropdownItem>
                          )}
                          <DropdownItem
                            icon={<Trash2 />}
                            danger
                            onSelect={() =>
                              void run(() => deleteTransaction(tx.id), t('Statement line deleted'))
                            }
                          >
                            {t('Delete line')}
                          </DropdownItem>
                        </DropdownContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {isOpen ? (
                    <MatchPanel
                      transaction={tx}
                      candidates={suggestMatches(
                        {
                          date: tx.date,
                          amount: minor(tx.amount),
                          description: tx.description,
                          reference: tx.reference,
                        },
                        entries,
                        taken,
                        matchNames,
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
                          () => matchTransaction(tx.id, { source: entry.source, id: entry.id }),
                          t('Line matched'),
                        )
                      }
                      onCreate={(action, message) =>
                        void run(() => createFromTransaction(tx.id, action), message)
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
        { value: 'document', label: t('Invoice payment') },
        { value: 'transfer', label: t('Transfer') },
        { value: 'account', label: t('Other') },
      ]
    : [
        { value: 'expense', label: t('Expense') },
        { value: 'document', label: t('Bill payment') },
        { value: 'transfer', label: t('Transfer') },
        { value: 'account', label: t('Other') },
      ];
  // Good first guesses from the bank's description, in English or Arabic.
  const text = `${transaction.description} ${transaction.reference}`;
  const looksLikeTransfer =
    moneyAccounts.length > 0 && /transfer|repayment|top.?up|tfr|تحويل|سداد/i.test(text);
  const looksLikeFee = /\bfees?\b|charges?|commission|interest|رسوم|عمولة|فوائد|فائدة/i.test(text);
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
    (/card|بطاقة/i.test(text)
      ? moneyAccounts.find((a) => a.type === 'liability_credit_card')?.id
      : undefined) ??
      moneyAccounts[0]?.id ??
      '',
  );
  const [otherAccount, setOtherAccount] = useState('');

  const otherOptions = accounts
    .filter((a) => !a.archived && a.id !== transaction.accountId)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map((a) => ({ value: a.id, label: `${a.code} ${localName(a)}` }));

  return (
    <div className="space-y-5 border-t border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-5">
      {candidates.length ? (
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
            {t('Found in your books')}
          </p>
          <ul className="space-y-2">
            {candidates.slice(0, 4).map(({ entry }) => (
              <li
                key={matchKey(entry)}
                className="bg-surface flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-medium text-slate-800">
                    {t(SOURCE_LABELS[entry.source])}{' '}
                    <bdi className="whitespace-nowrap">{entry.number}</bdi>
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {fmt.date(entry.date)}
                    {entry.contactId && names.get(entry.contactId)
                      ? ` · ${names.get(entry.contactId)}`
                      : ''}
                    {entry.description ? ` · ${lineDescription(entry)}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="tabular text-sm font-semibold">{money(entry.amount)}</span>
                  <Button size="sm" onClick={() => onMatch(entry)}>
                    {t('Match')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
          {candidates.length ? t('Or record it as') : t('Record it as')}
        </p>
        <Segmented value={recipe} onChange={setRecipe} options={recipes} />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          {recipe === 'document' ? (
            docs.length ? (
              <label className="flex-1 text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  {into ? t('Invoice') : t('Bill')}
                </span>
                <Select
                  value={documentId}
                  onChange={(e) => setDocumentId(e.target.value)}
                  aria-label={into ? t('Invoice') : t('Bill')}
                >
                  {docs.map((d) => {
                    const vars = {
                      number: d.number,
                      name: names.get(d.clientId) ?? '—',
                      amount: fmt.money(d.totals.balance, d.currency),
                    };
                    return (
                      <option key={d.id} value={d.id}>
                        {sameAmount(d.totals.balance, amount, d.currency)
                          ? t('{number} · {name} · balance {amount} · same amount', vars)
                          : t('{number} · {name} · balance {amount}', vars)}
                      </option>
                    );
                  })}
                </Select>
              </label>
            ) : (
              <p className="flex-1 text-sm text-slate-500">
                {into
                  ? t('No open invoices in {currency}.', { currency: fmt.currency })
                  : t('No open bills in {currency}.', { currency: fmt.currency })}
              </p>
            )
          ) : null}
          {recipe === 'expense' ? (
            <>
              <label className="flex-1 text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  {t('Category')}
                </span>
                <Combobox
                  ariaLabel={t('Expense category')}
                  value={category || null}
                  onChange={setCategory}
                  options={categoryOptions(accounts, [category])}
                  placeholder={t('Choose a category…')}
                  searchPlaceholder={t('Search accounts…')}
                />
              </label>
              <label className="text-sm sm:w-44">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  {t('Tax included')}
                </span>
                <TaxSelect value={taxes} onChange={setTaxes} rates={taxRates} />
              </label>
            </>
          ) : null}
          {recipe === 'transfer' ? (
            moneyAccounts.length ? (
              <label className="flex-1 text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  {into ? t('From') : t('To')}
                </span>
                <Select
                  value={otherMoney}
                  onChange={(e) => setOtherMoney(e.target.value)}
                  aria-label={into ? t('Transfer from') : t('Transfer to')}
                >
                  {moneyAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {localName(a)}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <p className="flex-1 text-sm text-slate-500">{t('No other bank or cash account.')}</p>
            )
          ) : null}
          {recipe === 'account' ? (
            <label className="flex-1 text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('Account')}</span>
              <Combobox
                ariaLabel={t('Other account')}
                value={otherAccount || null}
                onChange={setOtherAccount}
                options={otherOptions}
                placeholder={t('Choose an account…')}
                searchPlaceholder={t('Search accounts…')}
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
                onCreate({ kind: 'document', documentId }, t('Payment recorded and matched'));
              else if (recipe === 'expense')
                onCreate(
                  { kind: 'expense', accountId: category, taxes, vendorId: null },
                  t('Expense recorded and matched'),
                );
              else if (recipe === 'transfer')
                onCreate(
                  { kind: 'transfer', otherAccountId: otherMoney },
                  t('Transfer recorded and matched'),
                );
              else
                onCreate({ kind: 'account', accountId: otherAccount }, t('Recorded and matched'));
            }}
          >
            {t('Record and match')}
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
