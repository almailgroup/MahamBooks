import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Archive, CheckCircle2, Lock, Pencil, Plus, Search } from 'lucide-react';
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
import { bankFromIban, compactIban, formatIban, isValidIban } from '@/lib/kuwait';
import { currencyPrecision, fromMinor } from '@/lib/money';
import { today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { currentLanguage, t } from '@/i18n';
import { localName } from '@/i18n/names';
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

/** The account's name in the other language, shown under the main one. */
function otherName(account: Account): string {
  const shown = localName(account);
  const other = currentLanguage() === 'ar' ? account.name : (account.nameAr?.trim() ?? '');
  return other && other !== shown ? other : '';
}

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
  const iban = compactIban(bank.iban);
  const ibanValid = iban ? isValidIban(iban) : true;
  const known = ibanValid && iban ? bankFromIban(iban) : undefined;
  const title = isNew
    ? t('New account')
    : t('Edit {code} {name}', { code: account.code, name: localName(account) });

  const save = async () => {
    setSaving(true);
    try {
      await saveAccount({
        ...draft,
        bank: isMoneyAccount(draft.type) && draft.bank ? draft.bank : null,
      });
      toast.success(isNew ? t('Account created') : t('Account saved'));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the account.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (await accountInUse(account)) {
      toast.error(t('This account is used by transactions or settings. Archive it instead.'));
      return;
    }
    const ok = await confirm({
      title: t('Delete {code} {name}?', { code: account.code, name: localName(account) }),
      description: t('The account has never been used, so nothing else changes.'),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    await deleteAccount(account.id);
    toast.success(t('Account deleted'));
    onClose();
  };

  // A Kuwaiti IBAN names the bank: fill in the bank and its SWIFT code.
  const tidyIban = () => {
    if (!iban || !ibanValid) return;
    const found = bankFromIban(iban);
    update({
      bank: {
        ...bank,
        iban: formatIban(iban),
        institution: bank.institution || (found ? found.name[currentLanguage()] : ''),
        bic: bank.bic || found?.swift || '',
      },
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={title} size="lg">
        <DialogBody>
          {system ? (
            <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              <Lock className="mt-0.5 size-4 shrink-0 text-slate-400" />
              {t(
                'AlmailBooks posts to this account automatically, so its type is fixed. You can rename it or change its code.',
              )}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
            <Field label={t('Code')}>
              {(id) => (
                <Input
                  id={id}
                  value={draft.code}
                  onChange={(e) => update({ code: e.target.value })}
                  autoFocus={isNew}
                />
              )}
            </Field>
            <Field label={t('Name')}>
              {(id) => (
                <Input
                  id={id}
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Field
            label={t('Name in Arabic')}
            optional
            hint={t('Shown in the Arabic interface and on Arabic reports.')}
          >
            {(id) => (
              <Input
                id={id}
                dir="rtl"
                lang="ar"
                value={draft.nameAr ?? ''}
                onChange={(e) => update({ nameAr: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('Type')} hint={t(ACCOUNT_TYPES[draft.type].hint)}>
            {(id) => (
              <Select
                id={id}
                value={draft.type}
                disabled={system}
                onChange={(e) => update({ type: e.target.value as AccountType })}
              >
                {GROUPS.map((group) => (
                  <optgroup key={group} label={t(ACCOUNT_GROUP_LABELS[group])}>
                    {ACCOUNT_TYPE_ORDER.filter((x) => ACCOUNT_TYPES[x].group === group).map((x) => (
                      <option key={x} value={x}>
                        {t(ACCOUNT_TYPES[x].label)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('Description')} optional>
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
              <p className="text-sm font-medium text-slate-800 sm:col-span-2">
                {t('Bank details')}
              </p>
              <Field
                label={t('IBAN')}
                optional
                className="sm:col-span-2"
                error={
                  ibanValid
                    ? undefined
                    : t('This IBAN is not valid. Check it against a bank statement.')
                }
                hint={
                  known ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="size-3.5" /> {known.name[currentLanguage()]}
                    </span>
                  ) : (
                    t('Kuwaiti IBANs have 30 characters and start with KW.')
                  )
                }
              >
                {(id) => (
                  <Input
                    id={id}
                    dir="ltr"
                    className="tabular"
                    placeholder="KW81 CBKU 0000 0000 0000 1234 5601 01"
                    aria-invalid={!ibanValid || undefined}
                    value={bank.iban}
                    onChange={(e) => update({ bank: { ...bank, iban: e.target.value } })}
                    onBlur={tidyIban}
                  />
                )}
              </Field>
              <Field label={t('Bank')} optional>
                {(id) => (
                  <Input
                    id={id}
                    value={bank.institution}
                    onChange={(e) => update({ bank: { ...bank, institution: e.target.value } })}
                  />
                )}
              </Field>
              <Field label={t('Account number')} optional>
                {(id) => (
                  <Input
                    id={id}
                    dir="ltr"
                    value={bank.accountNumber}
                    onChange={(e) => update({ bank: { ...bank, accountNumber: e.target.value } })}
                  />
                )}
              </Field>
              <Field label={t('BIC / SWIFT')} optional>
                {(id) => (
                  <Input
                    id={id}
                    dir="ltr"
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
              label={t('Archived')}
              description={t(
                'Hidden from lists for new transactions. Its history stays in the reports.',
              )}
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
                {t('Delete')}
              </Button>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={!ibanValid}>
              {isNew ? t('Create account') : t('Save')}
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
  const lines = ledger?.lines;

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    if (!lines) return map;
    const now = today();
    for (const l of lines)
      if (l.date <= now) map.set(l.accountId, (map.get(l.accountId) ?? 0) + l.amount);
    return map;
  }, [lines]);

  if (!ledger) return <Spinner className="py-24" label={t('Loading…')} />;
  const q = query.trim().toLowerCase();
  const visible = ledger.accounts
    .filter((a) => showArchived || !a.archived)
    .filter(
      (a) =>
        !q ||
        `${a.code} ${a.name} ${a.nameAr ?? ''} ${ACCOUNT_TYPES[a.type].label} ${t(ACCOUNT_TYPES[a.type].label)}`
          .toLowerCase()
          .includes(q),
    )
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const startNew = () =>
    setEditing(
      createAccount(company.id, { type: 'expense', code: suggestCode(ledger.accounts, 'expense') }),
    );

  return (
    <div>
      <PageHeader
        title={t('Chart of accounts')}
        description={t(
          'Every invoice, payment and journal is recorded in these accounts. Balances are as of today.',
        )}
        actions={
          <Button onClick={startNew}>
            <Plus /> {t('New account')}
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
              placeholder={t('Search accounts…')}
              aria-label={t('Search accounts')}
              className="ps-9"
            />
          </div>
          <Checkbox
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            label={t('Show archived')}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="w-20 px-4 py-2.5 text-start font-medium sm:w-24">{t('Code')}</th>
                <th className="px-3 py-2.5 text-start font-medium">{t('Name')}</th>
                <th className="hidden px-3 py-2.5 text-start font-medium md:table-cell">
                  {t('Type')}
                </th>
                <th className="px-3 py-2.5 text-end font-medium">{t('Balance')}</th>
                <th className="w-12">
                  <span className="sr-only">{t('Actions')}</span>
                </th>
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
                      {t(ACCOUNT_GROUP_LABELS[group])}
                    </td>
                  </tr>
                  {rows.map((a) => {
                    const raw = balances.get(a.id) ?? 0;
                    const shown = isDebitNormal(a.type) ? raw : -raw;
                    const other = otherName(a);
                    return (
                      <tr
                        key={a.id}
                        className={cn('hover:bg-slate-50', a.archived && 'text-slate-500')}
                      >
                        <td className="tabular px-4 py-2 align-top text-slate-500">{a.code}</td>
                        <td className="px-3 py-2">
                          <Link
                            to={`/reports/general-ledger?account=${a.id}&from=0000-01-01&to=${today()}`}
                            className={cn(
                              'hover:text-primary-700 font-medium',
                              a.archived ? 'text-slate-500' : 'text-slate-900',
                            )}
                          >
                            {localName(a)}
                          </Link>
                          {a.role ? (
                            <Badge tone="gray" className="ms-2 align-middle">
                              {t('System')}
                            </Badge>
                          ) : null}
                          {a.archived ? (
                            <Badge tone="gray" className="ms-2 align-middle">
                              <Archive className="size-3" /> {t('Archived')}
                            </Badge>
                          ) : null}
                          {other ? (
                            <span
                              className="block text-xs text-slate-500"
                              dir={currentLanguage() === 'ar' ? 'ltr' : 'rtl'}
                              lang={currentLanguage() === 'ar' ? 'en' : 'ar'}
                            >
                              {other}
                            </span>
                          ) : null}
                        </td>
                        <td className="hidden px-3 py-2 text-slate-500 md:table-cell">
                          {t(ACCOUNT_TYPES[a.type].label)}
                        </td>
                        <td className="tabular px-3 py-2 text-end whitespace-nowrap text-slate-700">
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
                            aria-label={t('Edit {name}', { name: localName(a) })}
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
              {t('No accounts match your search.')}
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
