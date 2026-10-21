import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, Grid3x3, Printer } from 'lucide-react';
import type { Product } from '@/db/types';
import { useCompany } from '@/app/company';
import { qrDataUrl } from '@/lib/qr';
import { unitText } from '@/lib/units';
import { currentLanguage, tp, t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, NumberInput } from '@/components/ui/form';
import { Segmented, Spinner } from '@/components/ui/misc';
import {
  isLabelLayout,
  LABEL_LAYOUTS,
  labelBox,
  labelPages,
  type LabelLayout,
  type LabelLayoutId,
} from '@/apps/books/features/inventory/item-labels';
import { useInventory, useUnitAmount } from '@/apps/books/features/inventory/use-inventory';
import { MmBox, MmPage, MmPageStyle, TestGrid, type MmOffset } from '@/features/print/mm-page';

const LAYOUT_KEY = 'item-labels:layout';
const offsetKey = (layout: LabelLayoutId) => `item-labels:offset:${layout}`;

/** What this device remembers: the label paper and how far its printer is off (D3). */
function remembered<T>(key: string, read: (raw: string) => T | null, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return (raw ? read(raw) : null) ?? fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows: nothing is kept.
  }
}

function readOffset(raw: string): MmOffset | null {
  const value = JSON.parse(raw) as Partial<MmOffset> | null;
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

const clampOffset = (n: number) => Math.max(-20, Math.min(20, Math.round(n * 10) / 10));

/**
 * Labels for items: their QR code (of the SKU), name, SKU and price, on an
 * A4 sheet of 24 or on a thermal label printer. `?ids=` chooses the items
 * (all active items with an SKU otherwise). It only reads.
 */
export default function ItemLabelsPrintPage() {
  const inventory = useInventory();
  const unitAmount = useUnitAmount();
  const [params] = useSearchParams();
  const [layoutId, setLayoutId] = useState<LabelLayoutId>(() => {
    const asked = params.get('layout');
    return isLabelLayout(asked)
      ? asked
      : remembered(LAYOUT_KEY, (raw) => (isLabelLayout(raw) ? raw : null), 'a4-3x8');
  });
  const [offset, setOffset] = useState<MmOffset>(() =>
    remembered(offsetKey(layoutId), readOffset, { x: 0, y: 0 }),
  );
  const [copies, setCopies] = useState(1);
  const [skip, setSkip] = useState(0);
  const [showPrice, setShowPrice] = useState(params.get('price') !== '0');
  const [testPage, setTestPage] = useState(false);
  const [codes, setCodes] = useState<Map<string, string> | null>(null);
  const layout = LABEL_LAYOUTS[layoutId];

  const ids = params.get('ids');
  const { items, uncoded } = useMemo(() => {
    if (!inventory) return { items: [], uncoded: 0 };
    const wanted = ids ? new Set(ids.split(',').filter(Boolean)) : null;
    const chosen = inventory.products
      .filter((p) => (wanted ? wanted.has(p.id) : !p.archived))
      .sort((a, b) => localName(a).localeCompare(localName(b)));
    const coded = chosen.filter((p) => p.sku.trim());
    return { items: coded, uncoded: chosen.length - coded.length };
  }, [inventory, ids]);

  const skus = useMemo(() => [...new Set(items.map((p) => p.sku.trim()))], [items]);
  useEffect(() => {
    let live = true;
    void Promise.all(skus.map(async (sku) => [sku, await qrDataUrl(sku, 320)] as const)).then(
      (pairs) => {
        if (!live) return;
        setCodes(new Map(pairs.filter((p): p is [string, string] => p[1] !== null)));
      },
    );
    return () => {
      live = false;
    };
  }, [skus]);

  if (!inventory || !codes) return <Spinner className="min-h-dvh" label={t('Loading…')} />;

  const pages = labelPages(items, layout, copies, layout.rows > 1 ? skip : 0);
  const perPage = layout.columns * layout.rows;
  const chooseLayout = (next: LabelLayoutId) => {
    setLayoutId(next);
    remember(LAYOUT_KEY, next);
    setOffset(remembered(offsetKey(next), readOffset, { x: 0, y: 0 }));
  };
  const moveBy = (patch: Partial<MmOffset>) => {
    const next = { ...offset, ...patch };
    setOffset(next);
    remember(offsetKey(layoutId), JSON.stringify(next));
  };

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <MmPageStyle width={layout.page.width} height={layout.page.height} />
      <div className="mx-auto mb-4 max-w-4xl space-y-4 px-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/products"
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="size-4" /> {t('Products & services')}
          </Link>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              aria-pressed={testPage}
              onClick={() => setTestPage((on) => !on)}
            >
              <Grid3x3 /> {testPage ? t('Show the labels') : t('Test page')}
            </Button>
            <Button onClick={() => window.print()} disabled={!testPage && pages.length === 0}>
              <Printer /> {t('Print')}
            </Button>
          </div>
        </div>
        <div className="bg-surface space-y-4 rounded-xl p-4 shadow-xs ring-1 ring-slate-200">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{t('Print labels')}</h1>
            <p className="text-sm text-slate-500">
              {tp(items.length, '{count} item', '{count} items')} ·{' '}
              {t('The QR code holds the SKU: a scanner types it into item search.')}
            </p>
          </div>
          <Segmented
            value={layoutId}
            onChange={chooseLayout}
            options={Object.values(LABEL_LAYOUTS).map((l) => ({ value: l.id, label: t(l.name) }))}
          />
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label={t('Copies of each')}>
              {(id) => (
                <NumberInput
                  id={id}
                  value={copies}
                  allowNegative={false}
                  onValueChange={(v) => setCopies(Math.max(1, Math.min(100, Math.round(v))))}
                />
              )}
            </Field>
            {layout.rows > 1 ? (
              <Field
                label={t('Start at label')}
                hint={t('To use a sheet that has labels missing.')}
              >
                {(id) => (
                  <NumberInput
                    id={id}
                    value={skip + 1}
                    allowNegative={false}
                    onValueChange={(v) =>
                      setSkip(Math.max(0, Math.min(perPage - 1, Math.round(v) - 1)))
                    }
                  />
                )}
              </Field>
            ) : null}
            <Field label={t('Move right (mm)')} hint={t('Remembered on this device.')}>
              {(id) => (
                <NumberInput
                  id={id}
                  value={offset.x}
                  onValueChange={(v) => moveBy({ x: clampOffset(v) })}
                />
              )}
            </Field>
            <Field label={t('Move down (mm)')}>
              {(id) => (
                <NumberInput
                  id={id}
                  value={offset.y}
                  onValueChange={(v) => moveBy({ y: clampOffset(v) })}
                />
              )}
            </Field>
          </div>
          <Checkbox
            label={t('Show the price')}
            checked={showPrice}
            onChange={(e) => setShowPrice(e.target.checked)}
          />
          {uncoded > 0 ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {tp(
                uncoded,
                '{count} item has no SKU, so it has no label.',
                '{count} items have no SKU, so they have no label.',
              )}
            </p>
          ) : null}
          {testPage ? (
            <p className="text-sm text-slate-600">
              {t(
                'Print the grid on plain paper and hold it over a sheet of labels: if the lines are off, move the labels by that much.',
              )}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-6 overflow-x-auto px-4 print:space-y-0 print:overflow-visible print:px-0">
        {testPage ? (
          <MmPage width={layout.page.width} height={layout.page.height} offset={offset}>
            <TestGrid width={layout.page.width} height={layout.page.height} />
            {Array.from({ length: perPage }, (_, slot) => (
              <MmBox
                key={slot}
                {...labelBox(layout, slot)}
                className="border border-dashed border-slate-500"
              />
            ))}
          </MmPage>
        ) : pages.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500 print:hidden">
            {t('Nothing to print.')}
          </p>
        ) : (
          pages.map((page, index) => (
            <MmPage
              key={index}
              width={layout.page.width}
              height={layout.page.height}
              offset={offset}
              label={t('Sheet {number}', { number: index + 1 })}
            >
              {page.map((product, slot) =>
                product ? (
                  <MmBox key={slot} {...labelBox(layout, slot)}>
                    <ItemLabel
                      product={product}
                      qr={codes.get(product.sku.trim()) ?? null}
                      layout={layout}
                      price={showPrice ? unitAmount(product.unitPrice) : null}
                    />
                  </MmBox>
                ) : null,
              )}
            </MmPage>
          ))
        )}
      </div>
    </div>
  );
}

