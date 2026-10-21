import { useFormat } from '@/app/company';
import { Card, CardBody, CardHeader } from '@/components/ui/misc';
import { BarList, type BarRow } from '@/components/charts/bar-list';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';
import { ledgerLink } from '@/apps/books/features/accounting/source-link';
import type { DashboardRange, TopExpenseFigures } from '../model';
import { CardActions } from './shared';

/** The expense accounts with the most spent, each opening its ledger for the period. */
export function TopExpensesCard({
  figures,
  range,
  description,
  onHide,
}: {
  figures: TopExpenseFigures;
  range: DashboardRange;
  description: string;
  onHide?: () => void;
}) {
  const fmt = useFormat();
  const title = t('Top expenses');
  const rows: BarRow[] = figures.rows.map(({ account, amount }) => ({
    key: account.id,
    label: localName(account),
    value: amount,
    to: ledgerLink(account.id, range),
  }));
  if (figures.otherCount > 0) {
    rows.push({
      key: 'other',
      label: tp(figures.otherCount, '{count} other account', '{count} other accounts'),
      value: figures.other,
    });
  }
  return (
    <Card className="min-w-0">
      <CardHeader
        title={title}
        description={description}
        actions={<CardActions title={title} onHide={onHide} />}
      />
      <CardBody>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500 sm:py-6">
            {t('No expenses in this period.')}
          </p>
        ) : (
          <BarList
            title={t('Expenses by account')}
            nameLabel={t('Account')}
            rows={rows}
            formatValue={(v) => fmt.money(v)}
            formatShare={(share) => fmt.percent(Math.round(share * 1000) / 10)}
          />
        )}
      </CardBody>
    </Card>
  );
}
