import { tp } from '@/i18n';

/**
 * The warning shown before something removes changes that have not reached
 * the cloud yet: removing a company from this device, restoring a backup
 * with Replace, deleting all data, leaving a company.
 */
export function unsentWarning(count: number): string {
  return tp(
    count,
    '{count} change has not reached the cloud yet and will be lost. Sync first if you can.',
    '{count} changes have not reached the cloud yet and will be lost. Sync first if you can.',
  );
}
