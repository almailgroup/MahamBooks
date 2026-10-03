import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useFormat } from '@/app/company';
import type { Exposure, StatementSide } from '@/lib/statements';
import { fromMinor } from '@/lib/money';
import { cn } from '@/lib/cn';
import { t, tp } from '@/i18n';
import { Card } from '@/components/ui/misc';

function Figure({
  label,
  value,
  hint,
  tone = 'default',
  children,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'danger' | 'success';
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <Card className="min-w-0 p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={cn(
          'tabular mt-1 truncate text-xl font-semibold tracking-tight',
          tone === 'danger'
            ? 'text-red-600'
            : tone === 'success'
              ? 'text-emerald-600'
              : 'text-slate-900',
        )}
        data-testid={testId}
      >
        {value}
      </p>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </Card>
  );
}

/** Credit used against the limit, as a bar that turns amber near it and red above it. */
export function CreditBar({ used, limit }: { used: number; limit: number }) {
  const share = limit > 0 ? used / limit : used > 0 ? 2 : 0;
  const width = `${Math.min(100, Math.round(share * 100))}%`;
  return (
    <div
      className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
      role="meter"
      aria-label={t('Credit used')}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={Math.min(used, limit)}
    >
      <div
        className={cn(
          'h-full rounded-full',
          share > 1 ? 'bg-red-500' : share >= 0.75 ? 'bg-amber-500' : 'bg-emerald-500',
        )}
        style={{ width }}
      />
    </div>
  );
}

/** Where a contact stands: balance, overdue, credit, last payment and cheques. */
export function ContactSummary({
  side,
  position,
  currency,
  onHold,
  paymentsHref,
}: {
  side: StatementSide;
  position: Exposure;
  currency: string;
  onHold: boolean;
  paymentsHref: string;
}) {
  const fmt = useFormat();
  const money = (minor: number) => fmt.money(fromMinor(minor, position.precision), currency);
  const vendor = side === 'vendor';
  const last = position.lastPayment;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Figure
        label={vendor ? t('You owe') : t('Balance due')}
        value={money(position.balance)}
        testId="contact-balance"
        hint={
          position.retentionHeld
            ? t('Plus {amount} retention held', { amount: money(position.retentionHeld) })
            : undefined
        }
      />
      <Figure
        label={t('Overdue')}
        value={money(position.overdue)}
        tone={position.overdue > 0 ? 'danger' : 'default'}
      />
      {vendor ? (
        <Figure
          label={t('Cheques not yet presented')}
          value={money(position.uncleared)}
          hint={tp(position.unclearedCount, '{count} cheque', '{count} cheques')}
        />
      ) : (
        <Figure
          label={t('Credit used')}
          value={money(position.exposure)}
          tone={
            onHold || (position.available !== null && position.available < 0) ? 'danger' : 'default'
          }
          hint={
            onHold
              ? t('On credit hold')
              : position.limit === null
                ? t('No credit limit')
                : position.available !== null && position.available < 0
                  ? t('{amount} over the limit of {limit}', {
                      amount: money(-position.available),
                      limit: money(position.limit),
                    })
                  : t('{amount} left of {limit}', {
                      amount: money(position.available ?? 0),
                      limit: money(position.limit),
                    })
          }
        >
          {position.limit !== null ? (
            <CreditBar used={position.exposure} limit={position.limit} />
          ) : null}
        </Figure>
      )}
      <Figure
        label={vendor ? t('Last payment made') : t('Last payment')}
        value={last ? money(last.amount) : '—'}
        hint={
          last ? (
            <Link to={`${paymentsHref}/${last.id}`} className="hover:underline">
              {fmt.date(last.date)} · {last.number}
            </Link>
          ) : (
            t('No payments yet.')
          )
        }
      />
      {vendor ? (
        <Figure label={t('Retention you hold')} value={money(position.retentionHeld)} />
      ) : (
        <Figure
          label={t('Cheques in hand')}
          value={money(position.uncleared)}
          hint={tp(
            position.unclearedCount,
            '{count} cheque not cleared yet',
            '{count} cheques not cleared yet',
          )}
        />
      )}
    </div>
  );
}
