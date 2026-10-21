import { Link } from 'react-router';
import { Banknote, CreditCard } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/misc';
import { MoneyText } from '@/components/ui/money-text';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import type { MoneyAccountFigures } from '../model';
import { CardActions, CardLink } from './shared';

/** Bank, cash and card accounts with what each holds or owes today. */
export function BankAccountsCard({
  figures,
  onHide,
}: {
  figures: MoneyAccountFigures;
  onHide?: () => void;
}) {
  const title = t('Bank and card accounts');
  const cards = figures.rows.some((r) => r.kind === 'card');
  return (
    <Card className="min-w-0">
      <CardHeader
        title={title}
        description={t('In your books today')}
        actions={
          <CardActions title={title} onHide={onHide}>
            <CardLink to="/banking">{t('Banking')}</CardLink>
          </CardActions>
        }
      />
      <CardBody className="py-2">
        {figures.rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500 sm:py-6">
            {t('No bank accounts yet')}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {figures.rows.map(({ account, kind, balance }) => {
                const Icon = kind === 'card' ? CreditCard : Banknote;
                return (
                  <li key={account.id}>
                    <Link
                      to={`/banking/${account.id}`}
                      className="-mx-2 flex min-h-12 items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-slate-50"
                    >
                      <span className="flex min-w-0 items-start gap-2.5">
                        <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
                        <span className="min-w-0">
                          <span
                            dir="auto"
                            className="block truncate text-sm font-medium text-slate-800"
                          >
                            {localName(account)}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {kind === 'card'
                              ? t('Owed on the card')
                              : [account.code, account.bank?.institution]
                                  .filter(Boolean)
                                  .join(' · ')}
                          </span>
                        </span>
                      </span>
                      <MoneyText
                        amount={balance}
                        tone={
                          balance === 0
                            ? 'muted'
                            : kind === 'card' || balance < 0
                              ? 'negative'
                              : 'default'
                        }
                        className="shrink-0 text-sm font-semibold"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
            <dl className="mt-1 space-y-1 border-t border-slate-200 pt-2 pb-1 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">{t('Total in bank and cash')}</dt>
                <dd>
                  <MoneyText amount={figures.cash} tone="strong" />
                </dd>
              </div>
              {cards ? (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600">{t('Owed on cards')}</dt>
                  <dd>
                    <MoneyText
                      amount={figures.owed}
                      tone={figures.owed > 0 ? 'negative' : 'muted'}
                    />
                  </dd>
                </div>
              ) : null}
            </dl>
          </>
        )}
      </CardBody>
    </Card>
  );
}
