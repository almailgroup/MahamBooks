import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { NotebookPen, Plus } from 'lucide-react';
import { db } from '@/db/db';
import { journalTotals } from '@/db/accounting';
import { useCompany, useFormat } from '@/app/company';
import { journalKind } from '@/lib/accounting/journal-kinds';
import { currencyPrecision } from '@/lib/money';
import { t } from '@/i18n';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/misc';

type Filter = 'all' | 'manual' | 'system';

export default function JournalsPage() {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const journals = useLiveQuery(
    () => db.journals.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  if (!journals) return <Spinner className="py-24" label={t('Loading…')} />;
  const p = currencyPrecision(company.currency);
  const isSystem = (j: (typeof journals)[number]) => Boolean(j.kind || j.vatReturnId);
  const sorted = journals
    .filter((j) => filter === 'all' || (filter === 'system') === isSystem(j))
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  const systemCount = journals.filter(isSystem).length;

  return (
    <div>
      <PageHeader
        title={t('Manual journals')}
        description={t(
          'Entries that don’t come from an invoice or payment: owner investments, opening balances, corrections. Entries made by AlmailBooks are marked.',
        )}
        actions={
          <ButtonLink to="/journals/new">
            <Plus /> {t('New journal')}
          </ButtonLink>
        }
      />
      <Card>
        {journals.length === 0 ? (
          <EmptyState
            icon={<NotebookPen />}
            title={t('No manual journals yet')}
            description={t(
              'Invoices and payments are recorded automatically. Use a journal for anything else.',
            )}
            action={
              <ButtonLink to="/journals/new">
                <Plus /> {t('New journal')}
              </ButtonLink>
            }
          />
        ) : (
          <>
            {systemCount > 0 ? (
              <div className="border-b border-slate-100 px-4 py-3">
                <Segmented
                  size="sm"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: t('All'), count: journals.length },
                    { value: 'manual', label: t('Manual'), count: journals.length - systemCount },
                    { value: 'system', label: t('Made by AlmailBooks'), count: systemCount },
                  ]}
                />
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/60 text-xs tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-medium">{t('Date')}</th>
                    <th className="px-3 py-2.5 text-start font-medium">{t('Number')}</th>
                    <th className="px-3 py-2.5 text-start font-medium">{t('Reference')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('Amount')}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t('Status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map((j) => {
                    const kind = journalKind(j);
                    return (
                      <tr
                        key={j.id}
                        onClick={() => navigate(`/journals/${j.id}`)}
                        className="cursor-pointer hover:bg-slate-50"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                          {fmt.date(j.date)}
                        </td>
                        <td className="px-3 py-2.5 font-medium whitespace-nowrap text-slate-900">
                          {j.number}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">
                          {j.reference || <span className="text-slate-500">—</span>}
                        </td>
                        <td className="tabular px-3 py-2.5 text-end text-slate-900">
                          {fmt.money(journalTotals(j.lines, p).debit)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="flex flex-wrap gap-1.5">
                            <Badge tone={j.status === 'posted' ? 'green' : 'gray'}>
                              {j.status === 'posted' ? t('Posted') : t('Draft')}
                            </Badge>
                            {j.vatReturnId ? <Badge tone="blue">{t('VAT return')}</Badge> : null}
                            {kind ? <Badge tone={kind.tone}>{t(kind.label)}</Badge> : null}
                            {j.reversalOf ? <Badge tone="gray">{t('Reversal')}</Badge> : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
