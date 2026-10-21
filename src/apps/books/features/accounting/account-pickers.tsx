import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import type { Account, ID } from '@/db/types';
import { useCompany } from '@/app/company';
import { ACCOUNT_TYPES, isPurchaseCategory } from '@/lib/accounting/account-types';
import type { ComboOption } from '@/components/ui/combobox';
import { Select } from '@/components/ui/form';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';

const byCode = (a: Account, b: Account) =>
  a.code.localeCompare(b.code, undefined, { numeric: true });

/** The company's accounts, kept up to date. */
export function useAccounts(): Account[] | undefined {
  const company = useCompany();
  return useLiveQuery(
    () => db.accounts.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
}

/** Categories for bill lines and expenses. Accounts in `keep` stay listed even if archived. */
export function categoryOptions(accounts: Account[], keep: (ID | null | undefined)[] = []) {
  return accounts
    .filter((a) => (isPurchaseCategory(a) && !a.archived) || keep.includes(a.id))
    .sort(byCode)
    .map((a): ComboOption => {
      const type = ACCOUNT_TYPES[a.type].label;
      return {
        value: a.id,
        label: `${a.code} ${localName(a)}`,
        // Either name and the type find the account, whatever the interface language.
        keywords: [a.name, a.nameAr ?? '', type, t(type)].join(' '),
      };
    });
}

/** Any account in use, to pick one to keep an eye on; accounts in `skip` are left out. */
export function accountOptions(accounts: Account[], skip: readonly ID[] = []): ComboOption[] {
  return accounts
    .filter((a) => !a.archived && !skip.includes(a.id))
    .sort(byCode)
    .map((a): ComboOption => {
      const type = ACCOUNT_TYPES[a.type]?.label ?? '';
      return {
        value: a.id,
        label: `${a.code} ${localName(a)}`,
        detail: type ? t(type) : undefined,
        keywords: [a.name, a.nameAr ?? '', type, type ? t(type) : ''].join(' '),
      };
    });
}

/**
 * Where money went in or came out. Payments received go to bank or cash;
 * payments made can also come from a card; expenses can also be paid by the
 * owner personally (capital, drawings or a loan account).
 */
export function MoneyAccountSelect({
  id,
  value,
  onChange,
  accounts,
  use,
  defaultRole = 'bank',
}: {
  id?: string;
  value: ID | null | undefined;
  onChange: (accountId: ID | null) => void;
  accounts: Account[];
  use: 'deposit' | 'payment' | 'expense';
  defaultRole?: 'bank' | 'cash';
}) {
  const listed = (a: Account) => !a.archived || a.id === value;
  const money = accounts
    .filter(
      (a) =>
        listed(a) &&
        (a.type === 'asset_cash' || (use !== 'deposit' && a.type === 'liability_credit_card')),
    )
    .sort(byCode);
  const owner =
    use === 'expense'
      ? accounts
          .filter(
            (a) =>
              listed(a) &&
              ((a.type === 'equity' && (a.role === 'capital' || a.role === 'drawings')) ||
                ((a.type === 'liability_current' || a.type === 'liability_non_current') &&
                  !a.role)),
          )
          .sort(byCode)
      : [];
  const auto =
    accounts.find((a) => a.role === defaultRole) ?? accounts.find((a) => a.role === 'bank');
  const option = (a: Account) => (
    <option key={a.id} value={a.id}>
      {a.code} {localName(a)}
    </option>
  );

  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">
        {auto ? t('{name} (default)', { name: localName(auto) }) : t('Default account')}
      </option>
      {owner.length ? (
        <>
          <optgroup label={t('Bank, cash and cards')}>{money.map(option)}</optgroup>
          <optgroup label={t('Paid by the owner or a loan')}>{owner.map(option)}</optgroup>
        </>
      ) : (
        money.map(option)
      )}
    </Select>
  );
}
