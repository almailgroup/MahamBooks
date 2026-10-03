import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Archive, Lock, Pencil, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { Account, AccountType } from '@/db/types';
import { accountInUse, createAccount, deleteAccount, saveAccount } from '@/db/accounting';
import { useCompany, useFormat } from '@/app/company';
import { useLedger } from '@/features/accounting/use-ledger';
import {
  ACCOUNT_GROUP_LABELS,
  ACCOUNT_TYPE_ORDER,
  ACCOUNT_TYPES,
  isDebitNormal,
  isMoneyAccount,
  type AccountGroup,
} from '@/lib/accounting/account-types';
import { currencyPrecision, fromMinor } from '@/lib/money';
import { today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader, Spinner } from '@/components/ui/misc';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  useConfirm,
} from '@/components/ui/overlay';

const GROUPS: AccountGroup[] = ['asset', 'liability', 'equity', 'income', 'expense'];

function AccountDialog({
  account,
  accounts,
  onClose,
}: {
  account: Account;
  accounts: Account[];
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState(account);
  const [saving, setSaving] = useState(false);
  const isNew = !accounts.some((a) => a.id === account.id);
  const system = Boolean(account.role);
  const update = (patch: Partial<Account>) => setDraft((d) => ({ ...d, ...patch }));
  const bank = draft.bank ?? { institution: '', accountNumber: '', iban: '', bic: '' };

  const save = async () => {
    setSaving(true);
    try {
      await saveAccount({
        ...draft,
        bank: isMoneyAccount(draft.type) && draft.bank ? draft.bank : null,
      });
      toast.success(isNew ? 'Account created' : 'Account saved');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the account.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (await accountInUse(account)) {
      toast.error('This account is used by transactions or settings. Archive it instead.');
      return;
    }
    const ok = await confirm({
      title: `Delete ${account.code} ${account.name}?`,
      description: 'The account has never been used, so nothing else changes.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteAccount(account.id);
    toast.success('Account deleted');
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={isNew ? 'New account' : `Edit ${account.code} ${account.name}`}
        size="lg"
      >
        <DialogBody>
          {system ? (
            <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              <Lock className="mt-0.5 size-4 shrink-0 text-slate-400" />
              AlmailBooks posts to this account automatically, so its type is fixed. You can rename
              it or change its code.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
            <Field label="Code">
              {(id) => (
                <Input
                  id={id}
                  value={draft.code}
                  onChange={(e) => update({ code: e.target.value })}
                  autoFocus={isNew}
                />
              )}
            </Field>
            <Field label="Name">
              {(id) => (
                <Input
                  id={id}
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Field label="Type" hint={ACCOUNT_TYPES[draft.type].hint}>
            {(id) => (
              <Select
                id={id}
                value={draft.type}
                disabled={system}
                onChange={(e) => update({ type: e.target.value as AccountType })}
              >
                {GROUPS.map((group) => (
                  <optgroup key={group} label={ACCOUNT_GROUP_LABELS[group]}>
                    {ACCOUNT_TYPE_ORDER.filter((t) => ACCOUNT_TYPES[t].group === group).map((t) => (
                      <option key={t} value={t}>
                        {ACCOUNT_TYPES[t].label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Description" optional>
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={draft.description}
                onChange={(e) => update({ description: e.target.value })}
              />
            )}
          </Field>
          {isMoneyAccount(draft.type) ? (
            <div className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
              <p className="text-sm font-medium text-slate-800 sm:col-span-2">Bank details</p>
              <Field label="Bank" optional>
                {(id) => (
                  <Input
                    id={id}
                    value={bank.institution}
                    onChange={(e) => update({ bank: { ...bank, institution: e.target.value } })}
                  />
                )}
              </Field>
              <Field label="Account number" optional>
                {(id) => (
                  <Input
                    id={id}
                    value={bank.accountNumber}
                    onChange={(e) => update({ bank: { ...bank, accountNumber: e.target.value } })}
                  />
                )}
              </Field>
              <Field label="IBAN" optional>
                {(id) => (
                  <Input
                    id={id}
                    value={bank.iban}
                    onChange={(e) => update({ bank: { ...bank, iban: e.target.value } })}
                  />
                )}
              </Field>
              <Field label="BIC / SWIFT" optional>
                {(id) => (
                  <Input
                    id={id}
                    value={bank.bic}
                    onChange={(e) => update({ bank: { ...bank, bic: e.target.value } })}
                  />
                )}
              </Field>
            </div>
          ) : null}
          {!system && !isNew ? (
            <Switch
              checked={draft.archived}
              onChange={(archived) => update({ archived })}
              label="Archived"
              description="Hidden from lists for new transactions. Its history stays in the reports."
            />
          ) : null}
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          <div>
            {!isNew && !system ? (
              <Button
                variant="ghost"
                className="text-red-600 hover:bg-red-50"
                onClick={() => void remove()}
              >
                Delete
              </Button>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              {isNew ? 'Create account' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Next free code after the last account of the same type, e.g. 7600 → 7610. */
function suggestCode(accounts: Account[], type: AccountType): string {
  const codes = accounts
    .filter((a) => a.type === type)
    .map((a) => Number(a.code))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const taken = new Set(accounts.map((a) => a.code));
  let next = codes.length ? codes[codes.length - 1] + 10 : 9000;
  while (taken.has(String(next))) next += 1;
  return String(next);
}

export default function ChartOfAccountsPage() {
  const company = useCompany();
  const fmt = useFormat();
  const ledger = useLedger();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const p = currencyPrecision(company.currency);

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    if (!ledger) return map;
    const now = today();
    for (const l of ledger.lines)
      if (l.date <= now) map.set(l.accountId, (map.get(l.accountId) ?? 0) + l.amount);
    return map;
  }, [ledger]);

  if (!ledger) return <Spinner className="py-24" label="Loading…" />;
  const q = query.trim().toLowerCase();
  const visible = ledger.accounts
    .filter((a) => showArchived || !a.archived)
    .filter(
      (a) => !q || `${a.code} ${a.name} ${ACCOUNT_TYPES[a.type].label}`.toLowerCase().includes(q),
    )
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const startNew = () =>
    setEditing(
      createAccount(company.id, { type: 'expense', code: suggestCode(ledger.accounts, 'expense') }),
    );

  return (
    <div>
      <PageHeader
        title="Chart of accounts"
        description="Every invoice, payment and journal is recorded in these accounts. Balances are as of today."
        actions={
          <Button onClick={startNew}>
            <Plus /> New account
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search accounts…"
              aria-label="Search accounts"
              className="ps-9"
            />
          </div>
          <Checkbox
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            label="Show archived"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="w-24 px-4 py-2.5 text-start font-medium">Code</th>
                <th className="px-3 py-2.5 text-start font-medium">Name</th>
                <th className="hidden px-3 py-2.5 text-start font-medium md:table-cell">Type</th>
                <th className="px-3 py-2.5 text-end font-medium">Balance</th>
                <th className="w-12" />
              </tr>
            </thead>
            {GROUPS.map((group) => {
              const rows = visible.filter((a) => ACCOUNT_TYPES[a.type].group === group);
              if (rows.length === 0) return null;
              return (
                <tbody key={group} className="divide-y divide-slate-100 border-b border-slate-200">
                  <tr>
                    <td
                      colSpan={5}
                      className="bg-slate-50/40 px-4 pt-4 pb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase"
                    >
                      {ACCOUNT_GROUP_LABELS[group]}
                    </td>
                  </tr>
                  {rows.map((a) => {
                    const raw = balances.get(a.id) ?? 0;
                    const shown = isDebitNormal(a.type) ? raw : -raw;
                    return (
                      <tr
                        key={a.id}
                        className={cn('hover:bg-slate-50', a.archived && 'text-slate-400')}
                      >
                        <td className="tabular px-4 py-2 text-slate-500">{a.code}</td>
                        <td className="px-3 py-2">
                          <Link
                            to={`/reports/general-ledger?account=${a.id}&from=0000-01-01&to=${today()}`}
                            className={cn(
                              'hover:text-primary-700 font-medium',
                              a.archived ? 'text-slate-400' : 'text-slate-900',
                            )}
                          >
                            {a.name}
                          </Link>
                          {a.role ? (
                            <Badge tone="gray" className="ms-2 align-middle">
                              System
                            </Badge>
                          ) : null}
                          {a.archived ? (
                            <Badge tone="gray" className="ms-2 align-middle">
                              <Archive className="size-3" /> Archived
                            </Badge>
                          ) : null}
                        </td>
                        <td className="hidden px-3 py-2 text-slate-500 md:table-cell">
                          {ACCOUNT_TYPES[a.type].label}
                        </td>
                        <td className="tabular px-3 py-2 text-end text-slate-700">
                          {raw === 0 ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            fmt.money(fromMinor(shown, p))
                          )}
                        </td>
                        <td className="px-2 py-1 text-end">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${a.name}`}
                            onClick={() => setEditing(a)}
                          >
                            <Pencil />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              No accounts match your search.
            </p>
          ) : null}
        </div>
      </Card>
      {editing ? (
        <AccountDialog
          account={editing}
          accounts={ledger.accounts}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
