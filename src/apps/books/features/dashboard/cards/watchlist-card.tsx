import { Link } from 'react-router';
import { X } from 'lucide-react';
import type { Account, ID } from '@/db/types';
import { useFormat } from '@/app/company';
import { Card, CardBody, CardHeader } from '@/components/ui/misc';
import { MoneyText } from '@/components/ui/money-text';
import { Combobox } from '@/components/ui/combobox';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import { accountOptions } from '@/apps/books/features/accounting/account-pickers';
import { ledgerLink } from '@/apps/books/features/accounting/source-link';
import { WATCHLIST_SIZE, type DashboardRange, type WatchRow } from '../model';
import { CardActions } from './shared';

/**
 * Accounts this person keeps an eye on (up to eight, on this device):
 * balances at the end of the period, and for income and expense accounts
 * the period's total.
 */
export function WatchlistCard({
  rows,
  accounts,
  watched,
  range,
  description,
  onChange,
  onHide,
}: {
  rows: WatchRow[];
  accounts: Account[];
  watched: ID[];
  range: DashboardRange;
  description: string;
  onChange: (watchlist: ID[]) => void;
  onHide?: () => void;
}) {
  const fmt = useFormat();
  const title = t('Watchlist');
  const full = rows.length >= WATCHLIST_SIZE;
  // Accounts that are gone are dropped when the list next changes.
  const kept = watched.filter((id) => rows.some((r) => r.account.id === id));
  return (
    <Card className="min-w-0">
      <CardHeader
        title={title}
        description={description}
        actions={<CardActions title={title} onHide={onHide} />}
      />
      <CardBody className="py-2">
        {rows.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">
            {t(
              'Pick up to {count} accounts to keep an eye on, such as a deposit, a loan or a cost.',
              {
                count: WATCHLIST_SIZE,
              },
            )}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100" aria-label={title}>
            {rows.map(({ account, kind, amount }) => {
              const name = localName(account);
              return (
                <li key={account.id} className="flex items-center gap-1">
                  <Link
                    to={ledgerLink(account.id, range)}
                    className="-ms-2 flex min-h-12 min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span
                        dir="auto"
                        className="block truncate text-sm font-medium text-slate-800"
                      >
                        {name}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {account.code} ·{' '}
                        {kind === 'period'
                          ? t('In the period')
                          : t('Balance on {date}', { date: fmt.date(range.to) })}
                      </span>
                    </span>
                    <MoneyText
                      amount={amount}
                      tone={amount === 0 ? 'muted' : amount < 0 ? 'negative' : 'default'}
                      className="shrink-0 text-sm font-semibold"
                    />
                  </Link>
                  <button
                    type="button"
                    onClick={() => onChange(kept.filter((id) => id !== account.id))}
                    className="-me-2 flex size-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 pointer-coarse:size-11"
                    aria-label={t('Remove {name} from the watchlist', { name })}
                    title={t('Remove from the watchlist')}
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="py-3">
          {full ? (
            <p className="text-xs text-slate-500">
              {t('The watchlist holds {count} accounts. Remove one to add another.', {
                count: WATCHLIST_SIZE,
              })}
            </p>
          ) : (
            <Combobox
              value={null}
              onChange={(id) => onChange([...kept, id])}
              options={accountOptions(accounts, kept)}
              placeholder={t('Add an account…')}
              searchPlaceholder={t('Search accounts…')}
              emptyText={t('No accounts found.')}
              ariaLabel={t('Add an account to the watchlist')}
            />
          )}
        </div>
      </CardBody>
    </Card>
  );
}
