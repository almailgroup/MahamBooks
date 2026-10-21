import type { ExpiryInfo } from '@/lib/compliance';
import { Badge } from '@/components/ui/misc';
import type { StatusTone } from '@/lib/status';
import { t } from '@/i18n';
import { daysLeftLabel } from './text';

export { daysLeftLabel, daysText, entryOwner, entryTitle, purposeName, vehicleLabel } from './text';

const TONES: Record<ExpiryInfo['status'], StatusTone> = {
  valid: 'green',
  expiring: 'amber',
  expired: 'red',
};

/** Valid, expiring (with the days left) or expired. */
export function ExpiryBadge({ info, className }: { info: ExpiryInfo; className?: string }) {
  if (info.daysLeft === null) {
    return (
      <Badge tone="gray" className={className}>
        {t('No expiry date')}
      </Badge>
    );
  }
  const tone = info.status === 'expiring' && info.daysLeft <= 7 ? 'red' : TONES[info.status];
  const label =
    info.status === 'expired'
      ? t('Expired')
      : info.status === 'expiring'
        ? daysLeftLabel(info.daysLeft)
        : t('Valid');
  return (
    <Badge tone={tone} className={className}>
      {label}
    </Badge>
  );
}
