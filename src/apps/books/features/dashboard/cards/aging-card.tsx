import { CircleCheck } from 'lucide-react';
import { useFormat } from '@/app/company';
import { AGING_BUCKETS } from '@/lib/reports';
import { cn } from '@/lib/cn';
import { Card, CardBody, CardHeader } from '@/components/ui/misc';
import { MoneyText } from '@/components/ui/money-text';
import { t } from '@/i18n';
import type { AgingSummary } from '../model';
import { AGING_COLORS, CardActions, CardLink } from './shared';

/**
 * Unpaid invoices or bills: the total, what is not due yet and what is
 * overdue, then the 30-day ages of the aging report.
 */
function AgingCard({
  title,
  description,
  summary,
  link,
  linkLabel,
  empty,
  barLabel,
  onHide,
}: {
  title: string;
  description: string;
  summary: AgingSummary;
  link: string;
  linkLabel: string;
  empty: string;
  barLabel: string;
  onHide?: () => void;
}) {
  const fmt = useFormat();
  const { aging, current, overdue, otherCurrencies } = summary;
  const { total, totals } = aging;
  return (
    <Card className="min-w-0">
      <CardHeader
        title={title}
        description={description}
        actions={
          <CardActions title={title} onHide={onHide}>
            <CardLink to={link}>{linkLabel}</CardLink>
          </CardActions>
        }
      />
      <CardBody>
        {total === 0 && otherCurrencies.length === 0 ? (
          <div className="flex items-center gap-3 py-2 text-sm text-slate-600">
            <CircleCheck className="size-5 shrink-0 text-emerald-600" aria-hidden />
            {empty}
          </div>
        ) : (
          <>
            <MoneyText
              amount={total}
              tone={total === 0 ? 'muted' : 'default'}
              className="block text-2xl font-semibold tracking-tight [font-variant-numeric:normal]"
            />
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2">
                <dt className="text-xs font-medium text-slate-500">{t('Current')}</dt>
                <dd>
                  <MoneyText
                    amount={current}
                    tone={current === 0 ? 'muted' : 'default'}
                    className="text-sm font-semibold"
                  />
                </dd>
              </div>
              <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2">
                <dt
                  className={cn(
                    'text-xs font-medium',
                    overdue > 0 ? 'text-red-700' : 'text-slate-500',
                  )}
                >
                  {t('Overdue')}
                </dt>
                <dd>
                  <MoneyText
                    amount={overdue}
                    tone={overdue > 0 ? 'negative' : 'muted'}
                    className="text-sm font-semibold"
                  />
                </dd>
              </div>
            </dl>
            {total > 0 ? (
              <div
                className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded bg-slate-100"
                role="img"
                aria-label={barLabel}
              >
                {totals.map((amount, i) =>
                  amount > 0 ? (
                    <span
                      key={i}
                      title={`${t(AGING_BUCKETS[i])}: ${fmt.money(amount)}`}
                      className={cn('h-full first:rounded-s last:rounded-e', AGING_COLORS[i])}
                      style={{ width: `${(amount / total) * 100}%` }}
                    />
                  ) : null,
                )}
              </div>
            ) : null}
            <dl className="mt-3 divide-y divide-slate-100">
              {totals.map((amount, i) =>
                amount > 0 ? (
                  <div key={i} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <dt className="flex items-center gap-2 text-slate-600">
                      <span className={cn('size-2.5 shrink-0 rounded-sm', AGING_COLORS[i])} />
                      {t(AGING_BUCKETS[i])}
                    </dt>
                    <dd>
                      <MoneyText amount={amount} />
                    </dd>
                  </div>
                ) : null,
              )}
              {otherCurrencies.map(([currency, amount]) => (
                <div
                  key={currency}
                  className="flex items-center justify-between gap-3 py-1.5 text-sm"
                >
                  <dt className="text-slate-600">{t('In {currency}', { currency })}</dt>
                  <dd>
                    <MoneyText amount={amount} currency={currency} />
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/** What customers owe, with the Current/Overdue split. */
export function ReceivablesSummaryCard({
  summary,
  onHide,
}: {
  summary: AgingSummary;
  onHide?: () => void;
}) {
  return (
    <AgingCard
      title={t('Receivables')}
      description={t('Unpaid invoices')}
      summary={summary}
      link="/reports/aging"
      linkLabel={t('Aging report')}
      empty={t('No unpaid invoices. Everything you invoiced has been paid.')}
      barLabel={t('Unpaid invoices by age')}
      onHide={onHide}
    />
  );
}

/** What the company owes vendors, with the Current/Overdue split. */
export function PayablesCard({ summary, onHide }: { summary: AgingSummary; onHide?: () => void }) {
  return (
    <AgingCard
      title={t('Payables')}
      description={t('Unpaid bills')}
      summary={summary}
      link="/reports/payables"
      linkLabel={t('Payables aging')}
      empty={t('No unpaid bills. Everything you were billed has been paid.')}
      barLabel={t('Unpaid bills by age')}
      onHide={onHide}
    />
  );
}
