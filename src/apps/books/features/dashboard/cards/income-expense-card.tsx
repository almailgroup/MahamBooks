import { ChartNoAxesColumn } from 'lucide-react';
import { useFormat } from '@/app/company';
import { Card, CardBody, CardHeader } from '@/components/ui/misc';
import { MoneyText } from '@/components/ui/money-text';
import { ColumnChart } from '@/components/charts/column-chart';
import { t } from '@/i18n';
import { monthLabels, type IncomeExpenseFigures } from '../model';
import { CardActions, CardLink, compactNumber, SERIES_1, SERIES_2 } from './shared';

/** Income and expenses month by month, as in the profit and loss. */
export function IncomeExpenseCard({
  figures,
  description,
  onHide,
}: {
  figures: IncomeExpenseFigures;
  description: string;
  onHide?: () => void;
}) {
  const fmt = useFormat();
  const title = t('Income and expense');
  const empty = figures.months.every((m) => m.income === 0 && m.expense === 0);
  return (
    <Card className="min-w-0">
      <CardHeader
        title={title}
        description={description}
        actions={
          <CardActions title={title} onHide={onHide}>
            <CardLink to="/reports/profit-and-loss">{t('Profit and loss')}</CardLink>
          </CardActions>
        }
      />
      <CardBody>
        {empty ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <span className="bg-primary-50 text-primary-600 flex size-11 items-center justify-center rounded-full">
              <ChartNoAxesColumn className="size-5" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-medium text-slate-900">
              {t('No income or expenses in this period.')}
            </p>
          </div>
        ) : (
          <>
            <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-xs font-medium text-slate-500">{t('Income')}</dt>
                <dd>
                  <MoneyText amount={figures.income} className="font-semibold" />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-slate-500">{t('Expenses')}</dt>
                <dd>
                  <MoneyText amount={figures.expense} className="font-semibold" />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-slate-500">
                  {figures.profit < 0 ? t('Net loss') : t('Net profit')}
                </dt>
                <dd>
                  <MoneyText
                    amount={Math.abs(figures.profit)}
                    tone={figures.profit < 0 ? 'negative' : 'default'}
                    className="font-semibold"
                  />
                </dd>
              </div>
            </dl>
            <ColumnChart
              title={t('Income and expenses per month')}
              labels={monthLabels(
                figures.months.map((m) => m.key),
                fmt.locale,
              )}
              series={[
                {
                  key: 'income',
                  label: t('Income'),
                  color: SERIES_1,
                  values: figures.months.map((m) => m.income),
                },
                {
                  key: 'expense',
                  label: t('Expenses'),
                  color: SERIES_2,
                  values: figures.months.map((m) => m.expense),
                },
              ]}
              formatValue={(v) => fmt.money(v)}
              formatTick={(v) => compactNumber(v, fmt.locale)}
            />
          </>
        )}
      </CardBody>
    </Card>
  );
}
