import { useEffect, useState } from 'react';
import { qrDataUrl } from '@/lib/qr';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';

/** The QR code of an item's SKU, drawn on the device (never stored). */
export function useItemQr(sku: string, width = 240): string | null {
  const text = sku.trim();
  const [drawn, setDrawn] = useState<{ text: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!text) return;
    let live = true;
    void qrDataUrl(text, width).then((url) => {
      if (live) setDrawn({ text, url });
    });
    return () => {
      live = false;
    };
  }, [text, width]);
  return text && drawn?.text === text ? drawn.url : null;
}

/** The QR code of an SKU, as it prints on labels. */
export function ItemQr({ sku, className }: { sku: string; className?: string }) {
  const url = useItemQr(sku);
  return (
    <div
      className={cn(
        'paper flex size-20 shrink-0 items-center justify-center rounded-md bg-white p-1.5 ring-1 ring-slate-200',
        className,
      )}
    >
      {url ? (
        <img src={url} alt={t('QR code of {sku}', { sku: sku.trim() })} className="size-full" />
      ) : null}
    </div>
  );
}
