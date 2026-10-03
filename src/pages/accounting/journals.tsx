import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { NotebookPen, Plus } from 'lucide-react';
import { db } from '@/db/db';
import { journalTotals } from '@/db/accounting';
import { useCompany, useFormat } from '@/app/company';
import { currencyPrecision } from '@/lib/money';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';

export default function JournalsPage() {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const journals = useLiveQuery(
    () => db.journals.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  if (!journals) return <Spinner className="py-24" label="Loading…" />;
  const p = currencyPrecision(company.currency);
  const sorted = [...journals].sort(
    (a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number),
  );

  return (
    <div>
      <PageHeader
        title="Manual journals"
        description="Entries that don't come from an invoice or payment: owner investments, opening balances, depreciation, corrections."
        actions={
          <ButtonLink to="/journals/new">
            <Plus /> New journal
          </ButtonLink>
        }
      />
      <Card>
        {sorted.length === 0 ? (
          <EmptyState
            icon={<NotebookPen />}
            title="No manual journals yet"
            description="Invoices and payments are recorded automatically. Use a journal for anything else."
            action={
              <ButtonLink to="/journals/new">
                <Plus /> New journal
              </ButtonLink>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">Date</th>
                  <th className="px-3 py-2.5 text-start font-medium">Number</th>
                  <th className="px-3 py-2.5 text-start font-medium">Reference</th>
                  <th className="px-3 py-2.5 text-end font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-start font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((j) => (
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
                      {j.reference || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="tabular px-3 py-2.5 text-end text-slate-900">
                      {fmt.money(journalTotals(j.lines, p).debit)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={j.status === 'posted' ? 'green' : 'gray'}>
                        {j.status === 'posted' ? 'Posted' : 'Draft'}
                      </Badge>
                      {j.vatReturnId ? (
                        <Badge tone="blue" className="ms-2">
                          VAT return
                        </Badge>
                      ) : null}
                      {j.kind === 'transfer' ? (
                        <Badge tone="violet" className="ms-2">
                          Transfer
                        </Badge>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