function ItemLabel({
  product,
  qr,
  layout,
  price,
}: {
  product: Product;
  qr: string | null;
  layout: LabelLayout;
  price: string | null;
}) {
  const company = useCompany();
  const unit = unitText(company, product, currentLanguage());
  const small = layout.cell.height < 30;
  const pad = small ? 1.5 : 2.5;
  const nameAr = product.nameAr?.trim();
  return (
    <div
      className="flex h-full items-center"
      style={{ padding: `${pad}mm`, gap: `${small ? 1.5 : 2.5}mm` }}
      data-sku={product.sku}
    >
      {qr ? (
        <img
          src={qr}
          alt={t('QR code of {sku}', { sku: product.sku })}
          className="shrink-0"
          style={{ width: `${layout.qr}mm`, height: `${layout.qr}mm` }}
        />
      ) : null}
      <div
        className="flex min-w-0 flex-1 flex-col justify-center leading-tight"
        style={{ fontSize: small ? '6.5pt' : '8pt', gap: small ? '0.5mm' : '1mm' }}
      >
        <p className="line-clamp-2 font-semibold break-words" dir="auto">
          {product.name}
        </p>
        {nameAr && nameAr !== product.name ? (
          <p className="line-clamp-2 break-words" dir="rtl" lang="ar">
            {nameAr}
          </p>
        ) : null}
        <p className="font-mono break-all text-slate-700" dir="ltr">
          {product.sku}
        </p>
        {price ? (
          <p className="font-semibold" style={{ fontSize: small ? '7.5pt' : '9.5pt' }} dir="ltr">
            <bdi>{price}</bdi>
            {unit ? (
              <span className="font-normal text-slate-600">
                {' / '}
                <bdi>{unit}</bdi>
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
