import type { Payment } from '@/db/types';
import { chequeStatusMeta } from '@/lib/status';
import { t } from '@/i18n';
import { Badge } from '@/components/ui/misc';
import { paymentDirection } from './direction';

/** A badge for void payments and for cheques, so returned cheques stand out. */
export function PaymentStatusBadge({
  payment,
  className,
}: {
  payment: Pick<Payment, 'cheque' | 'voided' | 'direction'>;
  className?: string;
}) {
  if (payment.cheque) {
    const meta = chequeStatusMeta(payment.cheque.status, paymentDirection(payment));
    return (
      <Badge tone={meta.tone} className={className}>
        {t(meta.label)}
      </Badge>
    );
  }
  if (payment.voided) {
    return (
      <Badge tone="slate" className={className}>
        {t('Voided')}
      </Badge>
    );
  }
  return null;
}
