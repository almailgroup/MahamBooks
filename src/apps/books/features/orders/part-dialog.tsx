import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ID, InvoiceDocument } from '@/db/types';
import { createFromOrder, progressOf, remainingOf, type PartTarget } from '@/db/orders';
import type { LineProgress } from '@/lib/orders';
import { useFormat } from '@/app/company';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/form';
import { Spinner } from '@/components/ui/misc';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';

function titleOf(target: PartTarget): string {
  if (target === 'invoice') return t('Create invoice');
  if (target === 'bill') return t('Convert to bill');
  return t('Create delivery note');
}

/** "Invoiced 2 pcs", "Billed 2", "Delivered 1 · 1 on a draft delivery note". */
function doneText(
  p: LineProgress,
  target: PartTarget,
  quantity: (n: number) => string,
): string | null {
  if (target === 'delivery_note') {
    const parts: string[] = [];
    if (p.delivered) parts.push(t('Delivered {quantity}', { quantity: quantity(p.delivered) }));
    if (p.inDelivery) {
      parts.push(t('{quantity} on draft delivery notes', { quantity: quantity(p.inDelivery) }));
    }
    return parts.join(' · ') || null;
  }
  if (!p.invoiced) return null;
  return target === 'bill'
    ? t('Billed {quantity}', { quantity: quantity(p.invoiced) })
    : t('Invoiced {quantity}', { quantity: quantity(p.invoiced) });
}

function PartForm({
  doc,
  target,
  progress,
  onCancel,
  onCreated,
}: {
  doc: InvoiceDocument;
  target: PartTarget;
  progress: LineProgress[];
  onCancel: () => void;
  onCreated: (created: InvoiceDocument) => void;
}) {
  const fmt = useFormat();
  const [quantities, setQuantities] = useState<Record<ID, number>>(() =>
    Object.fromEntries(progress.map((p) => [p.line.id, remainingOf(p, target)])),
  );
  const [busy, setBusy] = useState(false);
  const withUnit = (n: number, unit: string) =>
    unit ? `${fmt.quantity(n)} ${unit}` : fmt.quantity(n);

  const tooMuch = (p: LineProgress) => (quantities[p.line.id] ?? 0) > remainingOf(p, target);
  const invalid = progress.some(tooMuch);
  const nothing = progress.every((p) => !((quantities[p.line.id] ?? 0) > 0));
  const set = (value: (p: LineProgress) => number) =>
    setQuantities(Object.fromEntries(progress.map((p) => [p.line.id, value(p)])));

  const submit = async () => {
    setBusy(true);
    try {
      const created = await createFromOrder(doc.id, target, quantities);
      onCreated(created);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
      setBusy(false);
    }
  };

  return (
    <>
      <DialogBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">
            {t('Everything that is left is filled in. Change a quantity to take part of a line.')}
          </p>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => set((p) => remainingOf(p, target))}>
              {t('All remaining')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => set(() => 0)}>
              {t('Clear')}
            </Button>
          </div>
        </div>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {progress.map((p, index) => {
            const left = remainingOf(p, target);
            const name = localName(p.line) || p.line.description || '—';
            const done = doneText(p, target, (n) => withUnit(n, p.line.unit));
            return (
              <li key={p.line.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{name}</p>
                  <p className="text-xs text-slate-500">
                    {t('Ordered {quantity}', { quantity: withUnit(p.ordered, p.line.unit) })}
                    {done ? ` · ${done}` : ''}
                  </p>
                </div>
                {left > 0 ? (
                  <div className="sm:w-40">
                    <NumberInput
                      aria-label={t('Quantity for line {number}', { number: index + 1 })}
                      value={quantities[p.line.id] ?? 0}
                      onValueChange={(value) =>
                        setQuantities((q) => ({ ...q, [p.line.id]: value }))
                      }
                      allowNegative={false}
                      aria-invalid={tooMuch(p)}
                    />
                    <p
                      className={
                        tooMuch(p) ? 'mt-1 text-xs text-red-600' : 'mt-1 text-xs text-slate-500'
                      }
                    >
                      {t('{quantity} left', { quantity: withUnit(left, p.line.unit) })}
                    </p>
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                    <CheckCircle2 className="size-4" aria-hidden /> {t('Nothing left')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button onClick={() => void submit()} loading={busy} disabled={busy || invalid || nothing}>
          {titleOf(target)}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Chooses how much of each line of an order (or invoice) goes on a new
 * invoice, bill or delivery note; what is left is filled in.
 */
export function PartDialog({
  open,
  onOpenChange,
  doc,
  target,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: InvoiceDocument;
  target: PartTarget;
  onCreated: (created: InvoiceDocument) => void;
}) {
  const progress = useLiveQuery(() => progressOf(doc), [doc]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={titleOf(target)} description={doc.number} size="lg">
        {progress ? (
          <PartForm
            doc={doc}
            target={target}
            progress={progress}
            onCancel={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        ) : (
          <Spinner className="py-12" />
        )}
      </DialogContent>
    </Dialog>
  );
}
