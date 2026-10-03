import type { Account, ID } from '@/db/types';
import { isMoneyAccount, isPurchaseCategory } from '@/lib/accounting/account-types';
import type { ComboOption } from '@/components/ui/combobox';
import { Select } from '@/components/ui/form';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';

const byCode = (a: Account, b: Account) =>
  a.code.localeCompare(b.code, undefined, { numeric: true });

/** Expense categories with their names in the interface language. */
export function expenseCategoryOptions(accounts: Account[], keep: ID[] = []): ComboOption[] {
  return accounts
    .filter((a) => (isPurchaseCategory(a) && !a.archived) || keep.includes(a.id))
    .sort(byCode)
    .map((a) => ({
      value: a.id,
      label: `${a.code} ${localName(a)}`,
      keywords: `${a.name} ${a.nameAr ?? ''}`,
    }));
}

/** The bank, cash or card account a fee was paid from; empty means the main bank account. */
export function PaidFromSelect({
  id,
  value,
  onChange,
  accounts,
}: {
  id?: string;
  value: ID | null;
  onChange: (accountId: ID | null) => void;
  accounts: Account[];
}) {
  const money = accounts
    .filter((a) => isMoneyAccount(a.type) && (!a.archived || a.id === value))
    .sort(byCode);
  const bank = accounts.find((a) => a.role === 'bank');
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">
        {bank ? t('{account} (default)', { account: localName(bank) }) : t('Default account')}
      </option>
      {money
        .filter((a) => a.id !== bank?.id)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} {localName(a)}
          </option>
        ))}
    </Select>
  );
}
