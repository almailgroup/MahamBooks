import { Landmark } from 'lucide-react';
import { useFormat } from '@/app/company';
import { Card, CardBody, CardHeader } from '@/components/ui/misc';
import { MoneyText } from '@/components/ui/money-text';
import { LineChart } from '@/components/charts/line-chart';
import { t } from '@/i18n';
import { monthLabels, type CashFlowFigures, type DashboardRange } from '../model';
import { CardActions, CardLink, compactNumber, SERIES_1 } from './shared';

/** Cash in the bank and cash accounts month by month, with what came in and went out. */
export function CashFlowCard({
  flow,
  range,
  description,
  onHide,
}: {
  flow: CashFlowFigures;
  range: DashboardRange;
  description: string;
  onHide?: () => void;
}) {
  const fmt = useFormat();
  const title = t('Cash flow');
  const quiet =
    flow.opening === 0 && flow.incoming === 0 && flow.outgoing === 0 && flow.closing === 0;
  return (
    <Card className="min-w-0">
      <CardHeader
        title={title}
        description={description}
        actions={
          <CardActions title={title} onHide={onHide}>
            <CardLink to="/reports/cash-flow">{t('Statement of cash flows')}</CardLink>
          </CardActions>
        }
      />
      <CardBody>
        {quiet ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <span className="bg-primary-50 text-primary-600 flex size-11 items-center justify-center rounded-full">
              <Landmark className="size-5" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-medium text-slate-900">
              {t('No money in or out of your bank and cash accounts in this period.')}
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <LineChart
                title={t('Cash at the end of each month')}
                labels={monthLabels(
                  flow.months.map((m) => m.key),
                  fmt.locale,
                )}
                series={[
                  {
                    key: 'closing',
                    label: t('Cash at the end of the month'),
                    color: SERIES_1,
                    values: flow.months.map((m) => m.closing),
                  },
                ]}
                formatValue={(v) => fmt.money(v)}
                formatTick={(v) => compactNumber(v, fmt.locale)}
              />
            </div>
            <dl className="divide-y divide-slate-100 self-start text-sm">
              <div className="flex items-center justify-between gap-3 py-2">
                <dt className="text-slate-600">
                  {t('Cash on {date}', { date: fmt.date(range.from) })}
                </dt>
                <dd>
                  <MoneyText amount={flow.opening} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <dt className="text-slate-600">{t('Incoming')}</dt>
                <dd>
                  <MoneyText amount={flow.incoming} tone="positive" />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <dt className="text-slate-600">{t('Outgoing')}</dt>
                <dd>
                  <MoneyText amount={-flow.outgoing} tone={flow.outgoing ? 'negative' : 'muted'} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2 font-semibold">
                <dt className="text-slate-900">
                  {t('Cash on {date}', { date: fmt.date(range.to) })}
                </dt>
                <dd>
                  <MoneyText amount={flow.closing} tone="strong" />
                </dd>
              </div>
            </dl>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
