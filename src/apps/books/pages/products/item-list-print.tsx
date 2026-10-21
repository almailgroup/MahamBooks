import type { Company, Product } from '@/db/types';
import { productKind } from '@/db/inventory';
import { today } from '@/lib/dates';
import { unitText } from '@/lib/units';
import { currentLanguage, t } from '@/i18n';
import { localName } from '@/i18n/names';
import { KIND_LABELS } from '@/apps/books/features/inventory/labels';

export type ItemListKind = 'items' | 'prices';

/**
 * The items as a printed list (usePrint): the product list with type, cost
 * and stock, or the price list a customer can be given. In the app's
 * language, with the other name of each item under it.
 */
export function ItemListPrint({
  company,
  kind,
  products,
  onHand,
  formatPrice,
  formatDate,
  formatQuantity,
}: {
  company: Company;
  kind: ItemListKind;
  products: Product[];
  /** Stock items' quantity on hand. */
  onHand: (product: Product) => number | null;
  formatPrice: (amount: number) => string;
  formatDate: (date: string) => string;
  formatQuantity: (value: number) => string;
}) {
  const language = currentLanguage();
  const full = kind === 'items';
  const cell = 'border-b border-slate-200 px-2 py-1.5 align-top';
  return (
    <div className="print-page text-[11px] text-slate-900">
      <header className="mb-4 flex items-end justify-between gap-4 border-b-2 border-slate-800 pb-2">
        <div>
          <p className="text-xs text-slate-600">{localName(company)}</p>
          <h1 className="text-lg font-semibold">{full ? t('Product list') : t('Price list')}</h1>
        </div>
        <p className="text-xs text-slate-600">{formatDate(today())}</p>
      </header>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-start text-[10px] text-slate-600 uppercase">
            <th className={`${cell} text-start`}>{t('SKU')}</th>
            <th className={`${cell} text-start`}>{t('Item')}</th>
            {full ? <th className={`${cell} text-start`}>{t('Type')}</th> : null}
            <th className={`${cell} text-start`}>{t('Unit')}</th>
            <th className={`${cell} text-end`}>{t('Price')}</th>
            {full ? <th className={`${cell} text-end`}>{t('Cost price')}</th> : null}
            {full ? <th className={`${cell} text-end`}>{t('On hand')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const name = localName(p);
            const other = name === p.name ? p.nameAr?.trim() : p.name;
            const stock = onHand(p);
            return (
              <tr key={p.id}>
                <td className={`${cell} font-mono whitespace-nowrap`} dir="ltr">
                  {p.sku}
                </td>
                <td className={cell}>
                  <span className="block font-medium">{name}</span>
                  {other && other !== name ? (
                    <span className="block text-slate-600">
                      <bdi>{other}</bdi>
                    </span>
                  ) : null}
                </td>
                {full ? <td className={cell}>{t(KIND_LABELS[productKind(p)].label)}</td> : null}
                <td className={cell}>{unitText(company, p, language)}</td>
                <td className={`${cell} tabular text-end whitespace-nowrap`}>
                  {formatPrice(p.unitPrice)}
                </td>
                {full ? (
                  <td className={`${cell} tabular text-end whitespace-nowrap`}>
                    {productKind(p) === 'service' ? '' : formatPrice(p.costPrice ?? 0)}
                  </td>
                ) : null}
                {full ? (
                  <td className={`${cell} tabular text-end whitespace-nowrap`}>
                    {stock === null ? '' : formatQuantity(stock)}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
