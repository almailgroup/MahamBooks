import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { documentsCreatedFrom } from '@/db/documents';
import type { DocumentType, InvoiceDocument } from '@/db/types';
import { DOCUMENT_LABELS, DOCUMENT_ROUTES, documentNoun, useFormat } from '@/app/company';
import { displayStatus } from '@/lib/status';
import { today } from '@/lib/dates';
import type { LineProgress } from '@/lib/orders';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Card, CardBody, CardHeader, StatusBadge } from '@/components/ui/misc';

/** Order in which documents made from another one are listed. */
const ORDER: DocumentType[] = [
  'proforma',
  'sales_order',
  'invoice',
  'delivery_note',
  'credit',
  'bill',
  'vendor_credit',
];

const linkClass = 'text-primary-700 font-medium hover:underline';

/**
 * The chain a document belongs to: what it was created from, what it was
 * converted into and the invoices, bills, delivery notes and credit notes
 * made from it ("Created from SO-2026-0003", "Invoices: …").
 */
export function RelatedDocuments({ doc }: { doc: InvoiceDocument }) {
  const related = useLiveQuery(async () => {
    const [source, converted] = await db.documents.bulkGet([
      doc.sourceId ?? '',
      doc.convertedToId ?? '',
    ]);
    const children = (await documentsCreatedFrom(doc.id)).filter(
      (d) => d.id !== doc.convertedToId && d.companyId === doc.companyId,
    );
    return { source, converted, children };
  }, [doc.id, doc.sourceId, doc.convertedToId, doc.companyId]);
  if (!related) return null;
  const { source, converted, children } = related;
  if (!source && !converted && children.length === 0) return null;

  const now = today();
  const groups = ORDER.map((type) => ({
    type,
    docs: children
      .filter((d) => d.type === type)
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
  })).filter((g) => g.docs.length > 0);

  return (
    <div className="mt-2 space-y-2 border-t border-slate-100 pt-3 text-sm">
      {source ? (
        <Link to={`${DOCUMENT_ROUTES[source.type]}/${source.id}`} className={`block ${linkClass}`}>
          {t('Created from {document} {number}', {
            document: documentNoun(source.type),
            number: source.number,
          })}
        </Link>
      ) : null}
      {converted ? (
        <Link
          to={`${DOCUMENT_ROUTES[converted.type]}/${converted.id}`}
          className={`block ${linkClass}`}
        >
          {t('Converted to {document} {number}', {
            document: documentNoun(converted.type),
            number: converted.number,
          })}
        </Link>
      ) : null}
      {groups.map((group) => (
        <div key={group.type}>
          <p className="text-xs font-medium text-slate-500">
            {t(DOCUMENT_LABELS[group.type].plural)}
          </p>
          <ul className="mt-1 space-y-1">
            {group.docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <Link to={`${DOCUMENT_ROUTES[d.type]}/${d.id}`} className={linkClass}>
                  {d.number}
                </Link>
                <StatusBadge status={displayStatus(d, now)} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Ordered, invoiced (or billed) and delivered quantities of each line of a
 * sales order, purchase order or invoice.
 */
export function OrderProgressCard({
  doc,
  progress,
}: {
  doc: InvoiceDocument;
  progress: LineProgress[];
}) {
  const fmt = useFormat();
  const invoiced = doc.type === 'sales_order' || doc.type === 'purchase_order';
  const delivered = doc.type === 'sales_order' || doc.type === 'invoice';
  const amount = (n: number, unit: string) =>
    unit ? `${fmt.quantity(n)} ${unit}` : fmt.quantity(n);
  const cell = 'tabular px-2 py-2 text-end whitespace-nowrap';
  const done = (have: number, of: number) =>
    have >= of && of > 0 ? `${cell} font-medium text-emerald-700` : `${cell} text-slate-600`;
  return (
    <Card>
      <CardHeader
        title={doc.type === 'invoice' ? t('Delivery') : t('Order progress')}
        description={
          doc.type === 'purchase_order'
            ? t('What has been billed so far.')
            : doc.type === 'invoice'
              ? t('What has gone out on delivery notes.')
              : t('What has been invoiced and delivered so far.')
        }
      />
      <CardBody className="overflow-x-auto px-3 py-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-medium text-slate-500">
              <th className="px-2 py-1.5 text-start">{t('Item')}</th>
              <th className="px-2 py-1.5 text-end">
                {doc.type === 'invoice' ? t('Quantity') : t('Ordered')}
              </th>
              {invoiced ? (
                <th className="px-2 py-1.5 text-end">
                  {doc.type === 'purchase_order' ? t('Billed') : t('Invoiced')}
                </th>
              ) : null}
              {delivered ? <th className="px-2 py-1.5 text-end">{t('Delivered')}</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {progress.map((p) => (
              <tr key={p.line.id}>
                <td className="max-w-40 truncate px-2 py-2 text-slate-800">
                  {localName(p.line) || p.line.description || '—'}
                </td>
                <td className={`${cell} text-slate-800`}>{amount(p.ordered, p.line.unit)}</td>
                {invoiced ? (
                  <td className={done(p.invoiced, p.ordered)}>{fmt.quantity(p.invoiced)}</td>
                ) : null}
                {delivered ? (
                  <td className={done(p.delivered, p.ordered)}>
                    {fmt.quantity(p.delivered)}
                    {p.inDelivery ? (
                      <span
                        className="block text-xs font-normal text-slate-400"
                        title={t('On draft delivery notes')}
                      >
                        +{fmt.quantity(p.inDelivery)}
                      </span>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
